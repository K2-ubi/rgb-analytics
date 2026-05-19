import { getDatabase } from 'firebase-admin/database';
import { setCorsHeaders, verifyAppCheck, getAdminApp } from './_shared.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-AppCheck');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!(await verifyAppCheck(req, res))) return;

  try {
    const database = getDatabase(getAdminApp());

    if (req.method === 'GET') {
      const snap = await database.ref('squad/_bans').once('value');
      return res.status(200).json(snap.val() || { users: {}, ips: {} });
    }

    if (req.method === 'POST' || req.method === 'DELETE') {
      const { type, value, bannedBy } = req.body || {};
      if (!type || !value) return res.status(400).json({ error: 'type and value required' });

      if (bannedBy) {
        const adminSnap = await database.ref('twitch-users/' + bannedBy.toLowerCase() + '/roles/admin').once('value');
        if (!adminSnap.val()) return res.status(403).json({ error: 'not authorized' });
      }

      const snap = await database.ref('squad/_bans').once('value');
      const bans = snap.val() || { users: {}, ips: {} };

      if (req.method === 'POST') {
        if (type === 'user') {
          bans.users[value.toLowerCase().trim()] = { bannedAt: Date.now(), bannedBy: bannedBy || 'admin' };
        } else if (type === 'ip') {
          bans.ips[value.replace(/\./g, '_')] = { bannedAt: Date.now(), bannedBy: bannedBy || 'admin' };
        } else return res.status(400).json({ error: 'invalid type' });
      } else {
        if (type === 'user') delete bans.users[value.toLowerCase().trim()];
        else if (type === 'ip') delete bans.ips[value.replace(/\./g, '_')];
        else return res.status(400).json({ error: 'invalid type' });
      }

      await database.ref('squad/_bans').set(bans);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
