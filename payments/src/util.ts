import type { Env, Order } from './types';

export const now = () => Math.floor(Date.now() / 1000);

export function randomToken(bytes = 18): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
}

export const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 6500000 → «65 000 ₽», 67000 → «670,00 €» */
export function money(minor: number, currency: 'RUB' | 'EUR'): string {
  if (currency === 'RUB') {
    const rub = minor / 100;
    return `${rub.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/\u00a0/g, ' ')} ₽`;
  }
  return `${(minor / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u00a0\u202f]/g, ' ')} €`;
}

export function fmtDate(ts: number, locale: 'ru' | 'fr' = 'ru'): string {
  return new Date(ts * 1000).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' МСК';
}

export function ttlHours(env: Env, o: Pick<Order, 'payer_type'>): number {
  return Number(o.payer_type === 'company' ? env.COMPANY_TTL_HOURS : env.PAYMENT_TTL_HOURS) || 48;
}

export function deadline(env: Env, o: Order): number {
  return o.created_at + ttlHours(env, o) * 3600;
}

export const payUrl = (env: Env, o: Order) => `${env.PUBLIC_URL}/p/${o.token}`;
export const botStartUrl = (env: Env, o?: Order) => `https://t.me/${env.BOT_USERNAME}${o ? `?start=${o.token}` : ''}`;

export function orderLabel(o: Order): string {
  if (o.currency === 'EUR') return 'EUR';
  return o.payer_type === 'company' ? 'RUB · юрлицо' : 'RUB · физлицо';
}

export function cleanTgHandle(tg: string | null | undefined): string | null {
  if (!tg) return null;
  const s = tg.trim();
  const m = s.match(/(?:https?:\/\/)?(?:t\.me\/)?@?([a-zA-Z0-9_]{3,})/);
  return m ? m[1] : null;
}

export const SERVICE_NAME_RU = (env: Env) => `Информационно-консультационные услуги: онлайн-курс «${env.COURSE_TITLE}», ${env.COURSE_STREAM}`;
export const SERVICE_NAME_FR = (env: Env) => `Formation en ligne « ${env.COURSE_TITLE} » — ${env.COURSE_STREAM}`;
