import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import qrcode from 'qrcode-generator';
import type { Env, Order } from './types';
import { deadline, fmtDate, money, now, SERVICE_NAME_FR, SERVICE_NAME_RU } from './util';
// @ts-ignore — wrangler Data rules bundle .ttf as ArrayBuffer
import regularFontBytes from '../fonts/PTSans-Regular.ttf';
// @ts-ignore
import boldFontBytes from '../fonts/PTSans-Bold.ttf';

/** QR-код платёжного поручения по ГОСТ Р 56042-2014 */
export function gostPaymentPayload(env: Env, o: Order): string {
  const fields = [
    'ST00012',
    `Name=${env.RU_PAYEE_NAME}`,
    `PersonalAcc=${env.RU_ACCOUNT}`,
    `BankName=${env.RU_BANK_NAME}`,
    `BIC=${env.RU_BIC}`,
    `CorrespAcc=${env.RU_CORR_ACCOUNT}`,
    `PayeeINN=${env.RU_INN}`,
    `Sum=${o.amount}`,
    `Purpose=Оплата по счёту № ${o.code} за курс. Без НДС`,
  ];
  return fields.join('|');
}

/** EPC QR-код для SEPA-перевода в банковских приложениях ЕС */
export function epcSepaPayload(env: Env, o: Order, amountMinor = Number(env.PRICE_EUR_IBAN)): string {
  const eur = (amountMinor / 100).toFixed(2);
  return ['BCD', '002', '1', 'SCT', env.FR_BIC.replace(/\s+/g, ''), env.FR_NAME.slice(0, 70), env.FR_IBAN.replace(/\s+/g, ''), `EUR${eur}`, '', o.code, ''].join('\n');
}

export function qrMatrix(data: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(data, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const m: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    m.push(row);
  }
  return m;
}

export function qrSvg(data: string, size = 180): string {
  const m = qrMatrix(data);
  const n = m.length;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) path += `M${c},${r}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

async function initDoc() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularFontBytes, { subset: true });
  const bold = await doc.embedFont(boldFontBytes, { subset: true });
  const page = doc.addPage([595.28, 841.89]); // A4
  return { doc, page, regular, bold };
}

function drawQr(page: any, data: string, x: number, yTop: number, boxSize: number) {
  const m = qrMatrix(data);
  const n = m.length;
  const cell = boxSize / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) {
        page.drawRectangle({ x: x + c * cell, y: yTop - (r + 1) * cell, width: cell + 0.15, height: cell + 0.15, color: rgb(0, 0, 0) });
      }
    }
  }
}

/** Счёт-договор для юрлица РФ (75 000 ₽, без НДС, НПД) */
export async function buildRuCompanyInvoicePdf(env: Env, o: Order): Promise<Uint8Array> {
  const { doc, page, regular, bold } = await initDoc();
  const M = 44;
  let y = 800;
  const text = (s: string, opts: { x?: number; size?: number; b?: boolean; color?: [number, number, number] } = {}) => {
    const size = opts.size ?? 10;
    page.drawText(s, {
      x: opts.x ?? M,
      y,
      size,
      font: opts.b ? bold : regular,
      color: opts.color ? rgb(...opts.color) : rgb(0.08, 0.08, 0.08),
    });
  };
  const line = (dy = 15) => { y -= dy; };
  const hr = () => {
    page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) });
    y -= 12;
  };

  drawQr(page, gostPaymentPayload(env, o), 595 - M - 108, 805, 108);
  page.drawText('QR для оплаты в банк-клиенте', { x: 595 - M - 115, y: 688, size: 7.5, font: regular, color: rgb(0.4, 0.4, 0.4) });

  text('Реквизиты получателя платежа:', { b: true, size: 10 }); line(14);
  text(`Получатель: ${env.RU_PAYEE_NAME} (плательщик НПД)`, { size: 9.5 }); line(13);
  text(`ИНН: ${env.RU_INN}`, { size: 9.5 }); line(13);
  text(`Счёт получателя: ${env.RU_ACCOUNT}`, { size: 9.5 }); line(13);
  text(`Банк получателя: ${env.RU_BANK_NAME}`, { size: 9.5 }); line(13);
  text(`БИК: ${env.RU_BIC}    Корр. счёт: ${env.RU_CORR_ACCOUNT}`, { size: 9.5 }); line(22);

  hr();
  text(`СЧЁТ-ДОГОВОР № ${o.code} от ${fmtDate(o.created_at, 'ru')}`, { b: true, size: 15 }); line(18);
  text(`Действителен к оплате до ${fmtDate(deadline(env, o), 'ru')}`, { size: 9.5, color: [0.35, 0.35, 0.35] }); line(18);

  text(`Исполнитель: самозанятый ${env.RU_PAYEE_NAME}, ИНН ${env.RU_INN} (режим НПД, 422-ФЗ).`, { size: 9.5 }); line(14);
  const cust = [
    o.company_name || 'Организация заказчика',
    o.company_inn ? `ИНН ${o.company_inn}` : '',
    o.company_kpp ? `КПП ${o.company_kpp}` : '',
    o.company_ogrn ? `ОГРН ${o.company_ogrn}` : '',
  ].filter(Boolean).join(', ');
  text(`Заказчик: ${cust}`, { size: 9.5 }); line(13);
  if (o.company_address) { text(`Адрес: ${o.company_address.slice(0, 95)}`, { size: 9 }); line(13); }
  text(`Участник курса: ${o.name ?? ''} (${o.email})`, { size: 9.5 }); line(18);

  hr();
  text('Наименование услуги', { b: true, size: 9.5 });
  text('Кол-во', { b: true, size: 9.5, x: 390 });
  text('Сумма, ₽', { b: true, size: 9.5, x: 465 });
  line(8); hr();

  const srv = SERVICE_NAME_RU(env);
  text(srv.slice(0, 68), { size: 9.5 });
  text('1', { size: 9.5, x: 400 });
  text(money(o.amount, 'RUB'), { b: true, size: 10, x: 465 });
  line(13);
  if (srv.length > 68) { text(srv.slice(68), { size: 9.5 }); line(14); }
  line(4); hr();

  text(`Итого к оплате: ${money(o.amount, 'RUB')}`, { b: true, size: 11.5 }); line(14);
  text('Без налога (НДС) — Исполнитель применяет налог на профессиональный доход (ст. 2 ФЗ № 422-ФЗ).', { size: 9 }); line(18);
  text(`Назначение платежа (обязательно): «Оплата по счёту № ${o.code} за курс. Без НДС»`, { b: true, size: 10 }); line(22);

  hr();
  text('Условия счёта-договора:', { b: true, size: 10 }); line(14);
  const terms = [
    `1. Оплата настоящего счёта означает полное согласие Заказчика с условиями публичной оферты (${env.SITE_URL}/docs/public_offer.pdf) и заключение договора оказания услуг (п. 3 ст. 438 ГК РФ).`,
    '2. После поступления оплаты Исполнитель формирует и направляет Заказчику чек из приложения ФНС «Мой налог» с указанием ИНН Заказчика, а по завершении курса — акт об оказании услуг.',
    '3. Заказчик подтверждает, что Исполнитель не состоит и не состоял с Заказчиком в трудовых отношениях в течение последних двух лет (п. 8 ч. 2 ст. 6 ФЗ № 422-ФЗ).',
  ];
  for (const t of terms) {
    for (const chunk of wrap(t, 92)) { text(chunk, { size: 8.8 }); line(12); }
    line(3);
  }
  line(16);
  text(`Исполнитель: ______________________ / ${env.RU_PAYEE_NAME} /`, { size: 10 });

  return doc.save();
}

/** Акт об оказании услуг для юрлица РФ */
export async function buildRuCompanyActPdf(env: Env, o: Order): Promise<Uint8Array> {
  const { doc, page, regular, bold } = await initDoc();
  const M = 44;
  let y = 790;
  const text = (s: string, opts: { x?: number; size?: number; b?: boolean } = {}) => {
    page.drawText(s, { x: opts.x ?? M, y, size: opts.size ?? 10, font: opts.b ? bold : regular, color: rgb(0.08, 0.08, 0.08) });
  };
  const line = (dy = 15) => { y -= dy; };
  const hr = () => { page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) }); y -= 12; };

  text(`АКТ № ${o.code}-А от ${fmtDate(now(), 'ru')}`, { b: true, size: 14 }); line(16);
  text(`об оказании услуг по счёту-договору № ${o.code} от ${fmtDate(o.created_at, 'ru')}`, { size: 10 }); line(20);
  hr();

  text(`Исполнитель: самозанятый ${env.RU_PAYEE_NAME}, ИНН ${env.RU_INN}.`, { size: 10 }); line(15);
  text(`Заказчик: ${o.company_name ?? ''}, ИНН ${o.company_inn ?? ''}${o.company_kpp ? `, КПП ${o.company_kpp}` : ''}.`, { size: 10 }); line(20);

  for (const l of wrap(`1. Исполнитель оказал, а Заказчик принял следующие услуги: ${SERVICE_NAME_RU(env)} (участник: ${o.name ?? o.email}).`, 88)) {
    text(l, { size: 10 }); line(14);
  }
  line(6);
  text(`2. Стоимость оказанных услуг составила ${money(o.amount_paid ?? o.amount, 'RUB')}, без НДС (НПД, 422-ФЗ). Сумма оплачена полностью.`, { size: 10 }); line(15);
  if (o.receipt_url) { text(`Чек ФНС «Мой налог»: ${o.receipt_url}`, { size: 9 }); line(15); }
  text('3. Услуги оказаны полностью, в срок и надлежащего качества. Стороны претензий друг к другу не имеют.', { size: 10 }); line(32);

  hr();
  text(`Исполнитель: ______________________ / ${env.RU_PAYEE_NAME} /`, { size: 10 }); line(28);
  text(`Заказчик:     ______________________ / ${o.company_name ?? ''} /`, { size: 10 });
  return doc.save();
}

/** Facture / Devis для ЕС (micro-entrepreneur, TVA non applicable art. 293 B du CGI) */
export async function buildEuInvoicePdf(env: Env, o: Order, paid: boolean): Promise<Uint8Array> {
  const { doc, page, regular, bold } = await initDoc();
  const M = 44;
  let y = 795;
  const text = (s: string, opts: { x?: number; size?: number; b?: boolean; color?: [number, number, number] } = {}) => {
    page.drawText(s, {
      x: opts.x ?? M,
      y,
      size: opts.size ?? 10,
      font: opts.b ? bold : regular,
      color: opts.color ? rgb(...opts.color) : rgb(0.08, 0.08, 0.08),
    });
  };
  const line = (dy = 15) => { y -= dy; };
  const hr = () => { page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) }); y -= 12; };

  const amountMinor = paid ? (o.amount_paid ?? o.amount) : Number(env.PRICE_EUR_IBAN);
  if (!paid && env.FR_IBAN) {
    drawQr(page, epcSepaPayload(env, o, amountMinor), 595 - M - 104, 800, 104);
    page.drawText('SEPA QR (650,00 €)', { x: 595 - M - 96, y: 686, size: 8, font: regular, color: rgb(0.4, 0.4, 0.4) });
  }

  text(env.FR_NAME, { b: true, size: 13 }); line(15);
  text(`SIRET : ${env.FR_SIRET}`, { size: 9.5 }); line(13);
  text(`Email : ${env.MAIL_FROM}`, { size: 9.5 }); line(22);

  hr();
  const docTitle = paid ? `FACTURE N° ${o.invoice_number ?? o.code}` : `PROFORMA / DEVIS N° ${o.code}`;
  text(docTitle, { b: true, size: 15 }); line(16);
  text(`Date d'émission : ${fmtDate(paid && o.paid_at ? o.paid_at : o.created_at, 'fr')}`, { size: 9.5 }); line(13);
  if (!paid) { text(`Valable jusqu'au : ${fmtDate(deadline(env, o), 'fr')}`, { size: 9.5 }); line(13); }
  line(6);

  text(`Client : ${o.name || o.email} (${o.email})`, { b: true, size: 10 }); line(20);

  hr();
  text('Désignation', { b: true, size: 9.5 });
  text('Qté', { b: true, size: 9.5, x: 390 });
  text('Total HT / TTC', { b: true, size: 9.5, x: 460 });
  line(8); hr();

  text(SERVICE_NAME_FR(env).slice(0, 68), { size: 9.5 });
  text('1', { size: 9.5, x: 395 });
  text(money(amountMinor, 'EUR'), { b: true, size: 10, x: 460 });
  line(18);

  if (!paid && Number(env.PRICE_EUR_CARD) > amountMinor) {
    text(`Tarif standard (carte / PayPal) : ${money(Number(env.PRICE_EUR_CARD), 'EUR')}`, { size: 9, color: [0.35, 0.35, 0.35] }); line(13);
    text(`Remise virement bancaire SEPA : −${money(Number(env.PRICE_EUR_CARD) - amountMinor, 'EUR')}`, { size: 9, color: [0.1, 0.45, 0.2] }); line(14);
  }
  hr();

  text(`Total à payer : ${money(amountMinor, 'EUR')}`, { b: true, size: 12 }); line(15);
  text('TVA non applicable, art. 293 B du CGI (franchise en base de TVA).', { b: true, size: 9.5 }); line(22);

  if (paid) {
    text(`STATUT : ACQUITTÉE le ${fmtDate(o.paid_at ?? now(), 'fr')} (${o.method === 'stripe' ? 'Carte / Stripe' : 'Virement SEPA'}) — Réf. ${o.code}`, {
      b: true,
      size: 10.5,
      color: [0.08, 0.48, 0.2],
    });
  } else {
    hr();
    text('Règlement par virement SEPA :', { b: true, size: 10 }); line(14);
    text(`Bénéficiaire : ${env.FR_NAME}`, { size: 9.5 }); line(13);
    text(`IBAN : ${env.FR_IBAN}`, { b: true, size: 10 }); line(13);
    text(`BIC / SWIFT : ${env.FR_BIC} (${env.FR_BANK_NAME})`, { size: 9.5 }); line(13);
    text(`Référence obligatoire du virement : ${o.code}`, { b: true, size: 10 }); line(16);
    text('Pas d’escompte en cas de paiement anticipé. Pénalités de retard : 3× taux d’intérêt légal.', { size: 8, color: [0.4, 0.4, 0.4] });
  }
  return doc.save();
}

function wrap(s: string, max: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) { out.push(cur); cur = w; }
    else cur = (cur ? cur + ' ' : '') + w;
  }
  if (cur) out.push(cur);
  return out;
}
