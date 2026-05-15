const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API  = 'https://api.twitch.tv/helix';
const TWITCH_CLIENT_ID = 'nvbp7ivyet47jxun4efsk3v803px73';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, POST',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/api/auth': return auth();
        case '/api/callback': return callback(url, env);
        case '/api/status': return status(env);
        case '/api/bot-info': return botInfo(env);
        case '/api/monitor-streams': return monitorStreams(env);
        case '/api/tracker-summary': return trackerSummary(url, env);
        default: return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
  async scheduled(_event, env) {
    await getToken(env);
    await monitorStreams(env);
    await fetchTrackerData(env);
  },
};

async function getToken(env) {
  let at = await env.KV.get('access_token');
  const exp = parseInt(await env.KV.get('expires_at') || '0');
  if (at && Date.now() < exp - 120000) return at;
  const rt = await env.KV.get('refresh_token');
  if (!rt) throw new Error('No refresh token. Open /api/auth');
  const r = await fetch(TWITCH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token', refresh_token: rt,
      client_id: TWITCH_CLIENT_ID, client_secret: env.CLIENT_SECRET,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Refresh failed: ' + (d.message || r.status));
  await env.KV.put('access_token', d.access_token);
  await env.KV.put('refresh_token', d.refresh_token);
  await env.KV.put('expires_at', String(Date.now() + (d.expires_in || 14400) * 1000));
  await saveInfo(env, d.access_token);
  return d.access_token;
}

async function saveInfo(env, token) {
  if (await env.KV.get('bot_login')) return;
  const r = await fetch(TWITCH_API + '/users', {
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID },
  });
  const d = await r.json();
  if (d.data?.[0]) {
    await env.KV.put('bot_login', d.data[0].login);
    await env.KV.put('bot_display', d.data[0].display_name);
    await env.KV.put('bot_id', d.data[0].id);
  }
}

function auth() {
  const p = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'moderator:read:chatters moderator:read:followers',
    force_verify: 'true',
  });
  return Response.redirect('https://id.twitch.tv/oauth2/authorize?' + p, 302);
}

async function callback(url, env) {
  const code = url.searchParams.get('code');
  if (!code) return html('Ошибка: ' + (url.searchParams.get('error') || 'unknown'));
  const r = await fetch(TWITCH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: TWITCH_CLIENT_ID, client_secret: env.CLIENT_SECRET,
      code, grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  const d = await r.json();
  if (!r.ok) return html('Ошибка: ' + (d.message || r.status));
  await env.KV.put('access_token', d.access_token);
  await env.KV.put('refresh_token', d.refresh_token);
  await env.KV.put('expires_at', String(Date.now() + (d.expires_in || 14400) * 1000));
  await saveInfo(env, d.access_token);
  const login = await env.KV.get('bot_display') || await env.KV.get('bot_login') || 'бот';
  return html(login + ' ✅ авторизован!<br><span style="font-size:14px">Закрой окно → в админке нажми Статус</span>', true);
}

async function proxy(url, env, path) {
  const token = await getToken(env);
  const q = new URLSearchParams(url.search);
  const r = await fetch(TWITCH_API + path + '?' + q, {
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID },
  });
  return json(await r.json(), r.status);
}

async function proxyAsBot(url, env, path) {
  const token = await getToken(env);
  const q = new URLSearchParams(url.search);
  const botId = await env.KV.get('bot_id');
  if (botId) q.set('moderator_id', botId);
  const r = await fetch(TWITCH_API + path + '?' + q, {
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID },
  });
  return json(await r.json(), r.status);
}

async function botInfo(env) {
  const token = await getToken(env);
  return json({
    token,
    client_id: TWITCH_CLIENT_ID,
    login: await env.KV.get('bot_login'),
    display: await env.KV.get('bot_display'),
    id: await env.KV.get('bot_id'),
    expires_at: parseInt(await env.KV.get('expires_at') || '0'),
  });
}

async function status(env) {
  const exp = parseInt(await env.KV.get('expires_at') || '0');
  return json({
    configured: !!(await env.KV.get('access_token')),
    bot_login: await env.KV.get('bot_login'),
    bot_display: await env.KV.get('bot_display'),
    expires_at: exp,
    expires_in: Math.max(0, Math.floor((exp - Date.now()) / 1000)),
  });
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

async function monitorStreams(env) {
  const now = Date.now();
  const d = new Date();
  const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  // Get squad members list from Firebase or KV cache
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

  // Fallback: set FIREBASE_DB_SECRET secret to automatically load squad from Firebase
  //   wrangler secret put FIREBASE_DB_SECRET
  if (!members || members.length === 0) {
    console.log('No squad list — set FIREBASE_DB_SECRET to read from Firebase');
    return [];
  }

  const token = await getToken(env);
  const results = [];

  for (const member of members) {
    try {
      // Resolve Twitch user ID if not cached
      let userId = member.id;
      if (!userId) {
        const uRes = await fetch(TWITCH_API + '/users?login=' + member.login, {
          headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID },
        });
        const uData = await uRes.json();
        if (!uData.data?.[0]) continue;
        userId = uData.data[0].id;
        member.id = userId;
      }

      // Check if currently live
      const sRes = await fetch(TWITCH_API + '/streams?user_id=' + userId, {
        headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID },
      });
      const sData = await sRes.json();
      const stream = sData.data?.[0];

      if (stream) {
        const chunk = {
          viewers: stream.viewer_count,
          game: stream.game_name || 'unknown',
          title: stream.title || '',
          language: stream.language || '',
          updatedAt: now,
        };

        // Save chunk to Firebase
        const chunkPath = 'stream-chunks/' + member.login + '/' + dateStr + '/' + now;
        await firebasePatch(env, chunkPath, chunk);

        results.push({ login: member.login, online: true, viewers: stream.viewer_count, game: stream.game_name });
      } else {
        results.push({ login: member.login, online: false });
      }
    } catch (e) {
      console.error('monitor error for ' + member.login + ':', e);
      results.push({ login: member.login, error: e.message });
    }
  }

  // Update last-monitor timestamp
  await firebasePatch(env, 'stream-cache/_monitor', { lastRun: now, results });

  console.log('Monitor results:', JSON.stringify(results));
  return results;
}

async function trackerSummary(url, env) {
  const login = url.searchParams.get('login');
  if (login) {
    const r = await fetch('https://twitchtracker.com/api/channels/summary/' + login);
    const data = r.ok ? await r.json() : {};
    if (r.ok && Object.keys(data).length && env.FIREBASE_DB_SECRET) {
      await firebasePatch(env, 'twitch-tracker/' + login, { ...data, updatedAt: Date.now() });
    }
    return json(data, r.status);
  }
  // No login — return cached data for all from Firebase
  if (!env.FIREBASE_DB_SECRET) return json({ error: 'no firebase' }, 400);
  const cached = await firebaseGet(env, 'twitch-tracker');
  return json(cached || {});
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

function json(data, s = 200) {
  return new Response(JSON.stringify(data), {
    status: s, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function html(msg, ok = false) {
  return new Response('<!DOCTYPE html><html lang="ru" style="background:#07070a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh"><body style="text-align:center;padding:20px"><h1 style="color:' + (ok ? '#4ade80' : '#ef4444') + '">' + msg + '</h1></body></html>', {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}
