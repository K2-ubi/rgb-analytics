import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const ALLOWED_ORIGINS = [
  'https://rgb-analytics.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  const serviceAccount = JSON.parse(Buffer.from(sa, 'base64').toString('utf-8'));
  return initializeApp({
    credential: cert(serviceAccount),
    databaseURL: serviceAccount.databaseURL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
  });
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const isAllowedOrigin = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin ? origin : 'https://rgb-analytics.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const app = getAdminApp();
    const database = getDatabase(app);

    if (req.method === 'GET') {
      const snap = await database.ref('config/bot').once('value');
      const data = snap.val() || {};
      return res.status(200).json(data._bans || { users: {}, ips: {} });
    }

    if (req.method === 'POST' || req.method === 'DELETE') {
      const { type, value, bannedBy } = req.body || {};
      if (!type || !value) return res.status(400).json({ error: 'type and value required' });

      if (bannedBy) {
        const adminSnap = await database.ref('twitch-users/' + bannedBy.toLowerCase() + '/roles/admin').once('value');
        if (!adminSnap.val()) {
          return res.status(403).json({ error: 'not authorized' });
        }
      }

      if (req.method === 'POST' || req.method === 'DELETE') {
        const snap = await database.ref('config/bot').once('value');
        const bot = snap.val() || {};
        const bans = bot._bans || { users: {}, ips: {} };

        if (req.method === 'POST') {
          if (type === 'user') {
            const login = value.toLowerCase().trim();
            bans.users[login] = { bannedAt: Date.now(), bannedBy: bannedBy || 'admin' };
          } else if (type === 'ip') {
            const key = value.replace(/\./g, '_');
            bans.ips[key] = { bannedAt: Date.now(), bannedBy: bannedBy || 'admin' };
          } else {
            return res.status(400).json({ error: 'invalid type' });
          }
        } else {
          if (type === 'user') {
            delete bans.users[value.toLowerCase().trim()];
          } else if (type === 'ip') {
            delete bans.ips[value.replace(/\./g, '_')];
          } else {
            return res.status(400).json({ error: 'invalid type' });
          }
        }

        bot._bans = bans;
        await database.ref('config/bot').set(bot);
        return res.status(200).json({ ok: true });
      }
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
