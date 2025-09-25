const fetch = require('node-fetch');
const { google } = require('googleapis');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const {
      name,
      phoneOrTelegram,
      toolId,
      toolName,
      startDate,
      endDate,
      notes,
      userAgent,
      referrer,
      pagePath,
      timestamp,
    } = req.body || {};

    if (!name || !phoneOrTelegram || !startDate || !endDate) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '')
      .split(',')[0]
      .trim();
    rateLimitGuard(ip);

    const safeNotes = notes && notes.length ? notes : '—';
    const message = [
      '🛠 <b>Новая заявка на аренду инструмента</b>',
      `Имя: ${escapeHtml(name)}`,
      `Контакт: ${escapeHtml(phoneOrTelegram)}`,
      `Инструмент: ${escapeHtml(toolName || '—')} (${escapeHtml(toolId || 'не указан')})`,
      `Даты: ${escapeHtml(startDate)} → ${escapeHtml(endDate)}`,
      `Комментарий: ${escapeHtml(safeNotes)}`,
      `Источник: ${escapeHtml(referrer || 'direct')} | Путь: ${escapeHtml(pagePath || '/')}`,
      `Время: ${escapeHtml(timestamp || new Date().toISOString())}`,
      `IP: ${escapeHtml(ip)}`,
      `UA: ${escapeHtml(userAgent || 'unknown')}`,
    ].join('\n');

    await sendTelegram(message);
    await appendToSheet({
      name,
      phoneOrTelegram,
      toolId,
      toolName,
      startDate,
      endDate,
      notes: safeNotes,
      userAgent,
      referrer,
      pagePath,
      timestamp: timestamp || new Date().toISOString(),
      ip,
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[lead] error', error);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
};

const bucket = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 3;

function rateLimitGuard(ip) {
  const now = Date.now();
  const record = bucket.get(ip) || { count: 0, expires: now + WINDOW_MS };
  if (record.expires < now) {
    record.count = 0;
    record.expires = now + WINDOW_MS;
  }
  record.count += 1;
  bucket.set(ip, record);
  if (record.count > MAX_PER_WINDOW) {
    const err = new Error('Too many requests');
    err.statusCode = 429;
    throw err;
  }
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Telegram env vars not configured');
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!response.ok) {
    throw new Error(`Telegram error: ${response.status}`);
  }
}

async function appendToSheet(lead) {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_ID_OVERRIDE;
  const leadsSheet = process.env.LEADS_SHEET_NAME || '{{LEADS_SHEET_NAME}}';
  if (!serviceAccountJson || !sheetId) {
    console.warn('Sheets append skipped: missing credentials');
    return;
  }
  const credentials = JSON.parse(serviceAccountJson);
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  const auth = new google.auth.JWT(credentials.client_email, null, credentials.private_key, scopes);
  const sheets = google.sheets({ version: 'v4', auth });
  const values = [[
    new Date().toISOString(),
    lead.name,
    lead.phoneOrTelegram,
    lead.toolId,
    lead.toolName,
    lead.startDate,
    lead.endDate,
    lead.notes,
    lead.referrer,
    lead.pagePath,
    lead.userAgent,
    lead.ip,
  ]];
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${leadsSheet}!A:L`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}
