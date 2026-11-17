import {
  getAdminMsg,
  getLatestOrderByTgUser,
  getOrderByCode,
  getOrderById,
  getOrderByToken,
  getPaidOrderByInviteLink,
  getPaidOrderByTgHandle,
  getPaidOrderByTgUser,
  listOpenOrders,
  listPaidOrders,
  nextCounter,
  saveAdminMsg,
  setTgUser,
  touchTgUser,
  transitionStatus,
  updateOrder,
} from './db';
import { actMail, cancelledMail, paidMail, receiptMail, sendMail, type Attachment } from './mail';
import { buildEuInvoicePdf, buildRuCompanyActPdf } from './pdf';
import { createJoinLink, kb, sendAdmin, sendDocument, sendMessage, tg } from './telegram';
import type { Env, Method, Order } from './types';
import { botStartUrl, cleanTgHandle, escapeHtml, fmtDate, money, now, orderLabel, payUrl, SERVICE_NAME_RU } from './util';

const h = escapeHtml;

export function personalConfirmationText(env: Env, o: Order): string {
  const name = o.name ? ` ${o.name}` : '';
  const groupLink = o.invite_link || botStartUrl(env, o);
  const lines = [
    `Здравствуйте${name}!`,
    `Оплата по курсу ComfyUI (заказ ${o.code}) подтверждена ✅`,
    ``,
    `Ссылка для входа в закрытую группу курса в Telegram:`,
    groupLink,
  ];

  if (o.currency === 'EUR') {
    lines.push(``, `Счёт / Facture (PDF):`, `${env.PUBLIC_URL}/p/${o.token}/invoice.pdf`);
  } else if (o.payer_type === 'company') {
    lines.push(``, `Счёт-договор (PDF):`, `${env.PUBLIC_URL}/p/${o.token}/invoice.pdf`);
    lines.push(`Акт (PDF):`, `${env.PUBLIC_URL}/p/${o.token}/act.pdf`);
  } else if (o.receipt_url) {
    lines.push(``, `Чек ФНС «Мой налог»:`, o.receipt_url);
  }

  lines.push(
    ``,
    `Пожалуйста, перед первым занятием зарегистрируйте аккаунты на сайтах:`,
    `• https://runpod.io?ref=x9hq16nj (моя реферальная ссылка)`,
    `• https://huggingface.co/join`,
    `• https://civitai.com/login`,
    ``,
    `Если возникнут вопросы — пишите прямо сюда!`,
  );
  return lines.join('\n');
}

export function personalOrderText(env: Env, o: Order): string {
  const name = o.name ? ` ${o.name}` : '';
  return [
    `Здравствуйте${name}!`,
    `Это Иван Якушев по поводу курса «ComfyUI для работы с нейросетями».`,
    `Ваша заявка № ${o.code} принята.`,
    ``,
    `Страница оплаты и реквизиты:`,
    payUrl(env, o),
    ``,
    `Если возникнут вопросы — пишите!`,
  ].join('\n');
}

export function adminOrderKb(env: Env, o: Order) {
  const handle = cleanTgHandle(o.telegram);
  const rows: { text: string; data?: string; url?: string }[][] = [];

  if (handle) {
    const text = o.status === 'paid' ? personalConfirmationText(env, o) : personalOrderText(env, o);
    const label = o.status === 'paid' ? '💬 Отправить подтверждение лично' : '💬 Написать клиенту лично';
    rows.push([{ text: label, url: `https://t.me/${handle}?text=${encodeURIComponent(text)}` }]);
  }

  if (o.status === 'paid') {
    const actRow: { text: string; data?: string; url?: string }[] = [];
    if (o.payer_type === 'company') actRow.push({ text: '📄 Отправить акт', data: `act:${o.id}` });
    if (actRow.length) rows.push(actRow);
    return rows.length ? kb(rows) : {};
  }
  if (o.status === 'cancelled') return rows.length ? kb(rows) : {};

  rows.push([
    { text: `✅ Оплачено (${money(o.amount, o.currency)})`, data: `paid:${o.id}` },
    { text: '❌ Отменить', data: `cancel:${o.id}` },
  ]);
  return kb(rows);
}

export function adminOrderText(env: Env, o: Order, title = '🆕 Заявка'): string {
  const lines = [
    `${title} <b>${h(o.code)}</b> · ${orderLabel(o)} · <b>${money(o.amount, o.currency)}</b>`,
    `Имя: ${h(o.name ?? '—')}`,
    `Email: <code>${h(o.email)}</code>`,
  ];
  if (o.telegram) lines.push(`Telegram (из формы): ${h(o.telegram)}`);
  if (o.tg_user_id) lines.push(`Telegram ID: <a href="tg://user?id=${o.tg_user_id}">${o.tg_user_id}</a>`);
  if (o.company_inn) lines.push(`Юрлицо: <b>${h(o.company_name ?? '')}</b> (ИНН <code>${h(o.company_inn)}</code>${o.company_kpp ? `, КПП <code>${h(o.company_kpp)}</code>` : ''})`);
  lines.push(`<a href="${payUrl(env, o)}">Страница оплаты</a>`);
  return lines.join('\n');
}

/** Идемпотентное подтверждение оплаты: вызывается кнопкой в боте или вебхуком Stripe */
export async function confirmOrderPaid(
  env: Env,
  o: Order,
  opts: { amountPaid?: number; method?: Method; stripeSessionId?: string } = {},
): Promise<Order | null> {
  const amountPaid = opts.amountPaid ?? o.amount;
  const method: Method = opts.method ?? (o.currency === 'EUR' ? 'iban' : o.payer_type === 'company' ? 'bank_ru' : 'sbp');

  let invoiceNumber = o.invoice_number;
  if (o.currency === 'EUR' && !invoiceNumber) {
    const seq = await nextCounter(env, `eu_inv_${new Date().getUTCFullYear()}`, 1);
    invoiceNumber = `F-${new Date().getUTCFullYear()}-${String(seq).padStart(4, '0')}`;
  }

  const changed = await transitionStatus(env, o.id, ['pending', 'claimed', 'cancelled'], 'paid', {
    paid_at: now(),
    amount_paid: amountPaid,
    method,
    invoice_number: invoiceNumber,
    stripe_session_id: opts.stripeSessionId ?? o.stripe_session_id,
  });
  if (!changed) return null;

  const updated = (await getOrderById(env, o.id))!;

  // 1. Ссылка в группу (всегда генерируем при подтверждении оплаты, чтобы можно было подставить в личное сообщение и на страницу)
  if (!updated.invite_link) {
    const link = await createJoinLink(env, `${updated.code} ${updated.name ?? updated.email}`);
    if (link) {
      await updateOrder(env, updated.id, { invite_link: link });
      updated.invite_link = link;
    }
  }
  if (updated.tg_user_id) {
    const btn = updated.invite_link ? kb([[{ text: '🎓 Войти в группу курса', url: updated.invite_link }]]) : {};
    await sendMessage(
      env,
      updated.tg_user_id,
      `✅ Оплата по заказу <b>${h(updated.code)}</b> подтверждена!\n\nНажмите кнопку ниже, чтобы подать заявку в закрытую группу курса — бот одобрит её автоматически.\n\nПожалуйста, перед первым занятием зарегистрируйте аккаунты на сайтах runpod, huggingface и civitai:\nhttps://runpod.io?ref=x9hq16nj (моя реферальная ссылка)\nhttps://huggingface.co/join\nhttps://civitai.com/login`,
      btn,
    );
  }

  // 2. Письмо студенту (+ facture PDF для EUR)
  const attachments: Attachment[] = [];
  if (updated.currency === 'EUR') {
    const pdf = await buildEuInvoicePdf(env, updated, true);
    attachments.push({ filename: `Facture-${updated.invoice_number ?? updated.code}.pdf`, bytes: pdf });
  }
  const m = paidMail(env, updated);
  await sendMail(env, updated.email, m.subject, m.body, attachments);

  // 3. Тебе в админ-чат: карточка для «Мой налог» (RUB) или отбивка + PDF (EUR) с кнопкой для отправки подтверждения
  if (updated.currency === 'RUB') {
    const npdLines = [
      `🧾 <b>Пробей чек в «Мой налог»</b> для заказа <b>${h(updated.code)}</b>:`,
      `• Наименование: <code>${h(SERVICE_NAME_RU(env))} (заказ ${h(updated.code)})</code>`,
      `• Сумма: <code>${(amountPaid / 100).toFixed(2).replace(/\.00$/, '')}</code> ₽`,
      `• Покупатель: <b>${updated.payer_type === 'company' ? `Юрлицо / ИП — ИНН <code>${h(updated.company_inn ?? '')}</code> (${h(updated.company_name ?? '')})` : 'Физическое лицо'}</b>`,
      `• Email клиента: <code>${h(updated.email)}</code>`,
      '',
      'Ответь (Reply) на это сообщение ссылкой на чек из «Мой налог» — я сам отправлю её студенту на почту и в Telegram.',
    ];
    const sent = await sendAdmin(env, npdLines.join('\n'), adminOrderKb(env, updated));
    if (sent.ok && sent.result) await saveAdminMsg(env, sent.result.message_id, 'receipt', updated.id);
  } else {
    await sendAdmin(
      env,
      `✅ Оплачен <b>${h(updated.code)}</b> (${updated.method === 'stripe' ? 'Stripe' : 'SEPA IBAN'} · ${money(amountPaid, 'EUR')}, facture <b>${h(updated.invoice_number)}</b>)\nКлиент: ${h(updated.name ?? '')} · <code>${h(updated.email)}</code>`,
      adminOrderKb(env, updated),
    );
    if (attachments[0]) await sendDocument(env, env.ADMIN_CHAT_ID, attachments[0].filename, attachments[0].bytes);
  }

  return updated;
}

export async function handleTelegramWebhook(env: Env, update: any): Promise<void> {
  if (update.callback_query) return handleCallback(env, update.callback_query);
  if (update.chat_join_request) return handleJoinRequest(env, update.chat_join_request);
  if (update.message) return handleMessage(env, update.message);
}

async function handleJoinRequest(env: Env, req: any): Promise<void> {
  const chatId = String(req.chat?.id ?? '');
  const userId: number = req.from?.id;
  if (chatId !== String(env.GROUP_CHAT_ID) || !userId) return;

  let paid = await getPaidOrderByTgUser(env, userId);
  if (!paid && req.invite_link?.invite_link) {
    paid = await getPaidOrderByInviteLink(env, req.invite_link.invite_link);
    if (paid) {
      await updateOrder(env, paid.id, { tg_user_id: userId });
    }
  }
  if (!paid && req.from?.username) {
    paid = await getPaidOrderByTgHandle(env, req.from.username);
    if (paid) {
      await updateOrder(env, paid.id, { tg_user_id: userId });
    }
  }

  if (paid) {
    await tg(env, 'approveChatJoinRequest', { chat_id: chatId, user_id: userId });
    await updateOrder(env, paid.id, { joined_group_at: now() });
    await sendMessage(env, userId, `🎉 Заявка одобрена — добро пожаловать в группу курса «${h(env.COURSE_TITLE)}»!`);
    await sendAdmin(env, `👋 В группу вступил(а) <b>${h(paid.name ?? req.from.first_name ?? '')}</b> (${h(paid.code)})`);
  } else {
    const name = [req.from?.first_name, req.from?.last_name].filter(Boolean).join(' ') || `id ${userId}`;
    const uname = req.from?.username ? ` (@${req.from.username})` : '';
    await sendAdmin(
      env,
      `🚪 Заявка на вступление в группу от <b>${h(name)}</b>${h(uname)}, но оплаченный заказ не привязан.`,
      kb([[
        { text: '✅ Впустить', data: `jr_ok:${userId}` },
        { text: '❌ Отклонить', data: `jr_no:${userId}` },
      ]]),
    );
  }
}

async function handleCallback(env: Env, cq: any): Promise<void> {
  const fromId = String(cq.from?.id ?? '');
  const data: string = cq.data ?? '';
  const answer = (text: string) => tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text });

  // Студент нажал «Я оплатил(а)» в боте
  if (data.startsWith('uclaim:')) {
    const o = await getOrderById(env, Number(data.slice(7)));
    if (!o) return void (await answer('Заказ не найден'));
    await markOrderClaimed(env, o, 'из Telegram-бота');
    await answer('Отметка отправлена, проверяем оплату');
    return;
  }

  // Остальные кнопки — только для тебя
  if (fromId !== String(env.ADMIN_CHAT_ID)) return void (await answer('Недоступно'));

  const [action, arg] = data.split(':');
  if (action === 'paid') {
    const o = await getOrderById(env, Number(arg));
    if (!o) return void (await answer('Заказ не найден'));
    if (o.status === 'paid') return void (await answer('Уже отмечен оплаченным'));
    await answer('Подтверждаю оплату…');
    await confirmOrderPaid(env, o);
    if (cq.message?.message_id) {
      await tg(env, 'editMessageReplyMarkup', { chat_id: env.ADMIN_CHAT_ID, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
    }
  } else if (action === 'cancel') {
    const o = await getOrderById(env, Number(arg));
    if (!o) return void (await answer('Заказ не найден'));
    const ok = await transitionStatus(env, o.id, ['pending', 'claimed'], 'cancelled', { cancelled_at: now() });
    if (ok) {
      const m = cancelledMail(env, o);
      await sendMail(env, o.email, m.subject, m.body);
      if (o.tg_user_id) await sendMessage(env, o.tg_user_id, `Заявка <b>${h(o.code)}</b> отменена.`);
    }
    await answer(ok ? 'Заявка отменена' : 'Уже обработана');
    if (cq.message?.message_id) {
      await tg(env, 'editMessageReplyMarkup', { chat_id: env.ADMIN_CHAT_ID, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
    }
  } else if (action === 'act') {
    const o = await getOrderById(env, Number(arg));
    if (!o) return void (await answer('Заказ не найден'));
    await answer('Генерирую и отправляю акт…');
    const pdf = await buildRuCompanyActPdf(env, o);
    const filename = `Akt-${o.code}.pdf`;
    const m = actMail(env, o);
    await sendMail(env, o.email, m.subject, m.body, [{ filename, bytes: pdf }]);
    await sendDocument(env, env.ADMIN_CHAT_ID, filename, pdf, `Акт по ${h(o.code)} отправлен на ${h(o.email)}`);
  } else if (action === 'jr_ok') {
    await tg(env, 'approveChatJoinRequest', { chat_id: env.GROUP_CHAT_ID, user_id: Number(arg) });
    await answer('Впустил');
  } else if (action === 'jr_no') {
    await tg(env, 'declineChatJoinRequest', { chat_id: env.GROUP_CHAT_ID, user_id: Number(arg) });
    await answer('Отклонил');
  }
}

export async function markOrderClaimed(env: Env, o: Order, source: string): Promise<boolean> {
  const changed = await transitionStatus(env, o.id, ['pending'], 'claimed', { claimed_at: now() });
  if (changed) {
    const updated = (await getOrderById(env, o.id))!;
    await sendAdmin(env, adminOrderText(env, updated, `💸 Клиент отметил оплату (${source})`), adminOrderKb(env, updated));
  }
  return changed;
}

async function handleMessage(env: Env, msg: any): Promise<void> {
  const chatId = String(msg.chat?.id ?? '');
  const text: string = (msg.text ?? '').trim();

  // Сообщения из группы игнорируем (кроме /id от админа для получения GROUP_CHAT_ID)
  if (msg.chat?.type !== 'private') {
    if (String(msg.from?.id ?? '') === String(env.ADMIN_CHAT_ID) && /^\/id(@\S+)?$/i.test(text)) {
      await sendAdmin(env, `🆔 ID группы «${h(msg.chat?.title ?? '')}»:\n<code>${h(chatId)}</code>`);
    }
    return;
  }

  // --- Сообщение от тебя (админа) ---
  if (chatId === String(env.ADMIN_CHAT_ID)) return handleAdminMessage(env, msg);

  // --- Сообщение от студента / потенциального студента ---
  const u = await touchTgUser(env, msg.from);
  if (u?.blocked) return;

  // /start <token> или просто /start
  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1];
    if (token) {
      const o = await getOrderByToken(env, token);
      if (o) {
        await updateOrder(env, o.id, { tg_user_id: msg.from.id });
        if (o.status === 'paid') {
          let link = o.invite_link;
          if (!link) {
            link = await createJoinLink(env, `${o.code} ${o.name ?? o.email}`);
            if (link) await updateOrder(env, o.id, { invite_link: link });
          }
          await sendMessage(
            env,
            msg.from.id,
            `Заказ <b>${h(o.code)}</b> оплачен ✅\nНажмите кнопку ниже, чтобы войти в закрытую группу курса — бот одобрит заявку автоматически.\n\nПожалуйста, перед первым занятием зарегистрируйте аккаунты на сайтах runpod, huggingface и civitai:\nhttps://runpod.io?ref=x9hq16nj (моя реферальная ссылка)\nhttps://huggingface.co/join\nhttps://civitai.com/login\n\nЕсли хотите задать вопрос Ивану, просто напишите его сюда.`,
            link ? kb([[{ text: '🎓 Войти в группу курса', url: link }]]) : {},
          );
          return;
        }
        await sendMessage(
          env,
          msg.from.id,
          `Заказ <b>${h(o.code)}</b> (${money(o.amount, o.currency)}) привязан к вашему Telegram.\nКак только оплата подтвердится, сюда придёт персональная ссылка в группу курса.\n\nЛюбой вопрос по курсу или оплате можно написать прямо в этот чат — я передам его Ивану.`,
          kb([
            [{ text: 'Страница оплаты и реквизиты', url: payUrl(env, o) }],
            ...(o.status === 'pending' ? [[{ text: '✅ Я оплатил(а)', data: `uclaim:${o.id}` }]] : []),
          ]),
        );
        return;
      }
    }
    await sendMessage(
      env,
      msg.from.id,
      `Здравствуйте! Это бот курса «${h(env.COURSE_TITLE)}».\n\nНапишите сюда ваш вопрос (текстом, фото или файлом) — я передам его Ивану, и ответ придёт в этот же чат.`,
    );
    return;
  }

  // Пересылка вопроса тебе в админ-чат (личные границы: твой личный аккаунт не светится)
  const linked = await getLatestOrderByTgUser(env, msg.from.id);
  const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Без имени';
  const uname = msg.from.username ? ` · @${msg.from.username}` : '';
  const ordTag = linked ? ` · заказ <b>${h(linked.code)}</b> (${linked.status})` : '';
  const header = `✉️ От <b>${h(fullName)}</b>${h(uname)} [<code>${msg.from.id}</code>]${ordTag}\n<i>Ответь (Reply) на сообщение ниже, чтобы ответить через бота:</i>`;
  await sendAdmin(env, header);

  const copied = await tg<{ message_id: number }>(env, 'copyMessage', {
    chat_id: env.ADMIN_CHAT_ID,
    from_chat_id: msg.chat.id,
    message_id: msg.message_id,
  });
  if (copied.ok && copied.result) {
    await saveAdminMsg(env, copied.result.message_id, 'relay', msg.chat.id);
  }

  const ts = now();
  if (!u?.last_ack_at || ts - u.last_ack_at > 6 * 3600) {
    await setTgUser(env, msg.from.id, { last_ack_at: ts });
    await sendMessage(env, msg.chat.id, 'Сообщение передано Ивану — ответ придёт сюда.');
  }
}

async function handleAdminMessage(env: Env, msg: any): Promise<void> {
  const text: string = (msg.text ?? '').trim();

  // 1. Reply на пересланное сообщение или на карточку чека
  const replyId = msg.reply_to_message?.message_id;
  if (replyId) {
    const link = await getAdminMsg(env, replyId);
    if (link?.kind === 'relay') {
      const targetChat = Number(link.ref);
      if (text === '/block') {
        await setTgUser(env, targetChat, { blocked: 1 });
        await sendAdmin(env, `🚫 Пользователь ${targetChat} заблокирован.`);
        return;
      }
      if (text === '/unblock') {
        await setTgUser(env, targetChat, { blocked: 0 });
        await sendAdmin(env, `Разблокирован ${targetChat}.`);
        return;
      }
      const r = await tg(env, 'copyMessage', { chat_id: targetChat, from_chat_id: env.ADMIN_CHAT_ID, message_id: msg.message_id });
      if (!r.ok) await sendAdmin(env, `⚠️ Не удалось доставить ответ: ${h(r.description ?? '')}`);
      return;
    }
    if (link?.kind === 'receipt') {
      const o = await getOrderById(env, Number(link.ref));
      const urlMatch = text.match(/https?:\/\/\S+/);
      if (o && urlMatch) {
        const url = urlMatch[0];
        await updateOrder(env, o.id, { receipt_url: url });
        const m = receiptMail(env, o, url);
        await sendMail(env, o.email, m.subject, m.body);
        if (o.tg_user_id) await sendMessage(env, o.tg_user_id, `🧾 Ваш чек ФНС «Мой налог» по заказу <b>${h(o.code)}</b>:\n${h(url)}`);
        await sendAdmin(env, `✅ Чек по <b>${h(o.code)}</b> сохранён и отправлен студенту.`);
        return;
      }
    }
  }

  // 2. Команды админа
  if (text === '/orders' || text === '/start') {
    const open = await listOpenOrders(env);
    const paid = await listPaidOrders(env);
    const lines = [
      `<b>Сводка</b>: оплачено <b>${paid.length}</b>, ожидают оплаты <b>${open.length}</b>.`,
      ...open.map((o) => `• <b>${h(o.code)}</b> (${o.status}) · ${money(o.amount, o.currency)} · ${h(o.name ?? o.email)} · ${fmtDate(o.created_at)}`),
      '',
      'Команды: <code>/order CU-0101</code> · <code>/paid CU-0101</code> · <code>/act CU-0101</code> · <code>/acts</code> (акты всем юрлицам)',
    ];
    await sendAdmin(env, lines.join('\n'));
    return;
  }

  const mOrder = text.match(/^\/(order|paid|act)\s+(CU-\d+)/i);
  if (mOrder) {
    const cmd = mOrder[1].toLowerCase();
    const o = await getOrderByCode(env, mOrder[2]);
    if (!o) return void (await sendAdmin(env, 'Заказ не найден.'));
    if (cmd === 'order') {
      await sendAdmin(env, adminOrderText(env, o, '📋 Заказ'), adminOrderKb(env, o));
    } else if (cmd === 'paid') {
      await confirmOrderPaid(env, o);
    } else if (cmd === 'act') {
      const pdf = await buildRuCompanyActPdf(env, o);
      const filename = `Akt-${o.code}.pdf`;
      const m = actMail(env, o);
      await sendMail(env, o.email, m.subject, m.body, [{ filename, bytes: pdf }]);
      await sendDocument(env, env.ADMIN_CHAT_ID, filename, pdf, `Акт по ${h(o.code)} отправлен на ${h(o.email)}`);
    }
    return;
  }

  if (text === '/acts') {
    const paid = (await listPaidOrders(env)).filter((o) => o.payer_type === 'company');
    for (const o of paid) {
      const pdf = await buildRuCompanyActPdf(env, o);
      const m = actMail(env, o);
      await sendMail(env, o.email, m.subject, m.body, [{ filename: `Akt-${o.code}.pdf`, bytes: pdf }]);
    }
    await sendAdmin(env, `📄 Отправлено актов юрлицам: ${paid.length}.`);
  }
}
