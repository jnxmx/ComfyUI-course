import { WorkerMailer } from 'worker-mailer';
import type { Env, Order } from './types';
import { botStartUrl, bytesToBase64, deadline, escapeHtml, fmtDateTime, money, payUrl } from './util';

export interface Attachment { filename: string; bytes: Uint8Array }

export async function sendMail(env: Env, to: string, subject: string, paragraphs: string[], attachments: Attachment[] = []): Promise<boolean> {
  // paragraphs: простой текст; ссылки вида [текст](url) превращаются в <a>
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const text = paragraphs.map((p) => p.replace(linkRe, '$1: $2')).join('\n\n');
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">${paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`)}</p>`)
    .join('')}</div>`;
  if (env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM}>`,
          to: [to],
          ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}),
          subject,
          text,
          html,
          ...(attachments.length
            ? {
                attachments: attachments.map((a) => ({
                  filename: a.filename,
                  content: bytesToBase64(a.bytes),
                  content_type: 'application/pdf',
                })),
              }
            : {}),
        }),
      });
      if (!r.ok) {
        console.error('resend failed', r.status, await r.text());
        return false;
      }
      return true;
    } catch (e) {
      console.error('resend error', to, subject, e);
      return false;
    }
  }

  const pass = env.SMTP_PASSWORD ?? env.GMAIL_APP_PASSWORD;
  if (!pass) {
    console.warn('mail skipped: no RESEND_API_KEY or SMTP_PASSWORD');
    return false;
  }
  try {
    const mailer = await WorkerMailer.connect({
      host: env.MAIL_SMTP_HOST || 'smtp.zoho.eu',
      port: Number(env.MAIL_SMTP_PORT) || 465,
      secure: true,
      credentials: { username: env.MAIL_FROM, password: pass },
      authType: 'plain',
    });
    await mailer.send({
      from: { name: env.MAIL_FROM_NAME, email: env.MAIL_FROM },
      to: { email: to },
      ...(env.MAIL_REPLY_TO ? { reply: env.MAIL_REPLY_TO } : {}),
      subject,
      text,
      html,
      attachments: attachments.map((a) => ({ filename: a.filename, content: bytesToBase64(a.bytes), mimeType: 'application/pdf' })),
    });
    await mailer.close();
    return true;
  } catch (e) {
    console.error('mail failed', to, subject, e);
    return false;
  }
}

const hello = (o: Order) => (o.name ? `Здравствуйте, ${o.name.split(' ')[0]}!` : 'Здравствуйте!');
const sign = (env: Env) => `Если есть вопросы — напишите [боту курса](${botStartUrl(env)}), он передаст их мне.\n\n${env.MAIL_FROM_NAME}`;

export function orderCreatedMail(env: Env, o: Order): { subject: string; body: string[] } {
  const dl = fmtDateTime(deadline(env, o));
  const page = payUrl(env, o);
  if (o.currency === 'RUB' && o.payer_type === 'person') {
    return {
      subject: `Оплата курса ${env.COURSE_TITLE} — заказ ${o.code}`,
      body: [
        hello(o),
        `Спасибо за регистрацию на курс «${env.COURSE_TITLE}» (${env.COURSE_STREAM}). Место за вами закреплено до ${dl}.`,
        `Как оплатить — перевод по СБП:\n• Сумма: ${money(o.amount, 'RUB')}\n• Номер телефона: ${env.RU_SBP_PHONE}\n• Банк получателя: ${env.RU_SBP_BANK}\n• Получатель: ${env.RU_PAYEE_NAME}\n• Комментарий к переводу: Оплата курса по ComfyUI`,
        `После перевода нажмите «Я оплатил(а)» на [странице заказа](${page}). Как только я подтвержу поступление, вам придёт письмо со ссылкой на группу курса в Telegram и чек.`,
        sign(env),
      ],
    };
  }
  if (o.currency === 'RUB') {
    return {
      subject: `Счёт на оплату курса ${env.COURSE_TITLE} — ${o.code}`,
      body: [
        hello(o),
        `Во вложении счёт № ${o.code} на оплату участия в курсе «${env.COURSE_TITLE}» для ${o.company_name ?? 'вашей организации'} на сумму ${money(o.amount, 'RUB')} (без НДС, исполнитель — плательщик НПД).`,
        `Пожалуйста, укажите в назначении платежа: «Оплата по счёту № ${o.code}. Без НДС». Счёт действителен до ${dl}.`,
        `Документы и реквизиты также доступны на [странице заказа](${page}). После оплаты вы получите чек самозанятого, а по окончании курса — акт.`,
        sign(env),
      ],
    };
  }
  return {
    subject: `Оплата курса ${env.COURSE_TITLE} — заказ ${o.code}`,
    body: [
      hello(o),
      `Спасибо за регистрацию на курс «${env.COURSE_TITLE}» (${env.COURSE_STREAM}). Место за вами закреплено до ${dl}.`,
      `Есть два способа оплаты:\n• ${money(Number(env.PRICE_EUR_CARD), 'EUR')} — картой, Apple Pay / Google Pay, PayPal (мгновенно).\n• ${money(Number(env.PRICE_EUR_IBAN), 'EUR')} — банковским переводом SEPA (скидка). Реквизиты и проформа-инвойс во вложении, референс платежа: ${o.code}.`,
      `Выбрать способ и оплатить: [страница заказа](${page}).`,
      sign(env),
    ],
  };
}

export function paidMail(env: Env, o: Order): { subject: string; body: string[] } {
  const groupAction = o.invite_link
    ? `Ссылка для входа в закрытую группу курса в Telegram:\n${o.invite_link}\n\nТакже вы можете подключить [Telegram-бота курса](${botStartUrl(env, o)}) для получения персональных уведомлений и связи с преподавателем.`
    : `Чтобы попасть в группу курса в Telegram, откройте бота по [этой ссылке](${botStartUrl(env, o)}) и нажмите «Start» — он сразу пришлёт приглашение в группу. Ссылка персональная, не пересылайте её.`;

  return {
    subject: `Оплата получена — добро пожаловать на курс! (${o.code})`,
    body: [
      hello(o),
      `Оплата ${money(o.amount_paid ?? o.amount, o.currency)} по заказу ${o.code} получена. Спасибо!`,
      groupAction,
      'Пожалуйста, перед первым занятием зарегистрируйте аккаунты на сайтах runpod, huggingface и civitai\nhttps://runpod.io?ref=x9hq16nj (моя реферальная ссылка)\nhttps://huggingface.co/join\nhttps://civitai.com/login',
      o.currency === 'RUB'
        ? 'Чек самозанятого из «Мой налог» пришлю отдельным письмом.'
        : o.invoice_number ? `Счёт (facture ${o.invoice_number}) во вложении.` : '',
      sign(env),
    ].filter(Boolean),
  };
}

export function reminderMail(env: Env, o: Order): { subject: string; body: string[] } {
  return {
    subject: `Напоминание об оплате курса — ${o.code}`,
    body: [
      hello(o),
      `Напоминаю, что место на курсе «${env.COURSE_TITLE}» закреплено за вами до ${fmtDateTime(deadline(env, o))}. После этого заявка будет автоматически отменена.`,
      `Реквизиты и способы оплаты: [страница заказа](${payUrl(env, o)}).`,
      'Если вы уже оплатили — нажмите на этой странице «Я оплатил(а)», и я проверю поступление.',
      sign(env),
    ],
  };
}

export function cancelledMail(env: Env, o: Order): { subject: string; body: string[] } {
  return {
    subject: `Заявка ${o.code} отменена`,
    body: [
      hello(o),
      `Оплата по заявке ${o.code} не поступила вовремя, поэтому заявка отменена и место освобождено.`,
      `Если вы всё ещё хотите участвовать — зарегистрируйтесь заново на [сайте курса](${env.SITE_URL}/#pricing). Если вы уже оплатили, просто ответьте боту — разберёмся.`,
      sign(env),
    ],
  };
}

export function receiptMail(env: Env, o: Order, url: string): { subject: string; body: string[] } {
  return {
    subject: `Чек об оплате курса — ${o.code}`,
    body: [hello(o), `Ваш чек самозанятого (ФНС, «Мой налог») по заказу ${o.code}: [открыть чек](${url})`, sign(env)],
  };
}

export function actMail(env: Env, o: Order): { subject: string; body: string[] } {
  return {
    subject: `Акт об оказании услуг — ${o.code}`,
    body: [hello(o), `Во вложении акт об оказании услуг по счёту № ${o.code} (курс «${env.COURSE_TITLE}»).`, sign(env)],
  };
}
