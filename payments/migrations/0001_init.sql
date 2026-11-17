-- Заказы на курс
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,          -- CU-0427: код для комментария к платежу
  token             TEXT NOT NULL UNIQUE,          -- секрет для ссылок /p/<token> и t.me/bot?start=<token>
  tally_response_id TEXT UNIQUE,
  created_at        INTEGER NOT NULL,              -- unix seconds
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | claimed | paid | cancelled
  currency          TEXT NOT NULL,                 -- RUB | EUR
  payer_type        TEXT NOT NULL,                 -- person | company
  amount            INTEGER NOT NULL,              -- базовая сумма к оплате в минорных единицах (копейки/центы)
  amount_paid       INTEGER,
  method            TEXT,                          -- sbp | bank_ru | stripe | iban
  name              TEXT,
  email             TEXT NOT NULL,
  telegram          TEXT,
  phone             TEXT,
  company_inn       TEXT,
  company_kpp       TEXT,
  company_name      TEXT,
  company_address   TEXT,
  company_ogrn      TEXT,
  raw_fields        TEXT,                          -- JSON всех полей формы
  tg_user_id        INTEGER,
  invite_link       TEXT,
  joined_group_at   INTEGER,
  claimed_at        INTEGER,
  paid_at           INTEGER,
  reminder_sent_at  INTEGER,
  cancelled_at      INTEGER,
  receipt_url       TEXT,                          -- ссылка на чек «Мой налог»
  invoice_number    TEXT,                          -- номер facture (EUR) после оплаты
  stripe_session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_tg ON orders(tg_user_id);

-- Сообщения бота в админ-чате: на них можно ответить reply'ем
CREATE TABLE IF NOT EXISTS admin_msgs (
  msg_id  INTEGER PRIMARY KEY,
  kind    TEXT NOT NULL,   -- relay | receipt
  ref     TEXT NOT NULL    -- relay: tg user chat id; receipt: order id
);

-- Пользователи бота (для анти-спама подтверждений)
CREATE TABLE IF NOT EXISTS tg_users (
  user_id     INTEGER PRIMARY KEY,
  username    TEXT,
  first_name  TEXT,
  last_ack_at INTEGER,
  blocked     INTEGER NOT NULL DEFAULT 0
);

-- Счётчики для сквозной нумерации документов
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
