const ALLOWED_ORIGINS = [
  'https://rgb-analytics.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const isAllowedOrigin = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin ? origin : 'https://rgb-analytics.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const username = (req.query.username || '').toLowerCase().trim();

  const bannedIps = (process.env.BANNED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  const bannedUsers = (process.env.BANNED_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const banned = bannedIps.includes(ip) || (username && bannedUsers.includes(username.toLowerCase()));

  res.status(200).json({ banned, ip, username: username || null });
}
