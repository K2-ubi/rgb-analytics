#!/usr/bin/env node
// Разовый синк данных из Firebase RTDB в Supabase (PostgREST).
//
// Запуск (нужны env):
//   FIREBASE_SECRET=... SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=... node scripts/sync-rtdb-to-supabase.js
//
// Переносит:
//   chat-log (последние N дней), all-viewers + channels, viewer-history,
//   raids, twitch-users, stream-chunks (последние N дней), config/lurker/extra
//
// Идемпотентный: upsert по первичным ключам. Можно гонять повторно.

const DB_BASE = process.env.FIREBASE_DB_URL || 'https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const CHAT_DAYS = Number(process.env.SYNC_CHAT_DAYS || 7);
const CHUNK_DAYS = Number(process.env.SYNC_CHUNK_DAYS || 30);

if (!FIREBASE_SECRET || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Нужны env: FIREBASE_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

function dayStr(offsetDays = 0, ts = Date.now()) {
  const d = new Date(ts + offsetDays * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function fbGet(path) {
  const r = await fetch(`${DB_BASE}/${path}.json?auth=${FIREBASE_SECRET}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`FB GET ${path}: ${r.status}`);
  return r.json();
}

async function sbUpsert(table, rows) {
  if (!rows || !rows.length) return 0;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`SB upsert ${table}: ${r.status} ${body.slice(0, 300)}`);
  }
  return rows.length;
}

async function sbDeleteBefore(table, tsField, tsMs) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${tsField}=lt.${tsMs}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'count=exact' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`SB delete ${table}: ${r.status}`);
  const n = r.headers.get('content-range') ? parseInt(r.headers.get('content-range').split('/')[1] || '0', 10) : 0;
  return n;
}

const BATCH = 250;
async function sbUpsertBatched(table, rows) {
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    n += await sbUpsert(table, rows.slice(i, i + BATCH));
    process.stdout.write(`  ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }
  console.log(`  ${table}: ${n} строк`);
}

async function syncChat() {
  console.log('chat-log → chat_messages');
  const days = [];
  for (let i = 0; i < CHAT_DAYS; i++) days.push(dayStr(-i));
  const rows = [];
  for (const d of days) {
    const byUid = await fbGet(`chat-log/${d}`).catch(() => null);
    if (!byUid) continue;
    for (const [uid, msgs] of Object.entries(byUid)) {
      for (const [msgId, msg] of Object.entries(msgs || {})) {
        rows.push({
          msg_id: msgId,
          user_id: uid,
          login: msg.l || '',
          display_name: msg.n || '',
          channel: msg.c || '',
          message: (msg.m || '').slice(0, 300),
          ts: msg.t || 0,
        });
      }
    }
  }
  await sbUpsertBatched('chat_messages', rows);
}

async function syncViewers() {
  console.log('all-viewers → viewers + viewer_channels');
  const all = await fbGet('all-viewers').catch(() => null);
  if (!all) return;
  const viewers = [];
  const channels = [];
  for (const [uid, v] of Object.entries(all)) {
    const meta = {};
    for (const k of ['profileImageUrl', 'createdAt', 'description', 'categories']) {
      if (v[k]) meta[k] = v[k];
    }
    viewers.push({ user_id: uid, login: v.login || '', display_name: v.displayName || '', first_seen: v.firstSeen || 0, last_seen: v.lastSeen || 0, meta });
    for (const [ch, cd] of Object.entries(v.channels || {})) {
      channels.push({ user_id: uid, channel: ch, first_seen: cd.firstSeen || 0, last_seen: cd.lastSeen || 0, last_message: (cd.lastMessage || '').slice(0, 300) });
    }
  }
  await sbUpsertBatched('viewers', viewers);
  await sbUpsertBatched('viewer_channels', channels);
}

async function syncViewerHistory() {
  console.log('viewer-history → viewer_history');
  const byCh = await fbGet('viewer-history').catch(() => null);
  if (!byCh) return;
  const rows = [];
  for (const [ch, viewers] of Object.entries(byCh)) {
    for (const [uid, v] of Object.entries(viewers || {})) {
      rows.push({ channel: ch, user_id: uid, login: v.login || '', display_name: v.displayName || '', first_seen: v.firstSeen || 0, last_seen: v.lastSeen || 0 });
    }
  }
  await sbUpsertBatched('viewer_history', rows);
}

async function syncRaids() {
  console.log('raids → raids');
  const days = [];
  for (let i = 0; i < RAID_DAYS; i++) days.push(dayStr(-i));
  const rows = [];
  for (const d of days) {
    const byDay = await fbGet(`raids/${d}`).catch(() => null);
    if (!byDay) continue;
    for (const [key, r] of Object.entries(byDay)) {
      if (!r) continue;
      rows.push({ src_key: `${d}/${key}`, from_login: r.from || '', from_name: r.fromName || '', to_channel: r.to || '', viewers: r.viewers || 0, ts: r.ts || 0 });
    }
  }
  await sbUpsertBatched('raids', rows);
}

async function syncTwitchUsers() {
  console.log('twitch-users → twitch_users');
  const all = await fbGet('twitch-users').catch(() => null);
  if (!all) return;
  const rows = [];
  for (const [login, u] of Object.entries(all)) {
    rows.push({ login, display_name: u.displayName || '', roles: u.roles || {}, meta: { twitchId: u.twitchId || '', profileImageUrl: u.profileImageUrl || '' } });
  }
  await sbUpsertBatched('twitch_users', rows);
}

async function syncStreamChunks() {
  console.log(`stream-chunks → stream_chunks (${CHUNK_DAYS} дней)`);
  const byLogin = await fbGet('stream-chunks').catch(() => null);
  if (!byLogin) return;
  const minimumTs = Date.now() - CHUNK_DAYS * 86400000;
  const rows = [];
  for (const [login, byDay] of Object.entries(byLogin)) {
    for (const [day, byTs] of Object.entries(byDay || {})) {
      for (const [tsStr, chunk] of Object.entries(byTs || {})) {
        const ts = parseInt(tsStr, 10) || 0;
        if (!ts || ts < minimumTs) continue;
        rows.push({ login, day, ts, viewers: chunk.viewers || 0, updated_at: chunk.updatedAt || 0 });
      }
    }
  }
  await sbUpsertBatched('stream_chunks', rows);
}

async function syncLurkerExtra() {
  console.log('config/lurker/extra → lurker_extra');
  const all = await fbGet('config/lurker/extra').catch(() => null);
  if (!all) return;
  const rows = [];
  for (const [ch, info] of Object.entries(all)) {
    rows.push({ channel: ch, added_at: info?.addedAt || 0, source: info?.source || 'manual', viewers: info?.viewers || 0, disabled: !!info?.disabled });
  }
  await sbUpsertBatched('lurker_extra', rows);
}

const RAID_DAYS = Number(process.env.SYNC_RAID_DAYS || 7);

async function main() {
  const t0 = Date.now();
  console.log('=== Синк RTDB → Supabase ===');
  // raids: чтоб не дублировать по serial id — чистим старые и вставляем
  await syncChat();
  await syncViewers();
  await syncViewerHistory();
  await syncRaids();
  await syncTwitchUsers();
  await syncStreamChunks();
  await syncLurkerExtra();
  // TTL-подчистка в Supabase (на всякий случай)
  console.log('TTL cleanup...');
  await sbDeleteBefore('chat_messages', 'ts', Date.now() - 2 * 86400000);
  await sbDeleteBefore('raids', 'ts', Date.now() - 7 * 86400000);
  console.log(`=== Готово за ${((Date.now() - t0) / 1000).toFixed(1)}s ===`);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });