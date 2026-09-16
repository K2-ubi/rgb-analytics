import tmi from 'tmi.js';

let WORKER_URL = process.env.WORKER_URL || 'https://quiet-hat-2de7.konstasil777.workers.dev';
WORKER_URL = WORKER_URL.replace(/\/+$/, '');
if (!WORKER_URL.startsWith('http://') && !WORKER_URL.startsWith('https://')) {
  WORKER_URL = 'https://' + WORKER_URL;
}
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || '';
const CHECK_INTERVAL = 60000;
const DB_BASE = 'https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app';
const CHAT_TTL_DAYS = 2;
const RAID_TTL_DAYS = 7;

function dayStr(offsetDays = 0, ts = Date.now()) {
  const d = new Date(ts + offsetDays * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const clients = {};
const joinedChannels = { bot1: [], bot2: [] };

async function getBotToken(bot = 1) {
  if (!FIREBASE_SECRET) {
    console.error('FIREBASE_SECRET not set');
    return null;
  }
  const res = await fetch(`${WORKER_URL}/api/token?bot=${bot}`, {
    headers: { 'X-Auth-Secret': FIREBASE_SECRET },
  });
  if (!res.ok) {
    console.error(`Failed to get token for bot ${bot}:`, res.status);
    return null;
  }
  return res.json();
}

async function getLiveSquadMembers() {
  const res = await fetch(
    `${WORKER_URL}/api/twitch/streams?first=100`,
    { headers: { 'X-Auth-Secret': FIREBASE_SECRET } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map(s => ({
    login: s.user_login.toLowerCase(),
    userId: s.user_id,
  }));
}

async function getSquadLogins() {
  if (!FIREBASE_SECRET) return [];
  const url = `https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app/twitch-users.json?auth=${FIREBASE_SECRET}`;
  try {
    const res = await fetch(url);
    const users = await res.json();
    if (!users) return [];
    return Object.entries(users)
      .filter(([, u]) => u.roles && (u.roles.squad || u.roles.academy))
      .map(([login]) => login.toLowerCase());
  } catch (e) {
    console.error('Failed to fetch squad logins:', e.message);
    return [];
  }
}

// --- Chat Capture (сообщения, присутствие, рейды) ---

const chatQueue = [];
let chatFlushTimer = null;
const viewerMeta = new Map();
let extraChannelsCache = { list: [], ts: 0 };

function trim(s, n) { return s && s.length > n ? s.slice(0, n) : s; }

async function readAllViewer(uid) {
  try {
    const r = await fetch(`${DB_BASE}/all-viewers/${encodeURIComponent(uid)}.json?auth=${FIREBASE_SECRET}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

async function seedViewerMeta(uid) {
  if (!viewerMeta.has(uid)) {
    const v = await readAllViewer(uid);
    const channels = new Map();
    const vch = (v && v.channels) || {};
    for (const [ch, cd] of Object.entries(vch)) {
      channels.set(ch, { firstSeen: cd.firstSeen || 0, lastSeen: cd.lastSeen || 0 });
    }
    viewerMeta.set(uid, { firstSeen: (v && v.firstSeen) || 0, lastSeen: (v && v.lastSeen) || 0, channels });
  }
  return viewerMeta.get(uid);
}

function captureMessage(channel, userstate, message, self) {
  const msgId = userstate['id'];
  const uid = userstate['user-id'];
  const login = (userstate['username'] || '').toLowerCase();
  const displayName = userstate['display-name'] || login;
  const chLogin = channel.replace('#', '').toLowerCase();
  if (self || !msgId || !uid || !login || !chLogin) return;
  const now = Date.now();
  chatQueue.push({
    date: dayStr(), uid, msgId,
    entry: { c: chLogin, l: login, n: displayName, m: trim(message, 300), t: now },
    chLogin, login, displayName, now,
  });
  if (!chatFlushTimer) {
    chatFlushTimer = setTimeout(() => { chatFlushTimer = null; flushChatQueue(); }, 8000);
  }
}

async function flushChatQueue() {
  if (!chatQueue.length) return;
  const batch = chatQueue.splice(0, chatQueue.length);
  const byDayUid = {};
  const presence = new Map();
  for (const it of batch) {
    const key = `${it.date}|${it.uid}`;
    (byDayUid[key] = byDayUid[key] || {})[it.msgId] = it.entry;
    try {
      const meta = await seedViewerMeta(it.uid);
      if (!meta.channels.has(it.chLogin)) meta.channels.set(it.chLogin, { firstSeen: it.now, lastSeen: it.now });
      const ch = meta.channels.get(it.chLogin);
      ch.firstSeen = Math.min(ch.firstSeen || it.now, it.now);
      ch.lastSeen = Math.max(ch.lastSeen || 0, it.now);
      meta.firstSeen = Math.min(meta.firstSeen || it.now, it.now);
      meta.lastSeen = Math.max(meta.lastSeen || 0, it.now);
      if (!presence.has(it.uid)) presence.set(it.uid, {});
      presence.get(it.uid)[it.chLogin] = { firstSeen: ch.firstSeen, lastSeen: ch.lastSeen, lastMessage: trim(it.entry.m, 120), login: it.login, displayName: it.displayName, now: it.now };
    } catch (e) {}
  }
  const writes = [];
  for (const [key, msgs] of Object.entries(byDayUid)) {
    const [date, uid] = key.split('|');
    writes.push(PATCH_FB(`chat-log/${date}/${uid}`, msgs));
  }
  const uidMeta = new Map();
  for (const it of batch) {
    if (!uidMeta.has(it.uid)) uidMeta.set(it.uid, { login: it.login, displayName: it.displayName, firstSeen: 0, lastSeen: 0 });
    const m = uidMeta.get(it.uid);
    const meta = viewerMeta.get(it.uid);
    if (meta) {
      m.firstSeen = meta.firstSeen || it.now;
      m.lastSeen = meta.lastSeen || it.now;
    }
  }
  for (const [uid, chs] of presence) {
    const m = uidMeta.get(uid) || { login: '', displayName: '', firstSeen: 0, lastSeen: 0 };
    writes.push(PATCH_FB(`all-viewers/${uid}`, { login: m.login, displayName: m.displayName, firstSeen: m.firstSeen, lastSeen: m.lastSeen }));
    for (const [ch, p] of Object.entries(chs)) {
      writes.push(PATCH_FB(`all-viewers/${encodeURIComponent(uid)}/channels/${ch}`, { firstSeen: p.firstSeen, lastSeen: p.lastSeen, lastMessage: p.lastMessage || '' }));
      writes.push(PATCH_FB(`viewer-history/${ch}/${encodeURIComponent(uid)}`, { login: p.login, displayName: p.displayName, firstSeen: p.firstSeen, lastSeen: p.lastSeen }));
    }
  }
  await Promise.allSettled(writes);
}

async function PATCH_FB(path, data, _retried) {
  try {
    const res = await fetch(`${DB_BASE}/${path}.json?auth=${FIREBASE_SECRET}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && (res.status === 402 || res.status === 413 || res.status === 403) && !_retried) {
      console.warn('[capture] PATCH ' + res.status + ' → очистка старых чатов');
      const freed = await trimChatLog(2);
      if (freed) return PATCH_FB(path, data, true);
    }
  } catch (e) { console.error('[capture] PATCH fail', path, e.message); }
}

async function PUT_FB(path, data, _retried) {
  try {
    const res = await fetch(`${DB_BASE}/${path}.json?auth=${FIREBASE_SECRET}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && (res.status === 402 || res.status === 413 || res.status === 403) && !_retried) {
      console.warn('[capture] PUT ' + res.status + ' → очистка старых чатов');
      const freed = await trimChatLog(2);
      if (freed) return PUT_FB(path, data, true);
    }
  } catch (e) { console.error('[capture] PUT fail', path, e.message); }
}

async function trimChatLog(days) {
  let freed = false;
  try {
    const r = await fetch(`${DB_BASE}/chat-log.json?shallow=true&auth=${FIREBASE_SECRET}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const keys = await r.json();
      if (keys) {
        const sorted = Object.keys(keys).sort();
        const keep = sorted.slice(-1);
        const toDel = sorted.filter(d => !keep.includes(d)).slice(0, days);
        for (const d of toDel) {
          await fetch(`${DB_BASE}/chat-log/${d}.json?auth=${FIREBASE_SECRET}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) });
          console.log('[quota] chat-log/' + d + ' удалён');
          freed = true;
        }
      }
    }
  } catch (e) {}
  try {
    const r2 = await fetch(`${DB_BASE}/raids.json?shallow=true&auth=${FIREBASE_SECRET}`, { signal: AbortSignal.timeout(8000) });
    if (r2.ok) {
      const keys2 = await r2.json();
      if (keys2) {
        const sorted = Object.keys(keys2).sort();
        const keep = sorted.slice(-1);
        const toDel = sorted.filter(d => !keep.includes(d)).slice(0, days);
        for (const d of toDel) {
          await fetch(`${DB_BASE}/raids/${d}.json?auth=${FIREBASE_SECRET}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) });
          freed = true;
        }
      }
    }
  } catch (e) {}
  return freed;
}

async function getExtraChannels() {
  if (Date.now() - extraChannelsCache.ts < 60000 && extraChannelsCache.list.length) return extraChannelsCache.list;
  try {
    const r = await fetch(`${DB_BASE}/config/lurker/extra.json?auth=${FIREBASE_SECRET}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const data = await r.json();
      const list = data ? Object.keys(data).filter(k => !(data[k] && data[k].disabled)) : [];
      extraChannelsCache = { list, ts: Date.now() };
      return list;
    }
  } catch (e) {}
  return extraChannelsCache.list;
}

async function captureRaid(userstate, channel) {
  if (userstate['msg-id'] !== 'raid') return;
  const fromLogin = (userstate['msg-param-login'] || userstate['msg-param-displayName'] || '').toLowerCase();
  const fromName = userstate['msg-param-displayName'] || fromLogin;
  const toChannel = channel.replace('#', '').toLowerCase();
  const viewers = parseInt(userstate['msg-param-viewerCount'] || '0') || 0;
  const now = Date.now();
  await PUT_FB(`raids/${dayStr()}/${now}_${Math.random().toString(36).slice(2, 8)}`, { from: fromLogin, fromName, to: toChannel, viewers, ts: now });
  if (fromLogin) {
    await PATCH_FB('config/lurker/extra/' + fromLogin, { addedAt: now, source: 'raid', viewers, ts: now });
  }
  console.log(`[raid] ${fromLogin || '?'} → ${toChannel} (${viewers} зр.)`);
}

async function cleanupTTL() {
  try {
    const r = await fetch(`${DB_BASE}/chat-log.json?shallow=true&auth=${FIREBASE_SECRET}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const keys = await r.json();
      if (keys) {
        for (const d of Object.keys(keys)) {
          if (d < dayStr(-CHAT_TTL_DAYS)) {
            await fetch(`${DB_BASE}/chat-log/${d}.json?auth=${FIREBASE_SECRET}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) });
            console.log('[ttl] chat-log/' + d + ' удалён');
          }
        }
      }
    }
  } catch (e) {}
  try {
    const r2 = await fetch(`${DB_BASE}/raids.json?shallow=true&auth=${FIREBASE_SECRET}`, { signal: AbortSignal.timeout(8000) });
    if (r2.ok) {
      const keys2 = await r2.json();
      if (keys2) {
        for (const d of Object.keys(keys2)) {
          if (d < dayStr(-RAID_TTL_DAYS)) {
            await fetch(`${DB_BASE}/raids/${d}.json?auth=${FIREBASE_SECRET}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) });
          }
        }
      }
    }
  } catch (e) {}
}

async function connectBot(botIndex, tokenInfo) {
  const botKey = `bot${botIndex}`;

  if (clients[botKey]) {
    try { clients[botKey].disconnect(); } catch {}
    delete clients[botKey];
  }

  if (!tokenInfo || !tokenInfo.token || !tokenInfo.login) {
    console.log(`[${botKey}] No token/login, skipping`);
    return;
  }

  const client = new tmi.Client({
    identity: {
      username: tokenInfo.login,
      password: `oauth:${tokenInfo.token}`,
    },
    connection: {
      reconnect: true,
      secure: true,
    },
    channels: [],
  });

  client.on('connected', () => {
    console.log(`[${botKey}] Connected to IRC as ${tokenInfo.login}`);
    const chans = joinedChannels[botKey] || [];
    for (const login of chans) {
      client.join(`#${login}`).catch(() => {});
    }
  });

  client.on('message', (channel, userstate, message, self) => {
    if (!self) captureMessage(channel, userstate, message, self);
  });

  client.on('usernotice', (channel, userstate) => {
    if (userstate && userstate['msg-id'] === 'raid') {
      captureRaid(userstate, channel).catch(() => {});
    }
  });

  client.on('join', (channel, username) => {
    if (username === tokenInfo.login) {
      console.log(`[${botKey}] Joined ${channel}`);
    }
  });

  client.on('part', (channel, username) => {
    if (username === tokenInfo.login) {
      console.log(`[${botKey}] Parted ${channel}`);
      const idx = (joinedChannels[botKey] || []).indexOf(channel.replace(/^#/, '').toLowerCase());
      if (idx !== -1) joinedChannels[botKey].splice(idx, 1);
    }
  });

  client.on('disconnected', (reason) => {
    console.log(`[${botKey}] Disconnected:`, reason);
  });

  try {
    await client.connect();
    clients[botKey] = client;
  } catch (e) {
    console.error(`[${botKey}] Connection failed:`, e.message);
  }
}

async function syncChannels() {
  const [liveStreams, squadLogins] = await Promise.all([
    getLiveSquadMembers(),
    getSquadLogins(),
  ]);
  const extra = await getExtraChannels();

  const liveSet = new Set(liveStreams.map(s => s.login));
  const squadSet = new Set(squadLogins);

  const targetLogins = [...new Set([...liveSet].filter(l => squadSet.has(l)))];
  for (const l of extra) targetLogins.push(l);

  console.log(`Sync: ${targetLogins.length} live squad members to lurk (+${extra.length} extra)`);

  for (const botIndex of [1, 2]) {
    const botKey = `bot${botIndex}`;
    const client = clients[botKey];
    if (!client || !client.readyState || client.readyState() !== 'OPEN') continue;

    const current = joinedChannels[botKey] || [];

    for (const login of targetLogins) {
      if (!current.includes(login)) {
        client.join(`#${login}`).catch(() => {});
        if (!joinedChannels[botKey].includes(login)) {
          joinedChannels[botKey].push(login);
        }
      }
    }

    for (const login of current) {
      if (!targetLogins.includes(login)) {
        client.part(`#${login}`).catch(() => {});
        const idx = joinedChannels[botKey].indexOf(login);
        if (idx !== -1) joinedChannels[botKey].splice(idx, 1);
      }
    }
  }
}

async function main() {
  console.log('RGB Lurker starting...');

  const [bot1Info, bot2Info] = await Promise.all([
    getBotToken(1),
    getBotToken(2).catch(() => null),
  ]);

  if (bot1Info) console.log(`Bot #1: ${bot1Info.login || 'unknown'}`);
  if (bot2Info) console.log(`Bot #2: ${bot2Info.login || 'unknown'}`);

  await Promise.all([
    connectBot(1, bot1Info),
    bot2Info ? connectBot(2, bot2Info) : Promise.resolve(),
  ]);

  await syncChannels();
  setInterval(syncChannels, CHECK_INTERVAL);
  setInterval(cleanupTTL, 3600000);
  setInterval(() => { if (chatQueue.length) flushChatQueue().catch(() => {}); }, 30000);
}

main().catch(console.error);

process.on('SIGINT', () => {
  console.log('Shutting down...');
  for (const key of Object.keys(clients)) {
    try { clients[key].disconnect(); } catch {}
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  for (const key of Object.keys(clients)) {
    try { clients[key].disconnect(); } catch {}
  }
  process.exit(0);
});
