let _viewersFilterChannel = '';
let _viewersSearchQuery = '';

function findMemberData(name) {
  return allMembers.find(m => m.name.toLowerCase() === name.toLowerCase());
}

function calculateHP(memberData) {
  if (!memberData) return null;
  const avgScore = Math.min(Math.round((memberData.avg || 0) * 10), 100);
  const retentionScore = Math.min(Math.round(memberData.retention || 0), 100);
  const freqNum = parseInt(memberData.consistency || '0');
  const freqScore = Math.min(Math.round(freqNum * 15), 100);
  const gainNum = parseInt((memberData.gain || '0').replace('+', ''));
  const gainScore = Math.min(Math.round(gainNum * 3), 100);
  const whNum = parseInt(memberData.watch || '0');
  const whScore = Math.min(Math.round(Math.sqrt(whNum) * 2.5), 100);
  const densityScore = Math.min(Math.round(parseInt(memberData.density || '0')), 100);
  const hp = Math.round(avgScore * 0.30 + retentionScore * 0.20 + freqScore * 0.15 + gainScore * 0.15 + whScore * 0.10 + densityScore * 0.10);
  return Math.max(0, Math.min(100, hp));
}

function hpInterpretation(score) {
  if (score === null || score === undefined) return { level: 'Нет данных', color: '#888' };
  if (score >= 90) return { level: 'Потенциальный большой канал', color: '#a855f7' };
  if (score >= 80) return { level: 'Высокий шанс популярности', color: '#4ade80' };
  if (score >= 65) return { level: 'Сильный рост', color: '#22d3ee' };
  if (score >= 50) return { level: 'Стабильный канал', color: '#facc15' };
  if (score >= 30) return { level: 'Слабый рост', color: '#fb923c' };
  return { level: 'Канал почти мертв', color: '#ef4444' };
}

function hpBreakdown(memberData) {
  if (!memberData) return '';
  const items = [
    { label: 'Avg Viewers', raw: memberData.avg, score: Math.min(Math.round((memberData.avg || 0) * 10), 100) },
    { label: 'Retention', raw: memberData.retention + '%', score: Math.min(Math.round(memberData.retention || 0), 100) },
    { label: 'Frequency', raw: memberData.consistency, score: Math.min(Math.round(parseInt(memberData.consistency || '0') * 15), 100) },
    { label: 'Followers Growth', raw: memberData.gain, score: Math.min(Math.round(parseInt((memberData.gain || '0').replace('+', '')) * 3), 100) },
    { label: 'Watch Hours', raw: memberData.watch, score: Math.min(Math.round(Math.sqrt(parseInt(memberData.watch || '0')) * 2.5), 100) },
    { label: 'Community Density', raw: memberData.density, score: Math.min(Math.round(parseInt(memberData.density || '0')), 100) }
  ];
  return '<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;line-height:1.8">' +
    items.map(i => '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<span style="color:var(--muted)">' + i.label + '</span>' +
      '<div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;max-width:60px">' +
      '<div style="width:' + i.score + '%;height:100%;border-radius:2px;background:var(--purple)"></div></div>' +
      '<span style="color:#fff;font-weight:600">' + i.score + '</span></div>').join('') + '</div>';
}

async function loadTwitchUsers(force) {
  const now = Date.now();
  if (!force && cachedUsers && (now - cachedUsersTime < CACHE_TTL)) return cachedUsers;
  const token = localStorage.getItem('twitchAccessToken');
  const snap = await db.ref('twitch-users').once('value');
  const all = snap.val();
  if (!all) { cachedUsers = []; cachedUsersTime = now; return []; }
  const logins = Object.keys(all);

  // Читаем stream-cache из Firebase (пишется воркером каждую минуту)
  let streamCache = {};
  try {
    const scSnap = await db.ref('stream-cache').once('value');
    const sc = scSnap.val() || {};
    for (const [login, data] of Object.entries(sc)) {
      if (data && data.live) streamCache[login] = data;
    }
  } catch (e) {}

  const members = [];
  let userMap = {};

  // Пробуем получить профили из Twitch API (токен пользователя)
  if (token && logins.length > 0) {
    try {
      const url = 'https://api.twitch.tv/helix/users?login=' + logins.join('&login=');
      const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID } });
      const data = await res.json();
      data.data.forEach(u => { userMap[u.login.toLowerCase()] = u; });
    } catch (e) {}
  }

  for (const login of logins) {
    const u = userMap[login];
    const sc = streamCache[login];
    members.push({
      login,
      roles: all[login].roles || {},
      displayName: u ? u.display_name : all[login].displayName || login,
      profileImageUrl: u ? u.profile_image_url : all[login].profileImageUrl || '',
      description: u ? u.description : all[login].description || '',
      twitchId: u ? u.id : all[login].twitchId,
      stream: sc ? sc : null,
      isLive: !!sc,
      viewers: sc ? sc.viewers : 0,
      peakViewers: sc ? sc.peakViewers : 0,
      gameName: sc ? sc.game : '',
      streamTitle: sc ? sc.title : '',
      startedAt: sc ? sc.startedAt : null,
      followers: 0,
    });
  }

  // Фолловеры — через бота или токен пользователя
  const botToken = await getBotToken();
  const modId = botToken?.id || currentTwitchUser?.id || '';
  if (modId) {
    await Promise.all(members.filter(m => m.twitchId).map(async (m) => {
      try {
        const fHdrs = botToken ? { 'Authorization': 'Bearer ' + botToken.token, 'Client-Id': botToken.clientId || TWITCH_CLIENT_ID } : { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID };
        const fRes = await fetch('https://api.twitch.tv/helix/channels/followers?broadcaster_id=' + m.twitchId + '&moderator_id=' + modId + '&first=1', { headers: fHdrs });
        if (fRes.ok) { const fData = await fRes.json(); m.followers = fData.total || 0; }
      } catch (e) {}
    }));
  }
  cachedUsers = members;
  cachedUsersTime = Date.now();
  return members;
}

async function renderHome() {
  const members = await loadTwitchUsers();
  const squad = members.filter(m => m.roles && m.roles.squad);
  const academy = members.filter(m => m.roles && m.roles.academy);
  const total = members.length;
  const online = members.filter(m => m.isLive).length;
  const totalViewers = members.reduce((s, m) => s + m.viewers, 0);
  const totalFollowers = members.reduce((s, m) => s + (m.followers || 0), 0);
  const lastUpdated = msk().short;
  document.getElementById('homePage').innerHTML = `
    <div class="hero"><div class="hero-inner"><div><div class="pill"><span class="dot ${online ? 'online' : ''}"></span>RGB Creator Analytics Network &mdash; ${online} в эфире</div><h1>Multi-Channel Twitch Intelligence Platform</h1><p class="lead">Автоматическая аналитика по креаторам RGB Network. Данные подтягиваются из Twitch API в реальном времени.</p><div class="hero-actions"><button class="btn primary" onclick="openSquad('squad')">RGB-Squad</button><button class="btn" onclick="openSquad('academy')">RGB-Academy</button></div><p class="muted" style="margin-top:16px;font-size:13px">Последнее обновление: ${lastUpdated} &bull; автообновление каждые 30с <button class="btn" style="padding:6px 12px;font-size:12px;margin-left:8px" onclick="cachedUsers=null;renderHome()">🔄</button></p></div><div class="profile"><div class="profile-head"><div class="avatar"></div><div><h2>RGB Network</h2><p class="muted">Squad + Academy</p></div></div><div class="metric-grid" style="grid-template-columns:repeat(2,1fr)">${metric('Креаторы', total)}${metric('В эфире', online)}${metric('Всего зрителей', totalViewers)}${metric('Фоловеры', totalFollowers ? totalFollowers.toLocaleString('ru-RU') : '—')}</div></div></div></div>
    <div class="home-grid">${[
      ['squad', 'RGB-Squad', 'PRIMARY CREATOR TEAM', squad],
      ['academy', 'RGB-Academy', 'DEVELOPMENT PROGRAM', academy]
    ].map(([key, title, label, list]) => `
      <section class="squad-card"><p class="section-label">${label}</p><h2>${title}</h2>
      ${list.length ? list.map(m => `
        <div class="creator-row" onclick="openCreator('${m.login}')">
          <div><h3>${m.displayName}</h3>
          <p>${m.isLive ? '<span style="color:var(--green)">● LIVE</span> ' + m.gameName : '○ Offline'} &bull; ${m.viewers} зр. &bull; <span style="color:var(--muted)">📊 ${m.followers ? m.followers.toLocaleString('ru-RU') + ' фол.' : '—'}</span></p></div>
          <button class="btn">Open</button>
        </div>`).join('') : '<p class="muted" style="padding:18px">Нет участников</p>'}
      <button class="btn primary" style="margin-top:18px" onclick="openSquad('${key}')">Смотреть всех</button>
      </section>`).join('')}</div>
    ${online ? `<section class="weekly"><div class="weekly-head"><div><p class="muted">Live Now</p><h2>Сейчас в эфире</h2></div><span class="tag">${online} streaming</span></div><div class="top-grid">${members.filter(m => m.isLive).slice(0, 4).map(m => `
      <article class="metric"><p>${m.displayName}</p><strong>${m.viewers}</strong><div style="display:flex;justify-content:space-between;margin-top:14px"><b>${m.gameName}</b><span style="color:var(--green)">Live</span></div></article>
    `).join('')}</div></section>` : ''}`;
  show('homePage');
}

async function openSquad(group) {
  viewerTracker.stop();
  activeNav('squad');
  const members = await loadTwitchUsers();
  const filtered = members.filter(m => m.roles && m.roles[group]);
  const title = group === 'squad' ? 'RGB-Squad' : 'RGB-Academy';
  const label = group === 'squad' ? 'PRIMARY CREATOR TEAM' : 'DEVELOPMENT PROGRAM';
  document.getElementById('squadPage').innerHTML = `
    <div class="page-card">
      <button class="btn" onclick="renderHome();activeNav('squad')">← Назад к подразделениям</button>
      <p class="section-label" style="margin-top:30px">${label}</p>
      <h1 style="margin-bottom:28px">${title}</h1>
      <div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Creator</th><th>Статус</th><th>Игра</th><th>Зрители</th><th>Фоловеры</th><th>Роль</th><th>Стрим</th></tr></thead><tbody>${
      filtered.map((m, i) => `
        <tr onclick="openCreator('${m.login}')">
          <td>${i + 1}</td>
          <td><div class="creator-cell"><img class="mini-avatar" src="${m.profileImageUrl || ''}" alt="" style="object-fit:cover;background:linear-gradient(135deg,var(--purple),var(--fuchsia))"><div><b>${m.displayName}</b><p class="muted">${m.login}</p></div></div></td>
          <td><span style="color:${m.isLive ? 'var(--green)' : 'var(--muted)'}">${m.isLive ? 'Online' : 'Offline'}</span></td>
          <td>${m.gameName || '—'}</td>
          <td>${m.viewers}</td>
          <td>${m.followers ? m.followers.toLocaleString('ru-RU') : '—'}</td>
          <td><span class="tag">${[m.roles?.admin && 'Admin', m.roles?.squad && 'Squad', m.roles?.academy && 'Academy'].filter(Boolean).join(', ') || 'user'}</span></td>
          <td>${m.streamTitle ? m.streamTitle.slice(0, 30) + (m.streamTitle.length > 30 ? '…' : '') : '—'}</td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>`;
  show('squadPage');
}

async function openCreator(name) {
  currentOpenCreator = name;
  const token = localStorage.getItem('twitchAccessToken');
  let user, stream, followers = 0;
  try {
    const res = await fetch('https://api.twitch.tv/helix/users?login=' + name, { headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID } });
    const data = await res.json();
    user = data.data[0];
    if (user) {
      const botToken = await getBotToken();
      const modId = currentTwitchUser?.id || user.id;
      const fModId = botToken?.id || modId;
      const fHdrs = botToken ? { 'Authorization': 'Bearer ' + botToken.token, 'Client-Id': botToken.clientId || TWITCH_CLIENT_ID } : { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID };
      const flRes = await fetch('https://api.twitch.tv/helix/channels/followers?broadcaster_id=' + user.id + '&moderator_id=' + fModId + '&first=1', { headers: fHdrs });
      if (flRes.ok) { const flData = await flRes.json(); followers = flData.total || 0; }
      _creatorFollowersCache[name] = followers;
      const stRes = await fetch('https://api.twitch.tv/helix/streams?user_id=' + user.id, { headers: fHdrs });
      const stData = await stRes.json();
      stream = stData.data && stData.data[0] ? stData.data[0] : null;
    }
  } catch (e) {}
  const snap = await db.ref('twitch-users/' + name.toLowerCase()).once('value');
  const dbUser = snap.val() || {};
  const roles = dbUser.roles || {};
  const roleStr = [roles.admin && 'Admin', roles.squad && 'Squad', roles.academy && 'Academy'].filter(Boolean).join(', ') || 'user';
  const displayName = user ? user.display_name : dbUser.displayName || name;
  const avatar = user ? user.profile_image_url : dbUser.profileImageUrl || '';
  const desc = user ? user.description : dbUser.description || '';
  const isLive = !!stream;
  const game = stream ? stream.game_name : '—';
  const title = stream ? stream.title : 'Не в эфире';
  const viewers = stream ? stream.viewer_count : 0;
  const quality = analyzeQuality(followers, 0, viewers);
  const memberData = findMemberData(name);
  const hpScore = calculateHP(memberData);
  const hpInfo = hpInterpretation(hpScore);
  const hpDisplay = hpScore !== null ? hpScore + ' / 100' : '—';
  const viewerSectionId = 'viewerAnalysis_' + name.replace(/[^a-z0-9]/gi, '');
  document.getElementById('creatorPage').innerHTML = `
    <div class="dash-grid">
      <div class="left-stack">
        <div class="profile big">
          <button class="btn" onclick="viewerTracker.stop();renderHome();activeNav('squad')">← Назад</button>
          <div class="profile-head" style="margin-top:24px">
            <img class="avatar" src="${avatar}" alt="" style="object-fit:cover">
            <div><h2>${displayName}</h2><p class="muted">${desc ? desc.slice(0, 80) : '—'}</p></div>
          </div>
          <div class="metric-grid">
            ${metric('Фоловеры', followers)}
            ${metric('Роль', roleStr)}
            ${metric('Статус', isLive ? 'Online' : 'Offline')}
            ${metric('Формула HP', hpDisplay, hpInfo.level + hpBreakdown(memberData))}
          </div>
        </div>
        <div class="card">
          <h2>Текущий стрим</h2>
          <p class="muted" style="margin:8px 0">${title}</p>
          ${stream ? '<div class="content-item"><span>Игра</span><b>' + game + '</b></div><div class="content-item"><span>Зрители</span><b>' + viewers + '</b></div>' : '<p class="muted">Не в эфире</p>'}
          ${quality.flags.length ? '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' + quality.flags.map(f => '<div style="font-size:13px;line-height:1.6;color:var(--muted)">' + f + '</div>').join('') + '</div>' : ''}
        </div>
      </div>
      <main class="dashboard-main card" style="padding:0">
        <div style="padding:30px 30px 0">
          <div class="dash-head" style="margin-bottom:0">
            <div><h1>${displayName}</h1><p class="muted">Данные Twitch в реальном времени</p></div>
            <div><p class="muted">Статус</p><b style="color:${isLive ? 'var(--green)' : 'var(--muted)'}">${isLive ? 'Online' : 'Offline'}</b></div>
          </div>
        </div>
        ${stream ? `
        <div style="padding:0 30px">
          <div class="analytics-grid" style="margin-top:0">
            <section class="card span-8">
              <h2>Сейчас в эфире</h2>
              <p class="muted">${title}</p>
              <div class="metric-grid" style="margin-top:16px">
                ${metric('Зрители', viewers)}
                ${metric('Игра', game)}
                ${metric('Язык', stream.language || '—')}
              </div>
            </section>
            <section class="card span-4">
              <h2>Канал</h2>
              <div class="content-item"><span>Фоловеры</span><b>${followers}</b></div>
              <div class="content-item"><span>Логин</span><b>${name}</b></div>
              <div class="content-item"><span>Роль</span><b>${roleStr}</b></div>
              <div class="content-item"><span>Качество ауд.</span><b style="color:${quality.color}">${quality.label}</b></div>
              <div style="display:flex;gap:6px;margin-top:10px">
                <a href="https://twitchtracker.com/${name}" target="_blank" class="btn" style="padding:6px 10px;font-size:11px;text-decoration:none;border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.15);color:white">📈 TwitchTracker</a>
                <a href="https://sullygnome.com/channel/${name}" target="_blank" class="btn" style="padding:6px 10px;font-size:11px;text-decoration:none;border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.15);color:white">📊 SullyGnome</a>
              </div>
            </section>
          </div>
        </div>` : `
        <div style="padding:0 30px">
          <div class="analytics-grid" style="margin-top:0">
            <section class="card span-8">
              <h2 style="color:var(--muted)">💤 Не в эфире</h2>
              <p class="muted" style="margin-top:6px">Стример офлайн — данные по прошлым стримам</p>
              <div class="metric-grid" style="margin-top:16px;grid-template-columns:repeat(2,1fr)">
                ${metric('Всего фоловеров', followers)}
                ${metric('Статус', 'Offline')}
              </div>
            </section>
            <section class="card span-4">
              <h2>Канал</h2>
              <div class="content-item"><span>Фоловеры</span><b>${followers}</b></div>
              <div class="content-item"><span>Логин</span><b>${name}</b></div>
              <div class="content-item"><span>Роль</span><b>${roleStr}</b></div>
              <div class="content-item"><span>Качество ауд.</span><b style="color:${quality.color}">${quality.label}</b></div>
              <div style="display:flex;gap:6px;margin-top:10px">
                <a href="https://twitchtracker.com/${name}" target="_blank" class="btn" style="padding:6px 10px;font-size:11px;text-decoration:none;border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.15);color:white">📈 TwitchTracker</a>
                <a href="https://sullygnome.com/channel/${name}" target="_blank" class="btn" style="padding:6px 10px;font-size:11px;text-decoration:none;border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.15);color:white">📊 SullyGnome</a>
              </div>
            </section>
          </div>
          ${quality.flags.length ? '<div style="padding:0 30px"><div style="padding:16px;border-radius:16px;background:rgba(255,255,255,.04)">' + quality.flags.map(f => '<div style="font-size:13px;line-height:1.7;color:var(--muted)">' + f + '</div>').join('') + '</div></div>' : ''}
        </div>`}
        <div class="tab-bar" style="margin:0 30px">
          <button class="tab-btn active" id="tabViewer_${name.replace(/[^a-z0-9]/gi, '')}" onclick="renderViewerAnalysis('${name}', '${user?.id || ''}')">📊 Анализ зрителей</button>
          <button class="tab-btn" id="tabCalendar_${name.replace(/[^a-z0-9]/gi, '')}" onclick="renderStreamCalendar('${name}', '${user?.id || ''}')">📅 Календарь стримов</button>
          <button class="tab-btn" id="tabTracker_${name.replace(/[^a-z0-9]/gi, '')}" onclick="renderTrackerStats('${name}', '${user?.id || ''}')">📊 Общие данные</button>
          <button class="tab-btn" id="tabAvg_${name.replace(/[^a-z0-9]/gi, '')}" onclick="renderAvgOnline('${name}', '${user?.id || ''}')">📈 Средний онлайн</button>
          <button class="tab-btn" id="tabCmds_${name.replace(/[^a-z0-9]/gi, '')}" onclick="renderStreamerCommands('${name}')">⚙️ Команды</button>
          ${isAdmin() || (currentTwitchUser && currentTwitchUser.login === name) ? `<button class="tab-btn" id="tabPoll_${name.replace(/[^a-z0-9]/gi, '')}" onclick="renderPollView('${name}')">📊 Опрос</button>` : ''}
        </div>
        <div id="viewerAnalysis" style="padding:0 30px 30px"></div>
        <div id="streamCalendarContainer_${name.replace(/[^a-z0-9]/gi, '')}" style="padding:0 30px 30px;display:none"></div>
        <div id="trackerContainer_${name.replace(/[^a-z0-9]/gi, '')}" style="padding:0 30px 30px;display:none"></div>
        <div id="avgOnlineContainer_${name.replace(/[^a-z0-9]/gi, '')}" style="padding:0 30px 30px;display:none"></div>
        <div id="cmdsContainer_${name.replace(/[^a-z0-9]/gi, '')}" style="padding:0 30px 30px;display:none"></div>
        ${isAdmin() || (currentTwitchUser && currentTwitchUser.login === name) ? `<div id="pollContainer_${name.replace(/[^a-z0-9]/gi, '')}" style="padding:0 30px 30px;display:none"></div>` : ''}
      </main>
    </div>`;
  show('creatorPage');
  if (user && user.id) {
    viewerTracker.start(user.id, name);
    setTimeout(() => viewerTracker.renderTable(), 2000);
  }
  renderStreamerCommands(name);
}

function getCurrentLogin() {
  return localStorage.getItem('twitch_login') || (typeof currentTwitchUser !== 'undefined' && currentTwitchUser?.login) || '';
}

async function renderStreamerCommands(login) {
  const safe = login.replace(/[^a-z0-9]/gi, '');
  setActiveTab(login, 'cmds');
  viewerTracker.stop();
  const ve = document.getElementById('viewerAnalysis');
  if (ve) ve.style.display = 'none';
  const cal = document.getElementById('streamCalendarContainer_' + safe);
  if (cal) cal.style.display = 'none';
  const tr = document.getElementById('trackerContainer_' + safe);
  if (tr) tr.style.display = 'none';
  const avgEl = document.getElementById('avgOnlineContainer_' + safe);
  if (avgEl) avgEl.style.display = 'none';
  const container = document.getElementById('cmdsContainer_' + safe);
  if (!container) return;
  container.style.display = 'block';

  const currentUser = getCurrentLogin();
  const canEdit = isAdmin() || currentUser === login;

  try {
    const snap = await db.ref('config/commands/' + login).once('value');
    const cmds = snap.val() || {};
    const entries = Object.entries(cmds);

    let html = '<div class="page-card" style="margin-top:24px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">';
    html += '<div><h2 style="font-size:24px">⚙️ Команды канала</h2><p class="muted">Чат-команды для @' + login + '</p></div>';
    if (canEdit) {
      html += '<button class="btn primary" onclick="editStreamerCmd(\'' + login + '\', null)">➕ Добавить команду</button>';
    }
    html += '</div>';

    if (entries.length) {
      html += '<div style="display:grid;gap:10px">';
      const permLabels = { 'все': '👥 все', 'випка': '⭐ Вип', 'редакторка': '📝 Ред', 'модерка': '🔨 Мод', 'стример': '👑 Стрим' };
      const actionLabels = { 'reply': 'ответить', 'ping': 'пинговать', 'send': 'отправить' };
      for (const [cmd, cfg] of entries) {
        const cfgObj = typeof cfg === 'string' ? { response: cfg, permission: 'все', action: 'reply' } : cfg;
        const isUrl = typeof cfgObj.response === 'string' && (cfgObj.response.startsWith('http://') || cfgObj.response.startsWith('https://'));
        html += '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--border)">';
        html += '<span style="font-family:monospace;font-weight:700;color:#a855f7;font-size:15px;min-width:80px">!' + cmd + '</span>';
        html += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,.06);color:var(--muted)">' + (permLabels[cfgObj.permission] || '👥 все') + '</span>';
        html += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,.06);color:var(--muted)">' + (actionLabels[cfgObj.action] || 'ответить') + '</span>';
        html += '<span style="flex:1;font-size:14px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (isUrl ? '<a href="' + cfgObj.response + '" target="_blank" style="color:#22d3ee">ссылка</a>' : cfgObj.response) + '</span>';
        if (canEdit) {
          html += '<button class="btn" onclick="editStreamerCmd(\'' + login + '\', \'' + cmd + '\')" style="padding:4px 10px;font-size:12px">✏️</button>';
          html += '<button class="btn" onclick="deleteStreamerCmd(\'' + login + '\', \'' + cmd + '\')" style="padding:4px 10px;font-size:12px;border-color:rgba(239,68,68,.3)">✕</button>';
        }
        html += '</div>';
      }
      html += '</div>';
    } else {
      html += '<p class="muted" style="padding:20px;text-align:center">Команды не настроены</p>';
    }
    html += '</div>';
    // Embed data for editor (hidden)
    html += '<span id="cmdsListData_' + safe + '" style="display:none">' + JSON.stringify(cmds).replace(/</g, '\\u003C') + '</span>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p class="muted" style="padding:20px;text-align:center">❌ Ошибка: ' + e.message + '</p>';
  }
}

async function editStreamerCmd(login, cmdName) {
  const safe = login.replace(/[^a-z0-9]/gi, '');
  const container = document.getElementById('cmdsContainer_' + safe);
  let cmdData = { response: '', permission: 'все', action: 'reply' };

  if (cmdName) {
    try {
      const snap = await db.ref('config/commands/' + login + '/' + cmdName).once('value');
      const existing = snap.val();
      if (existing) {
        cmdData = typeof existing === 'string' ? { response: existing, permission: 'все', action: 'reply' } : existing;
      }
    } catch {}
  }

  const permOptions = ['все', 'випка', 'редакторка', 'модерка', 'стример'];
  const permLabels = { 'все': '👥 все', 'випка': '⭐ Вип', 'редакторка': '📝 Ред', 'модерка': '🔨 Мод', 'стример': '👑 Стрим' };
  const actionOptions = ['reply', 'ping', 'send'];
  const actionLabels = { 'reply': '💬 ответить', 'ping': '🔔 пинговать', 'send': '📨 отправить' };

  let html = '<div class="page-card" style="margin-top:24px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">';
  html += '<div><h2 style="font-size:24px">' + (cmdName ? '✏️ ' + cmdName : '➕ Новая команда') + '</h2><p class="muted">для @' + login + '</p></div>';
  html += '<button class="btn" onclick="renderStreamerCommands(\'' + login + '\')" style="padding:8px 14px;font-size:13px">← Назад</button>';
  html += '</div>';
  html += '<div style="display:grid;gap:14px">';

  // Command name
  html += '<div><label style="display:block;font-size:13px;color:var(--muted);margin-bottom:4px">Команда (без !)</label>';
  if (cmdName) {
    html += '<input type="text" id="gcmd_name" value="' + cmdName + '" readonly style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:rgba(0,0,0,.3);color:#888;font-family:monospace;font-size:14px">';
  } else {
    html += '<input type="text" id="gcmd_name" placeholder="катг" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:white;font-family:monospace;font-size:14px">';
  }
  html += '</div>';

  // Permission
  html += '<div><label style="display:block;font-size:13px;color:var(--muted);margin-bottom:4px">Права</label>';
  html += '<select id="gcmd_perm" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:white;font-size:14px">';
  for (const p of permOptions) {
    html += '<option value="' + p + '"' + (cmdData.permission === p ? ' selected' : '') + '>' + (permLabels[p] || p) + '</option>';
  }
  html += '</select></div>';

  // Action type
  html += '<div><label style="display:block;font-size:13px;color:var(--muted);margin-bottom:4px">Тип ответа</label>';
  html += '<select id="gcmd_action" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:white;font-size:14px">';
  for (const a of actionOptions) {
    html += '<option value="' + a + '"' + (cmdData.action === a ? ' selected' : '') + '>' + (actionLabels[a] || a) + '</option>';
  }
  html += '</select></div>';

  // Response template
  html += '<div><label style="display:block;font-size:13px;color:var(--muted);margin-bottom:4px">Шаблон ответа</label>';
  html += '<div style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:8px">';
  html += 'Доступно: <code>${Значение}</code> — текст после команды, ';
  html += '<code>${СменаКатегории"..."}</code> — сменить категорию, ';
  html += '<code>${УбрУчаст}</code> — не писать в чат. ';
  html += '<code>\'\'</code> (пустой ответ) = ничего не писать в чат.</div>';
  html += '<textarea id="gcmd_response" placeholder="Пример: Категория изменена на ${Значение}${СменаКатегории&quot;${Значение}&quot;}" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:white;font-size:14px;font-family:monospace;resize:vertical;min-height:80px">' + (cmdData.response || '').replace(/"/g, '&quot;') + '</textarea>';
  html += '</div>';

  // Buttons
  html += '<div style="display:flex;gap:10px">';
  html += '<button class="btn primary" onclick="saveStreamerCmd(\'' + login + '\', \'' + (cmdName || '') + '\')" style="flex:1">💾 Сохранить</button>';
  if (cmdName) {
    html += '<button class="btn" onclick="deleteStreamerCmd(\'' + login + '\', \'' + cmdName + '\')" style="border-color:rgba(239,68,68,.3);color:#fca5a5">🗑 Удалить</button>';
  }
  html += '<button class="btn" onclick="renderStreamerCommands(\'' + login + '\')">Отмена</button>';
  html += '</div>';

  html += '</div></div>';
  container.innerHTML = html;
}

async function saveStreamerCmd(login, cmdName) {
  const nameInput = document.getElementById('gcmd_name');
  const permSelect = document.getElementById('gcmd_perm');
  const actionSelect = document.getElementById('gcmd_action');
  const responseInput = document.getElementById('gcmd_response');
  if (!nameInput || !responseInput) return;

  const name = (cmdName || nameInput.value.trim().toLowerCase());
  if (!name) { alert('Введите имя команды'); return; }

  const data = {
    response: responseInput.value.trim(),
    permission: permSelect.value,
    action: actionSelect.value,
  };

  const currentUser = getCurrentLogin();
  if (!currentUser) { alert('❌ Не удалось определить текущего пользователя'); return; }

  const path = 'config/commands/' + login + '/' + name;
  const headers = { 'Content-Type': 'application/json' };
  try { const at = await getAppCheckToken(); if (at) headers['X-Firebase-AppCheck'] = at; } catch {}

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('/api/firebase-proxy?path=' + encodeURIComponent(path) + '&adminLogin=' + encodeURIComponent(currentUser), {
        method: 'PATCH', headers, body: JSON.stringify(data),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg;
        try { const j = JSON.parse(text); msg = j.error || text; } catch { msg = 'Сервер вернул ' + res.status; }
        throw new Error(msg);
      }
      renderStreamerCommands(login);
      return;
    } catch (e) {
      if (attempt === 1) alert('❌ Ошибка: ' + e.message);
    }
  }
}

async function deleteStreamerCmd(login, cmdName) {
  if (!confirm('Удалить команду !' + cmdName + '?')) return;

  const currentUser = getCurrentLogin();
  if (!currentUser) { alert('❌ Не удалось определить пользователя'); return; }

  const path = 'config/commands/' + login + '/' + cmdName;
  const headers = { 'Content-Type': 'application/json' };
  try { const at = await getAppCheckToken(); if (at) headers['X-Firebase-AppCheck'] = at; } catch {}

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('/api/firebase-proxy?path=' + encodeURIComponent(path) + '&adminLogin=' + encodeURIComponent(currentUser), {
        method: 'PATCH', headers, body: JSON.stringify({ '.value': null }),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg;
        try { const j = JSON.parse(text); msg = j.error || text; } catch { msg = 'Сервер вернул ' + res.status; }
        throw new Error(msg);
      }
      renderStreamerCommands(login);
      return;
    } catch (e) {
      if (attempt === 1) alert('❌ Ошибка: ' + e.message);
    }
  }
}

async function renderPollView(login) {
  const safe = login.replace(/[^a-z0-9]/gi, '');
  setActiveTab(login, 'poll');
  viewerTracker.stop();
  const ve = document.getElementById('viewerAnalysis');
  if (ve) ve.style.display = 'none';
  const cal = document.getElementById('streamCalendarContainer_' + safe);
  if (cal) cal.style.display = 'none';
  const tr = document.getElementById('trackerContainer_' + safe);
  if (tr) tr.style.display = 'none';
  const avgEl = document.getElementById('avgOnlineContainer_' + safe);
  if (avgEl) avgEl.style.display = 'none';
  const cmEl = document.getElementById('cmdsContainer_' + safe);
  if (cmEl) cmEl.style.display = 'none';
  const container = document.getElementById('pollContainer_' + safe);
  if (!container) return;
  container.style.display = 'block';

  const token = localStorage.getItem('twitchAccessToken');
  const isOwner = currentTwitchUser && currentTwitchUser.login === login;
  const canManage = isAdmin() || isOwner;

  let html = '<div class="page-card" style="margin-top:24px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">';
  html += '<div><h2 style="font-size:24px">📊 Опросы канала (баллы канала)</h2><p class="muted">Голосование через встроенные опросы Twitch</p></div>';
  if (canManage) {
    html += '<button class="btn primary" onclick="showCreateTwitchPoll(\'' + login + '\')" style="padding:8px 16px;font-size:13px">➕ Создать опрос</button>';
  }
  html += '</div>';

  if (!token) {
    html += '<p class="muted" style="padding:20px;text-align:center">❌ Войди в Twitch чтобы видеть опросы</p>';
  } else {
    try {
      // Сначала ищем broadcaster_id
      const uRes = await fetch('https://api.twitch.tv/helix/users?login=' + login, { headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID } });
      const uData = await uRes.json();
      const broadcaster = uData.data?.[0];
      if (!broadcaster) {
        html += '<p class="muted" style="padding:20px;text-align:center">❌ Пользователь не найден</p>';
      } else {
        const pRes = await fetch('https://api.twitch.tv/helix/polls?broadcaster_id=' + broadcaster.id + '&first=20', { headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID } });
        if (pRes.status === 401 || pRes.status === 403) {
          html += '<p class="muted" style="padding:20px;text-align:center">❌ Нет прав. Нужен <b>токен с channel:read:polls</b>. Выйди и зайди снова.</p>';
        } else if (pRes.ok) {
          const pData = await pRes.json();
          const polls = pData.data || [];
          if (!polls.length) {
            html += '<p class="muted" style="padding:20px;text-align:center">Нет опросов на канале</p>';
          } else {
            for (const poll of polls) {
              html += renderTwitchPollCard(poll, login, canManage);
            }
          }
        } else {
          html += '<p class="muted" style="padding:20px;text-align:center">❌ Ошибка: HTTP ' + pRes.status + '</p>';
        }
      }
    } catch (e) {
      html += '<p class="muted" style="padding:20px;text-align:center">❌ ' + e.message + '</p>';
    }
  }
  html += '</div>';
  container.innerHTML = html;
}

function renderTwitchPollCard(poll, login, canManage) {
  const statusColors = { ACTIVE: '#4ade80', COMPLETED: '#888', TERMINATED: '#ef4444' };
  const statusLabels = { ACTIVE: 'Активен', COMPLETED: 'Завершён', TERMINATED: 'Остановлен' };
  const sc = statusColors[poll.status] || '#888';
  const sl = statusLabels[poll.status] || poll.status;
  const isActive = poll.status === 'ACTIVE';

  const started = new Date(poll.started_at).toLocaleString('ru-RU');
  const ended = poll.ended_at ? new Date(poll.ended_at).toLocaleString('ru-RU') : null;

  const choices = poll.choices || [];
  let totalVotes = 0;
  let totalPoints = 0;
  for (const ch of choices) {
    totalVotes += ch.votes || 0;
    totalPoints += ch.channel_points_votes || 0;
  }

  let html = '<div style="margin-bottom:16px;padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">';
  html += '<h3 style="margin:0">' + (poll.title || 'Опрос') + '</h3>';
  html += '<span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;color:' + sc + ';background:' + sc + '22;border:1px solid ' + sc + '44">' + sl + '</span></div>';
  html += '<p class="muted" style="font-size:12px;margin-bottom:12px">Начат: ' + started + (ended ? ' &bull; Завершён: ' + ended : '') + ' &bull; ' + totalVotes + ' голосов, ' + totalPoints + ' баллов</p>';

  if (choices.length) {
    const maxPoints = Math.max(...choices.map(c => c.channel_points_votes || 0), 1);
    for (const ch of choices) {
    const votes = ch.votes || 0;
    const points = ch.channel_points_votes || 0;
    const pct = Math.round(points / maxPoints * 100);
    html += '<div style="margin-bottom:8px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.03)">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px">';
    html += '<b>' + (ch.title || '?') + '</b>';
    html += '<span style="font-size:13px;color:var(--muted)">' + votes + ' голосов &bull; <b>' + points + '</b> баллов</span></div>';
    html += '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden">';
    html += '<div style="height:100%;width:' + pct + '%;border-radius:3px;background:linear-gradient(90deg,#a855f7,#22d3ee)"></div></div>';
    html += '</div>';
    }
  }

  if (isActive && canManage) {
    html += '<button class="btn" style="border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#fca5a5;margin-top:8px" onclick="endTwitchPoll(\'' + login + '\',\'' + poll.id + '\')">⏹ Завершить опрос</button>';
  }
  html += '</div>';
  return html;
}

function showCreateTwitchPoll(login) {
  const container = document.getElementById('pollContainer_' + login.replace(/[^a-z0-9]/gi, ''));
  if (!container) return;
  container.innerHTML = `
    <div class="page-card" style="margin-top:24px">
      <button class="btn" onclick="renderPollView('${login}')" style="margin-bottom:16px">← Назад к опросам</button>
      <h2>Создать опрос (Twitch Channel Points)</h2>
      <p class="muted" style="margin-bottom:16px">Опрос будет создан на канале @${login}. Зрители смогут голосовать баллами канала.</p>
      <div style="display:grid;gap:12px;max-width:500px">
        <input type="text" id="twPollQuestion" placeholder="Вопрос опроса" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">
        <div style="display:grid;gap:8px" id="twPollOptionsList">
          <input type="text" class="twPollOption" placeholder="Вариант 1" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">
          <input type="text" class="twPollOption" placeholder="Вариант 2" style="padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white">
        </div>
        <button class="btn" onclick="document.getElementById('twPollOptionsList').insertAdjacentHTML('beforeend','<input type=\\"text\\" class=\\"twPollOption\\" placeholder=\\"Вариант N\\" style=\\"padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white\\">')">➕ Добавить вариант</button>
        <div style="display:flex;gap:10px;align-items:center">
          <label style="font-size:13px;color:var(--muted)">Длительность (сек):</label>
          <input type="number" id="twPollDuration" value="60" min="15" max="1800" style="width:80px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:white">
        </div>
        <button class="btn primary" onclick="createTwitchPoll('${login}')">📊 Запустить опрос</button>
        <div id="twPollCreateStatus" class="muted" style="font-size:13px"></div>
      </div>
    </div>`;
}

async function createTwitchPoll(login) {
  const status = document.getElementById('twPollCreateStatus');
  const token = localStorage.getItem('twitchAccessToken');
  if (!token) { status.textContent = '❌ Войди в Twitch'; return; }

  const question = document.getElementById('twPollQuestion')?.value.trim();
  if (!question) { status.textContent = '❌ Введи вопрос'; return; }

  const optionInputs = document.querySelectorAll('.twPollOption');
  const choices = [];
  for (const inp of optionInputs) {
    const v = inp.value.trim();
    if (v) choices.push({ title: v });
  }
  if (choices.length < 2) { status.textContent = '❌ Минимум 2 варианта'; return; }

  const duration = parseInt(document.getElementById('twPollDuration')?.value || '60');

  try {
    const uRes = await fetch('https://api.twitch.tv/helix/users?login=' + login, { headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID } });
    const uData = await uRes.json();
    const broadcaster = uData.data?.[0];
    if (!broadcaster) { status.textContent = '❌ Пользователь не найден'; return; }

    const body = { broadcaster_id: broadcaster.id, title: question, choices, duration };
    const res = await fetch('https://api.twitch.tv/helix/polls', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = '❌ ' + (data.message || 'HTTP ' + res.status); return; }
    status.textContent = '✅ Опрос запущен!';
    setTimeout(() => renderPollView(login), 1500);
  } catch (e) { status.textContent = '❌ ' + e.message; }
}

async function endTwitchPoll(login, pollId) {
  if (!confirm('Завершить опрос на канале @' + login + '?')) return;
  const token = localStorage.getItem('twitchAccessToken');
  if (!token) { alert('❌ Войди в Twitch'); return; }
  try {
    const uRes = await fetch('https://api.twitch.tv/helix/users?login=' + login, { headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID } });
    const uData = await uRes.json();
    const broadcaster = uData.data?.[0];
    if (!broadcaster) { alert('❌ Пользователь не найден'); return; }
    const res = await fetch('https://api.twitch.tv/helix/polls', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcaster_id: broadcaster.id, id: pollId, status: 'TERMINATED' }),
    });
    if (!res.ok) { const d = await res.json(); alert('❌ ' + (d.message || 'HTTP ' + res.status)); return; }
    alert('✅ Опрос завершён!');
    renderPollView(login);
  } catch (e) { alert('❌ ' + e.message); }
}

async function renderMyProfile() {
  currentOpenCreator = null;
  const user = currentTwitchUser;
  if (!user) return;
  const token = localStorage.getItem('twitchAccessToken');
  let followers = 0;
  let streamInfo = null;
  try {
    const botToken = await getBotToken();
    const fModId = botToken?.id || user.id;
    const fHdrs = botToken ? { 'Authorization': 'Bearer ' + botToken.token, 'Client-Id': botToken.clientId || TWITCH_CLIENT_ID } : { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID };
    const flRes = await fetch('https://api.twitch.tv/helix/channels/followers?broadcaster_id=' + user.id + '&moderator_id=' + fModId + '&first=1', { headers: fHdrs });
    if (flRes.ok) { const flData = await flRes.json(); followers = flData.total || 0; }
    _creatorFollowersCache[user.login] = followers;
    const stRes = await fetch('https://api.twitch.tv/helix/streams?user_id=' + user.id, { headers: fHdrs });
    const stData = await stRes.json();
    streamInfo = stData.data && stData.data[0] ? stData.data[0] : null;
  } catch (e) {}
  const isLive = streamInfo ? 'Online' : 'Offline';
  const gameName = streamInfo ? streamInfo.game_name : '—';
  const title = streamInfo ? streamInfo.title : 'Нет в эфире';
  const viewers = streamInfo ? streamInfo.viewer_count : 0;
  const quality = analyzeQuality(followers, 0, viewers);
  const memberData = findMemberData(user.login);
  const hpScore = calculateHP(memberData);
  const hpInfo = hpInterpretation(hpScore);
  const hpDisplay = hpScore !== null ? hpScore + ' / 100' : '—';
  document.getElementById('creatorPage').innerHTML = `
    <div class="dash-grid">
      <div class="left-stack">
        <div class="profile big">
          <button class="btn" onclick="viewerTracker.stop();renderHome();activeNav('squad')">← На главную</button>
          <div class="profile-head" style="margin-top:24px">
            <img class="avatar" src="${user.profile_image_url}" alt="" style="object-fit:cover">
            <div><h2>${user.display_name}</h2><p class="muted">${user.description ? user.description.slice(0, 60) : '—'}</p></div>
          </div>
          <div class="metric-grid">
            ${metric('Фоловеры', followers)}
            ${metric('Роль', rolesDisplay())}
            ${metric('Статус', isLive)}
            ${metric('Формула HP', hpDisplay, hpInfo.level + hpBreakdown(memberData))}
            ${metric('Создан', new Date(user.created_at).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' }))}
          </div>
        </div>
        <div class="card">
          <h2>Текущий стрим</h2>
          <p class="muted" style="margin:8px 0">${title}</p>
          ${streamInfo ? '<div class="content-item"><span>Игра</span><b>' + gameName + '</b></div><div class="content-item"><span>Зрители</span><b>' + viewers + '</b></div>' : '<p class="muted">Не в эфире</p>'}
          ${quality.flags.length ? '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' + quality.flags.map(f => '<div style="font-size:13px;line-height:1.6;color:var(--muted)">' + f + '</div>').join('') + '</div>' : ''}
        </div>
      </div>
      <main class="dashboard-main card" style="padding:0">
        <div style="padding:30px 30px 0">
          <div class="dash-head" style="margin-bottom:0">
            <div><h1>Мой профиль</h1><p class="muted">Данные в реальном времени</p></div>
            <div><p class="muted">Статус</p><b style="color:${isLive === 'Online' ? 'var(--green)' : 'var(--muted)'}">${isLive}</b></div>
          </div>
        </div>
        ${streamInfo ? `
        <div style="padding:0 30px">
          <div class="analytics-grid" style="margin-top:0">
            <section class="card span-8">
              <h2>Сейчас в эфире</h2><p class="muted">${title}</p>
              <div class="metric-grid" style="margin-top:16px">
                ${metric('Зрители', viewers)}
                ${metric('Игра', gameName)}
                ${metric('Язык', streamInfo.language || '—')}
              </div>
            </section>
            <section class="card span-4">
              <h2>Канал</h2>
              <div class="content-item"><span>Фоловеры</span><b>${followers}</b></div>
              <div class="content-item"><span>Логин</span><b>${user.login}</b></div>
              <div class="content-item"><span>ID</span><b style="font-size:12px">${user.id}</b></div>
              <div class="content-item"><span>Качество ауд.</span><b style="color:${quality.color}">${quality.label}</b></div>
              <div style="display:flex;gap:6px;margin-top:10px">
                <a href="https://twitchtracker.com/${user.login}" target="_blank" class="btn" style="padding:6px 10px;font-size:11px;text-decoration:none;border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.15);color:white">📈 TwitchTracker</a>
                <a href="https://sullygnome.com/channel/${user.login}" target="_blank" class="btn" style="padding:6px 10px;font-size:11px;text-decoration:none;border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.15);color:white">📊 SullyGnome</a>
              </div>
            </section>
          </div>
        </div>` : `
        <div style="padding:0 30px">
          <div class="analytics-grid" style="margin-top:0">
            <section class="card span-8">
              <h2 style="color:var(--muted)">💤 Не в эфире</h2>
              <p class="muted" style="margin-top:6px">Ты офлайн — данные по прошлым стримам</p>
              <div class="metric-grid" style="margin-top:16px;grid-template-columns:repeat(2,1fr)">
                ${metric('Всего фоловеров', followers)}
                ${metric('Статус', 'Offline')}
              </div>
            </section>
            <section class="card span-4">
              <h2>Канал</h2>
              <div class="content-item"><span>Фоловеры</span><b>${followers}</b></div>
              <div class="content-item"><span>Логин</span><b>${user.login}</b></div>
              <div class="content-item"><span>ID</span><b style="font-size:12px">${user.id}</b></div>
              <div class="content-item"><span>Качество ауд.</span><b style="color:${quality.color}">${quality.label}</b></div>
              <div style="display:flex;gap:6px;margin-top:10px">
                <a href="https://twitchtracker.com/${user.login}" target="_blank" class="btn" style="padding:6px 10px;font-size:11px;text-decoration:none;border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.15);color:white">📈 TwitchTracker</a>
                <a href="https://sullygnome.com/channel/${user.login}" target="_blank" class="btn" style="padding:6px 10px;font-size:11px;text-decoration:none;border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.15);color:white">📊 SullyGnome</a>
              </div>
            </section>
          </div>
          ${quality.flags.length ? '<div style="padding:0 30px"><div style="padding:16px;border-radius:16px;background:rgba(255,255,255,.04)">' + quality.flags.map(f => '<div style="font-size:13px;line-height:1.7;color:var(--muted)">' + f + '</div>').join('') + '</div></div>' : ''}
        </div>`}
        <div class="tab-bar" style="margin:0 30px">
          <button class="tab-btn active" id="tabViewer_${user.login.replace(/[^a-z0-9]/gi, '')}" onclick="renderViewerAnalysis('${user.login}', '${user.id}')">📊 Анализ зрителей</button>
          <button class="tab-btn" id="tabCalendar_${user.login.replace(/[^a-z0-9]/gi, '')}" onclick="renderStreamCalendar('${user.login}', '${user.id}')">📅 Календарь стримов</button>
          <button class="tab-btn" id="tabTracker_${user.login.replace(/[^a-z0-9]/gi, '')}" onclick="renderTrackerStats('${user.login}', '${user.id}')">📊 Общие данные</button>
          <button class="tab-btn" id="tabAvg_${user.login.replace(/[^a-z0-9]/gi, '')}" onclick="renderAvgOnline('${user.login}', '${user.id}')">📈 Средний онлайн</button>
          <button class="tab-btn" id="tabCmds_${user.login.replace(/[^a-z0-9]/gi, '')}" onclick="renderStreamerCommands('${user.login}')">⚙️ Команды</button>
        </div>
        <div id="viewerAnalysis" style="padding:0 30px 30px"></div>
        <div id="streamCalendarContainer_${user.login.replace(/[^a-z0-9]/gi, '')}" style="padding:0 30px 30px;display:none"></div>
        <div id="trackerContainer_${user.login.replace(/[^a-z0-9]/gi, '')}" style="padding:0 30px 30px;display:none"></div>
        <div id="avgOnlineContainer_${user.login.replace(/[^a-z0-9]/gi, '')}" style="padding:0 30px 30px;display:none"></div>
        <div id="cmdsContainer_${user.login.replace(/[^a-z0-9]/gi, '')}" style="padding:0 30px 30px;display:none"></div>
      </main>
    </div>`;
  show('creatorPage');
  activeNav('me');
  if (user && user.id) {
    viewerTracker.start(user.id, user.login);
    setTimeout(() => viewerTracker.renderTable(), 2000);
  }
  renderStreamerCommands(user.login);
}

async function renderViewersPage() {
  viewerTracker.stop();
  activeNav('viewers');
  const [allSnap, members] = await Promise.all([db.ref('all-viewers').once('value'), loadTwitchUsers()]);
  const allViewers = allSnap.val() || {};
  const allMembers = members.filter(m => m.roles && (m.roles.squad || m.roles.academy));
  let viewerList = Object.entries(allViewers).map(([id, v]) => ({ id, login: v.login || '', displayName: v.displayName || v.login || id, profileImageUrl: v.profileImageUrl || '', firstSeen: v.firstSeen || 0, lastSeen: v.lastSeen || 0, channels: v.channels || {}, channelCount: Object.keys(v.channels || {}).length, createdAt: v.createdAt || '', description: v.description || '' }));
  if (_viewersFilterChannel) viewerList = viewerList.filter(v => v.channels[_viewersFilterChannel]);
  if (_viewersSearchQuery) { const q = _viewersSearchQuery.toLowerCase(); viewerList = viewerList.filter(v => v.login.toLowerCase().includes(q) || v.displayName.toLowerCase().includes(q)); }
  viewerList.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  const liveViewerIds = new Set();
  for (const m of allMembers) { const v = viewerTracker.viewers; for (const vid in v) liveViewerIds.add(vid); }
  const totalUnique = Object.keys(allViewers).length;
  document.getElementById('viewersPage').innerHTML = `
    <div class="page-card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;margin-bottom:24px">
        <div><h1>👁 Зрители которые смотрят</h1><p class="muted" style="margin-top:6px">Всего уникальных зрителей: ${totalUnique} | На этой странице: ${viewerList.length}</p></div>
        <button class="btn" onclick="renderViewersPage()" style="padding:8px 14px;font-size:13px">🔄 Обновить</button>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;align-items:center">
        <select id="viewersChannelFilter" onchange="_viewersFilterChannel=this.value;renderViewersPage()" style="padding:10px 14px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white;min-width:160px">
          <option value="">Все каналы</option>
          ${allMembers.map(m => '<option value="' + m.login + '" ' + (_viewersFilterChannel === m.login ? 'selected' : '') + '>' + m.displayName + '</option>').join('')}
        </select>
        <input type="text" id="viewersSearch" placeholder="Поиск по логину или имени..." oninput="_viewersSearchQuery=this.value;renderViewersPage()" style="flex:1;min-width:200px;padding:10px 14px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:white;" value="${_viewersSearchQuery}">
      </div>
      ${viewerList.length ? `
      <div style="overflow-x:auto;border-radius:20px;border:1px solid var(--border)">
        <table class="table" style="min-width:900px">
          <thead><tr><th>Зритель</th><th>Первый раз</th><th>Последний раз</th><th>Каналы</th><th>Аккаунт</th><th>Сейчас</th></tr></thead>
          <tbody>${viewerList.map(v => {
            const firstStr = v.firstSeen ? new Date(v.firstSeen).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
            const lastStr = v.lastSeen ? new Date(v.lastSeen).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
            const daysOld = v.createdAt ? Math.floor((Date.now() - new Date(v.createdAt).getTime()) / 86400000) : null;
            const chList = Object.keys(v.channels);
            const isOnline = liveViewerIds.has(v.id);
            return '<tr onclick="openViewerProfile(\'' + (v.id || '').replace(/'/g, "\\'") + '\')" style="cursor:pointer">' +
              '<td><div class="creator-cell">' + (v.profileImageUrl ? '<img class="mini-avatar" src="' + v.profileImageUrl + '" style="object-fit:cover;border-radius:50%">' : '<div class="mini-avatar"></div>') + '<div><b>' + v.displayName + '</b><p class="muted">@' + v.login + '</p></div></div></td>' +
              '<td style="font-size:13px">' + firstStr + '</td>' +
              '<td style="font-size:13px">' + lastStr + '</td>' +
              '<td><div style="display:flex;flex-wrap:wrap;gap:4px">' + chList.slice(0, 3).map(ch => '<span class="tag" style="cursor:pointer;font-size:11px" onclick="event.stopPropagation();_viewersFilterChannel=\'' + ch + '\';renderViewersPage()">' + ch + '</span>').join('') + (chList.length > 3 ? ' <span class="tag" style="font-size:11px">+' + (chList.length - 3) + '</span>' : '') + '</div></td>' +
              '<td style="font-size:13px">' + (daysOld !== null ? (daysOld < 30 ? '<span style="color:#facc15">' + daysOld + ' дн.</span>' : daysOld + ' дн.') : '—') + '</td>' +
              '<td>' + (isOnline ? '<span style="color:var(--green);font-size:13px">● Online</span>' : '<span class="muted" style="font-size:13px">○ Offline</span>') + '</td></tr>';
          }).join('')}</tbody>
        </table>
      </div>` : '<div style="padding:40px;text-align:center"><p class="muted">Зрители не найдены. Данные появятся после того, как кто-то откроет страницу криэйтера и в чате будут зрители.</p></div>'}
    </div>`;
  show('viewersPage');
}

async function renderCheckUser() {
  viewerTracker.stop();
  activeNav('checkuser');
  const [members] = await Promise.all([loadTwitchUsers()]);
  const allMembers = members.filter(m => m.roles && (m.roles.squad || m.roles.academy));
  document.getElementById('checkUserPage').innerHTML = `
    <div class="page-card">
      <h1>🔍 Проверить пользователя</h1>
      <p class="muted" style="margin-top:6px">Введи логин Twitch — узнай, где он сейчас в чатах RGB и где был раньше</p>
      <div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap">
        <input type="text" id="checkUserInput" placeholder="Логин пользователя..." onkeydown="if(event.key==='Enter') runCheckUser()" style="flex:1;min-width:200px;padding:12px 16px;border-radius:14px;border:1px solid var(--border);background:var(--panel);color:white;font-size:15px">
        <button class="btn primary" onclick="runCheckUser()">🔍 Проверить</button>
      </div>
      <div id="checkUserResult" style="margin-top:24px"></div>
    </div>`;
  show('checkUserPage');
  setTimeout(() => document.getElementById('checkUserInput')?.focus(), 100);
}

async function runCheckUser() {
  const result = document.getElementById('checkUserResult');
  const login = document.getElementById('checkUserInput')?.value.trim().toLowerCase();
  if (!login) { result.innerHTML = '<p class="muted">Введи логин</p>'; return; }
  result.innerHTML = '<p class="muted">🔍 Ищем пользователя <b>' + login + '</b>…</p>';
  try {
    const token = localStorage.getItem('twitchAccessToken');
    if (!token) { result.innerHTML = '<p style="color:#ef4444">❌ Нет авторизации</p>'; return; }
    const uRes = await fetch('https://api.twitch.tv/helix/users?login=' + login, { headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID } });
    if (!uRes.ok) { result.innerHTML = '<p style="color:#ef4444">❌ Пользователь не найден в Twitch</p>'; return; }
    const uData = await uRes.json();
    const user = uData.data?.[0];
    if (!user) { result.innerHTML = '<p style="color:#ef4444">❌ Пользователь не найден</p>'; return; }
    const members = (await loadTwitchUsers()).filter(m => m.roles && (m.roles.squad || m.roles.academy));
    const botToken = await getBotToken();
    const modId = currentTwitchUser?.id || user.id;
    const onlineMembers = members.filter(m => m.isLive && m.twitchId);
    const now = Date.now();
    const allViewersSnap = await db.ref('all-viewers/' + user.id).once('value');
    const allViewersData = allViewersSnap.val();
    const historyChannels = allViewersData?.channels || {};
    const historyFirstSeen = allViewersData?.firstSeen || 0;
    const historyLastSeen = allViewersData?.lastSeen || 0;
    const historyCategories = allViewersData?.categories || {};
    let html = '<div class="page-card" style="padding:28px">';
    html += '<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap">';
    html += (user.profile_image_url ? '<img src="' + user.profile_image_url + '" style="width:64px;height:64px;border-radius:50%;object-fit:cover">' : '<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--fuchsia))"></div>');
    html += '<div style="flex:1;min-width:200px"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b style="font-size:22px">' + user.display_name + '</b><span style="font-size:13px;color:var(--muted)">@' + user.login + '</span></div><p class="muted" style="font-size:13px;margin-top:4px">Создан ' + new Date(user.created_at).toLocaleDateString('ru-RU') + '</p></div>';
    html += '<div style="text-align:right"><a href="https://twitch.tv/' + user.login + '" target="_blank" class="btn" style="padding:8px 14px;font-size:13px;text-decoration:none">Открыть Twitch →</a></div></div>';
    let onlineChannels = [];
    if (onlineMembers.length > 0) {
      html += '<p class="muted" style="margin-bottom:16px">🔍 Проверяю <b>' + onlineMembers.length + '</b> каналов в эфире…</p>';
      for (const m of onlineMembers) {
        try {
          const cModId = botToken?.id || modId;
          const cHdrs = botToken ? { 'Authorization': 'Bearer ' + botToken.token, 'Client-Id': botToken.clientId || TWITCH_CLIENT_ID } : { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID };
          const cRes = await fetch('https://api.twitch.tv/helix/chat/chatters?broadcaster_id=' + m.twitchId + '&moderator_id=' + cModId + '&first=1000', { headers: cHdrs });
          if (!cRes.ok) continue;
          const cData = await cRes.json();
          const chatters = cData.data || [];
          const match = chatters.find(c => c.user_id === user.id || c.user_login?.toLowerCase() === login);
          if (match) onlineChannels.push({ member: m, chatter: match });
        } catch (e) {}
      }
    }
    const hasOnline = onlineChannels.length > 0;
    const hasHistory = Object.keys(historyChannels).length > 0;
    if (hasOnline) {
      html += '<div style="padding:20px;border-radius:16px;border:1px solid rgba(74,222,128,.3);background:rgba(74,222,128,.08);display:flex;align-items:center;gap:14px;margin-bottom:20px"><span style="font-size:32px">🟢</span><div><b style="font-size:18px;color:#4ade80">В чате прямо сейчас</b><p class="muted">Найден в ' + onlineChannels.length + ' ' + (onlineChannels.length === 1 ? 'канале' : 'каналах') + ' RGB Network</p></div></div>';
    } else if (hasHistory) {
      const lastSeenStr = historyLastSeen ? new Date(historyLastSeen).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '—';
      html += '<div style="padding:20px;border-radius:16px;border:1px solid rgba(250,204,21,.3);background:rgba(250,204,21,.08);display:flex;align-items:center;gap:14px;margin-bottom:20px"><span style="font-size:32px">🟡</span><div><b style="font-size:18px;color:#facc15">Был в чатах ранее</b><p class="muted">Последний раз: ' + lastSeenStr + ' &bull; ' + Object.keys(historyChannels).length + ' каналов</p></div></div>';
    } else {
      html += '<div style="padding:20px;border-radius:16px;border:1px solid rgba(239,68,68,.2);background:rgba(239,68,68,.06);display:flex;align-items:center;gap:14px;margin-bottom:20px"><span style="font-size:32px">⚫</span><div><b style="font-size:18px;color:#ef4444">Не найден в RGB Network</b><p class="muted">Не отслеживается в чатах участников</p></div></div>';
    }
    const daysOld = Math.floor((now - new Date(user.created_at).getTime()) / 86400000);
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">';
    html += '<div class="metric" style="flex:1;min-width:120px"><p>Аккаунт</p><strong style="font-size:20px">' + daysOld + ' дн.</strong></div>';
    html += '<div class="metric" style="flex:1;min-width:120px"><p>Сейчас в чатах</p><strong style="font-size:20px;color:' + (hasOnline ? '#4ade80' : 'var(--muted)') + '">' + (hasOnline ? onlineChannels.length : '—') + '</strong></div>';
    html += '<div class="metric" style="flex:1;min-width:120px"><p>Был в каналах</p><strong style="font-size:20px">' + Object.keys(historyChannels).length + '</strong></div>';
    html += '<div class="metric" style="flex:1;min-width:120px"><p>Категорий</p><strong style="font-size:20px">' + Object.keys(historyCategories).length + '</strong></div></div>';
    const fbUpdates = {};
    fbUpdates['all-viewers/' + user.id + '/login'] = user.login;
    fbUpdates['all-viewers/' + user.id + '/displayName'] = user.display_name;
    fbUpdates['all-viewers/' + user.id + '/profileImageUrl'] = user.profile_image_url || '';
    fbUpdates['all-viewers/' + user.id + '/createdAt'] = user.created_at || '';
    fbUpdates['all-viewers/' + user.id + '/description'] = user.description || '';
    fbUpdates['all-viewers/' + user.id + '/firstSeen'] = historyFirstSeen || now;
    fbUpdates['all-viewers/' + user.id + '/lastSeen'] = now;
    for (const oc of onlineChannels) {
      const chLogin = oc.member.login;
      const existingCh = historyChannels[chLogin] || {};
      fbUpdates['all-viewers/' + user.id + '/channels/' + chLogin + '/firstSeen'] = Math.min(existingCh.firstSeen || now, now);
      fbUpdates['all-viewers/' + user.id + '/channels/' + chLogin + '/lastSeen'] = now;
      const chHistoryPath = 'viewer-history/' + chLogin + '/' + user.id;
      try {
        const chSnap = await db.ref(chHistoryPath).once('value');
        const chData = chSnap.val() || {};
        await db.ref(chHistoryPath).update({ login: user.login, displayName: user.display_name, profileImageUrl: user.profile_image_url || '', createdAt: user.created_at || '', description: user.description || '', firstSeen: chData.firstSeen || now, lastSeen: now });
      } catch (e) {}
    }
    try { await db.ref().update(fbUpdates); } catch (e) {}
    if (hasOnline) {
      html += '<div style="margin-bottom:20px"><h3 style="font-size:16px;margin-bottom:12px">🟢 Сейчас в чате</h3><div style="display:grid;gap:10px">';
      for (const oc of onlineChannels) {
        const m = oc.member;
        html += '<div style="padding:16px;border-radius:14px;border:1px solid rgba(74,222,128,.25);background:rgba(74,222,128,.06);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">';
        html += '<div style="display:flex;align-items:center;gap:12px">' + (m.profileImageUrl ? '<img src="' + m.profileImageUrl + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover">' : '<div style="width:40px;height:40px;border-radius:50%;background:var(--purple)"></div>') + '<div><b>' + m.displayName + '</b><p class="muted" style="font-size:12px">🎮 ' + (m.gameName || '—') + ' &bull; 👁 ' + m.viewers + ' зр.</p></div></div>';
        html += '<div style="display:flex;align-items:center;gap:10px"><span style="width:8px;height:8px;border-radius:50%;background:#4ade80;display:inline-block"></span><span style="color:#4ade80;font-size:13px;font-weight:600">LIVE</span><button class="btn" onclick="openCreator(\'' + m.login + '\')" style="padding:6px 12px;font-size:12px">Открыть</button></div></div>';
      }
      html += '</div></div>';
    }
    if (hasHistory) {
      const chEntries = Object.entries(historyChannels).map(([chLogin, chData]) => {
        const member = members.find(m => m.login === chLogin);
        const isLive = member?.isLive || false;
        const isOnlineNow = onlineChannels.some(oc => oc.member.login === chLogin);
        return { login: chLogin, displayName: member?.displayName || chLogin, avatar: member?.profileImageUrl || '', isLive, isOnlineNow, firstSeen: chData.firstSeen || 0, lastSeen: chData.lastSeen || 0, game: member?.gameName || '' };
      }).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      html += '<h3 style="font-size:16px;margin-bottom:12px">📋 История посещений каналов</h3><div style="overflow-x:auto;border-radius:16px;border:1px solid var(--border)"><table class="table" style="min-width:700px"><thead><tr><th>Канал</th><th>Статус</th><th>Первый раз</th><th>Последний раз</th><th></th></tr></thead><tbody>';
      for (const ch of chEntries) {
        const firstStr = ch.firstSeen ? new Date(ch.firstSeen).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
        const lastStr = ch.lastSeen ? new Date(ch.lastSeen).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
        let statusHtml = '';
        if (ch.isOnlineNow) statusHtml = '<span style="color:#4ade80;font-weight:600">● Сейчас в чате</span>';
        else if (ch.isLive) statusHtml = '<span style="color:#22d3ee">● В эфире (не в чате)</span>';
        else statusHtml = '<span class="muted">○ Офлайн</span>';
        html += '<tr onclick="' + (ch.isLive ? "openCreator('" + ch.login + "')" : '') + '" style="cursor:' + (ch.isLive ? 'pointer' : 'default') + '">';
        html += '<td><div class="creator-cell">' + (ch.avatar ? '<img class="mini-avatar" src="' + ch.avatar + '" style="object-fit:cover;border-radius:50%">' : '<div class="mini-avatar"></div>') + '<div><b>' + ch.displayName + '</b><p class="muted">@' + ch.login + '</p></div></div></td>';
        html += '<td>' + statusHtml + '</td><td style="font-size:13px">' + firstStr + '</td><td style="font-size:13px">' + lastStr + '</td>';
        html += '<td>' + (ch.isLive ? '<span style="color:var(--purple);font-size:12px">→</span>' : '') + '</td></tr>';
      }
      html += '</tbody></table></div>';
      if (Object.keys(historyCategories).length > 0) {
        const catEntries = Object.entries(historyCategories).sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
        html += '<div style="margin-top:16px"><h3 style="font-size:16px;margin-bottom:12px">🎮 Интересы (категории)</h3><div style="display:flex;flex-wrap:wrap;gap:8px">';
        for (const [cat, data] of catEntries) {
          html += '<span class="tag" style="font-size:12px;padding:6px 12px;background:rgba(168,85,247,.08);border-color:rgba(168,85,247,.15)">' + cat.slice(0, 30) + ' <span style="color:var(--muted);font-size:11px">(' + (data.count || 0) + ')</span></span>';
        }
        html += '</div></div>';
      }
    }
    html += '<p class="muted" style="font-size:12px;margin-top:20px">🕐 Проверено: ' + msk().full + '</p></div>';
    result.innerHTML = html;
  } catch (e) {
    result.innerHTML = '<p style="color:#ef4444">❌ Ошибка: ' + e.message + '</p>';
  }
  show('checkUserPage');
}

function renderInfo(type) {
  const map = {
    watching: ['Что смотрят', 'Игры и категории, которые дают лучший watch time.', [['Minecraft', '166h', 'основной контент'], ['Just Chatting', '24h', 'лучшее вовлечение'], ['PEAK', '15h', 'эксперименты']]],
    similar: ['Похожий контент', 'Контентные направления, похожие на текущую стратегию RGB.', [['Minecraft SMP', 'High', 'сильное совпадение'], ['Cozy Gaming', 'Medium', 'хорошая совместимость'], ['Community Events', 'High', 'рост удержания']]]
  };
  const d = map[type];
  document.getElementById('infoPage').innerHTML = '<div class="page-card"><h1>' + d[0] + '</h1><p class="lead">' + d[1] + '</p><div class="top-grid" style="margin-top:26px">' + d[2].map(x => metric(x[0], x[1], x[2])).join('') + '</div></div>';
  show('infoPage');
}

function drawChart() {
  const canvas = document.getElementById('chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = r.width * dpr;
  canvas.height = r.height * dpr;
  ctx.scale(dpr, dpr);
  const p = 34, w = r.width - p * 2, h = r.height - p * 2;
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  for (let i = 0; i < 4; i++) { const y = p + h / 3 * i; ctx.beginPath(); ctx.moveTo(p, y); ctx.lineTo(p + w, y); ctx.stroke(); }
  const pts = [[p, p + h * .78], [p + w * .25, p + h * .7], [p + w * .45, p + h * .45], [p + w * .7, p + h * .32], [p + w, p + h * .12]];
  const gr = ctx.createLinearGradient(0, p, 0, p + h);
  gr.addColorStop(0, 'rgba(168,85,247,.45)');
  gr.addColorStop(1, 'rgba(168,85,247,0)');
  ctx.beginPath();
  pts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
  ctx.lineTo(p + w, p + h); ctx.lineTo(p, p + h); ctx.closePath();
  ctx.fillStyle = gr; ctx.fill();
  ctx.beginPath();
  pts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  ['Aug', 'Sep', 'Oct', 'Nov'].forEach((m, i) => { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = '14px system-ui'; ctx.fillText(m, p + i * (w / 3), p + h + 24); });
}
