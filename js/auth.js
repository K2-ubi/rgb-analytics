let TG_PROXY_URL = '/api/telegram';
let _tgChatIds = [];
let _botConfig = null;
let _botConfigTime = 0;
let _botInfoCache = null;
let _botInfoTime = 0;
let _ipCache = null;
let _workerUrl = null;

async function getWorkerUrl() {
  if (_workerUrl) return _workerUrl;
  const cfg = await getBotConfig();
  _workerUrl = cfg.workerUrl ? cfg.workerUrl.replace(/\/$/, '') : null;
  return _workerUrl;
}

async function twitchApiFetch(path, params) {
  const wu = await getWorkerUrl();
  if (wu) {
    const url = wu + '/api/twitch/' + path + (params ? '?' + new URLSearchParams(params) : '');
    const res = await fetch(url);
    return res.ok ? res.json() : null;
  }
  const token = localStorage.getItem('twitchAccessToken');
  if (!token) return null;
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const res = await fetch('https://api.twitch.tv/helix/' + path + qs, {
    headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID }
  });
  return res.ok ? res.json() : null;
}

async function getTgChatIds() {
  if (_tgChatIds.length) return _tgChatIds;
  try {
    const snap = await db.ref('config/tg-chat-id').once('value');
    const raw = snap.val() || '';
    _tgChatIds = raw.split(/[\s,;]+/).filter(Boolean);
    return _tgChatIds;
  } catch { return []; }
}

async function getTgProxyUrl() {
  try {
    const snap = await db.ref('config/tg-proxy-url').once('value');
    return snap.val() || '/api/telegram';
  } catch { return '/api/telegram'; }
}

async function getBotConfig() {
  if (_botConfig && Date.now() - _botConfigTime < BOT_CACHE_TTL) return _botConfig;
  try {
    const snap = await db.ref('config/bot').once('value');
    _botConfig = snap.val() || {};
    _botConfigTime = Date.now();
  } catch (e) { _botConfig = {}; }
  return _botConfig;
}

async function getBotHeaders() {
  const cfg = await getBotConfig();
  if (cfg.token) return { 'Authorization': 'Bearer ' + cfg.token, 'Client-Id': cfg.clientId || TWITCH_CLIENT_ID };
  return null;
}

async function getBotWorkerUrl() {
  const cfg = await getBotConfig();
  return cfg.workerUrl || null;
}

async function getWorkerBotInfo() {
  const workerUrl = await getBotWorkerUrl();
  if (!workerUrl) return null;
  if (_botInfoCache && Date.now() - _botInfoTime < BOT_INFO_TTL) return _botInfoCache;
  try {
    const res = await fetch(workerUrl + '/api/status');
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.configured) return null;
    _botInfoCache = { configured: true, login: d.bot_login, display: d.bot_display, id: null, token: null };
    _botInfoTime = Date.now();
    return _botInfoCache;
  } catch { return null; }
}

async function getBotToken() {
  const info = await getWorkerBotInfo();
  if (info && info.token) return { token: info.token, id: info.id, login: info.login, display: info.display, clientId: info.client_id };
  const cfg = await getBotConfig();
  if (cfg.token) return { token: cfg.token, id: null, login: null, display: null, clientId: cfg.clientId };
  return null;
}

async function getIP() {
  if (_ipCache) return _ipCache;
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const d = await r.json();
    _ipCache = d.ip;
    return _ipCache;
  } catch { return 'unknown'; }
}

async function callTgApi(action, payload) {
  const res = await fetch(TG_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  if (!res.ok) throw new Error('Telegram API error: ' + res.status);
  return res.json();
}

async function sendErrorToTelegram(error, context) {
  if (!_tgChatIds.length) return;
  try {
    const ip = await getIP();
    const loc = getErrorLocation(error);
    const msg = error?.message || String(error || 'Script error');
    const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' (МСК)';
    const user = currentTwitchUser?.login || 'гость';
    const url = window.location.hostname + window.location.pathname;
    const text = [
      '❌ ОШИБКА НА САЙТЕ', '',
      msg.length > 100 ? msg.slice(0, 100) + '…' : msg,
      '📍 ' + loc, '🕐 ' + time, '👤 ' + user, '🌐 IP: ' + ip, '🔗 ' + url
    ].join('\n');
    for (const chatId of _tgChatIds) {
      await callTgApi('sendMessage', { chat_id: chatId, text });
    }
  } catch (e) { console.warn('Telegram error report failed:', e); }
}

function twitchLogin() {
  if (!TWITCH_CLIENT_ID) {
    document.getElementById('twitchStatus').textContent = 'Twitch Client ID не настроен';
    return;
  }
  const redirect = encodeURIComponent(window.location.href.split('#')[0]);
  window.location.href = 'https://id.twitch.tv/oauth2/authorize?client_id=' + TWITCH_CLIENT_ID + '&redirect_uri=' + redirect + '&response_type=token&scope=moderator:read:followers+moderator:read:chatters+channel:read:subscriptions&force_verify=true';
}

function logout() {
  const adminData = localStorage.getItem('adminOriginalData');
  if (adminData) { restoreAdminAccount(); return; }
  if (typeof clearRouteCache === 'function') clearRouteCache();
  localStorage.removeItem('twitchAccessToken');
  localStorage.removeItem('twitchUserLogin');
  localStorage.removeItem('twitchUserRoles');
  localStorage.removeItem('twitchUserDisplayName');
  localStorage.removeItem('twitchUserAvatar');
  localStorage.removeItem('twitchUserCacheTime');
  localStorage.removeItem('twitchUserId');
  localStorage.removeItem('modReminderDismissed');
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('adminOriginalData');
  currentTwitchUser = null;
  currentUserRoles = {};
  cachedUsers = null;
  document.getElementById('app').classList.remove('authorized');
  document.getElementById('authBlock').style.display = 'flex';
  const p = document.getElementById('adminPanel');
  if (p) p.remove();
  const b = document.getElementById('adminNavBtn');
  if (b) b.remove();
  updateSquadNavButton();
  history.pushState(null, '', '/');
}

function restoreSession() {
  const login = localStorage.getItem('twitchUserLogin');
  const roles = localStorage.getItem('twitchUserRoles');
  const displayName = localStorage.getItem('twitchUserDisplayName');
  const avatar = localStorage.getItem('twitchUserAvatar');
  const id = localStorage.getItem('twitchUserId');
  if (login && roles) {
    currentUserRoles = JSON.parse(roles) || {};
    currentTwitchUser = {
      login,
      display_name: displayName || login,
      profile_image_url: avatar || '',
      description: '',
      id: id || ''
    };
    return true;
  }
  return false;
}

function saveSession(twitchUser, roles) {
  localStorage.setItem('twitchUserLogin', twitchUser.login);
  localStorage.setItem('twitchUserRoles', JSON.stringify(roles));
  localStorage.setItem('twitchUserDisplayName', twitchUser.display_name);
  localStorage.setItem('twitchUserAvatar', twitchUser.profile_image_url);
  localStorage.setItem('twitchUserId', twitchUser.id);
}

async function checkBanned(login) {
  try {
    const snap = await db.ref('config/bans').once('value');
    const bans = snap.val() || {};
    if (bans.users && bans.users[(login || '').toLowerCase()]) return true;
    if (bans.ips) {
      const ip = await getIP();
      if (bans.ips[ip.replace(/\./g, '_')]) return true;
    }
  } catch (e) {}
  return false;
}

async function checkTwitchAuth() {
  if (localStorage.getItem('isImpersonating') === 'true') return restoreSession();
  const hash = window.location.hash.substring(1);
  let token = null;
  if (hash) {
    const params = new URLSearchParams(hash);
    token = params.get('access_token');
    if (token) {
      localStorage.setItem('twitchAccessToken', token);
      window.location.hash = '';
      history.replaceState(null, '', window.location.pathname);
    }
  }
  if (!token) token = localStorage.getItem('twitchAccessToken');
  if (!token) return false;

  try {
    const res = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID }
    });
    if (!res.ok) { localStorage.removeItem('twitchAccessToken'); return false; }
    const data = await res.json();
    const twitchUser = data.data[0];
    if (!twitchUser) return false;

    currentTwitchUser = twitchUser;

    const banned = await checkBanned(twitchUser.login);
    if (banned) { navigate('/banned', true); return false; }

    const snap = await db.ref('twitch-users/' + twitchUser.login.toLowerCase()).once('value');
    const userData = snap.val();
    if (!userData) {
      document.getElementById('authBlock').innerHTML =
        '<div class="logo" style="width:80px;height:80px;"></div>' +
        '<h1 style="font-size:24px;text-align:center;">Мне кажется<br>Вам сюда нельзя</h1>' +
        '<p class="muted" style="text-align:center;max-width:300px;">Ваш Twitch аккаунт <b>' + twitchUser.login + '</b> не найден в базе RGB Network.</p>' +
        '<button class="btn" onclick="navigate(\'/\')">Назад</button>';
      return false;
    }

    currentUserRoles = userData.roles || {};
    if (userData.role && !currentUserRoles[userData.role]) currentUserRoles[userData.role] = true;
    saveSession(twitchUser, currentUserRoles);

    await db.ref('twitch-users/' + twitchUser.login.toLowerCase()).update({
      twitchId: twitchUser.id,
      displayName: twitchUser.display_name,
      profileImageUrl: twitchUser.profile_image_url,
      description: twitchUser.description || '',
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    });

    return true;
  } catch (e) { console.warn('Twitch API error:', e); return false; }
}

function showBugReport() {
  const overlay = document.getElementById('bugReportOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  document.getElementById('bugDescription').value = '';
  document.getElementById('bugScreenshot').value = '';
  document.getElementById('bugReportStatus').textContent = '';
  document.getElementById('bugSubmitBtn').disabled = false;
  document.getElementById('bugSubmitBtn').textContent = '📤 Отправить';
  const devEl = document.getElementById('bugDeviceInfo');
  devEl.textContent = collectDeviceInfo() + '\nIP: запрос...';
}

function closeBugReport() {
  const overlay = document.getElementById('bugReportOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function submitBugReport() {
  const desc = document.getElementById('bugDescription').value.trim();
  if (!desc) { document.getElementById('bugReportStatus').textContent = '❌ Опиши проблему'; return; }
  const btn = document.getElementById('bugSubmitBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Отправка...';
  const status = document.getElementById('bugReportStatus');
  status.textContent = '';
  const chatIds = await getTgChatIds();
  if (!chatIds.length) {
    status.textContent = '❌ Telegram Chat ID не настроен (Admin → Telegram)';
    btn.disabled = false; btn.textContent = '📤 Отправить'; return;
  }
  const devInfo = document.getElementById('bugDeviceInfo').textContent;
  const text = '🐛 <b>Баг-репорт</b>\n\n<b>Описание:</b>\n' + desc.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '\n\n<b>Устройство:</b>\n<code>' + devInfo.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code>';
  const sendToAll = async (fn) => { for (const cid of chatIds) { try { await fn(cid); } catch (e) { console.error('Send to', cid, 'failed:', e); } } };
  try {
    const fileInput = document.getElementById('bugScreenshot');
    const file = fileInput?.files?.[0];
    if (file) {
      await sendToAll(async (cid) => {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve) => { reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
        await callTgApi('sendPhoto', { chat_id: cid, photo: dataUrl, caption: text.slice(0, 1024), parse_mode: 'HTML' });
        if (text.length > 1024) await callTgApi('sendMessage', { chat_id: cid, text: '📎 <b>Продолжение:</b>\n' + text.slice(1024, 4096), parse_mode: 'HTML' });
      });
    } else {
      await sendToAll(async (cid) => { await callTgApi('sendMessage', { chat_id: cid, text: text.slice(0, 4096), parse_mode: 'HTML' }); });
    }
    status.textContent = '✅ Отправлено ' + chatIds.length + ' получателям! Спасибо!';
    btn.textContent = '✅ Отправлено';
    setTimeout(closeBugReport, 2000);
  } catch (e) { status.textContent = '❌ Ошибка: ' + e.message; btn.disabled = false; btn.textContent = '📤 Отправить'; }
}

const LOCALHOST_PASSWORD_KEY = 'localhostPass';
const LOCALHOST_USER_KEY = 'localhostUser';

async function getLocalhostPass() {
  try { const snap = await db.ref('config/localhost-password').once('value'); return snap.val() || ''; } catch { return ''; }
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'I') { window._ctrlIPending = true; setTimeout(() => window._ctrlIPending = false, 1000); }
  if (window._ctrlIPending && e.key === '9') { window._ctrlIPending = false; e.preventDefault(); showLocalhostLogin(); }
});

function showLocalhostLogin() {
  const existing = document.getElementById('localhostModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'localhostModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center';
  modal.innerHTML =
    '<div style="background:#1a1a2e;border:1px solid rgba(168,85,247,.3);border-radius:24px;padding:32px;width:360px;max-width:90vw">' +
    '<h2 style="margin-bottom:8px">🔐 Localhost Login</h2>' +
    '<p class="muted" style="font-size:13px;margin-bottom:20px">Для тестирования без Twitch OAuth</p>' +
    '<input type="text" id="llLogin" placeholder="Twitch логин" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:rgba(0,0,0,.3);color:white;margin-bottom:12px">' +
    '<input type="password" id="llPass" placeholder="Пароль (из админки)" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:rgba(0,0,0,.3);color:white;margin-bottom:20px">' +
    '<div style="display:flex;gap:10px"><button class="btn primary" onclick="doLocalhostLogin()" style="flex:1">Войти</button><button class="btn" onclick="this.closest(\'#localhostModal\').remove()" style="flex:1">Отмена</button></div>' +
    '<p id="llError" class="muted" style="font-size:12px;margin-top:12px;text-align:center"></p></div>';
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('llLogin')?.focus(), 100);
}

async function doLocalhostLogin() {
  const login = document.getElementById('llLogin').value.trim().toLowerCase();
  const pass = document.getElementById('llPass').value.trim();
  const err = document.getElementById('llError');
  if (!login || !pass) { err.textContent = 'Заполни оба поля'; return; }
  try {
    const correctPass = await getLocalhostPass();
    if (pass !== correctPass) { err.textContent = '❌ Неверный пароль'; return; }
    const userSnap = await db.ref('twitch-users/' + login).once('value');
    const userData = userSnap.val();
    if (!userData) { err.textContent = '❌ Пользователь не найден в базе'; return; }
    currentTwitchUser = { login: login, display_name: userData.displayName || login, profile_image_url: userData.profileImageUrl || '', description: userData.description || '', id: userData.twitchId || login };
    currentUserRoles = userData.roles || {};
    if (userData.role && !currentUserRoles[userData.role]) currentUserRoles[userData.role] = true;
    localStorage.setItem('twitchUserLogin', login);
    localStorage.setItem('twitchUserRoles', JSON.stringify(currentUserRoles));
    localStorage.setItem('twitchUserDisplayName', currentTwitchUser.display_name);
    localStorage.setItem('twitchUserAvatar', currentTwitchUser.profile_image_url || '');
    localStorage.setItem('twitchUserId', currentTwitchUser.id);
    document.getElementById('localhostModal').remove();
    const app = document.getElementById('app');
    app.classList.add('authorized');
    document.getElementById('authBlock').style.display = 'none';
    renderSidebarUser();
    renderAdminButton();
    updateSquadNavButton();
    checkBotModeratorStatus();
    navigate('/dashboard', true);
  } catch (e) { err.textContent = '❌ Ошибка: ' + e.message; }
}

async function checkBotModeratorStatus() {
  if (!currentTwitchUser?.id) return;
  if (!currentUserRoles?.squad && !currentUserRoles?.academy) return;
  const dismissed = localStorage.getItem('modReminderDismissed');
  if (dismissed) { const t = parseInt(dismissed, 10); if (!isNaN(t) && Date.now() - t < 3 * 86400000) return; }
  const bot = await getBotToken();
  if (!bot || !bot.id) return;
  try {
    const wu = await getWorkerUrl();
    if (wu) {
      const r = await fetch(wu + '/api/twitch/chatters?broadcaster_id=' + currentTwitchUser.id + '&first=1');
      if (r.ok) return;
    } else {
      const r = await fetch('https://api.twitch.tv/helix/chat/chatters?broadcaster_id=' + currentTwitchUser.id + '&moderator_id=' + bot.id + '&first=1', {
        headers: { 'Authorization': 'Bearer ' + bot.token, 'Client-Id': bot.clientId || TWITCH_CLIENT_ID }
      });
      if (r.ok) return;
    }
  } catch (e) {}
  showModReminder(bot);
}

function showModReminder(bot) {
  const existing = document.getElementById('modReminderModal');
  if (existing) existing.remove();
  const botName = bot?.login || bot?.display || 'rgbsquad_bot';
  const modal = document.createElement('div');
  modal.id = 'modReminderModal';
  modal.className = 'mod-modal';
  modal.innerHTML =
    '<div class="mod-modal-box">' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
    '<span style="font-size:28px">🤖</span>' +
    '<div><h2>Требуется модератор</h2><p class="muted" style="font-size:13px;margin-bottom:0">' + botName + '</p></div></div>' +
    '<p>Для стабильной и правильной работы сервиса сделайте <b>' + botName + '</b> модератором канала.<br><br>' +
    'Это нужно чтобы бот мог читать чат и анализировать зрителей вашего канала.<br><br>' +
    '<span style="font-size:13px;color:rgba(255,255,255,.5)">Команда в чате: <code style="background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px">/mod ' + botName + '</code></span></p>' +
    '<label><input type="checkbox" id="modRemindCheck"> Напомнить позже (через 3 дня или после выхода)</label>' +
    '<div style="display:flex;gap:10px"><button class="btn primary" onclick="dismissModReminder(true)" style="flex:1">Пропустить</button></div></div>';
  document.body.appendChild(modal);
}

function dismissModReminder(remindLater) {
  const cb = document.getElementById('modRemindCheck');
  if (remindLater && cb && cb.checked) localStorage.setItem('modReminderDismissed', String(Date.now()));
  const modal = document.getElementById('modReminderModal');
  if (modal) modal.remove();
}

function isImpersonating() {
  return localStorage.getItem('isImpersonating') === 'true';
}

async function showSimulateLogin() {
  const existing = document.getElementById('simulateModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'simulateModal';
  modal.className = 'mod-modal';
  modal.innerHTML =
    '<div class="mod-modal-box">' +
    '<h2>🔄 Симуляция входа</h2>' +
    '<p>Войди под другим пользователем чтобы увидеть что видит он. Для возврата нажми «Вернуться на свой аккаунт» в сайдбаре или выйди и зайди снова.</p>' +
    '<div style="display:grid;gap:12px">' +
    '<input type="text" id="simulateLoginInput" placeholder="Twitch логин пользователя" onkeydown="if(event.key===\'Enter\')doSimulateLogin()" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">' +
    '<div style="display:flex;gap:10px"><button class="btn primary" onclick="doSimulateLogin()" style="flex:1">🔀 Войти как</button><button class="btn" onclick="document.getElementById(\'simulateModal\').remove()">Отмена</button></div>' +
    '<div id="simulateStatus" class="muted" style="font-size:13px;text-align:center"></div></div></div>';
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('simulateLoginInput')?.focus(), 100);
}

async function doSimulateLogin() {
  const input = document.getElementById('simulateLoginInput');
  const status = document.getElementById('simulateStatus');
  const username = input?.value.trim().toLowerCase();
  if (!username) { status.textContent = '❌ Введи логин'; return; }
  status.textContent = '⏳ Загрузка...';
  try {
    const snap = await db.ref('twitch-users/' + username).once('value');
    const userData = snap.val();
    if (!userData) { status.textContent = '❌ Пользователь не найден в базе'; return; }
    const adminInfo = {
      token: localStorage.getItem('twitchAccessToken') || '',
      login: currentTwitchUser?.login || '',
      displayName: currentTwitchUser?.display_name || '',
      avatar: currentTwitchUser?.profile_image_url || '',
      id: currentTwitchUser?.id || '',
      roles: currentUserRoles || {}
    };
    localStorage.setItem('adminOriginalData', JSON.stringify(adminInfo));
    const roles = userData.roles || {};
    if (userData.role && !roles[userData.role]) roles[userData.role] = true;
    localStorage.setItem('twitchUserLogin', username);
    localStorage.setItem('twitchUserRoles', JSON.stringify(roles));
    localStorage.setItem('twitchUserDisplayName', userData.displayName || username);
    localStorage.setItem('twitchUserAvatar', userData.profileImageUrl || '');
    localStorage.setItem('twitchUserId', userData.twitchId || username);
    localStorage.setItem('isImpersonating', 'true');
    status.textContent = '✅ Вхожу как @' + username + '...';
    setTimeout(() => location.reload(), 500);
  } catch (e) { status.textContent = '❌ Ошибка: ' + e.message; }
}

function restoreAdminAccount() {
  const raw = localStorage.getItem('adminOriginalData');
  if (!raw) return;
  try {
    const admin = JSON.parse(raw);
    localStorage.removeItem('isImpersonating');
    localStorage.removeItem('adminOriginalData');
    if (admin.token) localStorage.setItem('twitchAccessToken', admin.token);
    else localStorage.removeItem('twitchAccessToken');
    localStorage.setItem('twitchUserLogin', admin.login);
    localStorage.setItem('twitchUserRoles', JSON.stringify(admin.roles));
    localStorage.setItem('twitchUserDisplayName', admin.displayName);
    localStorage.setItem('twitchUserAvatar', admin.avatar);
    localStorage.setItem('twitchUserId', admin.id);
    location.reload();
  } catch (e) { console.error('Restore admin error:', e); location.reload(); }
}

window.onerror = function (msg, source, line, col, error) { sendErrorToTelegram(error || msg); };
window.addEventListener('unhandledrejection', function (e) { sendErrorToTelegram(e.reason); });
