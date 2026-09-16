import tmi from 'tmi.js';
import express from 'express';
import WebSocket from 'ws';

let WORKER_URL = process.env.WORKER_URL || 'https://quiet-hat-2de7.konstasil777.workers.dev';
WORKER_URL = WORKER_URL.replace(/\/+$/, '');
if (!WORKER_URL.startsWith('http://') && !WORKER_URL.startsWith('https://')) {
  WORKER_URL = 'https://' + WORKER_URL;
}
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || '';
const CHECK_INTERVAL = 60000;
const PORT = parseInt(process.env.PORT || '10000');
const DB_BASE = 'https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app';
const CHAT_TTL_DAYS = 2;
const RAID_TTL_DAYS = 7;

function dayStr(offsetDays = 0, ts = Date.now()) {
  const d = new Date(ts + offsetDays * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const clients = {};
const connected = { bot1: false, bot2: false };
const joinedChannels = { bot1: [], bot2: [] };
const botTokens = { bot1: null, bot2: null };
const pubsub = { bot1: { ws: null, pingInterval: null, topics: [], badAuth: false }, bot2: { ws: null, pingInterval: null, topics: [], badAuth: false } };

// --- Express (чтобы Render не вырубал за бездействие) ---
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    bots: { bot1: connected.bot1, bot2: connected.bot2 },
    channels: { bot1: joinedChannels.bot1.length, bot2: joinedChannels.bot2.length },
    pubsub: {
      bot1: { connected: !!(pubsub.bot1.ws && pubsub.bot1.ws.readyState === WebSocket.OPEN), topics: pubsub.bot1.topics.length },
      bot2: { connected: !!(pubsub.bot2.ws && pubsub.bot2.ws.readyState === WebSocket.OPEN), topics: pubsub.bot2.topics.length },
    },
  });
});

app.get('/', (req, res) => res.redirect('/health'));

// API для записи команд в Firebase (через Render, т.к. у бота есть FIREBASE_SECRET и нет холодного старта)
app.get('/update', async (req, res) => {
  try {
    const result = { bot1: null, bot2: null, workerError: null };
    // Получаем свежие токены обоих ботов с воркера
    for (const bot of [1, 2]) {
      const data = await getBotToken(bot);
      result[`bot${bot}`] = data ? {
        login: data.login,
        token: data.token ? data.token.slice(0, 15) + '…' : null,
        client_id: data.client_id,
      } : null;
    }
    // Проверяем, живой ли сам воркер
    const wrRes = await fetch(WORKER_URL + '/api/token?bot=1', {
      headers: { 'X-Auth-Secret': FIREBASE_SECRET },
    });
    if (!wrRes.ok) result.workerError = `HTTP ${wrRes.status}`;

    res.json({
      status: 'ok',
      ts: Date.now(),
      bots: result,
      uptime: process.uptime(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/test-mod', async (req, res) => {
  try {
    const login = (req.query.login || 'nezerars').toLowerCase();
    const result = { login, steps: [], success: false, error: null, scopes: null };

    const ti = await getBotToken(1);
    if (!ti || !ti.token) {
      result.error = 'Не удалось получить токен бота #1';
      return res.json(result);
    }
    result.bot = { login: ti.login, token_prefix: ti.token.slice(0, 8) + '…', client_id: ti.client_id };
    result.steps.push('✅ Токен бота #1 получен: @' + (ti.login || '?'));

    const valRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': 'Bearer ' + ti.token },
    });
    if (valRes.ok) {
      const valData = await valRes.json();
      result.scopes = valData.scopes || [];
      result.steps.push('🔑 Скоупы токена (' + (valData.scopes?.length || 0) + '): ' + (valData.scopes?.join(', ') || 'нет'));
    } else {
      const err = await valRes.text().catch(() => '');
      result.steps.push('⚠️ Не удалось проверить скоупы токена: HTTP ' + valRes.status + ' ' + err);
    }

    const usersRes = await fetch('https://api.twitch.tv/helix/users?login=' + encodeURIComponent(login), {
      headers: { 'Authorization': 'Bearer ' + ti.token, 'Client-Id': ti.client_id },
    });
    if (!usersRes.ok) {
      const err = await usersRes.text().catch(() => '');
      result.error = 'Ошибка получения пользователя: HTTP ' + usersRes.status + ' ' + err.slice(0, 200);
      result.steps.push('❌ ' + result.error);
      return res.json(result);
    }
    const usersData = await usersRes.json();
    const user = usersData.data?.[0];
    if (!user) {
      result.error = 'Пользователь ' + login + ' не найден на Twitch';
      result.steps.push('❌ ' + result.error);
      return res.json(result);
    }
    result.broadcaster = { id: user.id, login: user.login, displayName: user.display_name };
    result.steps.push('✅ Стример найден: ' + user.display_name + ' (id=' + user.id + ')');

    const channelRes = await fetch('https://api.twitch.tv/helix/channels?broadcaster_id=' + user.id, {
      headers: { 'Authorization': 'Bearer ' + ti.token, 'Client-Id': ti.client_id },
    });
    if (!channelRes.ok) {
      const err = await channelRes.text().catch(() => '');
      result.error = 'Ошибка получения категории: HTTP ' + channelRes.status + ' ' + err.slice(0, 200);
      result.steps.push('❌ ' + result.error);
      return res.json(result);
    }
    const channelData = await channelRes.json();
    const channel = channelData.data?.[0];
    if (!channel) {
      result.error = 'Нет данных канала для ' + login;
      result.steps.push('❌ ' + result.error);
      return res.json(result);
    }
    result.currentCategory = { id: channel.game_id, name: channel.game_name };
    result.steps.push('✅ Текущая категория: "' + channel.game_name + '" (id=' + channel.game_id + ')');

    const TEST_GAME_ID = '509658';
    const TEST_GAME_NAME = 'Just Chatting';

    const patchRes = await fetch('https://api.twitch.tv/helix/channels?broadcaster_id=' + user.id, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + ti.token, 'Client-Id': ti.client_id, 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ game_id: TEST_GAME_ID }),
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text().catch(() => '');
      result.error = 'HTTP ' + patchRes.status + ' ' + errText.slice(0, 300);
      result.steps.push('❌ Смена категории не удалась: ' + result.error);
      return res.json(result);
    }

    result.steps.push('✅ Смена на "' + TEST_GAME_NAME + '" — успешно!');
    result.success = true;

    const revertRes = await fetch('https://api.twitch.tv/helix/channels?broadcaster_id=' + user.id, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + ti.token, 'Client-Id': ti.client_id, 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ game_id: result.currentCategory.id }),
    });

    if (!revertRes.ok) {
      const errText = await revertRes.text().catch(() => '');
      result.steps.push('⚠️ Не удалось вернуть категорию: HTTP ' + revertRes.status + ' ' + errText.slice(0, 200));
    } else {
      result.steps.push('✅ Категория возвращена на "' + result.currentCategory.name + '"');
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, steps: ['❌ Исключение: ' + e.message] });
  }
});

app.post('/api/commands', async (req, res) => {
  try {
    const { path: fbPath, data, adminLogin, method } = req.body || {};
    if (!fbPath || !adminLogin) return res.status(400).json({ error: 'path and adminLogin required' });

    // Проверка прав: админ или стример для своих команд
    const roleRes = await fetch(`${DB_BASE}/twitch-users/${encodeURIComponent(adminLogin.toLowerCase())}/roles/admin.json?auth=${FIREBASE_SECRET}`);
    const isAdmin = (await roleRes.json()) === true;
    const isOwnCommands = fbPath.startsWith('config/commands/' + adminLogin.toLowerCase() + '/');
    if (!isAdmin && !isOwnCommands) return res.status(403).json({ error: 'not authorized' });

    // Проверка что path начинается с разрешённого
    if (!fbPath.startsWith('config/commands/')) return res.status(403).json({ error: 'path not allowed' });

    if (method === 'DELETE') {
      await fetch(`${DB_BASE}/${fbPath}.json?auth=${FIREBASE_SECRET}`, { method: 'DELETE' });
    } else {
      await fetch(`${DB_BASE}/${fbPath}.json?auth=${FIREBASE_SECRET}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`HTTP server on :${PORT} (для здоровья Render)`));

// --- IRC Lurker ---

async function getBotToken(bot = 1) {
  if (!FIREBASE_SECRET) {
    console.error('FIREBASE_SECRET not set');
    return null;
  }
  const url = `${WORKER_URL}/api/token?bot=${bot}`;
  console.log(`[token] Fetching bot #${bot} from worker...`);
  const res = await fetch(url, {
    headers: { 'X-Auth-Secret': FIREBASE_SECRET },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[token] Failed bot #${bot}: HTTP ${res.status} — ${body}`);
    return null;
  }
  const data = await res.json();
  if (!data.token) {
    console.error(`[token] Bot #${bot}: response has no token field`, JSON.stringify(data));
    return null;
  }
  console.log(`[token] Bot #${bot}: ${data.login || '?'} token obtenido (${data.token.slice(0, 8)}…)`);
  return data;
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
    connection: { reconnect: true, secure: true },
    channels: [],
  });

  client.on('connected', () => {
    connected[botKey] = true;
    console.log(`[${botKey}] Connected to IRC as ${tokenInfo.login}`);
    const chans = joinedChannels[botKey] || [];
    for (const login of chans) {
      client.join(`#${login}`).catch(() => {});
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
    connected[botKey] = false;
    console.log(`[${botKey}] Disconnected:`, reason);
  });

  // Обработка сообщений: захват чата + команды из чата (только первый бот)
  client.on('message', (channel, userstate, message, self) => {
    if (!self) captureMessage(channel, userstate, message, self);
    if (botIndex === 1 && !self && message.startsWith('!')) {
      handleChatCommand(botKey, channel, userstate, message, tokenInfo).catch(() => {});
    }
  });

  // Рейды (приходят как USERNOTICE в канал, где сидит бот)
  client.on('usernotice', (channel, userstate, message) => {
    if (userstate && userstate['msg-id'] === 'raid') {
      captureRaid(userstate, channel).catch(() => {});
    }
  });

  try {
    await client.connect();
    clients[botKey] = client;
  } catch (e) {
    console.error(`[${botKey}] Connection failed:`, e.message);
  }
}

async function syncChannels() {
  const [squadLogins, extra] = await Promise.all([getSquadLogins(), getExtraChannels()]);
  const targetLogins = [...new Set([...squadLogins, ...extra])];

  console.log(`Sync: ${targetLogins.length} каналов (squad ${squadLogins.length} + extra ${extra.length})`);

  for (const botIndex of [1, 2]) {
    const botKey = `bot${botIndex}`;
    const client = clients[botKey];
    if (!connected[botKey]) continue;

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

    // Синхронизируем PubSub топики
    const ti = botTokens[botKey];
    if (ti && ti.token && ti.client_id) {
      syncPubSubTopics(botKey, ti).catch(() => {});
    }
  }
}

// --- PubSub (Channel Points) ---

async function getSquadMembers() {
  if (!FIREBASE_SECRET) return [];
  const url = `https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app/twitch-users.json?auth=${FIREBASE_SECRET}`;
  try {
    const res = await fetch(url);
    const users = await res.json();
    if (!users) return [];
    return Object.entries(users)
      .filter(([, u]) => u.roles && (u.roles.squad || u.roles.academy))
      .map(([login, u]) => ({ login: login.toLowerCase(), id: u.twitchId || null }));
  } catch (e) {
    console.error('Failed to fetch squad members:', e.message);
    return [];
  }
}

function connectPubSub(botKey, tokenInfo) {
  const ps = pubsub[botKey];
  if (!ps || !tokenInfo || !tokenInfo.token || !tokenInfo.client_id) return;

  if (ps.ws) {
    clearInterval(ps.pingInterval);
    try { ps.ws.close(); } catch {}
    ps.ws = null;
    ps.topics = [];
  }

  const ws = new WebSocket('wss://pubsub-edge.twitch.tv');
  ps.ws = ws;

  ws.on('open', async () => {
    console.log(`[pubsub-${botKey}] Connected`);
    ps.badAuth = false;
    const members = await getSquadMembers();

    // Тест: подписка на video-playback без токена (проверка что WebSocket работает)
    const testId = members.find(m => m.id)?.id || '0';
    ws.send(JSON.stringify({ type: 'LISTEN', nonce: 'test-' + botKey, data: { topics: ['video-playback-by-id.' + testId] } }));

    const topicIds = members.filter(m => m.id).map(m => `channel-points-channel-v1.${m.id}`);
    if (topicIds.length > 0) {
      ws.send(JSON.stringify({ type: 'LISTEN', nonce: 'listen-' + botKey, data: { topics: topicIds, auth_token: tokenInfo.token } }));
      ps.topics = topicIds;
      console.log(`[pubsub-${botKey}] Subscribed to ${topicIds.length} point topics`);
    }
    ps.pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PING' }));
    }, 240000);
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'MESSAGE' && msg.data?.topic?.startsWith('channel-points-channel-v1.')) {
        const inner = JSON.parse(msg.data.message);
        if (inner.type === 'claim-available') {
          const claim = inner.data?.claim;
          if (claim?.id && claim?.channel_id) {
            setTimeout(() => claimPoints(tokenInfo, claim.channel_id, claim.id, botKey), 2000);
          }
        }
      } else if (msg.type === 'RESPONSE') {
        if (msg.error) {
          console.error(`[pubsub-${botKey}] Error:`, JSON.stringify({ error: msg.error, nonce: msg.nonce, topics: msg.data?.topics }));
          if (msg.error === 'ERR_BADAUTH' && msg.nonce !== 'test-' + botKey) ps.badAuth = true;
        } else if (msg.nonce === 'test-' + botKey) {
          console.log(`[pubsub-${botKey}] Test topic (video-playback) OK → connection works`);
        } else if (msg.nonce === `listen-${botKey}`) {
          console.log(`[pubsub-${botKey}] Listen confirmed`);
        }
      } else if (msg.type === 'RECONNECT') {
        setTimeout(() => connectPubSub(botKey, tokenInfo), 1000);
      } else if (msg.type === 'PING') {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {
      console.error(`[pubsub-${botKey}] Message error:`, e.message);
    }
  });

  ws.on('close', () => {
    clearInterval(ps.pingInterval);
    ps.pingInterval = null;
    ps.ws = null;
    const delay = ps.badAuth ? 300000 : 3000;
    console.log(`[pubsub-${botKey}] Disconnected, reconnecting in ${delay / 1000}s...`);
    setTimeout(() => connectPubSub(botKey, tokenInfo), delay);
  });

  ws.on('error', (e) => {
    if (e.message?.includes('ECONNREFUSED') || e.message?.includes('ETIMEDOUT')) return;
    console.error(`[pubsub-${botKey}] WS error:`, e.message);
  });
}

async function syncPubSubTopics(botKey, tokenInfo) {
  const ps = pubsub[botKey];
  if (!ps || !ps.ws || ps.ws.readyState !== WebSocket.OPEN) return;
  if (ps.badAuth) return;

  const members = await getSquadMembers();
  const desired = members.filter(m => m.id).map(m => `channel-points-channel-v1.${m.id}`);
  const current = ps.topics || [];

  const toAdd = desired.filter(t => !current.includes(t));
  const toRemove = current.filter(t => !desired.includes(t));

  if (toRemove.length) {
    ps.ws.send(JSON.stringify({ type: 'UNLISTEN', data: { topics: toRemove } }));
  }
  if (toAdd.length) {
    ps.ws.send(JSON.stringify({ type: 'LISTEN', nonce: 'listen-' + botKey, data: { topics: toAdd, auth_token: tokenInfo.token } }));
    console.log(`[pubsub-${botKey}] Added ${toAdd.length} topics`);
  }
  if (toRemove.length || toAdd.length) ps.topics = desired;
}

async function claimPoints(tokenInfo, channelId, claimId, botKey) {
  try {
    const res = await fetch(`https://points.twitch.tv/points/${channelId}/claim?claim_id=${claimId}`, {
      method: 'POST',
      headers: {
        'Authorization': 'OAuth ' + tokenInfo.token,
        'Client-Id': tokenInfo.client_id,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log(`[claim-${botKey}] +${data.points || '?'} points in channel ${channelId}`);
    } else if (res.status !== 400) {
      const text = await res.text().catch(() => '');
      console.error(`[claim-${botKey}] Failed HTTP ${res.status} for ${channelId}: ${text.slice(0, 80)}`);
    }
  } catch (e) {
    if (!e.message?.includes('aborted')) console.error(`[claim-${botKey}] Error:`, e.message);
  }
}

// --- Chat Capture (сообщения, присутствие, рейды) ---

const chatQueue = [];
let chatFlushTimer = null;
const viewerMeta = new Map(); // uid -> { firstSeen, lastSeen, channels: Map(ch -> {firstSeen, lastSeen}) }
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
    chLogin, uid, login, displayName, now,
  });
  if (!chatFlushTimer) {
    chatFlushTimer = setTimeout(() => { chatFlushTimer = null; flushChatQueue(); }, 8000);
  }
}

async function flushChatQueue() {
  if (!chatQueue.length) return;
  const batch = chatQueue.splice(0, chatQueue.length);
  const byDayUid = {};
  const presence = new Map(); // uid -> { ch -> { firstSeen, lastSeen, lastMessage } }
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
      presence.set(it.uid, presence.get(it.uid));
      presence.get(it.uid)[it.chLogin] = { firstSeen: ch.firstSeen, lastSeen: ch.lastSeen, lastMessage: trim(it.entry.m, 120), login: it.login, displayName: it.displayName, uid: it.uid, now: it.now };
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
      console.warn('[capture] PATCH ' + res.status + ' на ' + path + ' → чищу самые старые чаты');
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
      console.warn('[capture] PUT ' + res.status + ' на ' + path + ' → чищу самые старые чаты');
      const freed = await trimChatLog(2);
      if (freed) return PUT_FB(path, data, true);
    }
  } catch (e) { console.error('[capture] PUT fail', path, e.message); }
}

async function trimChatLog(days) {
  // Удаляет N самых старых дней из chat-log (+ raids), чтобы освободить место.
  // Всегда оставляет хотя бы один свежий день.
  let freed = false;
  try {
    const r = await fetch(`${DB_BASE}/chat-log.json?shallow=true&auth=${FIREBASE_SECRET}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const keys = await r.json();
      if (keys) {
        const sorted = Object.keys(keys).sort();
        const keep = sorted.slice(-1); // последний (свежий) день не трогаем
        const toDel = sorted.filter(d => !keep.includes(d)).slice(0, days);
        for (const d of toDel) {
          await fetch(`${DB_BASE}/chat-log/${d}.json?auth=${FIREBASE_SECRET}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) });
          console.log('[quota] chat-log/' + d + ' удалён (не хватает места)');
          freed = true;
        }
      }
    }
  } catch (e) { console.error('[quota] trim chat-log fail:', e.message); }
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
          console.log('[quota] raids/' + d + ' удалён (не хватает места)');
          freed = true;
        }
      }
    }
  } catch (e) {}
  return freed;
}

async function captureRaid(userstate, channel) {
  if (userstate['msg-id'] !== 'raid') return;
  const fromLogin = (userstate['msg-param-login'] || userstate['msg-param-displayName'] || '').toLowerCase();
  const fromName = userstate['msg-param-displayName'] || fromLogin;
  const toChannel = channel.replace('#', '').toLowerCase();
  const viewers = parseInt(userstate['msg-param-viewerCount'] || '0') || 0;
  const now = Date.now();
  const date = dayStr();
  const key = `${now}_${Math.random().toString(36).slice(2, 8)}`;
  await PUT_FB(`raids/${date}/${key}`, { from: fromLogin, fromName, to: toChannel, viewers, ts: now });
  if (fromLogin) {
    // Автодобавление рейдера в extra-прослушку
    await PATCH_FB('config/lurker/extra/' + fromLogin, { addedAt: now, source: 'raid', viewers, ts: now });
  }
  console.log(`[raid] ${fromLogin || '?'} → ${toChannel} (${viewers} зр.)`);
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

async function heartbeatLurker() {
  try {
    await PUT_FB('config/lurker/status/' + (botTokens.bot1?.login || 'render'), {
      ts: Date.now(), connected: connected.bot1, channels: joinedChannels.bot1.length,
      extra: (await getExtraChannels()).length, version: 'render-node',
    });
  } catch (e) {}
}

async function cleanupTTL() {
  // chat-log: удаляем дни старше CHAT_TTL_DAYS
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
  // raids: удаляем дни старше RAID_TTL_DAYS
  try {
    const r2 = await fetch(`${DB_BASE}/raids.json?shallow=true&auth=${FIREBASE_SECRET}`, { signal: AbortSignal.timeout(8000) });
    if (r2.ok) {
      const keys2 = await r2.json();
      if (keys2) {
        for (const d of Object.keys(keys2)) {
          if (d < dayStr(-RAID_TTL_DAYS)) {
            await fetch(`${DB_BASE}/raids/${d}.json?auth=${FIREBASE_SECRET}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) });
            console.log('[ttl] raids/' + d + ' удалён');
          }
        }
      }
    }
  } catch (e) {}
}

// --- GQL Polling (fallback для channel points, если PubSub не работает) ---

const GQL_CLAIM_HASH = '46aaeebe02c0afecfc899c239de22a1adebaf2b3b4929af1cd39406852fd5713';

async function pollChannelPoints(botKey, tokenInfo) {
  if (!tokenInfo || !tokenInfo.token || !tokenInfo.client_id) return;
  const ps = pubsub[botKey];
  if (ps && !ps.badAuth) return; // PubSub работает — не дублируем

  const members = await getSquadMembers();
  const ids = members.filter(m => m.id).map(m => m.id);
  if (!ids.length) return;

  const headers = {
    'Authorization': 'OAuth ' + tokenInfo.token,
    'Client-Id': tokenInfo.client_id,
    'Content-Type': 'text/plain;charset=UTF-8',
  };

  // Формат: batch-запрос для проверки статуса + попытка claim
  // Используем PlayerChannelPointStatus — содержит availableClaim
  for (const channelId of ids) {
    try {
      const body = JSON.stringify([{
        operationName: 'PlayerChannelPointStatus',
        variables: { channelID: channelId, includeGained: false },
        extensions: {
          persistedQuery: { version: 1, sha256Hash: GQL_CLAIM_HASH },
        },
      }]);
      const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST', headers, body, signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      // Пробуем несколько путей до availableClaim
      const claim = data?.[0]?.data?.channelPointStatus?.availableClaim?.id
        || data?.[0]?.data?.community?.channelPointClaimStatus?.availableClaim?.id;
      if (claim) {
        await claimPoints(tokenInfo, channelId, claim, botKey);
      }
    } catch (e) { /* silent */ }
  }
}

// --- Команды из чата ---

const DB_URL = 'https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app';

async function logToFirebase(msg, level = 'info') {
  console.log(`[${level}] ${msg}`);
  if (!FIREBASE_SECRET) return;
  try {
    await fetch(`${DB_URL}/config/logs.json?auth=${FIREBASE_SECRET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: Date.now(), source: 'lurker', level, message: msg }),
    });
  } catch {}
}

async function getCommandConfig(cmdName, channelLogin) {
  if (!FIREBASE_SECRET) return null;
  // Сначала проверяем команду стримера, потом глобальную
  for (const base of [`config/commands/${channelLogin}`, 'config/commands']) {
    try {
      const res = await fetch(
        `https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app/${base}/${cmdName}.json?auth=${FIREBASE_SECRET}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json();
        if (data) return data;
      }
    } catch { /* try next */ }
  }
  return null;
}

function checkPermission(level, userstate) {
  const badges = userstate.badges || {};
  const isBroadcaster = !!badges.broadcaster;
  const isMod = !!badges.moderator;
  const isVip = !!badges.vip;
  if (!level || level === 'все') return true;
  if (level === 'стример' && isBroadcaster) return true;
  if (level === 'модерка' && (isBroadcaster || isMod)) return true;
  if (level === 'редакторка' && (isBroadcaster || isMod)) return true;
  if (level === 'випка' && (isBroadcaster || isMod || isVip)) return true;
  return false;
}

async function handleChatCommand(botKey, channel, userstate, message, tokenInfo) {
  const parts = message.slice(1).split(' ');
  const cmdName = parts[0].toLowerCase();
  const value = parts.slice(1).join(' ').trim();
  const channelLogin = channel.replace('#', '').toLowerCase();

  logToFirebase(`[cmd] !${cmdName} от @${userstate.username} в #${channelLogin}${value ? ' = ' + value : ''}`);

  const cmd = await getCommandConfig(cmdName, channelLogin);
  if (!cmd) return;

  // Поддержка старого формата (строка) и нового (объект)
  const responseText = typeof cmd === 'string' ? cmd : cmd.response;
  const permission = typeof cmd === 'string' ? 'все' : (cmd.permission || 'все');
  const action = typeof cmd === 'string' ? 'reply' : (cmd.action || 'reply');
  if (!responseText) return;

  if (!checkPermission(permission, userstate)) {
    logToFirebase(`[cmd] !${cmdName} — нет прав (нужен ${permission}, у юзера ${Object.keys(userstate.badges || {}).join(',')})`, 'warn');
    return;
  }

  const result = await processTemplate(responseText, { value, channelLogin, tokenInfo, botKey, userstate });
  if (!result) {
    logToFirebase(`[cmd] !${cmdName} — ответ пустой (${responseText})`);
    return;
  }

  const client = clients[botKey];
  if (!client || !connected[botKey]) return;

  logToFirebase(`[cmd] !${cmdName} → ответ: "${result}" (action=${action})`);
  if (action === 'ping') {
    client.say(channel, `@${userstate.username} ${result}`).catch(() => {});
  } else {
    client.say(channel, result).catch(() => {});
  }
}

async function processTemplate(template, ctx) {
  let result = template;

  // ${УбрУчаст} — убираем (проверка прав уже сделана)
  result = result.replace(/\$\{УбрУчаст\}/g, '');

  // ${Значение}
  result = result.replace(/\$\{Значение\}/g, ctx.value);

  // ${СменаКатегории"..."} — выполняем и убираем (не показываем результат в чате)
  const catRegex = /\$\{СменаКатегории"([^"]*)"\}/;
  let catMatch;
  while ((catMatch = result.match(catRegex)) !== null) {
    const catQuery = catMatch[1].replace(/\$\{Значение\}/g, ctx.value);
    await changeStreamCategory(ctx, catQuery);
    result = result.replace(catMatch[0], '');
  }

  // Убираем неизвестные ${...}
  result = result.replace(/\$\{[^}]+\}/g, '');

  return result.trim() || null;
}

async function changeStreamCategory(ctx, query) {
  if (!query) {
    logToFirebase(`[катг] ${query}: нет запроса`, 'warn');
    return false;
  }

  // Приоритет: токен стримера > токен бота
  let ti = ctx.tokenInfo;
  if (ctx.channelLogin && FIREBASE_SECRET) {
    try {
      const tokensRes = await fetch(`${DB_BASE}/twitch-users/${encodeURIComponent(ctx.channelLogin)}/tokens.json?auth=${FIREBASE_SECRET}`);
      if (tokensRes.ok) {
        const tokens = await tokensRes.json();
        if (tokens?.access_token && tokens?.client_id) {
          if (!tokens.expires_at || Date.now() < tokens.expires_at - 120000) {
            logToFirebase(`[катг] использую токен стримера ${ctx.channelLogin}`);
            ti = { token: tokens.access_token, client_id: tokens.client_id, login: ctx.channelLogin };
          } else {
            // Попробовать обновить через воркер
            const rr = await fetch(`${WORKER_URL}/api/token/user?login=${encodeURIComponent(ctx.channelLogin)}`, {
              headers: { 'X-Auth-Secret': FIREBASE_SECRET },
              signal: AbortSignal.timeout(10000),
            });
            if (rr.ok) {
              const rd = await rr.json();
              if (rd.token) {
                logToFirebase(`[катг] токен стримера ${ctx.channelLogin} обновлён`);
                ti = { token: rd.token, client_id: rd.client_id || tokens.client_id, login: ctx.channelLogin };
              }
            }
          }
        }
      }
    } catch (e) {
      logToFirebase(`[катг] не удалось получить токен стримера: ${e.message}`, 'warn');
    }
  }

  if (!ti?.token || !ti?.client_id) {
    logToFirebase(`[катг] ${query}: нет токена или client_id`, 'warn');
    return false;
  }
  try {
    logToFirebase(`[катг] ищу категорию "${query}"`);
    // Поиск категории
    const searchRes = await fetch(
      `https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(query)}`,
      {
        headers: {
          'Authorization': 'Bearer ' + ti.token,
          'Client-Id': ti.client_id,
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!searchRes.ok) {
      logToFirebase(`[катг] поиск категории "${query}" — HTTP ${searchRes.status}`, 'error');
      return false;
    }
    const searchData = await searchRes.json();
    if (!searchData.data?.length) {
      logToFirebase(`[катг] категория "${query}" не найдена`, 'warn');
      return false;
    }

    const best = searchData.data[0];
    logToFirebase(`[катг] найдена категория: ${best.name} (id=${best.id})`);

    // ID стримера
    const members = await getSquadMembers();
    const member = members.find(m => m.login === ctx.channelLogin);
    if (!member?.id) {
      logToFirebase(`[катг] стример ${ctx.channelLogin} не найден в squad`, 'warn');
      return false;
    }

    logToFirebase(`[катг] меняю категорию ${member.login} на ${best.name}`);
    // Смена категории
    const patchRes = await fetch(
      `https://api.twitch.tv/helix/channels?broadcaster_id=${member.id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + ti.token,
          'Client-Id': ti.client_id,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ game_id: best.id }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!patchRes.ok) {
      const errText = await patchRes.text().catch(() => '');
      logToFirebase(`[катг] ошибка смены категории: HTTP ${patchRes.status} ${errText}`, 'error');
      return false;
    }
    logToFirebase(`[катг] категория ${member.login} изменена на ${best.name} ✅`);
    return true;
  } catch (e) {
    logToFirebase(`[катг] исключение: ${e.message}`, 'error');
    return false;
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

  botTokens.bot1 = bot1Info;
  botTokens.bot2 = bot2Info;

  await Promise.all([
    connectBot(1, bot1Info),
    bot2Info ? connectBot(2, bot2Info) : Promise.resolve(),
  ]);

  // Ждём подключения IRC, затем запускаем PubSub
  await new Promise(resolve => {
    const check = () => {
      if (connected.bot1) resolve();
      else setTimeout(check, 200);
    };
    check();
  });

  connectPubSub('bot1', bot1Info);
  if (bot2Info) connectPubSub('bot2', bot2Info);

  // GQL polling (fallback, если PubSub не работает)
  setInterval(() => pollChannelPoints('bot1', bot1Info), 150000);
  if (bot2Info) setInterval(() => pollChannelPoints('bot2', bot2Info), 150000);

  await syncChannels();
  setInterval(syncChannels, CHECK_INTERVAL);
  setInterval(cleanupTTL, 3600000);
  setInterval(heartbeatLurker, 300000);
  setInterval(() => { if (chatQueue.length) flushChatQueue().catch(() => {}); }, 30000);

  // Периодический API-пинг (бот #1 к воркеру), чтобы держать токен активным
  setInterval(async () => {
    if (!connected['bot1']) return;
    try {
      await fetch(`${WORKER_URL}/api/twitch/streams?first=1`, {
        headers: { 'X-Auth-Secret': FIREBASE_SECRET },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) { /* silent */ }
  }, 300000);

  // Логирование статуса в Firebase каждые 5 минут
  async function logLurkerStatus() {
    if (!FIREBASE_SECRET) return;
    const data = {
      ts: Date.now(),
      connected: { bot1: connected['bot1'] || false, bot2: connected['bot2'] || false },
      channels: {
        bot1: (joinedChannels['bot1'] || []).length,
        bot2: (joinedChannels['bot2'] || []).length,
      },
      uptime: process.uptime(),
    };
    try {
      const baseUrl = 'https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app';
      const msg = 'Bot status: ' + JSON.stringify(data.connected) + ' chans: ' + data.channels.bot1 + '/' + data.channels.bot2;
      await fetch(`${baseUrl}/config/logs.json?auth=${FIREBASE_SECRET}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ts: Date.now(), source: 'lurker', level: 'info', message: msg }),
      });
    } catch (e) { console.error('[lurker-log] Error:', e.message); }
  }
  logLurkerStatus();
  setInterval(logLurkerStatus, 300000);
}

main().catch(console.error);

process.on('SIGINT', () => {
  console.log('Shutting down...');
  for (const key of Object.keys(clients)) {
    try { clients[key].disconnect(); } catch {}
  }
  for (const key of Object.keys(pubsub)) {
    clearInterval(pubsub[key].pingInterval);
    try { pubsub[key].ws?.close(); } catch {}
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  for (const key of Object.keys(clients)) {
    try { clients[key].disconnect(); } catch {}
  }
  for (const key of Object.keys(pubsub)) {
    clearInterval(pubsub[key].pingInterval);
    try { pubsub[key].ws?.close(); } catch {}
  }
  process.exit(0);
});
