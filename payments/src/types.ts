export interface Env {
  DB: D1Database;

  // --- публичные настройки (vars в wrangler.toml) ---
  PUBLIC_URL: string;            // https://pay.yakushev.fr или https://course-payments.<acc>.workers.dev
  SITE_URL: string;              // https://course.yakushev.fr
  COURSE_TITLE: string;          // «ComfyUI для работы с нейросетями»
  COURSE_STREAM: string;         // «5-й поток, 8 июня — 6 августа 2026»
  BOT_USERNAME: string;          // без @
  ADMIN_CHAT_ID: string;         // твой chat id в Telegram
  GROUP_CHAT_ID: string;         // id группы курса (-100…)
  MAIL_FROM_NAME: string;        // «Иван Якушев»
  MAIL_FROM: string;             // course@yakushev.fr
  MAIL_REPLY_TO?: string;        // ivan.yakushev@gmail.com
  MAIL_SMTP_HOST?: string;       // smtp.zoho.eu (или smtp.gmail.com)
  MAIL_SMTP_PORT?: string;       // 465
  PAYMENT_TTL_HOURS: string;     // 48
  COMPANY_TTL_HOURS: string;     // 168
  REMIND_AFTER_HOURS: string;    // 24

  // цены в минорных единицах
  PRICE_RUB_PERSON: string;      // 6500000
  PRICE_RUB_COMPANY: string;     // 7500000
  PRICE_EUR_CARD: string;        // 67000
  PRICE_EUR_IBAN: string;        // 65000

  // реквизиты: РФ (самозанятый)
  RU_PAYEE_NAME: string;         // Якушев Иван Евгеньевич
  RU_INN: string;
  RU_SBP_PHONE: string;          // +7 …
  RU_SBP_BANK: string;           // Райффайзенбанк
  RU_ACCOUNT: string;            // 40817… (счёт для оплаты от юрлиц)
  RU_BANK_NAME: string;
  RU_BIC: string;
  RU_CORR_ACCOUNT: string;

  // реквизиты: Франция (micro-entrepreneur)
  FR_NAME: string;               // Ivan Yakushev EI
  FR_SIRET: string;
  FR_ADDRESS: string;
  FR_IBAN: string;
  FR_BIC: string;
  FR_BANK_NAME: string;

  // --- секреты (wrangler secret put) ---
  TG_BOT_TOKEN: string;
  TG_WEBHOOK_SECRET: string;
  TALLY_SIGNING_SECRET: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  SMTP_PASSWORD?: string;
  GMAIL_APP_PASSWORD?: string;
  DADATA_API_KEY?: string;
  ADMIN_KEY: string;             // для /setup
}

export type OrderStatus = 'pending' | 'claimed' | 'paid' | 'cancelled';
export type Currency = 'RUB' | 'EUR';
export type PayerType = 'person' | 'company';
export type Method = 'sbp' | 'bank_ru' | 'stripe' | 'iban';

export interface Order {
  id: number;
  code: string;
  token: string;
  tally_response_id: string | null;
  created_at: number;
  status: OrderStatus;
  currency: Currency;
  payer_type: PayerType;
  amount: number;
  amount_paid: number | null;
  method: Method | null;
  name: string | null;
  email: string;
  telegram: string | null;
  phone: string | null;
  company_inn: string | null;
  company_kpp: string | null;
  company_name: string | null;
  company_address: string | null;
  company_ogrn: string | null;
  raw_fields: string | null;
  tg_user_id: number | null;
  invite_link: string | null;
  joined_group_at: number | null;
  claimed_at: number | null;
  paid_at: number | null;
  reminder_sent_at: number | null;
  cancelled_at: number | null;
  receipt_url: string | null;
  invoice_number: string | null;
  stripe_session_id: string | null;
}
