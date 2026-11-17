import type { Currency, Env, PayerType } from './types';
import { bytesToBase64, hmacSha256, timingSafeEqual } from './util';

export interface ParsedTallySubmission {
  responseId: string | null;
  name: string | null;
  email: string;
  telegram: string | null;
  phone: string | null;
  currency: Currency;
  payerType: PayerType;
  customAmountMinor: number | null;
  companyInn: string | null;
  companyName: string | null;
  rawFields: string;
}

export async function verifyTallySignature(env: Env, rawBody: string, sig: string | null): Promise<boolean> {
  if (!env.TALLY_SIGNING_SECRET) return true;
  if (!sig) return false;
  const expected = bytesToBase64(await hmacSha256(env.TALLY_SIGNING_SECRET, rawBody));
  return timingSafeEqual(expected, sig.trim());
}

function fieldValueText(f: any): string {
  const v = f?.value;
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  if (Array.isArray(v)) {
    const opts: any[] = f?.options ?? [];
    return v
      .map((item) => {
        if (typeof item === 'string') {
          const found = opts.find((o) => o.id === item);
          return found ? found.text : item;
        }
        return item?.text ?? item?.name ?? '';
      })
      .filter(Boolean)
      .join(', ')
      .trim();
  }
  return '';
}

export function parseTally(payload: any): ParsedTallySubmission | null {
  const data = payload?.data ?? payload;
  const fields: any[] = data?.fields ?? [];
  const flat: Record<string, string> = {};
  for (const f of fields) {
    const label = String(f?.label ?? f?.key ?? '').trim();
    const val = fieldValueText(f);
    if (label && val) flat[label] = val;
  }

  let email = '';
  let name: string | null = null;
  let telegram: string | null = null;
  let phone: string | null = null;
  let companyInn: string | null = null;
  let companyName: string | null = null;
  let allChoiceText = '';

  for (const f of fields) {
    const label = String(f?.label ?? '').toLowerCase();
    const type = String(f?.type ?? '');
    const val = fieldValueText(f);
    if (!val) continue;

    if (!email && (type === 'INPUT_EMAIL' || /e-?mail|почт/i.test(label) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val))) {
      const m = val.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      if (m) email = m[0].toLowerCase();
    } else if (!companyInn && (/инн|\binn\b/i.test(label) || /^\d{10}(\d{2})?$/.test(val.replace(/\s+/g, '')))) {
      const digits = val.replace(/\D/g, '');
      if (digits.length === 10 || digits.length === 12) companyInn = digits;
    } else if (!telegram && (/telegram|телеграм|тг|\btg\b/i.test(label) || /^@[a-zA-Z0-9_]{3,}$/.test(val) || /t\.me\//i.test(val))) {
      telegram = val;
    } else if (!phone && (type === 'INPUT_PHONE_NUMBER' || /телефон|phone|номер/i.test(label))) {
      phone = val;
    } else if (!name && (/имя|фамил|фио|name/i.test(label) && !/компан|орган|юр/i.test(label))) {
      name = val;
    } else if (!companyName && /компан|организац|юр\.?\s*лиц/i.test(label) && !/оплат|способ|тариф|тип|форм/i.test(label)) {
      companyName = val;
    } else if (!name && type === 'INPUT_TEXT' && val.length < 80) {
      name = val;
    } else if (!telegram && type === 'INPUT_TEXT' && val.length < 60) {
      telegram = val;
    }

    if (/оплат|валют|способ|тариф|страна|тип|лиц|payment|currency|method/i.test(label) || type.includes('CHOICE') || type.includes('DROPDOWN')) {
      allChoiceText += ' ' + val;
    }
  }

  if (!email) return null;

  const blob = (allChoiceText + ' ' + Object.values(flat).join(' ')).toLowerCase();
  let payerType: PayerType = 'person';
  let currency: Currency = 'RUB';
  let customAmountMinor: number | null = null;

  if (companyInn || /юр\.?\s*лиц|юридическ|организац|компан|по\s+сч[её]ту|\bооо\b|75\s*000/.test(blob)) {
    payerType = 'company';
    currency = 'RUB';
  } else if (/€|\beur\b|евро|sepa|iban|stripe|paypal|\bес\b|европ|650\s*€|670\s*€|международн/.test(blob)) {
    currency = 'EUR';
    payerType = 'person';
  } else if (/69\s*000/.test(blob)) {
    customAmountMinor = 6900000;
  }

  return {
    responseId: data?.responseId ?? data?.submissionId ?? null,
    name,
    email,
    telegram,
    phone,
    currency,
    payerType,
    customAmountMinor,
    companyInn,
    companyName,
    rawFields: JSON.stringify(flat),
  };
}
