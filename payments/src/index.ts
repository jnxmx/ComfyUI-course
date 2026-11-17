import { adminOrderKb, adminOrderText, confirmOrderPaid, handleTelegramWebhook, markOrderClaimed } from './bot';
import { lookupByInn } from './dadata';
import { createOrder, getOrderByToken, getOrderByTallyId, listOpenOrders, transitionStatus, updateOrder } from './db';
import { cancelledMail, orderCreatedMail, reminderMail, sendMail, type Attachment } from './mail';
import { renderOrderPage } from './pages';
import { buildEuInvoicePdf, buildRuCompanyActPdf, buildRuCompanyInvoicePdf } from './pdf';
import { createStripeCheckout, verifyStripeWebhook } from './stripe';
import { parseTally, verifyTallySignature } from './tally';
import { sendAdmin, sendDocument, sendMessage, tg } from './telegram';
import type { Env, Order } from './types';
import { deadline, escapeHtml, now, payUrl, timingSafeEqual } from './util';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // 1. Одноразовая регистрация вебхука Telegram: GET /setup?key=<ADMIN_KEY>
      if (path === '/setup') {
        const key = url.searchParams.get('key') ?? '';
        if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) return new Response('forbidden', { status: 403 });
        const wh = await tg(env, 'setWebhook', {
          url: `${env.PUBLIC_URL}/webhooks/telegram`,
          secret_token: env.TG_WEBHOOK_SECRET,
          allowed_updates: ['message', 'callback_query', 'chat_join_request'],
        });
        await tg(env, 'setMyCommands', {
          commands: [{ command: 'orders', description: 'Список открытых и оплаченных заявок' }],
          scope: { type: 'chat', chat_id: env.ADMIN_CHAT_ID },
        });
        return Response.json({ ok: true, webhook: wh });
      }

      // 2. Вебхук Tally (регистрация на курс)
      if (path === '/webhooks/tally' && req.method === 'POST') {
        const raw = await req.text();
        if (!(await verifyTallySignature(env, raw, req.headers.get('tally-signature')))) {
          return new Response('bad signature', { status: 401 });
        }
        const parsed = parseTally(JSON.parse(raw));
        if (!parsed) return Response.json({ ok: true, skipped: 'no email' });

        if (parsed.responseId) {
          const existing = await getOrderByTallyId(env, parsed.responseId);
          if (existing) return Response.json({ ok: true, duplicate: existing.code, url: payUrl(env, existing) });
        }

        let companyKpp: string | null = null;
        let companyAddress: string | null = null;
        let companyOgrn: string | null = null;
        let companyName = parsed.companyName;
        if (parsed.payerType === 'company' && parsed.companyInn) {
          const info = await lookupByInn(env, parsed.companyInn);
          if (info) {
            companyName = info.name || companyName;
            companyKpp = info.kpp;
            companyAddress = info.address;
            companyOgrn = info.ogrn;
          }
        }

        const amount =
          parsed.customAmountMinor ??
          (parsed.currency === 'EUR'
            ? Number(env.PRICE_EUR_IBAN)
            : parsed.payerType === 'company'
              ? Number(env.PRICE_RUB_COMPANY)
              : Number(env.PRICE_RUB_PERSON));

        const order = await createOrder(env, {
          tally_response_id: parsed.responseId,
          currency: parsed.currency,
          payer_type: parsed.payerType,
          amount,
          name: parsed.name,
          email: parsed.email,
          telegram: parsed.telegram,
          phone: parsed.phone,
          company_inn: parsed.companyInn,
          company_kpp: companyKpp,
          company_name: companyName,
          company_address: companyAddress,
          company_ogrn: companyOgrn,
          raw_fields: parsed.rawFields,
        });

        ctx.waitUntil(onOrderCreated(env, order));
        return Response.json({ ok: true, code: order.code, url: payUrl(env, order) });
      }

      // 3. Вебхук Stripe
      if (path === '/webhooks/stripe' && req.method === 'POST') {
        const raw = await req.text();
        const evt = await verifyStripeWebhook(env, raw, req.headers.get('stripe-signature'));
        if (!evt) return new Response('bad stripe sig', { status: 400 });
        if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
          const s = evt.data?.object;
          const token: string | undefined = s?.metadata?.order_token ?? s?.client_reference_id;
          if (token && s?.payment_status === 'paid') {
            const o = await getOrderByToken(env, token);
            if (o) {
              ctx.waitUntil(
                confirmOrderPaid(env, o, {
                  amountPaid: Number(s.amount_total ?? env.PRICE_EUR_CARD),
                  method: 'stripe',
                  stripeSessionId: s.id,
                }),
              );
            }
          }
        }
        return Response.json({ received: true });
      }

      // 4. Вебхук Telegram-бота
      if (path === '/webhooks/telegram' && req.method === 'POST') {
        const sec = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
        if (env.TG_WEBHOOK_SECRET && !timingSafeEqual(sec, env.TG_WEBHOOK_SECRET)) {
          return new Response('unauthorized', { status: 401 });
        }
        const update = await req.json();
        ctx.waitUntil(handleTelegramWebhook(env, update));
        return Response.json({ ok: true });
      }

      // 5. Персональная страница заказа и PDF: /p/<token>[/claim|/stripe|/invoice.pdf|/act.pdf]
      const m = path.match(/^\/p\/([A-Za-z0-9_-]+)(?:\/(claim|stripe|invoice\.pdf|act\.pdf))?$/);
      if (m) {
        const o = await getOrderByToken(env, m[1]);
        if (!o) return new Response('Заказ не найден', { status: 404 });
        const sub = m[2];

        if (!sub && req.method === 'GET') return renderOrderPage(env, o);

        if (sub === 'claim' && req.method === 'POST') {
          ctx.waitUntil(markOrderClaimed(env, o, 'на странице оплаты'));
          return Response.redirect(payUrl(env, o), 303);
        }

        if (sub === 'stripe' && req.method === 'POST' && o.currency === 'EUR' && o.status !== 'paid') {
          const sess = await createStripeCheckout(env, o);
          if (!sess) return new Response('Не удалось создать сессию Stripe', { status: 502 });
          await updateOrder(env, o.id, { stripe_session_id: sess.id });
          return Response.redirect(sess.url, 303);
        }

        if (sub === 'invoice.pdf' && req.method === 'GET') {
          const bytes =
            o.currency === 'EUR'
              ? await buildEuInvoicePdf(env, o, o.status === 'paid')
              : await buildRuCompanyInvoicePdf(env, o);
          const fname = o.currency === 'EUR' ? `${o.status === 'paid' ? 'Facture' : 'Devis'}-${o.invoice_number ?? o.code}.pdf` : `Schet-${o.code}.pdf`;
          return new Response(bytes, {
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': `inline; filename="${fname}"`,
            },
          });
        }

        if (sub === 'act.pdf' && req.method === 'GET' && o.payer_type === 'company') {
          const bytes = await buildRuCompanyActPdf(env, o);
          return new Response(bytes, {
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': `inline; filename="Akt-${o.code}.pdf"`,
            },
          });
        }
      }

      if (path === '/' || path === '/health') return Response.json({ ok: true, service: 'comfyui-course-payments' });
      return new Response('not found', { status: 404 });
    } catch (e) {
      console.error('unhandled error', e);
      return new Response('internal error', { status: 500 });
    }
  },

  /** Почасовой крон: напоминание об оплате и автоотмена просроченных неоплаченных заявок */
  async scheduled(_ctrl: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const ts = now();
    const remindSec = (Number(env.REMIND_AFTER_HOURS) || 24) * 3600;
    const open = await listOpenOrders(env);

    for (const o of open) {
      const dl = deadline(env, o);

      // Если клиент уже нажал «Я оплатил(а)», автоматически не отменяем — только напомним тебе в бот
      if (ts > dl && o.status === 'pending') {
        const ok = await transitionStatus(env, o.id, ['pending'], 'cancelled', { cancelled_at: ts });
        if (ok) {
          const m = cancelledMail(env, o);
          await sendMail(env, o.email, m.subject, m.body);
          if (o.tg_user_id) {
            await sendMessage(env, o.tg_user_id, `Срок оплаты по заявке <b>${escapeHtml(o.code)}</b> истёк, заявка отменена.`);
          }
          await sendAdmin(env, `⌛ Автоотмена просроченной заявки <b>${escapeHtml(o.code)}</b> (${escapeHtml(o.email)})`);
        }
        continue;
      }

      if (o.status === 'pending' && !o.reminder_sent_at && ts - o.created_at >= remindSec && dl - ts > 2 * 3600) {
        await updateOrder(env, o.id, { reminder_sent_at: ts });
        const m = reminderMail(env, o);
        await sendMail(env, o.email, m.subject, m.body);
      }
    }
  },
};

async function onOrderCreated(env: Env, o: Order): Promise<void> {
  const attachments: Attachment[] = [];
  if (o.payer_type === 'company') {
    const pdf = await buildRuCompanyInvoicePdf(env, o);
    attachments.push({ filename: `Schet-${o.code}.pdf`, bytes: pdf });
  } else if (o.currency === 'EUR') {
    const pdf = await buildEuInvoicePdf(env, o, false);
    attachments.push({ filename: `Devis-${o.code}.pdf`, bytes: pdf });
  }

  const m = orderCreatedMail(env, o);
  await sendMail(env, o.email, m.subject, m.body, attachments);

  await sendAdmin(env, adminOrderText(env, o, '🆕 Новая заявка'), adminOrderKb(env, o));
  if (attachments[0]) {
    await sendDocument(env, env.ADMIN_CHAT_ID, attachments[0].filename, attachments[0].bytes);
  }
}
