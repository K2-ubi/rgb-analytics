export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const username = req.query.username || '';

  const bannedIps = (process.env.BANNED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  const bannedUsers = (process.env.BANNED_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const banned = bannedIps.includes(ip) || (username && bannedUsers.includes(username.toLowerCase()));

  res.status(200).json({ banned, ip });
}
