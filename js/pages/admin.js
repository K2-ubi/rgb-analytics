function renderAdminPanel() {
  let panel = document.getElementById('adminPanel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'adminPanel';
    panel.className = 'hidden fade';
    document.querySelector('.main').appendChild(panel);
  }
  panel.innerHTML = `
    <div class="page-card">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px">
        <span style="background:linear-gradient(135deg,#f59e0b,#ef4444);width:12px;height:12px;border-radius:50%;display:inline-block"></span>
        <h1>Admin Panel</h1>
      </div>
      <p class="muted" style="margin-bottom:24px">Управление ролями пользователей. Отметь нужные роли для пользователя.</p>
      <div style="display:grid;gap:14px;margin-bottom:24px">
        <input type="text" id="adminUsername" placeholder="Twitch username" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white;">
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;border:1px solid var(--border);background:var(--panel);cursor:pointer">
            <input type="checkbox" id="chkAdmin" value="admin"> <span style="color:#fbbf24">Admin</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;border:1px solid var(--border);background:var(--panel);cursor:pointer">
            <input type="checkbox" id="chkSquad" value="squad"> <span style="color:#4ade80">RGB-Squad</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;border:1px solid var(--border);background:var(--panel);cursor:pointer">
            <input type="checkbox" id="chkAcademy" value="academy"> <span style="color:#a855f7">RGB-Academy</span>
          </label>
        </div>
        <button class="btn primary" onclick="assignRole()">Назначить роли</button>
      </div>
      <div id="adminResult"></div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">🤖 Backend-воркер (автообновление токена)</p>
        <div style="display:grid;gap:12px">
          <input type="url" id="botWorkerUrlInput" placeholder="URL воркера, например https://rgb-bot.xxx.workers.dev" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white;font-family:monospace">
          <div style="display:flex;gap:10px">
            <button class="btn primary" onclick="saveBotConfig()">💾 Сохранить</button>
            <button class="btn" onclick="loadBotConfig()">🔄 Загрузить</button>
            <button class="btn" onclick="authBot()" id="botAuthBtn">🔑 Авторизовать бота #1</button>
            <button class="btn" onclick="checkBotStatus()">🧪 Статус #1</button>
            <button class="btn" onclick="deleteBotConfig()" style="border-color:rgba(239,68,68,.2);background:rgba(239,68,68,.08);color:#fca5a5">🗑 Сбросить</button>
          </div>
          <p class="muted" style="font-size:12px;line-height:1.5">1. Заполни URL воркера → Сохранить<br>2. Нажми <b>Авторизовать бота #1</b> — откроется Twitch. Войди как бот-аккаунт, нажми Авторизовать<br>3. Нажми <b>Статус #1</b> — должен показать логин бота и сколько живет токен</p>
          <div id="botConfigStatus" class="muted" style="font-size:13px"></div>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">🤖 Второй бот-аккаунт (продление просмотров)</p>
        <div style="display:grid;gap:12px">
          <div style="display:flex;gap:10px">
            <button class="btn primary" onclick="authBot2()">🔑 Авторизовать бота #2</button>
            <button class="btn" onclick="checkBotStatus2()">🧪 Статус #2</button>
            <button class="btn" onclick="resetBot2()" style="border-color:rgba(239,68,68,.2);background:rgba(239,68,68,.08);color:#fca5a5">🗑 Сбросить #2</button>
          </div>
          <p class="muted" style="font-size:12px;line-height:1.5">Авторизуй второй Twitch аккаунт. Воркер будет использовать его для продления серии просмотров у стримеров сквада в эфире. Авторизация через тот же воркер.</p>
          <div id="bot2ConfigStatus" class="muted" style="font-size:13px"></div>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">👁 Луркер (IRC боты в чатах)</p>
        <div style="display:grid;gap:12px">
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn" onclick="checkLurkerStatus()">🔄 Статус луркера</button>
          </div>
          <p class="muted" style="font-size:12px;line-height:1.5">Статус IRC-подключения ботов к каналам сквада и PubSub WebSocket для баллов канала.</p>
          <div id="lurkerStatus" class="muted" style="font-size:13px"></div>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border);display:none" id="botTokenSection">
        <p class="muted" style="margin-bottom:12px">🔑 Токен напрямую (если без воркера)</p>
        <div style="display:grid;gap:12px">
          <input type="password" id="botTokenInput" placeholder="Access Token бота" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white;font-family:monospace">
          <input type="text" id="botClientIdInput" placeholder="Client ID (оставь пустым — будет как у всех)" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">
          <div style="display:flex;gap:10px">
            <button class="btn" onclick="saveBotTokenDirect()">💾 Сохранить токен</button>
            <button class="btn" onclick="testBotToken()">🧪 Проверить токен</button>
          </div>
          <p class="muted" style="font-size:12px">Используй если нет Cloudflare Worker. Токен живет 4 часа, надо обновлять вручную.</p>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">🔐 Localhost-логин (Ctrl+I+9)</p>
        <div style="display:grid;gap:12px">
          <input type="text" id="localhostPassInput" placeholder="Пароль для входа через Ctrl+I+9" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">
          <div style="display:flex;gap:10px">
            <button class="btn" onclick="saveLocalhostPass()">💾 Сохранить пароль</button>
            <button class="btn" onclick="loadLocalhostPass()">🔄 Загрузить</button>
          </div>
          <div id="localhostPassStatus" class="muted" style="font-size:13px"></div>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">🤖 Telegram для баг-репортов</p>
        <div style="display:grid;gap:12px">
          <input type="text" id="tgChatIdInput" placeholder="Telegram Chat ID (несколько через запятую: 123,456)" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white;font-family:monospace">
          <input type="url" id="tgProxyUrlInput" placeholder="URL прокси для Telegram (по умолч. /api/telegram)" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white;font-family:monospace;margin-bottom:8px">
          <div style="display:flex;gap:10px">
            <button class="btn primary" onclick="saveTgConfig()">💾 Сохранить</button>
            <button class="btn" onclick="loadTgConfig()">🔄 Загрузить</button>
            <button class="btn" onclick="testTgBot()">🧪 Тест</button>
          </div>
          <p class="muted" style="font-size:12px">Укажи Telegram Chat ID, куда будут приходить баг-репорты. Можно несколько через запятую. Чтобы узнать свой ID — напиши <b>@userinfobot</b> в Telegram.</p>
          <div id="tgConfigStatus" class="muted" style="font-size:13px"></div>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">📥 Импорт CSV с SullyGnome</p>
        <div style="display:grid;gap:12px">
          <input type="text" id="sgLoginInput" placeholder="Twitch логин (например k2gemer)" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">
          <input type="file" id="sgCsvInput" accept=".csv" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">
          <button class="btn primary" onclick="importSullyGnomeCSV()">📥 Импортировать CSV</button>
          <div id="sgImportResult" class="muted" style="font-size:13px"></div>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">📋 Логи (worker/lurker/site)</p>
        <div style="display:grid;gap:10px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="logSourceFilter" style="padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:white;font-size:12px">
              <option value="">все источники</option>
              <option value="worker">worker</option>
              <option value="lurker">lurker</option>
              <option value="site">site</option>
            </select>
            <select id="logLevelFilter" style="padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:white;font-size:12px">
              <option value="">все уровни</option>
              <option value="error">❌ error</option>
              <option value="warn">⚠️ warn</option>
              <option value="info">✅ info</option>
            </select>
            <button class="btn" onclick="fetchLogs()" style="padding:6px 14px;font-size:12px">🔄 Обновить</button>
          </div>
          <div id="logsList" style="max-height:400px;overflow-y:auto;background:rgba(0,0,0,.3);border-radius:12px;padding:8px;font-family:monospace;font-size:11px;line-height:1.6"></div>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">Все пользователи в базе:</p>
        <div id="userList"></div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">⛔ Бан-лист (хранится в Firebase)</p>
        <div style="display:grid;gap:12px">
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <input type="text" id="banUsername" placeholder="Twitch логин для бана" style="flex:1;min-width:160px;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">
            <button class="btn" onclick="banUser()" style="border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#fca5a5">🔨 Забанить логин</button>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <input type="text" id="banIP" placeholder="IP адрес для бана (напр. 192.168.1.1)" style="flex:1;min-width:160px;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">
            <button class="btn" onclick="banIP()" style="border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#fca5a5">🔨 Забанить IP</button>
          </div>
          <div id="banStatus" class="muted" style="font-size:13px"></div>
          <div id="bannedList" style="margin-top:8px"></div>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
        <p class="muted" style="margin-bottom:12px">🔄 Симуляция входа</p>
        <div style="display:grid;gap:12px">
          <p style="font-size:13px;color:var(--muted);line-height:1.5">Войди под любым пользователем из базы чтобы увидеть дашборд его глазами. Для возврата нажми «Вернуться на свой аккаунт» в сайдбаре или выйди и зайди снова.</p>
          <button class="btn primary" onclick="showSimulateLogin()">🔀 Симулировать вход</button>
          <div id="simulateAdminStatus" class="muted" style="font-size:13px"></div>
        </div>
      </div>
    </div>`;
  showAdminPage();
  loadUsersList();
  loadBannedList();
  loadBotConfig();
}

function showAdminPage() {
  pages.forEach(p => { const el = document.getElementById(p); if (el) el.classList.add('hidden'); });
  const ap = document.getElementById('adminPanel');
  if (ap) ap.classList.remove('hidden');
}

async function loadUsersList() {
  const el = document.getElementById('userList');
  if (!el) return;
  try {
    const snap = await db.ref('twitch-users').once('value');
    const users = snap.val();
    if (!users) { el.innerHTML = '<p class="muted">Нет пользователей</p>'; return; }
    el.innerHTML = Object.entries(users).map(([login, u]) => {
      const roles = u.roles || {};
      const tags = [];
      if (roles.admin) tags.push('<span class="tag" style="color:#fbbf24;background:rgba(251,191,36,.13);border-color:rgba(251,191,36,.22)">Admin</span>');
      if (roles.squad) tags.push('<span class="tag" style="color:#4ade80;background:rgba(74,222,128,.13);border-color:rgba(74,222,128,.22)">Squad</span>');
      if (roles.academy) tags.push('<span class="tag" style="color:#a855f7;background:rgba(168,85,247,.13);border-color:rgba(168,85,247,.22)">Academy</span>');
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-radius:16px;background:rgba(255,255,255,.055);margin-top:8px"><div><b>' + login + '</b><p class="muted" style="font-size:13px">' + (u.displayName || '') + '</p></div><div style="display:flex;gap:6px">' + (tags.length ? tags.join('') : '<span class="tag">user</span>') + '</div></div>';
    }).join('');
  } catch (e) { el.innerHTML = '<p class="muted">Ошибка загрузки</p>'; }
}

async function getBans() {
  try {
    const snap = await db.ref('squad/_bans').once('value');
    return snap.val() || { users: {}, ips: {} };
  } catch { return { users: {}, ips: {} }; }
}

async function saveBans(data) {
  try { await adminProxy('PATCH', 'squad/_bans', data); return true; }
  catch { return false; }
}

async function loadBannedList() {
  const el = document.getElementById('bannedList');
  if (!el) return;
  const bans = await getBans();
  const userEntries = Object.entries(bans.users || {});
  const ipEntries = Object.entries(bans.ips || {});
  if (!userEntries.length && !ipEntries.length) {
    el.innerHTML = '<p class="muted" style="padding:12px 0">⛔ Нет забаненных пользователей</p>';
    return;
  }
  let html = '<div style="display:grid;gap:8px">';
  for (const [login, info] of userEntries) {
    const time = info.bannedAt ? new Date(info.bannedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:12px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.15)"><div><b style="color:#fca5a5">@' + login + '</b><p class="muted" style="font-size:12px">забанен ' + time + '</p></div><button class="btn" onclick="unbanUser(\'' + login + '\')" style="padding:6px 12px;font-size:12px;border-color:rgba(239,68,68,.3)">✕ Разбанить</button></div>';
  }
  for (const [ip, info] of ipEntries) {
    const time = info.bannedAt ? new Date(info.bannedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const displayIp = ip.replace(/_/g, '.');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.1)"><div><span style="color:#fca5a5;font-family:monospace">🌐 ' + displayIp + '</span><p class="muted" style="font-size:12px">забанен ' + time + '</p></div><button class="btn" onclick="unbanIP(\'' + ip + '\')" style="padding:6px 12px;font-size:12px;border-color:rgba(239,68,68,.3)">✕ Разбанить</button></div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

async function banUser() {
  const input = document.getElementById('banUsername');
  const status = document.getElementById('banStatus');
  const login = input?.value.trim().toLowerCase();
  if (!login) { status.textContent = '❌ Введи логин'; return; }
  const bans = await getBans();
  if (bans.users[login]) { status.textContent = '⚠️ @' + login + ' уже в бане'; return; }
  bans.users[login] = { bannedAt: Date.now(), bannedBy: currentTwitchUser?.login || 'admin' };
  if (await saveBans(bans)) {
    status.textContent = '✅ @' + login + ' забанен';
    input.value = '';
    loadBannedList();
  } else {
    status.textContent = '❌ Ошибка записи в Firebase';
  }
}

async function unbanUser(login) {
  const status = document.getElementById('banStatus');
  const bans = await getBans();
  if (!bans.users[login]) { status.textContent = '⚠️ @' + login + ' не в бане'; return; }
  delete bans.users[login];
  if (await saveBans(bans)) {
    status.textContent = '✅ @' + login + ' разбанен';
    loadBannedList();
  } else {
    status.textContent = '❌ Ошибка записи в Firebase';
  }
}

async function banIP() {
  const input = document.getElementById('banIP');
  const status = document.getElementById('banStatus');
  const ip = input?.value.trim();
  if (!ip) { status.textContent = '❌ Введи IP адрес'; return; }
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) { status.textContent = '❌ Неверный формат IP (напр. 192.168.1.1)'; return; }
  const key = ip.replace(/\./g, '_');
  const bans = await getBans();
  if (bans.ips[key]) { status.textContent = '⚠️ IP ' + ip + ' уже в бане'; return; }
  bans.ips[key] = { bannedAt: Date.now(), bannedBy: currentTwitchUser?.login || 'admin' };
  if (await saveBans(bans)) {
    status.textContent = '✅ IP ' + ip + ' забанен';
    input.value = '';
    loadBannedList();
  } else {
    status.textContent = '❌ Ошибка записи в Firebase';
  }
}

async function unbanIP(key) {
  const status = document.getElementById('banStatus');
  const displayIp = key.replace(/_/g, '.');
  const bans = await getBans();
  if (!bans.ips[key]) { status.textContent = '⚠️ IP ' + displayIp + ' не в бане'; return; }
  delete bans.ips[key];
  if (await saveBans(bans)) {
    status.textContent = '✅ IP ' + displayIp + ' разбанен';
    loadBannedList();
  } else {
    status.textContent = '❌ Ошибка записи в Firebase';
  }
}

async function assignRole() {
  const username = document.getElementById('adminUsername').value.trim().toLowerCase();
  const result = document.getElementById('adminResult');
  if (!username) { result.innerHTML = '<p style="color:#ef4444">Введите Twitch username</p>'; return; }
  const roles = {};
  if (document.getElementById('chkAdmin').checked) roles.admin = true;
  if (document.getElementById('chkSquad').checked) roles.squad = true;
  if (document.getElementById('chkAcademy').checked) roles.academy = true;
  try {
    await adminProxy('PATCH', 'twitch-users/' + username + '/roles', roles);
    const label = Object.keys(roles).length ? Object.keys(roles).join(', ') : 'user';
    result.innerHTML = '<p style="color:#4ade80">Роли "' + label + '" назначены для ' + username + '</p>';
    document.getElementById('adminUsername').value = '';
    document.querySelectorAll('#adminPanel input[type=checkbox]').forEach(c => c.checked = false);
    loadUsersList();
  } catch (e) { result.innerHTML = '<p style="color:#ef4444">Ошибка: ' + e.message + '</p>'; }
}

async function loadBotConfig() {
  const status = document.getElementById('botConfigStatus');
  try {
    const snap = await db.ref('config/bot').once('value');
    const cfg = snap.val() || {};
    const wu = document.getElementById('botWorkerUrlInput');
    if (wu) wu.value = cfg.workerUrl || '';
    const ti = document.getElementById('botTokenInput');
    if (ti) ti.value = cfg.token || '';
    const ci = document.getElementById('botClientIdInput');
    if (ci) ci.value = cfg.clientId || '';
    status.innerHTML = cfg.workerUrl ? '✅ Воркер: ' + cfg.workerUrl : (cfg.token ? '🟡 Токен (без воркера)' : '🟡 Бот не настроен');
  } catch (e) { status.innerHTML = '❌ Ошибка загрузки'; }
}

async function adminProxy(method, path, body) {
  const login = currentTwitchUser?.login;
  if (!login) throw new Error('Не определён текущий пользователь');
  const token = await getAppCheckToken();
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Login': login };
  if (token) headers['X-Firebase-AppCheck'] = token;
  const res = await fetch('/api/firebase-proxy?path=' + encodeURIComponent(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'HTTP ' + res.status); }
  return res.json();
}

async function saveBotConfig() {
  const status = document.getElementById('botConfigStatus');
  const workerUrl = document.getElementById('botWorkerUrlInput').value.trim();
  if (!workerUrl) { status.innerHTML = '❌ Введи URL воркера'; return; }
  try {
    await adminProxy('PATCH', 'config/bot', { workerUrl });
    _botConfig = null;
    status.innerHTML = '✅ URL воркера сохранен: ' + workerUrl;
  } catch (e) { status.innerHTML = '❌ Ошибка: ' + e.message; }
}

async function saveBotTokenDirect() {
  const status = document.getElementById('botConfigStatus');
  const token = document.getElementById('botTokenInput').value.trim();
  const clientId = document.getElementById('botClientIdInput').value.trim();
  if (!token) { status.innerHTML = '❌ Введи токен'; return; }
  try {
    await adminProxy('PATCH', 'config/bot', { token, clientId: clientId || TWITCH_CLIENT_ID, workerUrl: '' });
    _botConfig = null;
    status.innerHTML = '✅ Токен сохранен: ' + token.slice(0, 8) + '…';
  } catch (e) { status.innerHTML = '❌ Ошибка: ' + e.message; }
}

async function deleteBotConfig() {
  const status = document.getElementById('botConfigStatus');
  if (!confirm('Сбросить настройки бота? Все API запросы пойдут через твой токен.')) return;
  try {
    await adminProxy('PATCH', 'config/bot', { workerUrl: '', token: '', clientId: '' });
    _botConfig = null;
    const wu = document.getElementById('botWorkerUrlInput');
    if (wu) wu.value = '';
    const ti = document.getElementById('botTokenInput');
    if (ti) ti.value = '';
    const ci = document.getElementById('botClientIdInput');
    if (ci) ci.value = '';
    status.innerHTML = '🗑 Настройки сброшены';
  } catch (e) { status.innerHTML = '❌ Ошибка: ' + e.message; }
}

function authBot() {
  const input = document.getElementById('botWorkerUrlInput').value.trim();
  if (!input) { document.getElementById('botConfigStatus').innerHTML = '❌ Сначала введи URL воркера'; return; }
  let url = input.replace(/\/+$/, '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  url = url.replace(/\/$/, '') + '/api/auth';
  window.open(url, '_blank');
}

async function checkBotStatus() {
  const status = document.getElementById('botConfigStatus');
  const workerUrl = document.getElementById('botWorkerUrlInput').value.trim();
  if (!workerUrl) { status.innerHTML = '❌ Сначала сохрани URL воркера'; return; }
  try {
    const res = await fetch(workerUrl + '/api/status');
    if (!res.ok) { status.innerHTML = '❌ Воркер недоступен (' + res.status + ')'; return; }
    const d = await res.json();
    if (d.configured) {
      const left = d.expires_in > 3600 ? Math.floor(d.expires_in / 3600) + 'ч' : Math.floor(d.expires_in / 60) + 'мин';
      status.innerHTML = '✅ Бот: <b>' + (d.bot_display || d.bot_login) + '</b> | токен живет ' + left + ' | автообновление каждые 3ч';
    } else { status.innerHTML = '🟡 Воркер работает, но бот не авторизован. Нажми "Авторизовать бота"'; }
  } catch (e) { status.innerHTML = '❌ Ошибка соединения: ' + e.message; }
}

async function testBotToken() {
  const status = document.getElementById('botConfigStatus');
  const token = document.getElementById('botTokenInput').value.trim();
  const clientId = document.getElementById('botClientIdInput').value.trim() || TWITCH_CLIENT_ID;
  if (!token) { status.innerHTML = '❌ Введи токен'; return; }
  try {
    const res = await fetch('https://api.twitch.tv/helix/users', { headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': clientId } });
    if (!res.ok) { const err = await res.json(); status.innerHTML = '❌ Ошибка ' + res.status + ': ' + (err.message || 'токен невалидный'); return; }
    const data = await res.json();
    const user = data.data && data.data[0];
    status.innerHTML = '✅ Токен валидный. Бот: <b>' + (user ? user.login + ' (' + user.display_name + ')' : 'неизвестный пользователь') + '</b>';
  } catch (e) { status.innerHTML = '❌ Ошибка соединения: ' + e.message; }
}

async function saveLocalhostPass() {
  const input = document.getElementById('localhostPassInput');
  const status = document.getElementById('localhostPassStatus');
  const pass = input?.value.trim();
  if (!pass) { status.innerHTML = '❌ Введи пароль'; return; }
  try { await adminProxy('PATCH', 'config/localhost-password', { '.value': pass }); status.innerHTML = '✅ Пароль сохранен'; }
  catch (e) { status.innerHTML = '❌ Ошибка: ' + e.message; }
}

async function loadLocalhostPass() {
  const input = document.getElementById('localhostPassInput');
  const status = document.getElementById('localhostPassStatus');
  try {
    const snap = await db.ref('config/localhost-password').once('value');
    const pass = snap.val() || '';
    if (input) input.value = pass;
    status.innerHTML = pass ? '🔄 Пароль загружен' : '🟡 Пароль не установлен';
  } catch (e) { status.innerHTML = '❌ Ошибка: ' + e.message; }
}

async function importSullyGnomeCSV() {
  const result = document.getElementById('sgImportResult');
  const loginInput = document.getElementById('sgLoginInput');
  const fileInput = document.getElementById('sgCsvInput');
  const login = loginInput.value.trim().toLowerCase();
  if (!login) { result.innerHTML = '❌ Введи Twitch логин'; return; }
  if (!fileInput.files.length) { result.innerHTML = '❌ Выбери CSV файл'; return; }
  const text = await fileInput.files[0].text();
  const lines = text.trim().split('\n').slice(1);
  let imported = 0, errors = 0;
  result.innerHTML = '⏳ Импортирую ' + lines.length + ' стримов для @' + login + '...';
  for (const line of lines) {
    const vals = [];
    let cur = '', inQ = false;
    for (const ch of line) { if (ch === '"') { inQ = !inQ; continue; } if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; continue; } cur += ch; }
    vals.push(cur.trim());
    const dateRaw = vals[1] || '';
    const streamMins = parseInt(vals[3]) || 0;
    const watchMins = parseInt(vals[4]) || 0;
    const avg = parseInt(vals[5]) || 0;
    const peak = parseInt(vals[6]) || 0;
    const followers = parseInt(vals[7]) || 0;
    const games = vals[9] || '';
    const months = { 'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6, 'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12 };
    const parts = dateRaw.split(' ');
    const day = parseInt(parts[1]);
    const month = months[parts[2]];
    const year = parseInt(parts[3]);
    const time = parts[4] ? parts[4].split(':') : [0, 0];
    if (!day || !month || !year) { errors++; continue; }
    const startDate = new Date(Date.UTC(year, month - 1, day, parseInt(time[0]), parseInt(time[1])));
    const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const chunkTs = startDate.getTime();
    try {
      await db.ref('stream-chunks/' + login + '/' + dateStr + '/' + chunkTs).set({
        viewers: avg, peakViewers: peak, watchTimeMins: watchMins, followersGained: followers,
        game: games.split(',')[0].trim(), games, title: 'SullyGnome import', durationMins: streamMins,
        updatedAt: chunkTs, source: 'sullygnome-csv'
      });
      imported++;
      result.innerHTML = '⏳ Импортировано ' + imported + '/' + lines.length + ' (' + dateStr + ' ' + streamMins + 'мин)...';
    } catch (e) { errors++; }
  }
  result.innerHTML = '✅ Импортировано ' + imported + ' стримов для @' + login + (errors ? ', ошибок: ' + errors : '');
  loginInput.value = '';
  fileInput.value = '';
}

async function saveTgConfig() {
  const input = document.getElementById('tgChatIdInput');
  const proxyInput = document.getElementById('tgProxyUrlInput');
  const status = document.getElementById('tgConfigStatus');
  const val = input.value.trim();
  const proxyVal = proxyInput.value.trim() || '/api/telegram';
  if (!val) { status.textContent = '❌ Введи Chat ID'; return; }
  try {
    await adminProxy('PATCH', 'config', { 'tg-chat-id': val, 'tg-proxy-url': proxyVal });
    _tgChatIds = val.split(/[\s,;]+/).filter(Boolean);
    TG_PROXY_URL = proxyVal;
    status.textContent = '✅ Сохранено (' + _tgChatIds.length + ' ID): ' + _tgChatIds.join(', ');
  } catch (e) { status.textContent = '❌ Ошибка: ' + e.message; }
}

async function loadTgConfig() {
  const status = document.getElementById('tgConfigStatus');
  try {
    const ids = await getTgChatIds();
    document.getElementById('tgChatIdInput').value = ids.join(', ') || '';
    const proxyUrl = await getTgProxyUrl();
    document.getElementById('tgProxyUrlInput').value = proxyUrl !== '/api/telegram' ? proxyUrl : '';
    status.textContent = ids.length ? '✅ ' + ids.length + ' ID: ' + ids.join(', ') : '🟡 Не настроен';
  } catch (e) { status.textContent = '❌ Ошибка: ' + e.message; }
}

async function testTgBot() {
  const status = document.getElementById('tgConfigStatus');
  const chatIds = await getTgChatIds();
  if (!chatIds.length) { status.textContent = '❌ Сначала сохрани Chat ID'; return; }
  try {
    status.textContent = '⏳ Тест для ' + chatIds.length + ' получателей...';
    let ok = 0, fail = 0;
    for (const cid of chatIds) {
      try { await callTgApi('sendMessage', { chat_id: cid, text: '🧪 Тестовое сообщение от RGB Analytics', parse_mode: 'HTML' }); ok++; }
      catch { fail++; }
    }
    status.textContent = '✅ Отправлено ' + ok + ', ошибок ' + fail;
  } catch (e) { status.textContent = '❌ ' + e.message; }
}

// --- Bot #2 ---

async function authBot2() {
  const wu = await getBotWorkerUrl();
  if (!wu) { document.getElementById('bot2ConfigStatus').innerHTML = '❌ Сначала сохрани URL воркера в секции выше'; return; }
  window.open(wu.replace(/\/$/, '') + '/api/auth?bot=2', '_blank');
}

async function checkBotStatus2() {
  const status = document.getElementById('bot2ConfigStatus');
  const wu = await getBotWorkerUrl();
  if (!wu) { status.innerHTML = '❌ Сначала сохрани URL воркера'; return; }
  try {
    const res = await fetch(wu + '/api/status?bot=2');
    if (!res.ok) { status.innerHTML = '❌ Воркер недоступен (' + res.status + ')'; return; }
    const d = await res.json();
    if (d.configured) {
      const left = d.expires_in > 3600 ? Math.floor(d.expires_in / 3600) + 'ч' : Math.floor(d.expires_in / 60) + 'мин';
      status.innerHTML = '✅ Бот #2: <b>' + (d.bot_display || d.bot_login) + '</b> | токен живет ' + left;
    } else {
      status.innerHTML = '🟡 Бот #2 не авторизован. Нажми "Авторизовать бота #2"';
    }
  } catch (e) { status.innerHTML = '❌ Ошибка соединения: ' + e.message; }
}

async function resetBot2() {
  const status = document.getElementById('bot2ConfigStatus');
  if (!confirm('Сбросить бота #2? Придётся авторизовать заново как konstasil.')) return;
  const wu = await getBotWorkerUrl();
  if (!wu) { status.innerHTML = '❌ Сначала сохрани URL воркера'; return; }
  try {
    const res = await fetch(wu + '/api/reset?bot=2');
    if (!res.ok) { status.innerHTML = '❌ Ошибка сброса (' + res.status + ')'; return; }
    status.innerHTML = '🗑 Бот #2 сброшен. Авторизуй заново — войди как <b>konstasil</b>';
    checkBotStatus2();
  } catch (e) { status.innerHTML = '❌ ' + e.message; }
}

async function fetchLogs() {
  const container = document.getElementById('logsList');
  if (!container) return;
  const sourceFilter = document.getElementById('logSourceFilter')?.value || '';
  const levelFilter = document.getElementById('logLevelFilter')?.value || '';
  container.innerHTML = '<p style="color:var(--muted);padding:12px">⏳ Загрузка...</p>';
  try {
    const snap = await db.ref('config/logs').once('value');
    const logs = snap.val();
    if (!logs || !logs.length) { container.innerHTML = '<p style="color:var(--muted);padding:12px">Нет логов</p>'; return; }
    const filtered = logs.reverse().filter(e => {
      if (sourceFilter && e.source !== sourceFilter) return false;
      if (levelFilter && e.level !== levelFilter) return false;
      return true;
    });
    if (!filtered.length) { container.innerHTML = '<p style="color:var(--muted);padding:12px">Нет записей по фильтру</p>'; return; }
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const colors = { error: '#ef4444', warn: '#f59e0b', info: '#4ade80' };
    const icons = { error: '❌', warn: '⚠️', info: '✅' };
    container.innerHTML = filtered.map(e => {
      const t = e.ts ? new Date(e.ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
      const c = colors[e.level] || '#888';
      const ic = icons[e.level] || '•';
      const msg = e.message || '';
      const extra = e.data ? ' ' + esc(JSON.stringify(e.data)).slice(0, 150) : '';
      return '<div style="padding:6px 10px;border-left:3px solid ' + c + ';margin-bottom:4px;border-radius:0 6px 6px 0;background:rgba(255,255,255,.04)">' +
        '<span style="color:#888">' + t + '</span>' +
        '<span style="color:' + c + '"> ' + ic + ' [' + esc(e.source || '?') + ']</span>' +
        '<span style="color:#ccc"> ' + esc(msg) + '</span>' +
        '<span style="color:#666;font-size:10px;display:block;padding-left:14px">' + extra + '</span></div>';
    }).join('');
  } catch (e) {
    container.innerHTML = '<p style="color:#ef4444;padding:12px">❌ ' + e.message + '</p>';
  }
}

async function checkLurkerStatus() {
  const el = document.getElementById('lurkerStatus');
  if (!el) return;
  el.innerHTML = '⏳ Проверка...';
  try {
    // URL луркера — берём из конфига или стандартный
    const LURKER_URL = 'https://botforrgbsquad.onrender.com';
    const res = await fetch(LURKER_URL + '/health', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const online1 = data.bots?.bot1 ? '✅' : '❌';
    const online2 = data.bots?.bot2 ? '✅' : '❌';
    const chans1 = data.channels?.bot1 || 0;
    const chans2 = data.channels?.bot2 || 0;
    const ps1 = data.pubsub?.bot1?.connected ? '🔔' : '🔕';
    const ps2 = data.pubsub?.bot2?.connected ? '🔔' : '🔕';
    const psT1 = data.pubsub?.bot1?.topics || 0;
    const psT2 = data.pubsub?.bot2?.topics || 0;
    const uptime = data.uptime ? Math.round(data.uptime / 60) + ' мин' : '—';
    el.innerHTML = `<div style="display:grid;gap:6px;font-size:13px">
      <div>Бот #1: ${online1} <b>${data.bots?.bot1 ? 'IRC подключён' : 'IRC отключён'}</b> — ${chans1} каналов ${ps1} PubSub ${psT1} топиков</div>
      <div>Бот #2: ${online2} <b>${data.bots?.bot2 ? 'IRC подключён' : 'IRC отключён'}</b> — ${chans2} каналов ${ps2} PubSub ${psT2} топиков</div>
      <div class="muted">Аптайм: ${uptime}</div>
    </div>`;
  } catch (e) {
    el.innerHTML = '❌ Не удалось получить статус: ' + e.message;
  }
}

// Patch renderAdminPanel
const _origRenderAdmin = renderAdminPanel;
renderAdminPanel = function() {
  _origRenderAdmin();
  setTimeout(fetchLogs, 500);
  setTimeout(checkLurkerStatus, 1000);
};
