const path = require('path');
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const SAMPLE_INVENTORY = [
  {
    id: 'rotary-hammer',
    name: 'Перфоратор SDS-Plus',
    daily_price: 1200,
    weekend_price: 2000,
    deposit: 5000,
    availability: 'in_stock',
    quantity: 3
  },
  {
    id: 'space-heater',
    name: 'Тепловая пушка 5 кВт',
    daily_price: 1800,
    weekend_price: 3000,
    deposit: 7000,
    availability: 'limited',
    quantity: 1
  }
];

const SAMPLE_REVIEWS = [
  {
    author: 'Андрей',
    platform: 'avito',
    text: 'Брал тепловую пушку на выходные — всё отлично, инструмент в идеале.',
    url: 'https://example.com/review/1',
    date: new Date().toISOString()
  },
  {
    author: 'Мария',
    platform: 'avito',
    text: 'Выдали перфоратор с полной комплектацией, помогли с доставкой.',
    url: 'https://example.com/review/2',
    date: new Date().toISOString()
  }
];

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
  });
  pool.on('error', (err) => {
    console.error('PostgreSQL pool error', err);
  });
}

async function fetchInventory() {
  if (!pool) {
    return SAMPLE_INVENTORY;
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, daily_price, weekend_price, deposit, availability, quantity
       FROM inventory
       ORDER BY name`
    );
    if (!rows || rows.length === 0) {
      return SAMPLE_INVENTORY;
    }
    return rows;
  } catch (err) {
    console.error('Failed to query inventory:', err);
    return SAMPLE_INVENTORY;
  }
}

async function fetchReviews() {
  if (!pool) {
    return SAMPLE_REVIEWS;
  }
  try {
    const { rows } = await pool.query(
      `SELECT author, platform, text, url, COALESCE(date::text, created_at::text) AS date
       FROM reviews
       ORDER BY created_at DESC NULLS LAST
       LIMIT 12`
    );
    if (!rows || rows.length === 0) {
      return SAMPLE_REVIEWS;
    }
    return rows;
  } catch (err) {
    console.error('Failed to query reviews:', err);
    return SAMPLE_REVIEWS;
  }
}

async function saveBooking(booking) {
  if (!pool) {
    return null;
  }
  const {
    name,
    contact,
    toolId,
    dateFrom,
    dateTo,
    notes,
    addons
  } = booking;
  const toolRes = await pool.query('SELECT name FROM inventory WHERE id = $1', [toolId]);
  const toolName = toolRes.rows?.[0]?.name || null;
  const insert = await pool.query(
    `INSERT INTO bookings (customer_name, contact, tool_id, tool_name, date_from, date_to, notes, addons)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, tool_name` ,
    [name, contact, toolId, toolName, dateFrom, dateTo, notes, addons ? JSON.stringify(addons) : null]
  );
  return {
    id: insert.rows?.[0]?.id || null,
    toolName: toolName || insert.rows?.[0]?.tool_name || null
  };
}

async function sendTelegramNotification(booking, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || options.fallbackChat;
  if (!token || !chatId) {
    console.warn('Telegram credentials are not configured');
    return;
  }
  const enabledAddons = Object.entries(booking.addons || {}).filter(([, enabled]) => Boolean(enabled));
  const addonsLine = enabledAddons.length
    ? `Опции: ${enabledAddons
        .map(([key]) => key.replace('addon_', '').replace(/_/g, ' '))
        .join(', ')}`
    : 'Опции: —';

  const message = [
    'Новая бронь на ToolRent!',
    `Имя: ${booking.name}`,
    `Контакт: ${booking.contact}`,
    `Инструмент: ${booking.toolName || booking.toolId}`,
    `Даты: ${booking.dateFrom || '—'} → ${booking.dateTo || '—'}`,
    addonsLine,
    `Комментарий: ${booking.notes || '—'}`
  ].join('\n');

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${text}`);
    }
  } catch (err) {
    console.error('Failed to send Telegram notification:', err);
  }
}

app.get('/api/inventory', async (_req, res) => {
  const inventory = await fetchInventory();
  res.json(inventory);
});

app.get('/api/reviews', async (_req, res) => {
  const reviews = await fetchReviews();
  res.json(reviews);
});

app.post('/api/bookings', async (req, res) => {
  const { name, contact, toolId, dateFrom, dateTo, notes, addons } = req.body || {};

  if (!name || !contact || !toolId) {
    return res.status(400).json({ error: 'Не заполнены обязательные поля' });
  }

  const normalizedAddons = Object.fromEntries(
    Object.entries(addons || {}).map(([key, value]) => [key, Boolean(value)])
  );

  const booking = {
    name: String(name).trim(),
    contact: String(contact).trim(),
    toolId: String(toolId).trim(),
    dateFrom: dateFrom ? String(dateFrom) : null,
    dateTo: dateTo ? String(dateTo) : null,
    notes: notes ? String(notes).trim() : null,
    addons: normalizedAddons
  };

  try {
    const saved = await saveBooking(booking).catch((err) => {
      console.error('Failed to save booking:', err);
      return null;
    });

    const fallbackToolName = SAMPLE_INVENTORY.find(item => item.id === booking.toolId)?.name;
    const toolName = saved?.toolName || fallbackToolName || null;
    const messagePayload = { ...booking, toolName: toolName || booking.toolId };

    await sendTelegramNotification(messagePayload, { fallbackChat: '@hokkystyle' });

    res.json({
      status: 'ok',
      message: 'Заявка отправлена. Мы свяжемся с вами в ближайшее время.'
    });
  } catch (err) {
    console.error('Booking workflow failed:', err);
    res.status(500).json({ error: 'Не удалось обработать заявку' });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'Landing.html'));
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`ToolRent backend listening on port ${PORT}`);
});
