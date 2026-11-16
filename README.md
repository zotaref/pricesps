# Telegram-бот для PlayStation Store Україна

Надішли назву гри в особистому чаті. Бот покаже доступну всім ціну придбання з українського PlayStation Store, суму з націнкою і підсумок після ділення на 43,3. За кількох збігів бот покаже кнопки вибору видання. Приклад з таблиці дає 4 575 грн і 105,66 для ціни 4 300 грн.

GitHub Actions публікує код у Cloudflare Workers. Telegram надсилає повідомлення опублікованому сервісу через webhook. Бот працює незалежно від ПК. Для особистого бота можна використати Workers Free. [Ліміти Cloudflare](https://developers.cloudflare.com/workers/platform/limits/)

## Одноразове підключення

1. У Cloudflare відкрий **Workers & Pages** і налаштуй піддомен `workers.dev`, якщо його ще немає. Скопіюй **Account ID**. Створи API Token за шаблоном **Edit Cloudflare Workers** для свого акаунта. [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages), [створення API Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
2. Відкрий **Settings → Secrets and variables → Actions → New repository secret** у цьому репозиторії. Додай `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` та `TELEGRAM_BOT_TOKEN`. Для `TELEGRAM_BOT_TOKEN` використай токен цього бота від BotFather. [Secrets цього репозиторію](https://github.com/zotaref/pricesps/settings/secrets/actions), [@BotFather](https://t.me/BotFather)
3. Відкрий **Actions → Deploy PlayStation price bot → Run workflow** і вибери `main`. Після успішного запуску в підсумку з’явиться посилання на бота. Відкрий його, натисни **Start** і надішли `ASTRO BOT`. [Дії цього репозиторію](https://github.com/zotaref/pricesps/actions)

Після успішного підключення можна закрити локальне вікно запуску бота. Кожна зміна в `main` розгортається автоматично. Розгортання перевіряє живу ціну ASTRO BOT з Cloudflare перед підключенням Telegram. Для змін у формулі онови пороги, націнки або курс у `src/prices.mjs`.
