import type { Env } from './types';

export interface TgResult<T = any> { ok: boolean; result?: T; description?: string; error_code?: number }

export async function tg<T = any>(env: Env, method: string, payload: Record<string, unknown>): Promise<TgResult<T>> {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as TgResult<T>;
  if (!j.ok) console.warn(`tg ${method} failed`, j.error_code, j.description);
  return j;
}

export const sendMessage = (env: Env, chatId: number | string, text: string, extra: Record<string, unknown> = {}) =>
  tg<{ message_id: number }>(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

export const sendAdmin = (env: Env, text: string, extra: Record<string, unknown> = {}) => sendMessage(env, env.ADMIN_CHAT_ID, text, extra);

export async function sendDocument(env: Env, chatId: number | string, filename: string, bytes: Uint8Array, caption?: string) {
  const fd = new FormData();
  fd.set('chat_id', String(chatId));
  if (caption) { fd.set('caption', caption); fd.set('parse_mode', 'HTML'); }
  fd.set('document', new File([bytes], filename, { type: 'application/pdf' }));
  const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd });
  return (await r.json()) as TgResult;
}

export const kb = (rows: { text: string; data?: string; url?: string }[][]) => ({
  reply_markup: {
    inline_keyboard: rows.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))),
  },
});

/** Персональная ссылка-заявка: вступить можно только после одобрения ботом. */
export async function createJoinLink(env: Env, name: string): Promise<string | null> {
  const r = await tg<{ invite_link: string }>(env, 'createChatInviteLink', {
    chat_id: env.GROUP_CHAT_ID,
    name: name.slice(0, 32),
    creates_join_request: true,
    expire_date: Math.floor(Date.now() / 1000) + 30 * 86400,
  });
  return r.ok ? r.result!.invite_link : null;
}
