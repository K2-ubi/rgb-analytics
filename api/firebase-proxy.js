import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const ALLOWED_PATHS = [
  'twitch-users', 'stream-chunks', 'stream-cache', 'twitch-tracker',
  'userStats', 'stats', 'config'
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const app = getAdminApp();
    const db = getDatabase(app);
    const path = req.query.path || '';
    const method = req.method;

    if (!path) return res.status(400).json({ error: 'path required' });

    const allowed = ALLOWED_PATHS.some(p => path.startsWith(p));
    if (!allowed) return res.status(403).json({ error: 'path not allowed' });

    if (method === 'GET') {
      const snap = await db.ref(path).once('value');
      return res.status(200).json(snap.val() || {});
    }

    if (method === 'PATCH' || method === 'POST') {
      await db.ref(path).update(req.body);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
