# Оплата курса, письма и Telegram-бот (`payments/`)

Бесплатный бэкенд на **Cloudflare Workers + D1** для статического сайта на GitHub Pages (`course.yakushev.fr`).

## Что делает система

1. **Заявка из Tally (`POST /webhooks/tally`):**
   - создаёт заказ с кодом `CU-0101` и персональной страницей `/p/<token>`;
   - **РФ, физлицо (65 000 ₽):** отправляет письмо с реквизитами СБП, суммой и кодом для комментария;
   - **РФ, юрлицо (75 000 ₽):** подтягивает реквизиты компании по ИНН через DaData, генерирует PDF **счёт-договор** с QR по ГОСТ Р 56042-2014 и отправляет на почту;
   - **ЕС (670 € / 650 €):** генерирует PDF **Proforma / Devis** на 650 € с EPC SEPA QR-кодом и даёт на странице заказа выбор: мгновенная оплата 670 € через **Stripe Checkout** (карта, Apple/Google Pay, PayPal) или прямой **SEPA-перевод на IBAN** со скидкой (650 €);
   - присылает тебе в Telegram карточку заказа с кнопками `✅ Оплачено` / `❌ Отменить` (и копию PDF-счёта).

2. **Подтверждение оплаты:**
   - **Полуавтомат (СБП / счёт юрлица / SEPA IBAN):** студент нажимает «Я оплатил(а)» на странице заказа или в боте → тебе приходит уведомление → ты проверяешь банк и жмёшь `✅ Оплачено`.
   - **Автомат (Stripe 670 €):** вебхук `checkout.session.completed` сам подтверждает заказ.
   - **После подтверждения автоматически:**
     1. Студенту на почту уходит **письмо о факте оплаты** (для EUR — с вложенным PDF **Facture** `F-2026-0001` со штампом *ACQUITTÉE* и строкой *TVA non applicable, art. 293 B du CGI*) и персональной ссылкой на бота.
     2. Бот выдаёт персональную ссылку-заявку в закрытую Telegram-группу курса и **автоматически одобряет** вход только для оплатившего `tg_user_id` (`chat_join_request`).
     3. Для RUB бот присылает тебе готовые строки для **«Мой налог»** (наименование, сумма, физлицо или ИНН юрлица). Если ответить (Reply) на это сообщение ссылкой на чек из «Мой налог», бот сам отправит чек студенту на почту и в Telegram.
     4. Для юрлиц РФ кнопка `📄 Отправить акт` (или команда `/acts` в конце потока) генерирует и отправляет PDF-акт.

3. **Бот для вопросов по курсу (`@<BOT_USERNAME>`):**
   - Любое личное сообщение от потенциального или действующего студента пересылается тебе в админ-чат (твой личный аккаунт не раскрывается).
   - Чтобы ответить — просто сделай **Reply** на пересланное сообщение в боте. Команда `/block` в Reply блокирует спамера.

4. **Автоотмена неоплаченных заявок (cron раз в час):**
   - через 24 ч без оплаты отправляет напоминание на почту;
   - через 48 ч (для юрлиц — 7 дней), если студент не нажал «Я оплатил(а)», отменяет заявку и уведомляет по почте и в Telegram.

---

## Быстрый запуск (15 минут)

### 1. Telegram: бот и группа курса
1. В `@BotFather`: `/newbot` → сохрани токен (`TG_BOT_TOKEN`) и username бота (`BOT_USERNAME` без `@`).
2. Добавь бота в закрытую группу курса **администратором** с правом **«Приглашать пользователей»** (*Invite Users via Link*).
3. Узнай свой `ADMIN_CHAT_ID` и `GROUP_CHAT_ID` (групповой начинается с `-100…`).

### 2. Gmail: пароль приложения для отправки писем
1. В Google-аккаунте включи двухфакторную аутентификацию.
2. Перейди на `https://myaccount.google.com/apppasswords`, создай пароль приложения (16 символов без пробелов) — это секрет `GMAIL_APP_PASSWORD`.

### 3. Заполни реквизиты в `payments/wrangler.toml`
Открой `payments/wrangler.toml` и впиши свои значения в секцию `[vars]`:
- `BOT_USERNAME`, `ADMIN_CHAT_ID`, `GROUP_CHAT_ID`, `MAIL_FROM` (твой Gmail);
- `RU_INN`, `RU_SBP_PHONE`, `RU_ACCOUNT` (20-значный счёт в Райфе для юрлиц);
- `FR_SIRET`, `FR_ADDRESS`, `FR_IBAN`, `FR_BIC`, `FR_BANK_NAME`.
Также поменяй ссылку `https://t.me/comfyui_course_bot` в `index.html` на реальный username бота.

### 4. Создай БД D1 и задеплой Worker
```bash
cd payments
npx wrangler login
npx wrangler d1 create comfyui-course-db
# скопируй выведенный database_id в wrangler.toml (поле database_id)

npx wrangler d1 migrations apply comfyui-course-db --remote
```

Задай секреты:
```bash
npx wrangler secret put TG_BOT_TOKEN
npx wrangler secret put TG_WEBHOOK_SECRET      # любая случайная строка
npx wrangler secret put GMAIL_APP_PASSWORD     # 16-значный App Password из шага 2
npx wrangler secret put ADMIN_KEY              # пароль для разового вызова /setup
# опционально:
npx wrangler secret put TALLY_SIGNING_SECRET   # Signing Secret из настроек вебхука Tally
npx wrangler secret put DADATA_API_KEY         # бесплатный ключ с dadata.ru для автозаполнения по ИНН
npx wrangler secret put STRIPE_SECRET_KEY      # sk_live_...
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # whsec_...
```

Деплой:
```bash
npx wrangler deploy
```
После первого деплоя впиши полученный URL (`https://comfyui-course-payments.<subdomain>.workers.dev` или свой поддомен `https://pay.yakushev.fr`) в `PUBLIC_URL` в `wrangler.toml`, запусти `npx wrangler deploy` ещё раз и зарегистрируй вебхук Telegram, открыв в браузере:
```
https://<PUBLIC_URL>/setup?key=<ADMIN_KEY>
```

### 5. Подключи Tally и (при необходимости) Stripe
- **Tally:** в форме регистрации (`GxXNBo`) добавь вопрос выбора варианта оплаты (`РФ — физлицо 65 000 ₽ (СБП)`, `РФ — юрлицо 75 000 ₽ (по счёту, укажите ИНН)`, `ЕС — 650 € SEPA / 670 € карта или PayPal`) и условное поле «ИНН организации». В *Integrations → Webhooks* укажи `https://<PUBLIC_URL>/webhooks/tally`.
- **Stripe:** в *Developers → Webhooks* добавь endpoint `https://<PUBLIC_URL>/webhooks/stripe` на события `checkout.session.completed` и `checkout.session.async_payment_succeeded`.
