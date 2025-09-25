# ToolRent — лендинг проката инструмента

Одностраничный лендинг на русском языке. Каталог инструментов подтягивается из Google Sheets, заявки уходят в Telegram и могут записываться в отдельный лист.

## Настройка фронтенда

1. Опубликуйте Google Sheet с каталогом. Структура листа `{{TOOLS_SHEET_NAME}}`:
   ```text
   id | name | shortDescription | dailyPrice | weekendPrice | deposit | tags | availability | image | specs markdown
   ```
2. Добавьте стартовые записи (см. техническое задание) или собственные. Сделайте доступ «Просмотр для всех».
3. В файле `index.html` замените плейсхолдеры:
   - `{{PHONE_NUMBER}}`, `{{TELEGRAM_USERNAME}}`
   - `{{GOOGLE_SHEET_ID}}`, `{{TOOLS_SHEET_NAME}}`
   - `{{BACKEND_ENDPOINT}}`
   - `{{ADDRESS_PLACEHOLDER}}`
4. Разместите `index.html` на любой статический хостинг (Vercel, Netlify, GitHub Pages). Каталог загрузится при открытии страницы.

## Работа формы и Telegram-уведомлений

Форма отправляет POST-запрос `{{BACKEND_ENDPOINT}}/lead` с JSON:
```json
{
  "name": "Иван",
  "phoneOrTelegram": "+7 900 000-00-00",
  "toolId": "rotary-hammer",
  "toolName": "Rotary Hammer",
  "startDate": "2024-03-01",
  "endDate": "2024-03-03",
  "notes": "Нужны буры 12 и 16 мм",
  "userAgent": "Mozilla/5.0...",
  "referrer": "https://example.com",
  "pagePath": "/",
  "timestamp": "2024-02-20T10:00:00.000Z"
}
```

## Serverless-функция `backend/lead.js`

Минимальная функция для Vercel / Netlify Functions / Cloudflare Workers (через Webpack/Bundler). Задачи функции:

- Проверить обязательные поля, ограничить количество запросов (rate limit).  
- Отправить сообщение в Telegram Bot API.  
- При наличии сервисного аккаунта — записать лид в лист `{{LEADS_SHEET_NAME}}` той же таблицы Google Sheets.

### Переменные окружения

| Имя | Назначение |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Токен бота @BotFather |
| `TELEGRAM_CHAT_ID` | ID чата/канала, куда отправлять уведомления |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON сервисного аккаунта (строка) с доступом к таблице |
| `GOOGLE_SHEET_ID` | ID таблицы Google Sheets |
| `LEADS_SHEET_NAME` | Название листа, куда добавлять лиды (например, `Leads`) |

### Деплой на Vercel

1. `npm init -y && npm install node-fetch googleapis` (добавьте в `package.json` `type: "module"` при необходимости).  
2. Скопируйте файл `backend/lead.js` в `api/lead.js` в корне проекта.  
3. Создайте проект на Vercel, задайте переменные окружения (Settings → Environment Variables).  
4. Разверните проект (`vercel deploy`).  
5. Вставьте URL функции в `{{BACKEND_ENDPOINT}}` в `index.html`.

### Альтернатива без сервисного аккаунта

- Создайте Google Form, связанную с тем же Spreadsheet.  
- Настройте Apps Script-триггер `onFormSubmit`, который отправляет сообщение в Telegram (логика в README легко переносится).  
- Укажите URL формы в кнопке, если нужно.

## Проверка

- Откройте сайт, убедитесь, что карточки подгружаются, поиск и фильтры работают.  
- Отправьте тестовую заявку и убедитесь, что сообщение приходит в Telegram и строка появляется в Google Sheets.

## Лицензия

Проект распространяется «как есть» для демонстрационных целей. Используйте и адаптируйте под свои нужды.
