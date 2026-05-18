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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const username = (req.query.username || '').toLowerCase().trim();

  try {
    const app = getAdminApp();
    const db = getDatabase(app);

    const ipKey = ip.replace(/\./g, '_');
    const [userSnap, ipSnap] = await Promise.all([
      username ? db.ref('config/banned/users/' + username).once('value') : Promise.resolve(null),
      db.ref('config/banned/ips/' + ipKey).once('value'),
    ]);

    const userBanned = userSnap ? !!userSnap.val() : false;
    const ipBanned = !!ipSnap.val();

    res.status(200).json({ banned: userBanned || ipBanned, ip, username: username || null });
  } catch (e) {
    res.status(200).json({ banned: false, ip, username: username || null, error: e.message });
  }
}
