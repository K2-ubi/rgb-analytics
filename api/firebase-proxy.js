import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const ALLOWED_PATHS = [
  'twitch-users', 'stream-chunks', 'stream-cache', 'twitch-tracker',
  'userStats', 'stats', 'config'
];

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-UID, X-Admin-Login');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const uid = req.headers['x-firebase-uid'];
  const adminLogin = req.headers['x-admin-login'];
  if (!uid && !adminLogin) {
    return res.status(401).json({ error: 'X-Firebase-UID or X-Admin-Login header required' });
  }

  try {
    const app = getAdminApp();
    const db = getDatabase(app);
    const path = req.query.path || '';
    const method = req.method;

    if (!path) return res.status(400).json({ error: 'path required' });

    const allowed = ALLOWED_PATHS.some(p => path.startsWith(p));
    if (!allowed) return res.status(403).json({ error: 'path not allowed' });

    if (uid) {
      const adminSnap = await db.ref('admins/' + uid).once('value');
      if (!adminSnap.val()) {
        return res.status(403).json({ error: 'not authorized' });
      }
    } else {
      const roleSnap = await db.ref('twitch-users/' + adminLogin.toLowerCase() + '/roles/admin').once('value');
      if (!roleSnap.val()) {
        return res.status(403).json({ error: 'not authorized' });
      }
    }

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
