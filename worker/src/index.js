const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API  = 'https://api.twitch.tv/helix';

const CLIENT_ID = 'nvbp7ivyet47jxun4efsk3v803px73';
const REDIRECT_URI = 'https://gentle-smoke-7903.konstasil777.workers.dev/api/callback';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
        case '/api/chatters': return proxy(url, env, '/chat/chatters');
        case '/api/followers': return proxy(url, env, '/channels/followers');
        default: return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
  async scheduled(_event, env) {
    await getToken(env);
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
      client_id: CLIENT_ID, client_secret: env.CLIENT_SECRET,
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
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': CLIENT_ID },
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
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'moderator:read:chatters+moderator:read:followers',
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
      client_id: CLIENT_ID, client_secret: env.CLIENT_SECRET,
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
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': CLIENT_ID },
  });
  return json(await r.json(), r.status);
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
