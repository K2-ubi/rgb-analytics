import { getDatabase } from 'firebase-admin/database';
import { setCorsHeaders, verifyAppCheck, getAdminApp } from './_shared.js';

const ALLOWED_PATHS = [
  'twitch-users', 'stream-chunks', 'stream-cache', 'twitch-tracker',
  'userStats', 'stats', 'config'
];

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-UID, X-Admin-Login, X-Firebase-AppCheck');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!(await verifyAppCheck(req, res))) return;

  const uid = req.headers['x-firebase-uid'];
  const adminLogin = req.headers['x-admin-login'];
  if (!uid && !adminLogin) return res.status(401).json({ error: 'X-Firebase-UID or X-Admin-Login header required' });

  try {
    const db = getDatabase(getAdminApp());
    const path = req.query.path || '';
    const method = req.method;

    if (!path) return res.status(400).json({ error: 'path required' });

    const allowed = ALLOWED_PATHS.some(p => path.startsWith(p));
    if (!allowed) return res.status(403).json({ error: 'path not allowed' });

    if (uid) {
      const adminSnap = await db.ref('admins/' + uid).once('value');
      if (!adminSnap.val()) return res.status(403).json({ error: 'not authorized' });
    } else {
      const roleSnap = await db.ref('twitch-users/' + adminLogin.toLowerCase() + '/roles/admin').once('value');
      if (!roleSnap.val()) return res.status(403).json({ error: 'not authorized' });
    }

    if (method === 'GET') {
      const snap = await db.ref(path).once('value');
      return res.status(200).json(snap.val() || {});
    }

    if (method === 'PATCH' || method === 'POST') {
      if (req.body && typeof req.body === 'object' && '.value' in req.body) {
        await db.ref(path).set(req.body['.value']);
      } else {
        await db.ref(path).update(req.body);
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
