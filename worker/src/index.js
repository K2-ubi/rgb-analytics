const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API  = 'https://api.twitch.tv/helix';

const ALLOWED_ORIGINS = [
  'https://rgb-analytics.vercel.app',
  'https://rgbsquad-892a2.firebaseapp.com',
  'http://localhost:5173',
];

const CORS = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'https://rgb-analytics.vercel.app',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, POST',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Secret',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

function botSuffix(bot) {
  return bot === 2 ? '_2' : '';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = CORS(origin);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    const bot = parseInt(url.searchParams.get('bot') || '1');
    try {
      switch (url.pathname) {
        case '/api/auth': return auth(env, corsHeaders, bot);
        case '/api/callback': return callback(url, env, corsHeaders, bot);
        case '/api/status': return status(env, corsHeaders, bot);
        case '/api/twitch/users': return proxyAsBot(url, env, '/users', corsHeaders);
        case '/api/twitch/streams': return proxyAsBot(url, env, '/streams', corsHeaders);
        case '/api/twitch/chatters': return proxyAsBot(url, env, '/chat/chatters', corsHeaders);
        case '/api/twitch/followers': return proxyAsBot(url, env, '/channels/followers', corsHeaders);
        case '/api/twitch/subscriptions': return proxyAsBot(url, env, '/subscriptions', corsHeaders);
        case '/api/twitch/videos': return proxyAsBot(url, env, '/videos', corsHeaders);
        case '/api/monitor-streams': return requireSecret(env, request) ? monitorStreams(env) : json({ error: 'forbidden' }, 403, corsHeaders);
        case '/api/token': return requireSecret(env, request) ? getBotTokenForLurker(url, env, corsHeaders) : json({ error: 'forbidden' }, 403, corsHeaders);
        case '/api/reset': return resetBot(url, env, corsHeaders);
        case '/api/logs': return requireSecret(env, request) ? getLogs(env, corsHeaders) : json({ error: 'forbidden' }, 403, corsHeaders);
        case '/api/tracker-summary': return trackerSummary(url, env, corsHeaders);
        default: return json({ error: 'not found' }, 404, corsHeaders);
      }
    } catch (e) {
      return json({ error: e.message }, 500, corsHeaders);
    }
  },
  async scheduled(_event, env) {
    try {
      await getToken(env);
      await logToFirebase(env, 'worker', 'info', 'Bot #1 token refreshed');
    } catch (e) {
      await logToFirebase(env, 'worker', 'error', 'Bot #1 token refresh failed: ' + e.message);
    }
    try {
      await getToken(env, 2);
      await logToFirebase(env, 'worker', 'info', 'Bot #2 token refreshed');
    } catch (e) {
      await logToFirebase(env, 'worker', 'error', 'Bot #2 token refresh failed: ' + e.message);
    }
    let results = [];
    try { results = (await monitorStreams(env)) || []; } catch (e) { await logToFirebase(env, 'worker', 'error', 'monitorStreams failed: ' + e.message); }
    await logToFirebase(env, 'worker', 'info', 'Monitor: ' + results.length + ' members checked', results);
    try { await fetchTrackerData(env); } catch (e) { await logToFirebase(env, 'worker', 'error', 'fetchTrackerData failed: ' + e.message); }
  },
};

function requireSecret(env, request) {
  const secret = request.headers.get('X-Auth-Secret');
  if (!secret || secret !== env.FIREBASE_DB_SECRET) return false;
  return true;
}

async function getToken(env, bot = 1) {
  const sfx = botSuffix(bot);
  let at = await env.KV.get('access_token' + sfx);
  const exp = parseInt(await env.KV.get('expires_at' + sfx) || '0');
  if (at && Date.now() < exp - 120000) return at;
  const rt = await env.KV.get('refresh_token' + sfx);
  if (!rt) throw new Error('No refresh token for bot ' + bot + '. Open /api/auth?bot=' + bot);
  const r = await fetch(TWITCH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token', refresh_token: rt,
      client_id: env.BOT_CLIENT_ID, client_secret: env.BOT_CLIENT_SECRET,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Refresh failed for bot ' + bot + ': ' + (d.message || r.status));
  await env.KV.put('access_token' + sfx, d.access_token);
  await env.KV.put('refresh_token' + sfx, d.refresh_token);
  await env.KV.put('expires_at' + sfx, String(Date.now() + (d.expires_in || 14400) * 1000));
  await saveInfo(env, d.access_token, sfx);
  return d.access_token;
}

async function saveInfo(env, token, sfx = '') {
  if (await env.KV.get('bot_login' + sfx)) return;
  const r = await fetch(TWITCH_API + '/users', {
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': env.BOT_CLIENT_ID },
  });
  const d = await r.json();
  if (d.data?.[0]) {
    await env.KV.put('bot_login' + sfx, d.data[0].login);
    await env.KV.put('bot_display' + sfx, d.data[0].display_name);
    await env.KV.put('bot_id' + sfx, d.data[0].id);
  }
}

function auth(env, _corsHeaders, bot = 1) {
  const sfx = botSuffix(bot);
  const p = new URLSearchParams({
    client_id: env.BOT_CLIENT_ID,
    redirect_uri: env.REDIRECT_URI,
    response_type: 'code',
    scope: 'moderator:read:chatters moderator:read:followers channel:read:subscriptions channel:read:redemptions channel:manage:broadcast channel:manage:moderators channel:manage:vips channel:manage:raids channel:manage:polls channel:manage:predictions channel:manage:schedule channel:manage:ads channel:manage:videos channel:manage:redemptions chat:read chat:edit',
    state: 'bot=' + bot,
    force_verify: 'true',
  });
  return Response.redirect('https://id.twitch.tv/oauth2/authorize?' + p, 302);
}

async function callback(url, env, _corsHeaders) {
  const code = url.searchParams.get('code');
  if (!code) return html('Ошибка: ' + (url.searchParams.get('error') || 'unknown'));
  const bot = parseInt(url.searchParams.get('state')?.match(/bot=(\d)/)?.[1] || '1');
  const sfx = botSuffix(bot);
  const r = await fetch(TWITCH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.BOT_CLIENT_ID, client_secret: env.BOT_CLIENT_SECRET,
      code, grant_type: 'authorization_code',
      redirect_uri: env.REDIRECT_URI,
    }),
  });
  const d = await r.json();
  if (!r.ok) return html('Ошибка: ' + (d.message || r.status));
  await env.KV.put('access_token' + sfx, d.access_token);
  await env.KV.put('refresh_token' + sfx, d.refresh_token);
  await env.KV.put('expires_at' + sfx, String(Date.now() + (d.expires_in || 14400) * 1000));
  await env.KV.delete('bot_login' + sfx);
  await env.KV.delete('bot_display' + sfx);
  await env.KV.delete('bot_id' + sfx);
  await saveInfo(env, d.access_token, sfx);
  const login = await env.KV.get('bot_display' + sfx) || await env.KV.get('bot_login' + sfx) || 'бот ' + bot;
  const botLabel = bot === 2 ? ' (второй аккаунт)' : '';
  await logToFirebase(env, 'worker', 'info', 'Bot #' + bot + ' authorized as ' + login);
  return html(login + ' ✅ авторизован' + botLabel + '!<br><span style="font-size:14px">Закрой окно → в админке нажми Статус</span>', true);
}

async function proxyAsBot(url, env, path, corsHeaders) {
  const bot = parseInt(url.searchParams.get('bot') || '1');
  const token = await getToken(env, bot);
  const sfx = botSuffix(bot);
  const q = new URLSearchParams(url.search);
  q.delete('bot');
  const botId = await env.KV.get('bot_id' + sfx);
  if (botId && path === '/chat/chatters') q.set('moderator_id', botId);
  const r = await fetch(TWITCH_API + path + '?' + q, {
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': env.BOT_CLIENT_ID },
  });
  const data = await r.json();
  return new Response(JSON.stringify(data), {
    status: r.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function status(env, corsHeaders, bot = 1) {
  const sfx = botSuffix(bot);
  const exp = parseInt(await env.KV.get('expires_at' + sfx) || '0');
  return json({
    bot: bot,
    configured: !!(await env.KV.get('access_token' + sfx)),
    bot_login: await env.KV.get('bot_login' + sfx),
    bot_display: await env.KV.get('bot_display' + sfx),
    expires_at: exp,
    expires_in: Math.max(0, Math.floor((exp - Date.now()) / 1000)),
  }, 200, corsHeaders);
}

async function firebaseGet(env, path) {
  if (!env.FIREBASE_DB_SECRET) return null;
  const r = await fetch(env.FIREBASE_DB_URL + '/' + path + '.json?auth=' + env.FIREBASE_DB_SECRET);
  return r.ok ? r.json() : null;
}

async function firebasePatch(env, path, data) {
  if (!env.FIREBASE_DB_SECRET) return;
  await fetch(env.FIREBASE_DB_URL + '/' + path + '.json?auth=' + env.FIREBASE_DB_SECRET, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

async function firebasePut(env, path, data) {
  if (!env.FIREBASE_DB_SECRET) return;
  await fetch(env.FIREBASE_DB_URL + '/' + path + '.json?auth=' + env.FIREBASE_DB_SECRET, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

async function logToFirebase(env, source, level, message, data) {
  if (!env.FIREBASE_DB_SECRET) return;
  const entry = { ts: Date.now(), source, level, message, data: data || null };
  try {
    const snap = await firebaseGet(env, 'config/logs');
    let logs = Array.isArray(snap) ? snap : [];
    logs.push(entry);
    if (logs.length > 200) logs = logs.slice(-200);
    await firebasePut(env, 'config/logs', logs);
  } catch (e) { console.error('logToFirebase error:', e); }
}

async function resetBot(url, env, corsHeaders) {
  const bot = parseInt(url.searchParams.get('bot') || '1');
  const sfx = botSuffix(bot);
  const keys = ['access_token', 'refresh_token', 'expires_at', 'bot_login', 'bot_display', 'bot_id'];
  for (const k of keys) await env.KV.delete(k + sfx);
  await logToFirebase(env, 'worker', 'warn', 'Bot #' + bot + ' KV reset');
  return json({ ok: true, bot }, 200, corsHeaders);
}

async function getLogs(env, corsHeaders) {
  const logs = await firebaseGet(env, 'config/logs');
  return json(Array.isArray(logs) ? logs.reverse() : [], 200, corsHeaders);
}

async function monitorStreams(env) {
  const now = Date.now();
  const d = new Date();
  const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  let members = null;
  if (env.FIREBASE_DB_SECRET) {
    try {
      const users = await firebaseGet(env, 'twitch-users');
      if (users) {
        members = Object.entries(users)
          .filter(([, u]) => u.roles && (u.roles.squad || u.roles.academy))
          .map(([login, u]) => ({ login, id: u.twitchId }));
      }
    } catch (e) { console.error('firebase squad read error:', e); }
  }

  if (!members || members.length === 0) {
    console.log('No squad list — set FIREBASE_DB_SECRET to read from Firebase');
    return [];
  }

  const token = await getToken(env);
  const results = [];
  const cacheUpdates = {};

  for (const member of members) {
    try {
      let userId = member.id;
      if (!userId) {
        const uRes = await fetch(TWITCH_API + '/users?login=' + member.login, {
          headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': env.BOT_CLIENT_ID },
        });
        const uData = await uRes.json();
        if (!uData.data?.[0]) continue;
        userId = uData.data[0].id;
        member.id = userId;
      }

      const sRes = await fetch(TWITCH_API + '/streams?user_id=' + userId, {
        headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': env.BOT_CLIENT_ID },
      });
      const sData = await sRes.json();
      const stream = sData.data?.[0];

      const wasLive = await env.KV.get('live_' + member.login);
      const peakKey = 'peak_' + member.login;
      const startedKey = 'started_' + member.login;

      if (stream) {
        const viewers = stream.viewer_count;
        const durationMins = Math.round((now - new Date(stream.started_at).getTime()) / 60000);
        const startedAt = stream.started_at;

        let peakViewers = parseInt(await env.KV.get(peakKey) || '0');
        if (viewers > peakViewers) {
          peakViewers = viewers;
          await env.KV.put(peakKey, String(peakViewers));
        }

        if (!wasLive) {
          await env.KV.put('live_' + member.login, '1');
          await env.KV.put(startedKey, startedAt);
        }

        const chunk = {
          viewers,
          peakViewers,
          durationMins,
          game: stream.game_name || 'unknown',
          title: stream.title || '',
          language: stream.language || '',
          updatedAt: now,
          startedAt,
          online: true,
        };

        const chunkPath = 'stream-chunks/' + member.login + '/' + dateStr + '/' + now;
        await firebasePatch(env, chunkPath, chunk);

        cacheUpdates['stream-cache/' + member.login] = {
          game: stream.game_name || 'unknown',
          title: stream.title || '',
          startedAt,
          viewers,
          peakViewers,
          live: true,
          updatedAt: now,
        };

        results.push({ login: member.login, online: true, viewers, peakViewers, game: stream.game_name, durationMins });

        try {
          const bot2Token = await getToken(env, 2);
          if (bot2Token) {
            const bot2Id = await env.KV.get('bot_id_2');
            if (bot2Id && bot2Id !== userId) {
              await fetch(TWITCH_API + '/chat/chatters?broadcaster_id=' + userId + '&moderator_id=' + bot2Id + '&first=1', {
                headers: { 'Authorization': 'Bearer ' + bot2Token, 'Client-Id': env.BOT_CLIENT_ID },
              });
            }
          }
        } catch (e) {}
      } else {
        if (wasLive) {
          const startedAt = await env.KV.get(startedKey);
          if (startedAt) {
            const finalDuration = Math.round((now - new Date(startedAt).getTime()) / 60000);
            await firebasePatch(env, 'stream-chunks/' + member.login + '/' + dateStr + '/' + now, {
              viewers: 0, peakViewers: parseInt(await env.KV.get(peakKey) || '0'),
              durationMins: finalDuration, online: false, endedAt: now, updatedAt: now,
            });
          }
          await env.KV.delete('live_' + member.login);
          await env.KV.delete(peakKey);
          await env.KV.delete(startedKey);
        }

        cacheUpdates['stream-cache/' + member.login] = { live: false, updatedAt: now };
        results.push({ login: member.login, online: false });
      }
    } catch (e) {
      await logToFirebase(env, 'worker', 'error', 'monitorStreams member failed: ' + member.login + ' — ' + e.message);
      console.error('monitor error for ' + member.login + ':', e);
      results.push({ login: member.login, error: e.message });
    }
  }

  if (Object.keys(cacheUpdates).length) {
    await firebasePatch(env, '', cacheUpdates);
  }
  await firebasePatch(env, 'stream-cache/_monitor', { lastRun: now, results });

  console.log('Monitor results:', JSON.stringify(results));
  return results;
}

async function getBotTokenForLurker(url, env, corsHeaders) {
  const bot = parseInt(url.searchParams.get('bot') || '1');
  const sfx = botSuffix(bot);
  try {
    const token = await getToken(env, bot);
    const login = await env.KV.get('bot_login' + sfx);
    const display = await env.KV.get('bot_display' + sfx);
    const id = await env.KV.get('bot_id' + sfx);
    await logToFirebase(env, 'worker', 'info', 'Lurker token requested bot=' + bot + ' login=' + (login || '?'));
    return json({ token, login, display, id, bot, client_id: env.BOT_CLIENT_ID }, 200, corsHeaders);
  } catch (e) {
    await logToFirebase(env, 'worker', 'error', 'Lurker token failed bot=' + bot + ': ' + e.message);
    return json({ error: e.message, bot }, 400, corsHeaders);
  }
}

async function trackerSummary(url, env, corsHeaders) {
  const login = url.searchParams.get('login');
  if (login) {
    const r = await fetch('https://twitchtracker.com/api/channels/summary/' + login);
    const data = r.ok ? await r.json() : {};
    if (r.ok && Object.keys(data).length && env.FIREBASE_DB_SECRET) {
      await firebasePatch(env, 'twitch-tracker/' + login, { ...data, updatedAt: Date.now() });
    }
    return json(data, r.status, corsHeaders);
  }
  if (!env.FIREBASE_DB_SECRET) return json({ error: 'no firebase' }, 400, corsHeaders);
  const cached = await firebaseGet(env, 'twitch-tracker');
  return json(cached || {}, 200, corsHeaders);
}

async function fetchTrackerData(env) {
  const lastRun = parseInt(await env.KV.get('tracker_last_run') || '0');
  if (Date.now() - lastRun < 86400000) return null;

  let members = [];
  if (env.FIREBASE_DB_SECRET) {
    try {
      const users = await firebaseGet(env, 'twitch-users');
      if (users) {
        members = Object.entries(users)
          .filter(([, u]) => u.roles && (u.roles.squad || u.roles.academy))
          .map(([login]) => login);
      }
    } catch (e) { console.error('firebase read error:', e); }
  }
  if (!members.length) return [];

  const results = {};
  for (const login of members) {
    try {
      const r = await fetch('https://twitchtracker.com/api/channels/summary/' + login);
      if (r.ok) {
        const data = await r.json();
        if (Object.keys(data).length) results[login] = { ...data, updatedAt: Date.now() };
      }
    } catch (e) { console.error('tracker error for ' + login + ':', e); }
  }

  if (Object.keys(results).length && env.FIREBASE_DB_SECRET) {
    await firebasePatch(env, 'twitch-tracker', results);
  }
  await env.KV.put('tracker_last_run', String(Date.now()));
  console.log('Tracker results:', JSON.stringify(results));
  return results;
}

function json(data, s = 200, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: s, headers: { ...corsHeaders || CORS(''), 'Content-Type': 'application/json' },
  });
}

function html(msg, ok = false) {
  return new Response('<!DOCTYPE html><html lang="ru" style="background:#07070a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh"><body style="text-align:center;padding:20px"><h1 style="color:' + (ok ? '#4ade80' : '#ef4444') + '">' + msg + '</h1></body></html>', {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}
