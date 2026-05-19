import { setCorsHeaders, verifyAppCheck } from './_shared.js';

const ALLOWED_METHODS = ['sendMessage', 'sendPhoto'];
const ALLOWED_CHAT_IDS = [];
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ALLOWED = (process.env.TG_CHAT_ALLOWED || '').split(',').map(s => s.trim()).filter(Boolean);
const BANNED_IPS = (process.env.BANNED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-AppCheck');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifyAppCheck(req, res))) return;

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (BANNED_IPS.includes(ip)) return res.status(403).json({ error: 'banned' });

  if (!TG_BOT_TOKEN) return res.status(500).json({ error: 'TG_BOT_TOKEN not configured' });

  const { action, chat_id, text, parse_mode, photo, caption } = req.body;
  if (!action || !ALLOWED_METHODS.includes(action)) return res.status(400).json({ error: 'Invalid action. Allowed: ' + ALLOWED_METHODS.join(', ') });
  if (!chat_id) return res.status(400).json({ error: 'chat_id is required' });

  const allowedIds = ALLOWED_CHAT_IDS.length > 0 ? ALLOWED_CHAT_IDS : TG_CHAT_ALLOWED;
  if (allowedIds.length > 0 && !allowedIds.includes(String(chat_id))) return res.status(403).json({ error: 'chat_id not allowed' });

  try {
    let tgUrl, tgBody;
    if (action === 'sendMessage') {
      tgUrl = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
      tgBody = { chat_id, text, parse_mode: parse_mode || 'HTML' };
    } else if (action === 'sendPhoto') {
      if (!photo) return res.status(400).json({ error: 'photo is required for sendPhoto' });
      tgUrl = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`;
      tgBody = { chat_id, photo, caption: caption || '', parse_mode: parse_mode || 'HTML' };
    }

    const tgRes = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tgBody),
    });
    const data = await tgRes.json();
    res.status(tgRes.ok ? 200 : 502).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
