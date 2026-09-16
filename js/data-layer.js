// Единый слой доступа к данным.
// Сейчас читает из Firebase RTDB, потом можно переключить на Supabase,
// не трогая остальной код (см. SUPABASE-MIGRATION.md).
//
// Использование:
//   const msgs = await dataLayer.getUserMessages(userId);
//   // [{ channel, login, displayName, messages: [{ msgId, m, t }] }]

(function (global) {
  const DATA = {
    // Сколько дней чата показываем (совпадает с TTL ботов: 2 суток)
    CHAT_TTL_DAYS: 2,
    // Провайдер: 'firebase' (по умолчанию) или 'supabase' (включается в config.js)
    provider: 'firebase',
  };

  function dayStr(offsetDays = 0, ts = Date.now()) {
    const d = new Date(ts + offsetDays * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---------- Supabase (PostgREST) ----------
  function supabaseConfig() {
    return (global.CONFIG && global.CONFIG.supabase) || null;
  }

  async function sbQuery(path, params) {
    const cfg = supabaseConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) throw new Error('Supabase не настроен (config.supabase)');
    const u = new URL(cfg.url.replace(/\/+$/, '') + path);
    for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
    const r = await fetch(u, {
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error('Supabase ' + r.status);
    return r.json();
  }

  function sbRows(obj) {
    const type = typeof obj;
    if (type === 'object' && obj !== null && Array.isArray(obj)) return obj;
    if (type === 'object' && obj !== null) return Object.values(obj);
    return [];
  }

  async function getChatFromSupabase(userId, days) {
    if (!userId) return {};
    const t0 = Date.now() - days * 86400000;
    const rows = await sbQuery('/rest/v1/chat_messages', {
      select: 'msg_id,channel,login,display_name,message,ts',
      'user_id': 'eq.' + userId,
      'ts': 'gte.' + t0,
      order: 'ts.asc',
      limit: '5000',
    });
    const out = {};
    for (const row of sbRows(rows)) {
      const d = new Date((row.ts || 0) + 0).toISOString().slice(0, 10);
      (out[d] = out[d] || {})[row.msg_id] = { c: row.channel, l: row.login, n: row.display_name, m: row.message, t: row.ts };
    }
    return out;
  }

  async function getRaidsFromSupabase(days) {
    const t0 = Date.now() - days * 86400000;
    const rows = await sbQuery('/rest/v1/raids', {
      select: 'from_login,from_name,to_channel,viewers,ts',
      'ts': 'gte.' + t0,
      order: 'ts.desc',
      limit: '5000',
    });
    return sbRows(rows).map(r => ({ from: r.from_login, fromName: r.from_name, to: r.to_channel, viewers: r.viewers, ts: r.ts }));
  }

  // ---------- Firebase (RTDB) ----------
  async function getUserMessages(userId, days) {
    days = days || DATA.CHAT_TTL_DAYS;
    if (!userId) return {};
    if (DATA.provider === 'supabase') return getChatFromSupabase(userId, days);
    const out = {};
    const tasks = [];
    for (let i = 0; i < days; i++) {
      const day = dayStr(-i);
      const ref = db.ref('chat-log/' + day + '/' + userId);
      tasks.push(ref.once('value').then(snap => {
        const val = snap.val();
        if (val) out[day] = val;
      }).catch(() => {}));
    }
    await Promise.all(tasks);
    return out;
  }

  function groupByChannel(byDay) {
    const channels = {};
    for (const day of Object.keys(byDay)) {
      for (const msgId of Object.keys(byDay[day])) {
        const msg = byDay[day][msgId];
        const ch = msg.c || 'unknown';
        if (!channels[ch]) channels[ch] = { channel: ch, messages: [] };
        channels[ch].messages.push({
          msgId,
          m: msg.m || '',
          t: msg.t || 0,
          day,
          login: msg.l || '',
          displayName: msg.n || msg.l || '',
        });
      }
    }
    for (const ch of Object.keys(channels)) {
      channels[ch].messages.sort((a, b) => (a.t || 0) - (b.t || 0));
    }
    const sorted = Object.values(channels).sort((a, b) => {
      const aLast = a.messages.length ? a.messages[a.messages.length - 1].t : 0;
      const bLast = b.messages.length ? b.messages[b.messages.length - 1].t : 0;
      return bLast - aLast;
    });
    return sorted;
  }

  // Сообщения, сгруппированные по каналам (для страницы юзера).
  async function getUserChatByChannel(userId, days) {
    const byDay = await getUserMessages(userId, days);
    return groupByChannel(byDay);
  }

  // Для админки: лента рейдов за N дней
  async function getRaids(days) {
    days = days || 7;
    if (DATA.provider === 'supabase') return getRaidsFromSupabase(days);
    const out = [];
    const tasks = [];
    for (let i = 0; i < days; i++) {
      const day = dayStr(-i);
      tasks.push(db.ref('raids/' + day).once('value').then(snap => {
        const val = snap.val();
        if (val) {
          for (const k of Object.keys(val)) out.push(Object.assign({ key: day + '/' + k }, val[k]));
        }
      }).catch(() => {}));
    }
    await Promise.all(tasks);
    out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return out;
  }

  function setProvider(provider) {
    DATA.provider = provider === 'supabase' ? 'supabase' : 'firebase';
  }

  function getProvider() {
    return DATA.provider;
  }

  // Автоматический выбор провайдера из window.CONFIG (дается после загрузки config.js)
  try {
    if (global.CONFIG && global.CONFIG.supabase && global.CONFIG.supabase.enabled && global.CONFIG.supabase.url) {
      setProvider('supabase');
    }
  } catch (e) {}

  global.dataLayer = {
    CHAT_TTL_DAYS: DATA.CHAT_TTL_DAYS,
    dayStr,
    getUserMessages,
    getUserChatByChannel,
    getRaids,
    setProvider,
    getProvider,
  };
})(window);