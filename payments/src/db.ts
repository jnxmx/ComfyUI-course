import type { Env, Order } from './types';
import { cleanTgHandle, now, randomToken } from './util';

export async function getOrderByToken(env: Env, token: string): Promise<Order | null> {
  return env.DB.prepare('SELECT * FROM orders WHERE token = ?').bind(token).first<Order>();
}
export async function getOrderById(env: Env, id: number): Promise<Order | null> {
  return env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Order>();
}
export async function getOrderByCode(env: Env, code: string): Promise<Order | null> {
  return env.DB.prepare('SELECT * FROM orders WHERE code = ?').bind(code.toUpperCase()).first<Order>();
}
export async function getOrderByTallyId(env: Env, rid: string): Promise<Order | null> {
  return env.DB.prepare('SELECT * FROM orders WHERE tally_response_id = ?').bind(rid).first<Order>();
}
export async function getPaidOrderByTgUser(env: Env, userId: number): Promise<Order | null> {
  return env.DB.prepare("SELECT * FROM orders WHERE tg_user_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 1").bind(userId).first<Order>();
}
export async function getPaidOrderByInviteLink(env: Env, link: string): Promise<Order | null> {
  return env.DB.prepare("SELECT * FROM orders WHERE status = 'paid' AND invite_link = ? ORDER BY paid_at DESC LIMIT 1").bind(link).first<Order>();
}
export async function getPaidOrderByTgHandle(env: Env, handle: string): Promise<Order | null> {
  const clean = cleanTgHandle(handle)?.toLowerCase();
  if (!clean) return null;
  const list = await listPaidOrders(env);
  for (const o of list) {
    if (o.telegram && cleanTgHandle(o.telegram)?.toLowerCase() === clean) {
      return o;
    }
  }
  return null;
}
export async function getLatestOrderByTgUser(env: Env, userId: number): Promise<Order | null> {
  return env.DB.prepare('SELECT * FROM orders WHERE tg_user_id = ? ORDER BY created_at DESC LIMIT 1').bind(userId).first<Order>();
}
export async function listOpenOrders(env: Env): Promise<Order[]> {
  const r = await env.DB.prepare("SELECT * FROM orders WHERE status IN ('pending','claimed') ORDER BY created_at").all<Order>();
  return r.results;
}
export async function listPaidOrders(env: Env): Promise<Order[]> {
  const r = await env.DB.prepare("SELECT * FROM orders WHERE status = 'paid' ORDER BY paid_at").all<Order>();
  return r.results;
}

export async function updateOrder(env: Env, id: number, fields: Partial<Order>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE orders SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  await env.DB.prepare(sql).bind(...keys.map((k) => (fields as Record<string, unknown>)[k] ?? null), id).run();
}

/** Атомарный переход статуса. Возвращает true, если именно этот вызов перевёл заказ. */
export async function transitionStatus(env: Env, id: number, from: string[], to: string, extra: Partial<Order> = {}): Promise<boolean> {
  const keys = Object.keys(extra);
  const set = ['status = ?', ...keys.map((k) => `${k} = ?`)].join(', ');
  const sql = `UPDATE orders SET ${set} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`;
  const r = await env.DB.prepare(sql).bind(to, ...keys.map((k) => (extra as Record<string, unknown>)[k] ?? null), id, ...from).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function nextCounter(env: Env, name: string, start = 1): Promise<number> {
  const r = await env.DB.prepare(
    'INSERT INTO counters(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value',
  ).bind(name, start).first<{ value: number }>();
  return r!.value;
}

export type NewOrder = Omit<Order, 'id' | 'code' | 'token' | 'created_at' | 'status' | 'amount_paid' | 'tg_user_id' | 'invite_link' |
  'joined_group_at' | 'claimed_at' | 'paid_at' | 'reminder_sent_at' | 'cancelled_at' | 'receipt_url' | 'invoice_number' | 'stripe_session_id' | 'method'> & { method?: Order['method'] };

export async function createOrder(env: Env, o: NewOrder): Promise<Order> {
  const n = await nextCounter(env, 'order', 101);
  const code = `CU-${String(n).padStart(4, '0')}`;
  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO orders (code, token, tally_response_id, created_at, status, currency, payer_type, amount, method, name, email, telegram, phone,
      company_inn, company_kpp, company_name, company_address, company_ogrn, raw_fields)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(code, token, o.tally_response_id, now(), o.currency, o.payer_type, o.amount, o.method ?? null, o.name, o.email, o.telegram, o.phone,
    o.company_inn, o.company_kpp, o.company_name, o.company_address, o.company_ogrn, o.raw_fields).run();
  return (await getOrderByToken(env, token))!;
}

export async function saveAdminMsg(env: Env, msgId: number, kind: 'relay' | 'receipt', ref: string | number): Promise<void> {
  await env.DB.prepare('INSERT OR REPLACE INTO admin_msgs(msg_id, kind, ref) VALUES (?, ?, ?)').bind(msgId, kind, String(ref)).run();
}
export async function getAdminMsg(env: Env, msgId: number): Promise<{ kind: string; ref: string } | null> {
  return env.DB.prepare('SELECT kind, ref FROM admin_msgs WHERE msg_id = ?').bind(msgId).first();
}

export async function touchTgUser(env: Env, u: { id: number; username?: string; first_name?: string }) {
  return env.DB.prepare(
    `INSERT INTO tg_users(user_id, username, first_name) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name
     RETURNING last_ack_at, blocked`,
  ).bind(u.id, u.username ?? null, u.first_name ?? null).first<{ last_ack_at: number | null; blocked: number }>();
}
export async function setTgUser(env: Env, userId: number, fields: { last_ack_at?: number; blocked?: number }) {
  const keys = Object.keys(fields);
  await env.DB.prepare(`UPDATE tg_users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`)
    .bind(...keys.map((k) => (fields as Record<string, number>)[k]), userId).run();
}
