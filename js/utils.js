function msk(date) {
  const d = date || new Date();
  return {
    full: d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' (МСК)',
    short: d.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) + ' (МСК)',
    time: d.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' (МСК)',
    dateStr: d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' (МСК)'
  };
}

function isAdmin() {
  return currentUserRoles && currentUserRoles.admin === true;
}

function hasRole(role) {
  return currentUserRoles && currentUserRoles[role] === true;
}

function isSquad() {
  return currentUserRoles && currentUserRoles.squad === true;
}

function isAcademy() {
  return currentUserRoles && currentUserRoles.academy === true;
}

function rolesDisplay() {
  const labels = [];
  if (currentUserRoles?.admin) labels.push('Admin');
  if (currentUserRoles?.squad) labels.push('Squad');
  if (currentUserRoles?.academy) labels.push('Academy');
  return labels.join(', ') || 'user';
}

function getErrorLocation(error) {
  if (!error) return 'unknown:?:?';
  const stack = error.stack || '';
  const match = stack.match(/(https?:\/\/[^\s]+):(\d+):(\d+)/) || stack.match(/at\s+(?:.*?\()?(https?:\/\/[^\s]+):(\d+):(\d+)/);
  if (match) return `${match[1].split('/').pop()}:${match[2]}:${match[3]}`;
  return 'unknown:?:?';
}

function analyzeQuality(followers, avgViewers, viewerCountNow) {
  const v = viewerCountNow || avgViewers || 0;
  const f = followers || 0;
  if (!v && !f) return { label: 'Нет данных (офлайн)', color: '#888', score: 0, flags: ['💤 Стример не в эфире'] };
  const flags = [];
  let score = 50;

  if (v > 100) { flags.push('🔥 Высокая активность (' + v + ' зр.)'); score = 80; }
  else if (v > 30) { flags.push('✅ Хорошая аудитория (' + v + ' зр.)'); score = 65; }
  else if (v > 10) { flags.push('🟢 Средняя аудитория (' + v + ' зр.)'); score = 50; }
  else if (v > 3) { flags.push('🟡 Мало зрителей (' + v + ' зр.)'); score = 30; }
  else if (v > 0) { flags.push('🔴 Очень мало зрителей (' + v + ' зр.)'); score = 15; }

  if (f > 0) {
    flags.push('📊 Фоловеров: ' + f.toLocaleString('ru-RU'));
    if (v > 0) {
      const ratio = Math.round(f / v);
      if (ratio > 100) flags.push('🟡 Фоловеров намного больше зрителей (' + ratio + ':1)');
      else if (ratio > 30) flags.push('🟢 Среднее вовлечение (' + ratio + ' фол/зр)');
      else flags.push('🔥 Хорошее вовлечение (' + ratio + ' фол/зр)');
    }
  }
  if (v > 0) flags.push('📊 Прямой эфир: ' + v + ' зр.');

  const label = score >= 65 ? '✅ Хорошо' : score >= 45 ? '🟢 Средне' : score >= 25 ? '🟡 Слабо' : '🔴 Критично';
  return { label, color: score >= 65 ? '#4ade80' : score >= 45 ? '#facc15' : '#ef4444', score, flags };
}

function metric(label, value, sub) {
  if (value === undefined || value === null) value = '—';
  return '<article class="metric"><p>' + label + '</p><strong>' + value + '</strong>' + (sub ? '<p style="margin-top:8px">' + sub + '</p>' : '') + '</article>';
}

function activeNav(page) {
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
}

function show(id) {
  const allPages = ['homePage', 'squadPage', 'creatorPage', 'viewersPage', 'checkUserPage', 'infoPage'];
  allPages.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.add('hidden');
  });
  const ap = document.getElementById('adminPanel');
  if (ap) ap.classList.add('hidden');
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setActiveTab(login, active) {
  const safe = login.replace(/[^a-z0-9]/gi, '');
  const vt = document.getElementById('tabViewer_' + safe);
  const ct = document.getElementById('tabCalendar_' + safe);
  const tt = document.getElementById('tabTracker_' + safe);
  const at = document.getElementById('tabAvg_' + safe);
  const cm = document.getElementById('tabCmds_' + safe);
  if (vt) vt.className = 'tab-btn' + (active === 'viewer' ? ' active' : '');
  if (ct) ct.className = 'tab-btn' + (active === 'calendar' ? ' active' : '');
  if (tt) tt.className = 'tab-btn' + (active === 'tracker' ? ' active' : '');
  if (at) at.className = 'tab-btn' + (active === 'avg' ? ' active' : '');
  if (cm) cm.className = 'tab-btn' + (active === 'cmds' ? ' active' : '');
}

function getMySquadGroup() {
  if (currentUserRoles?.squad) return 'squad';
  if (currentUserRoles?.academy) return 'academy';
  return null;
}

function showBarTooltip(e, html) {
  const tip = document.getElementById('barTooltip') || (() => {
    const t = document.createElement('div');
    t.id = 'barTooltip';
    t.style.cssText = 'position:fixed;z-index:99999;background:#1a1a2e;border:1px solid rgba(168,85,247,.5);color:white;padding:5px 10px;border-radius:8px;font-size:11px;white-space:nowrap;pointer-events:none;display:none;font-weight:500';
    document.body.appendChild(t);
    return t;
  })();
  tip.innerHTML = html;
  tip.style.display = 'block';
  let x = e.clientX + 14, y = e.clientY - 10;
  if (x + tip.offsetWidth > window.innerWidth) x = e.clientX - tip.offsetWidth - 14;
  if (y < 4) y = e.clientY + 14;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function hideBarTooltip() {
  const tip = document.getElementById('barTooltip');
  if (tip) tip.style.display = 'none';
}

function collectDeviceInfo() {
  const sc = screen;
  const ua = navigator.userAgent;
  const lang = navigator.language || '';
  const langs = navigator.languages ? navigator.languages.join(',') : lang;
  const plat = navigator.platform || '';
  const cpu = navigator.hardwareConcurrency || 'N/A';
  const touch = navigator.maxTouchPoints || 0;
  const cookie = navigator.cookieEnabled;
  const orient = screen.orientation ? screen.orientation.type : 'N/A';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'N/A';
  const dpr = window.devicePixelRatio || 1;
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' (МСК)';
  const url = location.href;
  const user = currentTwitchUser?.login || localStorage.getItem('twitchUserDisplayName') || 'не авторизован';
  let info = '';
  info += 'User-Agent: ' + ua + '\n';
  info += 'Платформа: ' + plat + '\n';
  info += 'Экран: ' + sc.width + 'x' + sc.height + ' (' + sc.colorDepth + 'bit, ' + dpr + 'x)\n';
  info += 'Ориентация: ' + orient + '\n';
  info += 'Язык: ' + lang + ' (' + langs + ')\n';
  info += 'CPU: ' + cpu + ' ядер\n';
  info += 'Тач: ' + touch + ' точек\n';
  info += 'Куки: ' + cookie + '\n';
  info += 'URL: ' + url + '\n';
  info += 'Время: ' + now + '\n';
  info += 'Часовой пояс: ' + tz + '\n';
  info += 'Пользователь: ' + user + '\n';
  fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => {
    const el = document.getElementById('bugDeviceInfo');
    if (el && el.textContent.includes('IP:')) return;
    if (el) el.textContent = el.textContent.replace(/\n$/, '') + '\nIP: ' + (d.ip || 'N/A');
  }).catch(() => {});
  return info;
}
