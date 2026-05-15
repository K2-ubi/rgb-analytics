const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API  = 'https://api.twitch.tv/helix';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/api/auth':       return auth(env);
        case '/api/callback':   return callback(url, env);
        case '/api/status':     return status(env);
        case '/api/refresh':    return refresh(env);
        case '/api/chatters':   return proxy(url, env, '/chat/chatters');
        case '/api/followers':  return proxy(url, env, '/channels/followers');
        default:                return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },

  // Cron: refresh token every 3 hours
  async scheduled(_event, env) {
    await getToken(env);
  },
};

// ─── Token Management ─────────────────────────────────────────────

async function getToken(env) {
  let at = await env.KV.get('access_token');
  const exp = parseInt(await env.KV.get('expires_at') || '0');
  if (at && Date.now() < exp - 120000) return at; // 2 min buffer

  const rt = await env.KV.get('refresh_token');
  if (!rt) throw new Error('No refresh token. Open /api/auth in browser');

  const r = await fetch(TWITCH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: rt,
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Refresh failed: ' + (d.message || r.status));

  await env.KV.put('access_token', d.access_token);
  await env.KV.put('refresh_token', d.refresh_token);
  await env.KV.put('expires_at', String(Date.now() + (d.expires_in || 14400) * 1000));
  await saveBotInfo(env, d.access_token);
  return d.access_token;
}

async function saveBotInfo(env, token) {
  if (await env.KV.get('bot_login')) return;
  const r = await fetch(TWITCH_API + '/users', {
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': env.CLIENT_ID },
  });
  const d = await r.json();
  if (d.data?.[0]) {
    await env.KV.put('bot_login',   d.data[0].login);
    await env.KV.put('bot_display', d.data[0].display_name);
    await env.KV.put('bot_id',      d.data[0].id);
  }
}

// ─── OAuth Flow ───────────────────────────────────────────────────

async function auth(env) {
  const state = crypto.randomUUID();
  await env.KV.put('oauth_state', state, { expirationTtl: 300 });
  const p = new URLSearchParams({
    client_id: env.CLIENT_ID,
    redirect_uri: env.REDIRECT_URI,
    response_type: 'code',
    scope: 'moderator:read:chatters+moderator:read:followers',
    state, force_verify: 'true',
  });
  return Response.redirect('https://id.twitch.tv/oauth2/authorize?' + p, 302);
}

async function callback(url, env) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stored = await env.KV.get('oauth_state');
  if (state !== stored) return html('Ошибка: state не совпадает. Попробуй снова.');
  if (!code) return html('Ошибка: ' + (url.searchParams.get('error') || 'unknown'));

  const r = await fetch(TWITCH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET,
      code, grant_type: 'authorization_code',
      redirect_uri: env.REDIRECT_URI,
    }),
  });
  const d = await r.json();
  if (!r.ok) return html('Ошибка обмена кода: ' + (d.message || r.status));

  await env.KV.put('access_token',  d.access_token);
  await env.KV.put('refresh_token', d.refresh_token);
  await env.KV.put('expires_at', String(Date.now() + (d.expires_in || 14400) * 1000));
  await saveBotInfo(env, d.access_token);

  const login = await env.KV.get('bot_display') || await env.KV.get('bot_login') || 'бот';
  return html('✅ Бот <b>' + login + '</b> авторизован!<br><span style="color:rgba(255,255,255,.45);font-size:14px">Можешь закрыть окно и вернуться в админку → нажать "Проверить"</span>', true);
}

// ─── API Proxy ────────────────────────────────────────────────────

async function proxy(url, env, path) {
  const token = await getToken(env);
  // Forward all query params except worker-specific ones
  const q = new URLSearchParams(url.search);
  const target = TWITCH_API + path + '?' + q;
  const r = await fetch(target, {
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': env.CLIENT_ID },
  });
  const data = await r.json();
  return json(data, r.status);
}

// ─── Status / Refresh ─────────────────────────────────────────────

async function status(env) {
  const at = await env.KV.get('access_token');
  const exp = parseInt(await env.KV.get('expires_at') || '0');
  return json({
    configured: !!at,
    bot_login:   await env.KV.get('bot_login'),
    bot_display: await env.KV.get('bot_display'),
    expires_at: exp,
    expires_in: Math.max(0, Math.floor((exp - Date.now()) / 1000)),
  });
}

async function refresh(env) {
  await getToken(env);
  return status(env);
}

// ─── Helpers ──────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function html(msg, ok = false) {
  const c = ok ? '#4ade80' : '#ef4444';
  return new Response(`<!DOCTYPE html>
<html lang="ru" style="background:#07070a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh">
<body style="text-align:center;padding:20px"><h1 style="color:${c}">${msg}</h1></body>
</html>`, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}
