import type { Env, Order } from './types';
import { hmacSha256, payUrl, SERVICE_NAME_FR, timingSafeEqual, toHex } from './util';

export async function createStripeCheckout(env: Env, o: Order): Promise<{ id: string; url: string } | null> {
  if (!env.STRIPE_SECRET_KEY) return null;
  const amount = Number(env.PRICE_EUR_CARD) || 67000;
  const body = new URLSearchParams({
    mode: 'payment',
    success_url: `${payUrl(env, o)}?paid=1`,
    cancel_url: payUrl(env, o),
    client_reference_id: o.token,
    customer_email: o.email,
    'metadata[order_id]': String(o.id),
    'metadata[order_code]': o.code,
    'metadata[order_token]': o.token,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': SERVICE_NAME_FR(env),
    'line_items[0][price_data][product_data][description]': `Réf. ${o.code} — TVA non applicable, art. 293 B du CGI`,
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const j = (await r.json()) as any;
  if (!r.ok || !j?.url) {
    console.error('stripe checkout error', j);
    return null;
  }
  return { id: j.id, url: j.url };
}

export async function verifyStripeWebhook(env: Env, rawBody: string, sigHeader: string | null): Promise<any | null> {
  if (!env.STRIPE_WEBHOOK_SECRET || !sigHeader) return null;
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.trim().split('=')));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return null;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > 300) return null;
  const expected = toHex(await hmacSha256(env.STRIPE_WEBHOOK_SECRET, `${t}.${rawBody}`));
  if (!timingSafeEqual(expected, v1)) return null;
  return JSON.parse(rawBody);
}
