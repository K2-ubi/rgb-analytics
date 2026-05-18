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
      const [usersSnap, ipsSnap] = await Promise.all([
        database.ref('banned/users').once('value'),
        database.ref('banned/ips').once('value'),
      ]);
      const users = usersSnap.val() || {};
      const ips = ipsSnap.val() || {};
      return res.status(200).json({ users, ips });
    }

    if (req.method === 'POST') {
      const { type, value, bannedBy } = req.body || {};
      if (!type || !value) return res.status(400).json({ error: 'type and value required' });
      if (type === 'user') {
        const login = value.toLowerCase().trim();
        await database.ref('banned/users/' + login).set({ bannedAt: Date.now(), bannedBy: bannedBy || 'admin' });
        return res.status(200).json({ ok: true, type: 'user', value: login });
      }
      if (type === 'ip') {
        const key = value.replace(/\./g, '_');
        await database.ref('banned/ips/' + key).set({ bannedAt: Date.now(), bannedBy: bannedBy || 'admin' });
        return res.status(200).json({ ok: true, type: 'ip', value: value });
      }
      return res.status(400).json({ error: 'invalid type, must be "user" or "ip"' });
    }

    if (req.method === 'DELETE') {
      const { type, value } = req.body || {};
      if (!type || !value) return res.status(400).json({ error: 'type and value required' });
      if (type === 'user') {
        const login = value.toLowerCase().trim();
        await database.ref('banned/users/' + login).remove();
        return res.status(200).json({ ok: true, type: 'user', value: login });
      }
      if (type === 'ip') {
        const key = value.replace(/\./g, '_');
        await database.ref('banned/ips/' + key).remove();
        return res.status(200).json({ ok: true, type: 'ip', value: value });
      }
      return res.status(400).json({ error: 'invalid type' });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
