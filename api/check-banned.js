import { getDatabase } from 'firebase-admin/database';
import { setCorsHeaders, verifyAppCheck, getAdminApp } from './_shared.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-AppCheck');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!(await verifyAppCheck(req, res))) return;

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const username = (req.query.username || '').toLowerCase().trim();

  try {
    const db = getDatabase(getAdminApp());
    const ipKey = ip.replace(/\./g, '_');
    const snap = await db.ref('squad/_bans').once('value');
    const bans = snap.val() || {};
    const userBanned = username ? !!(bans.users && bans.users[username]) : false;
    const ipBanned = !!(bans.ips && bans.ips[ipKey]);

    res.status(200).json({ banned: userBanned || ipBanned, ip, username: username || null });
  } catch (e) {
    res.status(200).json({ banned: false, ip, username: username || null, error: e.message });
  }
}
