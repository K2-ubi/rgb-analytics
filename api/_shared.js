import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';

export const ALLOWED_ORIGINS = [
  'https://rgb-analytics.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

let _app = null;

export function getAdminApp() {
  if (_app) return _app;
  if (getApps().length) { _app = getApps()[0]; return _app; }
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  const serviceAccount = JSON.parse(Buffer.from(sa, 'base64').toString('utf-8'));
  _app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: serviceAccount.databaseURL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
  });
  return _app;
}

export function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : 'https://rgb-analytics.vercel.app');
  res.setHeader('Vary', 'Origin');
}

export async function verifyAppCheck(req, res) {
  const token = req.headers['x-firebase-appcheck'];
  if (!token) return true;
  try {
    const app = getAdminApp();
    const appCheck = getAppCheck(app);
    await appCheck.verifyToken(token);
    return true;
  } catch (e) {
    if (res) res.status(403).json({ error: 'App Check verification failed' });
    return false;
  }
}
