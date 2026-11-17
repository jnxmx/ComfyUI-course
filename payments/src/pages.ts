import type { Env, Order } from './types';
import { epcSepaPayload, gostPaymentPayload, qrSvg } from './pdf';
import { botStartUrl, deadline, escapeHtml, fmtDateTime, money, SERVICE_NAME_RU } from './util';

export function renderOrderPage(env: Env, o: Order): Response {
  const h = escapeHtml;
  const dl = fmtDateTime(deadline(env, o));
  const botUrl = botStartUrl(env, o);

  let main = '';
  if (o.status === 'paid') {
    const docs: string[] = [];
    if (o.currency === 'EUR') docs.push(`<a class="btn sec" href="/p/${o.token}/invoice.pdf">Скачать Facture (PDF)</a>`);
    if (o.payer_type === 'company') {
      docs.push(`<a class="btn sec" href="/p/${o.token}/invoice.pdf">Счёт-договор (PDF)</a>`);
      docs.push(`<a class="btn sec" href="/p/${o.token}/act.pdf">Акт (PDF)</a>`);
    }
    if (o.receipt_url) docs.push(`<a class="btn sec" href="${h(o.receipt_url)}" target="_blank" rel="noopener">Чек ФНС «Мой налог»</a>`);

    const groupAction = o.invite_link
      ? `<p><a class="btn" href="${h(o.invite_link)}">Войти в закрытую группу курса в Telegram →</a></p>
         <p class="hint">Если хотите задать вопрос преподавателю или подключить бота курса: <a href="${h(botUrl)}">открыть бота</a>.</p>`
      : `<p>Чтобы получить персональное приглашение в Telegram-группу курса, откройте бота:</p>
         <p><a class="btn" href="${h(botUrl)}">Открыть бота и войти в группу →</a></p>`;

    main = `
      <div class="badge ok">Оплачено · ${money(o.amount_paid ?? o.amount, o.currency)}</div>
      <h1>Спасибо, оплата получена!</h1>
      <p>Заказ <b>${h(o.code)}</b> подтверждён.</p>
      ${groupAction}
      <p>Пожалуйста, перед первым занятием зарегистрируйте аккаунты на сайтах runpod, huggingface и civitai:<br>
        <a href="https://runpod.io?ref=x9hq16nj" target="_blank" rel="noopener">https://runpod.io?ref=x9hq16nj</a> (моя реферальная ссылка)<br>
        <a href="https://huggingface.co/join" target="_blank" rel="noopener">https://huggingface.co/join</a><br>
        <a href="https://civitai.com/login" target="_blank" rel="noopener">https://civitai.com/login</a>
      </p>
      ${docs.length ? `<div class="row">${docs.join('')}</div>` : ''}
    `;
  } else if (o.status === 'cancelled') {
    main = `
      <div class="badge err">Заявка отменена</div>
      <h1>Срок оплаты истёк</h1>
      <p>Заявка <b>${h(o.code)}</b> отменена, место освобождено. Если вы уже отправили перевод — напишите <a href="${h(botUrl)}">боту курса</a>, я проверю поступление.</p>
      <p><a class="btn sec" href="${h(env.SITE_URL)}/#pricing">Зарегистрироваться заново</a></p>
    `;
  } else {
    const claimedBanner = o.status === 'claimed'
      ? `<div class="notice">Отметка об оплате получена — я проверяю поступление. Как только подтвержу, на <b>${h(o.email)}</b> и в <a href="${h(botUrl)}">Telegram-бот</a> придёт ссылка на группу курса.</div>`
      : '';

    if (o.currency === 'RUB' && o.payer_type === 'person') {
      main = `
        <div class="badge">${o.status === 'claimed' ? 'Проверяем оплату' : `Бронь до ${h(dl)}`}</div>
        <h1>Оплата курса по СБП</h1>
        ${claimedBanner}
        <div class="card">
          <div class="kv"><span>Сумма</span><b class="big">${money(o.amount, 'RUB')}</b></div>
          <div class="kv"><span>Телефон (СБП)</span><b>${h(env.RU_SBP_PHONE)}</b> <button class="copy" data-copy="${h(env.RU_SBP_PHONE)}">Скопировать</button></div>
          <div class="kv"><span>Банк получателя</span><b>${h(env.RU_SBP_BANK)}</b></div>
          <div class="kv"><span>Получатель</span><b>${h(env.RU_PAYEE_NAME)}</b></div>
          <div class="kv"><span>Комментарий к переводу</span><b class="code">Оплата курса по ComfyUI</b> <button class="copy" data-copy="Оплата курса по ComfyUI">Скопировать</button></div>
        </div>
        <p class="hint">Переведите точную сумму в приложении вашего банка через Систему быстрых платежей (комиссия 0 ₽) и укажите код <b>${h(o.code)}</b> в сообщении получателю.</p>
        ${o.status === 'pending' ? `<form method="POST" action="/p/${o.token}/claim"><button class="btn" type="submit">Я перевёл(а) ${money(o.amount, 'RUB')}</button></form>` : ''}
      `;
    } else if (o.currency === 'RUB' && o.payer_type === 'company') {
      const qr = qrSvg(gostPaymentPayload(env, o), 176);
      main = `
        <div class="badge">${o.status === 'claimed' ? 'Проверяем оплату' : `Счёт действителен до ${h(dl)}`}</div>
        <h1>Оплата от организации</h1>
        ${claimedBanner}
        <p>Заказчик: <b>${h(o.company_name ?? `ИНН ${o.company_inn}`)}</b> (ИНН ${h(o.company_inn ?? '—')}${o.company_kpp ? `, КПП ${h(o.company_kpp)}` : ''})</p>
        <div class="row">
          <a class="btn" href="/p/${o.token}/invoice.pdf">Скачать счёт-договор № ${h(o.code)} (PDF)</a>
        </div>
        <div class="card split">
          <div>
            <div class="kv"><span>Сумма (без НДС, НПД)</span><b class="big">${money(o.amount, 'RUB')}</b></div>
            <div class="kv"><span>Получатель</span><b>${h(env.RU_PAYEE_NAME)} (ИНН ${h(env.RU_INN)})</b></div>
            <div class="kv"><span>Счёт</span><b>${h(env.RU_ACCOUNT)}</b> <button class="copy" data-copy="${h(env.RU_ACCOUNT)}">Скопировать</button></div>
            <div class="kv"><span>Банк</span><b>${h(env.RU_BANK_NAME)}, БИК ${h(env.RU_BIC)}, к/с ${h(env.RU_CORR_ACCOUNT)}</b></div>
            <div class="kv"><span>Назначение платежа</span><b class="code">Оплата по счёту № ${h(o.code)} за курс. Без НДС</b> <button class="copy" data-copy="Оплата по счёту № ${h(o.code)} за курс. Без НДС">Скопировать</button></div>
            <div class="kv"><span>Предмет</span><span>${h(SERVICE_NAME_RU(env))}</span></div>
          </div>
          <div class="qrbox">${qr}<span>QR для банк-клиента</span></div>
        </div>
        ${o.status === 'pending' ? `<form method="POST" action="/p/${o.token}/claim"><button class="btn sec" type="submit">Платёжное поручение отправлено</button></form>` : ''}
      `;
    } else {
      const cardEur = money(Number(env.PRICE_EUR_CARD), 'EUR');
      const ibanEur = money(Number(env.PRICE_EUR_IBAN), 'EUR');
      const diffEur = money(Number(env.PRICE_EUR_CARD) - Number(env.PRICE_EUR_IBAN), 'EUR');
      const qr = env.FR_IBAN ? qrSvg(epcSepaPayload(env, o), 168) : '';
      main = `
        <div class="badge">${o.status === 'claimed' ? 'Проверяем перевод' : `Бронь до ${h(dl)}`}</div>
        <h1>Оплата курса (EUR)</h1>
        ${claimedBanner}
        <div class="card">
          <h2>Вариант 1 — Карта / Apple Pay / PayPal · ${cardEur}</h2>
          <p class="hint">Мгновенное подтверждение, автоматический счёт (facture) и доступ к группе сразу после оплаты.</p>
          ${env.STRIPE_SECRET_KEY
            ? `<form method="POST" action="/p/${o.token}/stripe"><button class="btn" type="submit">Оплатить ${cardEur} онлайн →</button></form>`
            : `<p class="hint">Онлайн-оплата временно недоступна — используйте SEPA-перевод ниже или напишите в бот.</p>`}
        </div>
        <div class="card split">
          <div>
            <h2>Вариант 2 — Прямой SEPA-перевод по IBAN · ${ibanEur} <span class="save">скидка ${diffEur}</span></h2>
            <div class="kv"><span>Сумма</span><b class="big">${ibanEur}</b></div>
            <div class="kv"><span>Получатель (Bénéficiaire)</span><b>${h(env.FR_NAME)}</b></div>
            <div class="kv"><span>IBAN</span><b>${h(env.FR_IBAN)}</b> <button class="copy" data-copy="${h(env.FR_IBAN.replace(/\s+/g, ''))}">Скопировать</button></div>
            <div class="kv"><span>BIC / Банк</span><b>${h(env.FR_BIC)} · ${h(env.FR_BANK_NAME)}</b></div>
            <div class="kv"><span>Référence (обязательно)</span><b class="code">${h(o.code)}</b> <button class="copy" data-copy="${h(o.code)}">Скопировать</button></div>
            <div class="row" style="margin-top:12px">
              <a class="btn sec" href="/p/${o.token}/invoice.pdf">Скачать инвойс / Devis (PDF)</a>
              ${o.status === 'pending' ? `<form method="POST" action="/p/${o.token}/claim"><button class="btn sec" type="submit">Я отправил(а) SEPA-перевод</button></form>` : ''}
            </div>
          </div>
          ${qr ? `<div class="qrbox">${qr}<span>EPC QR для банков ЕС</span></div>` : ''}
        </div>
      `;
    }
  }

  const html = `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Заказ ${h(o.code)} — ${h(env.COURSE_TITLE)}</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#0d0e11;color:#f2f3f5;font:15px/1.55 Inter,-apple-system,BlinkMacSystemFont,sans-serif;padding:28px 16px 60px}
  .wrap{max-width:680px;margin:0 auto}
  header{display:flex;justify-content:space-between;align-items:center;color:#9aa0a6;font-size:13px;margin-bottom:22px}
  a{color:#9ec5fe;text-decoration:none} a:hover{text-decoration:underline}
  h1{font-size:24px;margin:8px 0 14px} h2{font-size:17px;margin:0 0 8px}
  .badge{display:inline-block;padding:4px 10px;border-radius:99px;background:#1f2430;color:#c7d2fe;font-size:12.5px;font-weight:600}
  .badge.ok{background:#0f2e1f;color:#6ee7b7} .badge.err{background:#351518;color:#fca5a5}
  .save{background:#0f2e1f;color:#6ee7b7;font-size:12px;padding:2px 8px;border-radius:99px;margin-left:6px;font-weight:600}
  .card{background:#151821;border:1px solid #242938;border-radius:12px;padding:18px;margin:14px 0}
  .split{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center}
  @media(max-width:560px){.split{grid-template-columns:1fr}}
  .kv{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #202534}
  .kv:last-child{border-bottom:0} .kv>span:first-child{color:#9aa0a6}
  .big{font-size:19px} .code{font-family:ui-monospace,Menlo,monospace;background:#0d0e11;padding:2px 7px;border-radius:6px;border:1px solid #2c3347}
  .qrbox{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11.5px;color:#9aa0a6}
  .qrbox svg{border-radius:8px;border:1px solid #2c3347}
  .btn{display:inline-block;background:#e5e7eb;color:#0d0e11;font-weight:600;border:0;border-radius:9px;padding:11px 18px;font-size:14.5px;cursor:pointer;text-decoration:none}
  .btn:hover{background:#fff;text-decoration:none}
  .btn.sec{background:#1f2430;color:#e5e7eb;border:1px solid #2f3647}
  .btn.sec:hover{background:#272d3d}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}
  .copy{background:#1f2430;color:#cbd5e1;border:1px solid #2f3647;border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer}
  .hint{color:#9aa0a6;font-size:13.5px}
  .notice{background:#17223b;border:1px solid #29427a;border-radius:10px;padding:12px 14px;margin:12px 0;font-size:14px}
  footer{margin-top:26px;padding-top:16px;border-top:1px solid #202534;color:#8b929a;font-size:13px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px}
</style></head><body><div class="wrap">
  <header>
    <span><a href="${h(env.SITE_URL)}">← ${h(env.COURSE_TITLE)}</a></span>
    <span>Заказ ${h(o.code)}</span>
  </header>
  ${main}
  <footer>
    <span>Привяжите Telegram для уведомлений и входа в группу: <a href="${h(botUrl)}">@${h(env.BOT_USERNAME)}</a></span>
    <span><a href="${h(env.SITE_URL)}/docs/public_offer.pdf">Договор-оферта</a></span>
  </footer>
</div>
<script>
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{
  await navigator.clipboard.writeText(b.dataset.copy);
  const t=b.textContent; b.textContent='Скопировано ✓'; setTimeout(()=>b.textContent=t,1400);
}));
</script></body></html>`;

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
