const _streamVodCache = {};

function hideAllTabs(login, except) {
  const safe = login.replace(/[^a-z0-9]/gi, '');
  const tabs = ['viewerAnalysis', 'streamCalendarContainer_', 'trackerContainer_', 'avgOnlineContainer_', 'cmdsContainer_', 'pollContainer_'];
  for (const t of tabs) {
    if (t === except || (except && t + safe === except)) continue;
    if (t === 'viewerAnalysis') {
      const el = document.getElementById(t);
      if (el) el.style.display = 'none';
    } else {
      const el = document.getElementById(t + safe);
      if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    }
  }
}

const viewerTracker = {
  viewers: {},
  history: {},
  _interval: null,
  _broadcasterId: null,
  _broadcasterLogin: null,
  _currentLiveIds: new Set(),
  _showCurrentOnly: false,

  async start(broadcasterId, broadcasterLogin) {
    this._broadcasterId = broadcasterId;
    this._broadcasterLogin = broadcasterLogin;
    this.viewers = {};
    this._showCurrentOnly = false;
    if (this._interval) clearInterval(this._interval);
    try {
      const snap = await db.ref('viewer-history/' + broadcasterLogin).once('value');
      const history = snap.val() || {};
      const now = Date.now();
      for (const vid in history) {
        const h = history[vid];
        this.viewers[vid] = {
          userId: vid, login: h.login || '', displayName: h.displayName || h.login || '',
          profileImageUrl: h.profileImageUrl || '', createdAt: h.createdAt || null,
          description: h.description || '', firstSeen: h.firstSeen || now, lastSeen: h.lastSeen || now, totalSessions: 1, _fromHistory: true
        };
      }
    } catch (e) { console.warn('Failed to load viewer history:', e); }
    this._poll();
  },

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this._broadcasterId = null;
    this._broadcasterLogin = null;
  },

  async _poll() {
    const id = this._broadcasterId;
    const login = this._broadcasterLogin;
    if (!id) return;
    const token = localStorage.getItem('twitchAccessToken');
    const modId = currentTwitchUser?.id;
    if (!token || !modId) return;
    const botToken = await getBotToken();
    let chattersRes;
    try {
      const now = Date.now();

      // 1) Пробуем токен самого стримера (из Firebase) — он всегда видит свой чат
      if (!chattersRes || !chattersRes.ok) {
        try {
          const snap = await db.ref('twitch-users/' + login + '/tokens/access_token').once('value');
          const streamerToken = snap.val();
          if (streamerToken) {
            chattersRes = await fetch('https://api.twitch.tv/helix/chat/chatters?broadcaster_id=' + id + '&moderator_id=' + id + '&first=100', {
              headers: { 'Authorization': 'Bearer ' + streamerToken, 'Client-Id': TWITCH_CLIENT_ID }
            });
          }
        } catch (e) {}
      }

      // 2) Пробуем токен бота (если бот модер)
      if ((!chattersRes || !chattersRes.ok) && botToken && botToken.id) {
        chattersRes = await fetch('https://api.twitch.tv/helix/chat/chatters?broadcaster_id=' + id + '&moderator_id=' + botToken.id + '&first=100', {
          headers: { 'Authorization': 'Bearer ' + botToken.token, 'Client-Id': botToken.clientId || TWITCH_CLIENT_ID }
        });
      }

      // 3) Если текущий пользователь — сам стример, пробуем его токен из localStorage
      if ((!chattersRes || !chattersRes.ok) && modId === id) {
        chattersRes = await fetch('https://api.twitch.tv/helix/chat/chatters?broadcaster_id=' + id + '&moderator_id=' + id + '&first=100', {
          headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID }
        });
      }

      if (!chattersRes || !chattersRes.ok) return;
      const data = await chattersRes.json();
      const currentIds = new Set();
      this._currentLiveIds = currentIds;
      const chatters = data.data || [];
      const ids = chatters.map(c => c.user_id).filter(Boolean);
      let userMap = {};
      if (ids.length > 0) {
        const uRes = await fetch('https://api.twitch.tv/helix/users?id=' + ids.join('&id='), {
          headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID }
        });
        if (uRes.ok) { const uData = await uRes.json(); (uData.data || []).forEach(u => { userMap[u.id] = u; }); }
      }
      for (const c of chatters) {
        const vid = c.user_id;
        currentIds.add(vid);
        const u = userMap[vid] || {};
        if (!this.viewers[vid]) {
          this.viewers[vid] = { userId: vid, login: c.user_login || u.login, displayName: u.display_name || c.user_name || c.user_login, profileImageUrl: u.profile_image_url || '', createdAt: u.created_at || null, description: u.description || '', firstSeen: now, lastSeen: now, totalSessions: 1 };
        } else {
          this.viewers[vid].lastSeen = now;
          this.viewers[vid].displayName = u.display_name || this.viewers[vid].displayName;
          this.viewers[vid].profileImageUrl = u.profile_image_url || this.viewers[vid].profileImageUrl;
          this.viewers[vid].createdAt = u.created_at || this.viewers[vid].createdAt;
          this.viewers[vid].description = u.description || this.viewers[vid].description;
        }
      }

      // Добавляем текущего пользователя сайта, если смотрит
      if (modId && currentTwitchUser?.login) {
        currentIds.add(modId);
        if (!this.viewers[modId]) {
          this.viewers[modId] = {
            userId: modId, login: currentTwitchUser.login, displayName: currentTwitchUser.displayName || currentTwitchUser.login,
            profileImageUrl: currentTwitchUser.profileImageUrl || '', createdAt: null, description: '',
            firstSeen: now, lastSeen: now, totalSessions: 1,
          };
        } else {
          this.viewers[modId].lastSeen = now;
        }
      }

      for (const vid in this.viewers) {
        if (!currentIds.has(vid)) {
          const v = this.viewers[vid];
          if (v.lastSeen === v.firstSeen) v.lastSeen = now - 15000;
        }
      }
      const ve = document.getElementById('viewerAnalysis');
      if (ve && !ve.classList.contains('hidden')) this.renderTable();
      if (!this._lastSaveTime || Date.now() - this._lastSaveTime > 30000) {
        this._lastSaveTime = now;
        this._saveToFirebase();
      }
    } catch (e) {}
  },

  _saveToFirebase() {
    const channelLogin = this._broadcasterLogin;
    if (!channelLogin || Object.keys(this.viewers).length === 0) return;
    (async () => {
      try {
        const vids = Object.keys(this.viewers);
        const [channelSnap, allSnap, streamSnap] = await Promise.all([
          db.ref('viewer-history/' + channelLogin).once('value'),
          db.ref('all-viewers').once('value'),
          db.ref('stream-cache/' + channelLogin).once('value')
        ]);
        const existingChannel = channelSnap.val() || {};
        const existingAll = allSnap.val() || {};
        const cachedStream = streamSnap.val() || {};
        let currentGame = cachedStream.game || '';
        if (!currentGame && this._broadcasterId) {
          try {
            const bt = await getBotToken();
            const hdrs = bt ? { 'Authorization': 'Bearer ' + bt.token, 'Client-Id': TWITCH_CLIENT_ID } : (localStorage.getItem('twitchAccessToken') ? { 'Authorization': 'Bearer ' + localStorage.getItem('twitchAccessToken'), 'Client-Id': TWITCH_CLIENT_ID } : null);
            if (hdrs) {
              const stRes = await fetch('https://api.twitch.tv/helix/streams?user_id=' + this._broadcasterId, { headers: hdrs });
              const stData = await stRes.json();
              if (stData.data && stData.data[0]) currentGame = stData.data[0].game_name;
            }
          } catch (e) {}
        }
        const updates = {};
        for (const vid of vids) {
          const v = this.viewers[vid];
          if (!v.login) continue;
          const eCh = existingChannel[vid] || {};
          const eAll = existingAll[vid] || {};
          const eChCh = (eAll.channels && eAll.channels[channelLogin]) || {};
          const chFirst = Math.min(v.firstSeen, eCh.firstSeen || v.firstSeen);
          const chLast = Math.max(v.lastSeen, eCh.lastSeen || v.lastSeen);
          const allFirst = Math.min(v.firstSeen, eAll.firstSeen || v.firstSeen);
          const allLast = Math.max(v.lastSeen, eAll.lastSeen || 0);
          updates['viewer-history/' + channelLogin + '/' + vid + '/login'] = v.login;
          updates['viewer-history/' + channelLogin + '/' + vid + '/displayName'] = v.displayName || v.login;
          updates['viewer-history/' + channelLogin + '/' + vid + '/profileImageUrl'] = v.profileImageUrl || '';
          updates['viewer-history/' + channelLogin + '/' + vid + '/createdAt'] = v.createdAt || '';
          updates['viewer-history/' + channelLogin + '/' + vid + '/description'] = v.description || '';
          updates['viewer-history/' + channelLogin + '/' + vid + '/firstSeen'] = chFirst;
          updates['viewer-history/' + channelLogin + '/' + vid + '/lastSeen'] = chLast;
          updates['all-viewers/' + vid + '/login'] = v.login;
          updates['all-viewers/' + vid + '/displayName'] = v.displayName || v.login;
          updates['all-viewers/' + vid + '/profileImageUrl'] = v.profileImageUrl || '';
          updates['all-viewers/' + vid + '/createdAt'] = v.createdAt || '';
          updates['all-viewers/' + vid + '/description'] = v.description || '';
          updates['all-viewers/' + vid + '/firstSeen'] = allFirst;
          updates['all-viewers/' + vid + '/lastSeen'] = allLast;
          updates['all-viewers/' + vid + '/channels/' + channelLogin + '/firstSeen'] = Math.min(v.firstSeen, eChCh.firstSeen || v.firstSeen);
          updates['all-viewers/' + vid + '/channels/' + channelLogin + '/lastSeen'] = chLast;
          if (currentGame) {
            const eCat = (eAll.categories && eAll.categories[currentGame]) || {};
            updates['all-viewers/' + vid + '/categories/' + currentGame + '/count'] = (eCat.count || 0) + 1;
            updates['all-viewers/' + vid + '/categories/' + currentGame + '/lastSeen'] = Date.now();
          }
        }
        if (currentGame) {
          updates['stream-cache/' + channelLogin + '/game'] = currentGame;
          updates['stream-cache/' + channelLogin + '/updatedAt'] = Date.now();
        }
        await db.ref().update(updates);
        const now = Date.now();
        if (!this._lastChunkTime || now - this._lastChunkTime > 900000) {
          this._lastChunkTime = now;
          const d = new Date();
          const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          const viewerCount = Object.keys(this.viewers).length;
          try {
            await db.ref('stream-chunks/' + channelLogin + '/' + dateStr + '/' + now).set({ viewers: viewerCount, game: currentGame || 'unknown', updatedAt: now });
          } catch (e) { console.warn('Chunk save error:', e); }
        }
      } catch (e) { console.warn('Firebase viewer save error:', e); }
    })();
  },

  analyzeViewer(v) {
    if (!v) return { score: 0, level: '✅ Обычный', reasons: ['Нет данных'], color: '#4ade80' };
    const reasons = [];
    let score = 0;
    if (v.createdAt) {
      const days = (Date.now() - new Date(v.createdAt).getTime()) / 86400000;
      if (days < 2) { score += 40; reasons.push('🔴 Аккаунт создан ' + Math.floor(days) + 'д назад (< 2 дней)'); }
      else if (days < 7) { score += 20; reasons.push('🟡 Аккаунт создан ' + Math.floor(days) + 'д назад (< недели)'); }
      else if (days < 30) { score += 10; reasons.push('🟢 Аккаунт свежий (' + Math.floor(days) + 'д)'); }
      else if (days < 90) { score += 3; reasons.push('🟢 Аккаунту < 3 мес (' + Math.floor(days) + 'д)'); }
      else { score -= 10; reasons.push('✅ Аккаунт зрелый (' + Math.floor(days) + 'д)'); }
    } else { score += 10; reasons.push('🟡 Нет даты создания'); }
    if (v.login) {
      const n = v.login.toLowerCase();
      if (/^[a-z]\d{8,}$/.test(n)) { score += 20; reasons.push('🟡 Имя похоже на авто-генерацию (буква + 8+ цифр)'); }
      if (/^[a-z0-9]{16,}$/.test(n)) { score += 15; reasons.push('🟡 Очень длинное имя (' + n.length + ' симв.)'); }
      if (/(.)\1{6,}/.test(n)) { score += 10; reasons.push('🟡 Много повторяющихся символов в имени'); }
    }
    const duration = v.lastSeen - v.firstSeen;
    const durMin = Math.floor(duration / 60000);
    if (durMin < 1) { score += 5; reasons.push('🟡 Сидит менее минуты'); }
    else if (durMin < 5) { reasons.push('🟢 Сидит ' + durMin + ' мин'); }
    else if (durMin < 30) { reasons.push('✅ Сидит ' + durMin + ' мин'); }
    else { score -= 5; reasons.push('🔥 Сидит ' + durMin + ' мин (постоянный)'); }
    const totalScore = Math.max(0, Math.min(100, score));
    const level = totalScore >= 50 ? '⚠️ Подозрительный' : totalScore >= 25 ? '🔍 Обратить внимание' : '✅ Обычный';
    const color = totalScore >= 50 ? '#ef4444' : totalScore >= 25 ? '#facc15' : '#4ade80';
    return { score: totalScore, level, reasons, color };
  },

  getViewers() {
    let list = Object.values(this.viewers);
    if (this._showCurrentOnly && this._currentLiveIds.size > 0) list = list.filter(v => this._currentLiveIds.has(v.userId));
    return list.map(v => ({ ...v, analysis: this.analyzeViewer(v) })).sort((a, b) => b.analysis.score - a.analysis.score);
  },

  renderTable() {
    const container = document.getElementById('viewerAnalysis');
    if (!container) return;
    const list = this.getViewers();
    const suspicious = list.filter(v => v.analysis.score >= 25);
    container.innerHTML = `
      <div class="page-card" style="margin-top:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px">
          <div><h2 style="font-size:24px">👁 Анализ зрителей</h2>
          <p class="muted">${this._showCurrentOnly ? 'Сейчас в чате' : 'Всего зрителей'}: ${list.length} ${suspicious.length ? '| ⚠️ Подозрительных: ' + suspicious.length : ''}</p></div>
          <div style="display:flex;gap:8px">
            <button class="btn ${!this._showCurrentOnly ? 'primary' : ''}" onclick="viewerTracker._showCurrentOnly=false;viewerTracker.renderTable()" style="padding:6px 12px;font-size:12px">📋 Все</button>
            <button class="btn ${this._showCurrentOnly ? 'primary' : ''}" onclick="viewerTracker._showCurrentOnly=true;viewerTracker.renderTable()" style="padding:6px 12px;font-size:12px">🟢 В чате</button>
            <button class="btn" onclick="viewerTracker._poll();viewerTracker.renderTable()" style="padding:6px 12px;font-size:12px">🔄</button>
          </div>
        </div>
        ${list.length ? `
        <div style="overflow-x:auto;border-radius:20px;border:1px solid var(--border)">
          <table class="table" style="min-width:900px">
            <thead><tr>
              <th>Зритель</th><th>Время в чате</th><th>Аккаунт</th><th>Описание</th><th>Статус</th><th>Риск</th><th></th>
            </tr></thead>
            <tbody>${list.map(v => {
            const dur = v.lastSeen - v.firstSeen;
            const durStr = dur < 60000 ? '<1 мин' : Math.floor(dur / 60000) + ' мин';
            const daysOld = v.createdAt ? Math.floor((Date.now() - new Date(v.createdAt).getTime()) / 86400000) : '—';
            return `<tr onclick="openViewerProfile('${(v.userId || v.login || '').replace(/'/g, "\\'")}')" style="cursor:pointer">
              <td><div class="creator-cell">
                ${v.profileImageUrl ? '<img class="mini-avatar" src="' + v.profileImageUrl + '" style="object-fit:cover;border-radius:50%">' : '<div class="mini-avatar"></div>'}
                <div><b>${v.displayName || v.login}</b><p class="muted">@${v.login || ''}</p></div>
              </div></td>
              <td>${durStr}</td>
              <td style="font-size:13px">${daysOld !== '—' ? daysOld + ' дн.' : '—'}</td>
              <td style="font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)">${(v.description || '—').slice(0, 40)}</td>
              <td><span style="color:${v.analysis.score >= 50 ? '#ef4444' : v.analysis.score >= 25 ? '#facc15' : '#4ade80'};font-size:13px">${v.analysis.level.split(' ')[0]}</span></td>
              <td><div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden;min-width:60px">
                  <div style="width:${v.analysis.score}%;height:100%;border-radius:3px;background:${v.analysis.color}"></div>
                </div>
                <span style="font-size:12px;color:${v.analysis.color};white-space:nowrap">${v.analysis.score}%</span>
              </div></td>
              <td><span style="color:var(--purple);font-size:12px">→</span></td>
            </tr>`;
          }).join('')}</tbody>
          </table>
        </div>
        ${suspicious.length ? '<div style="margin-top:16px;padding:14px 18px;border-radius:16px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2)"><p style="color:#fca5a5;font-weight:700;margin-bottom:8px">⚠️ Подозрительные зрители</p>' + suspicious.map(v => '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer" onclick="openViewerProfile(\'' + (v.userId || v.login || '').replace(/'/g, "\\'") + '\')"><span><b>' + (v.displayName || v.login) + '</b> <span class="muted">— ' + v.analysis.reasons.slice(0, 2).join(', ') + '</span></span><span style="color:' + v.analysis.color + ';font-weight:700">' + v.analysis.score + '%</span></div>').join('') + '</div>' : ''}
        ` : '<p class="muted" style="padding:20px;text-align:center">Нет зрителей в чате. Стример не в эфире или нет доступа к чату.</p>'}
      </div>`;
  }
};

function renderViewerAnalysis(login, userId) {
  setActiveTab(login, 'viewer');
  viewerTracker.stop();
  hideAllTabs(login, 'viewerAnalysis');
  const ve = document.getElementById('viewerAnalysis');
  if (ve) { ve.style.display = 'block'; ve.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  viewerTracker.start(userId, login);
  setTimeout(() => viewerTracker.renderTable(), 2000);
}

async function renderAvgOnline(login, userId) {
  setActiveTab(login, 'avg');
  viewerTracker.stop();
  const safe = login.replace(/[^a-z0-9]/gi, '');
  hideAllTabs(login, 'avgOnlineContainer_' + safe);
  const container = document.getElementById('avgOnlineContainer_' + safe);
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = '<p class="muted" style="padding:20px;text-align:center">📈 Загрузка...</p>';
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const allSnap = await db.ref('stream-chunks/' + login).once('value');
    const allVal = allSnap.val() || {};
    const monthData = {};
    let totalDays = 0, totalViewers = 0, totalSamples = 0, maxPeakOverall = 0;
    for (const dateStr of Object.keys(allVal)) {
      let daySum = 0, dayCount = 0, dayPeak = 0;
      for (const ts of Object.keys(allVal[dateStr])) {
        const c = allVal[dateStr][ts];
        const v = c.viewers || 0;
        daySum += v; dayCount++;
        if ((c.peakViewers || v) > dayPeak) dayPeak = c.peakViewers || v;
      }
      if (!dayCount) continue;
      totalDays++; totalViewers += daySum; totalSamples += dayCount;
      if (dayPeak > maxPeakOverall) maxPeakOverall = dayPeak;
      const m = dateStr.slice(0, 7);
      if (!monthData[m]) monthData[m] = { sum: 0, count: 0, peak: 0, days: 0 };
      monthData[m].sum += daySum; monthData[m].count += dayCount;
      if (dayPeak > monthData[m].peak) monthData[m].peak = dayPeak;
      monthData[m].days++;
    }
    const overallAvg = totalSamples ? Math.round(totalViewers / totalSamples) : 0;
    const sortedMonths = Object.keys(monthData).sort();
    const maxAvg = Math.max(1, ...sortedMonths.map(m => Math.round(monthData[m].sum / monthData[m].count)));
    let html = '<div class="page-card" style="margin-top:24px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">';
    html += '<div><h2 style="font-size:24px">📈 Средний онлайн</h2><p class="muted">@' + login + '</p></div>';
    html += '<button class="btn" onclick="renderAvgOnline(\'' + login + '\', \'' + userId + '\')" style="padding:8px 14px;font-size:13px">🔄</button></div>';
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)">';
    html += '<div class="metric"><p>📅 Дней со стримами</p><strong style="font-size:22px">' + totalDays + '</strong></div>';
    html += '<div class="metric"><p>📈 Средний онлайн</p><strong style="font-size:22px;color:#a855f7">' + overallAvg + '</strong></div>';
    html += '<div class="metric"><p>🔥 Макс пик</p><strong style="font-size:22px;color:white">' + maxPeakOverall + '</strong></div>';
    html += '<div class="metric"><p>📅 Месяцев</p><strong style="font-size:22px">' + sortedMonths.length + '</strong></div></div>';
    if (sortedMonths.length) {
      const barH = 145;
      html += '<div style="padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)">';
      html += '<p style="font-size:13px;font-weight:600;margin-bottom:12px">📈 По месяцам</p>';
      html += '<div style="display:flex;gap:6px;align-items:flex-end;height:160px;overflow-x:auto;padding-bottom:8px">';
      for (const m of sortedMonths) {
        const d = monthData[m];
        const avg = Math.round(d.sum / d.count);
        const h = Math.max(3, Math.round(avg / maxAvg * barH));
        const color = avg > overallAvg * 1.15 ? '#4ade80' : avg > overallAvg * 0.85 ? '#a855f7' : '#7c3aed';
        html += '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;position:relative"';
        html += ' onmouseenter="showBarTooltip(event,\'' + m + ' · ср. ' + avg + ' · пик ' + d.peak + ' · ' + d.days + ' дн.\')" onmouseleave="hideBarTooltip()" onmousemove="showBarTooltip(event,\'' + m + ' · ср. ' + avg + ' · пик ' + d.peak + ' · ' + d.days + ' дн.\')">';
        html += '<div class="bar" style="width:36px;height:' + h + 'px;border-radius:4px 4px 0 0;background:' + color + ';transition:opacity .2s;cursor:pointer"></div>';
        html += '<span style="font-size:9px;color:var(--muted);margin-top:2px">' + m.slice(5) + '</span></div>';
      }
      html += '</div><div style="display:flex;justify-content:space-between;margin-top:4px">';
      html += '<span style="font-size:9px;color:var(--muted)">' + (sortedMonths[0] || '') + '</span>';
      html += '<span style="font-size:9px;color:var(--muted)">' + (sortedMonths[sortedMonths.length - 1] || '') + '</span></div></div>';
      html += '<div style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">';
      for (const m of sortedMonths) {
        const d = monthData[m];
        const avg = Math.round(d.sum / d.count);
        html += '<div style="padding:10px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid var(--border);text-align:center">';
        html += '<div style="font-size:12px;font-weight:600">' + m + '</div>';
        html += '<div style="font-size:18px;color:#a855f7;margin-top:2px">' + avg + '</div>';
        html += '<div class="muted" style="font-size:10px">пик ' + d.peak + ' · ' + d.days + ' дн.</div></div>';
      }
      html += '</div>';
    } else {
      html += '<div style="padding:40px 20px;text-align:center"><p class="muted">Нет данных</p></div>';
    }
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p class="muted" style="padding:20px;text-align:center">❌ Ошибка: ' + e.message + '</p>';
  }
}

async function fetchAllVods(userId, hdrs) {
  let vods = [];
  for (const type of ['archive', 'highlight']) {
    let cursor = null;
    while (true) {
      const url = 'https://api.twitch.tv/helix/videos?user_id=' + userId + '&first=100&type=' + type + '&period=all' + (cursor ? '&after=' + cursor : '');
      const res = await fetch(url, { headers: hdrs });
      if (!res.ok) break;
      const d = await res.json();
      vods = vods.concat(d.data || []);
      cursor = d.pagination?.cursor;
      if (!cursor) break;
    }
  }
  vods.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return vods;
}

async function renderStreamCalendar(login, userId, monthKey) {
  setActiveTab(login, 'calendar');
  viewerTracker.stop();
  const safe = login.replace(/[^a-z0-9]/gi, '');
  hideAllTabs(login, 'streamCalendarContainer_' + safe);
  const container = document.getElementById('streamCalendarContainer_' + safe);
  if (!container) return;
  container.innerHTML = '<p class="muted" style="padding:20px;text-align:center">📅 Загрузка календаря стримов...</p>';
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const now = new Date();
    if (!_streamVodCache[login]) {
      const token = localStorage.getItem('twitchAccessToken');
      const botToken = await getBotToken();
      const hdrs = botToken ? { 'Authorization': 'Bearer ' + botToken.token, 'Client-Id': botToken.clientId || TWITCH_CLIENT_ID } : { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID };
      const [vods, streamsRes] = await Promise.all([
        fetchAllVods(userId, hdrs),
        fetch('https://api.twitch.tv/helix/streams?user_id=' + userId, { headers: hdrs })
      ]);
      let live = null;
      if (streamsRes.ok) { const d = await streamsRes.json(); live = d.data && d.data[0] ? d.data[0] : null; }
      _streamVodCache[login] = { vods, live };
    }
    const { vods: allVods, live: liveStream } = _streamVodCache[login];
    let chunkDaysByMonth = {};
    try {
      const chSnap = await db.ref('stream-chunks/' + login).once('value');
      const chVal = chSnap.val() || {};
      for (const dateStr of Object.keys(chVal)) {
        const mk = dateStr.slice(0, 7);
        const day = parseInt(dateStr.slice(8, 10), 10);
        if (!chunkDaysByMonth[mk]) chunkDaysByMonth[mk] = new Set();
        chunkDaysByMonth[mk].add(day);
      }
    } catch (e) {}
    if (!monthKey) {
      const allMonths = new Set();
      for (const vod of allVods) {
        const d = new Date(vod.created_at);
        allMonths.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      }
      Object.keys(chunkDaysByMonth).forEach(m => allMonths.add(m));
      allMonths.add(now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
      monthKey = [...allMonths].sort().pop() || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
    }
    const [year, month] = monthKey.split('-').map(Number);
    const daysWithActivity = new Set();
    const dayStats = {};
    for (const vod of allVods) {
      const d = new Date(vod.created_at);
      if (d.getFullYear() === year && d.getMonth() + 1 === month) {
        daysWithActivity.add(d.getDate());
        const dd = d.getDate();
        if (!dayStats[dd]) dayStats[dd] = { streams: 0, totalMins: 0, sumViewers: 0, maxViewers: 0, hasVod: false };
        dayStats[dd].hasVod = true;
      }
    }
    if (chunkDaysByMonth[monthKey]) {
      chunkDaysByMonth[monthKey].forEach(d => {
        daysWithActivity.add(d);
        if (!dayStats[d]) dayStats[d] = { streams: 0, totalMins: 0, sumViewers: 0, maxViewers: 0, hasVod: false };
      });
    }
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const prevM = month === 1 ? (year - 1) + '-12' : year + '-' + String(month - 1).padStart(2, '0');
    const nextM = month === 12 ? (year + 1) + '-01' : year + '-' + String(month + 1).padStart(2, '0');
    const hasPrev = year > 2020 || (year === 2020 && month > 1);
    let mcData = {};
    try { const mcSnap = await db.ref('stream-chunks/' + login + '/' + monthKey).once('value'); mcData = mcSnap.val() || {}; } catch (e) {}
    const mcDays = {};
    for (const dateStr of Object.keys(mcData)) {
      const dayNum = parseInt(dateStr.slice(8, 10), 10);
      const chunks = mcData[dateStr];
      for (const ts of Object.keys(chunks)) {
        const c = chunks[ts];
        if (!mcDays[dayNum]) mcDays[dayNum] = { totalMins: 0, sumViewers: 0, maxViewers: 0, count: 0 };
        mcDays[dayNum].totalMins += c.durationMins || 15;
        mcDays[dayNum].sumViewers += c.viewers || 0;
        mcDays[dayNum].count++;
        if ((c.viewers || 0) > mcDays[dayNum].maxViewers) mcDays[dayNum].maxViewers = c.viewers || 0;
      }
    }
    let maxStreamMins = 0, maxAvgViewers = 0, maxPeakViewers = 0;
    for (const d of Object.keys(mcDays)) {
      const sd = mcDays[d];
      if (sd.totalMins > maxStreamMins) maxStreamMins = sd.totalMins;
      const avg = sd.count ? Math.round(sd.sumViewers / sd.count) : 0;
      if (avg > maxAvgViewers) maxAvgViewers = avg;
      if (sd.maxViewers > maxPeakViewers) maxPeakViewers = sd.maxViewers;
    }
    function mcColor(val, max) {
      if (!max || !val) return 'rgba(255,255,255,.04)';
      const p = val / max;
      return p > 0.7 ? 'rgba(168,85,247,.45)' : p > 0.4 ? 'rgba(168,85,247,.25)' : 'rgba(168,85,247,.12)';
    }
    function renderMiniGrid(label, dataKey) {
      const maxVal = dataKey === 'totalMins' ? maxStreamMins : dataKey === 'maxViewers' ? maxPeakViewers : maxAvgViewers;
      let g = '<div style="flex:1;min-width:200px"><p style="font-size:11px;font-weight:600;margin-bottom:6px;color:var(--muted)">' + label + '</p>';
      g += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">';
      const sp = firstDay === 0 ? 6 : firstDay - 1;
      for (let i = 0; i < sp; i++) g += '<div></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const sd = mcDays[d] || {};
        const val = dataKey === 'totalMins' ? (sd.totalMins || 0) : dataKey === 'maxViewers' ? (sd.maxViewers || 0) : sd.count ? Math.round(sd.sumViewers / sd.count) : 0;
        const has = daysWithActivity.has(d);
        g += '<div style="aspect-ratio:1;border-radius:4px;background:' + (has ? mcColor(val, maxVal) : 'rgba(255,255,255,.02)') + ';display:flex;align-items:center;justify-content:center;font-size:8px;color:' + (has ? 'white' : 'var(--muted)') + '" title="' + d + ': ' + val + '">' + d + '</div>';
      }
      g += '</div></div>';
      return g;
    }
    let html = '<div class="page-card" style="margin-top:24px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:16px">';
    html += '<div><h2 style="font-size:24px">📅 Календарь стримов</h2><p class="muted" style="font-size:12px">Статистика стримов по дням</p></div>';
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap">';
    html += '<span class="muted" style="font-size:12px">📺 ' + daysWithActivity.size + ' дней со стримами</span>';
    if (liveStream) html += '<span style="font-size:12px;color:#ef4444">🔴 Сейчас в эфире!</span>';
    html += '<button class="btn" onclick="_streamVodCache[\'' + login + '\']=null;renderStreamCalendar(\'' + login + '\', \'' + userId + '\', \'' + monthKey + '\')" style="padding:6px 12px;font-size:12px">🔄</button></div></div>';
    if (liveStream) {
      html += '<div style="background:rgba(168,85,247,.1);border:1px solid rgba(168,85,247,.25);border-radius:20px;padding:20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:16px">';
      html += '<div style="width:12px;height:12px;border-radius:50%;background:#ef4444;animation:pulse 2s infinite"></div>';
      html += '<div style="flex:1;min-width:0"><b style="font-size:16px">' + liveStream.title + '</b>';
      html += '<p class="muted" style="margin-top:4px">🎮 ' + liveStream.game_name + ' | 👁 ' + liveStream.viewer_count + ' зрителей</p></div></div>';
    }
    html += '<div class="month-nav">';
    html += '<button onclick="renderStreamCalendar(\'' + login + '\', \'' + userId + '\', \'' + prevM + '\')" ' + (!hasPrev ? 'disabled style="opacity:.3"' : '') + '>←</button>';
    html += '<h3>' + monthNames[month - 1] + ' ' + year + '</h3>';
    html += '<button onclick="renderStreamCalendar(\'' + login + '\', \'' + userId + '\', \'' + nextM + '\')">→</button></div>';
    html += '<div style="background:rgba(255,255,255,.04);border-radius:20px;padding:16px;border:1px solid var(--border)">';
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">';
    html += ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => '<div style="font-size:10px;color:var(--muted);padding:4px 0;font-weight:700;text-align:center;text-transform:uppercase;letter-spacing:.05em">' + d + '</div>').join('');
    const startPad = firstDay === 0 ? 6 : firstDay - 1;
    for (let i = 0; i < startPad; i++) html += '<div></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const hasActivity = daysWithActivity.has(day);
      const isToday = now.getFullYear() === year && now.getMonth() === month - 1 && now.getDate() === day;
      const sd = mcDays[day] || {};
      const cellDuration = sd.totalMins || 0;
      const cellAvg = sd.count ? Math.round(sd.sumViewers / sd.count) : 0;
      const cellPeak = sd.maxViewers || 0;
      const bg = isToday ? 'rgba(168,85,247,.18)' : hasActivity ? 'rgba(255,255,255,.03)' : 'transparent';
      const bd = isToday ? '1px solid rgba(168,85,247,.35)' : hasActivity ? '1px solid rgba(168,85,247,.08)' : '1px solid transparent';
      html += '<div style="position:relative;padding:6px 4px;border-radius:8px;cursor:' + (hasActivity ? 'pointer' : 'default') + ';background:' + bg + ';border:' + bd + ';transition:.15s;text-align:center;min-height:48px"';
      if (hasActivity) html += ' onclick="showStreamDay(\'' + login + '\', \'' + userId + '\', ' + year + ', ' + month + ', ' + day + ')"';
      html += ' onmouseover="this.style.background=\'' + (hasActivity ? 'rgba(168,85,247,.15)' : 'rgba(255,255,255,.04)') + '\'" onmouseout="this.style.background=\'' + bg + '\'">';
      html += '<div style="font-size:13px;font-weight:' + (hasActivity ? '700' : '400') + ';color:' + (hasActivity ? 'white' : 'var(--muted)') + '">' + day + '</div>';
      if (hasActivity && cellDuration > 0) {
        html += '<div style="font-size:9px;color:rgba(168,85,247,.6);margin-top:1px;line-height:1.2">' + (cellDuration >= 60 ? Math.floor(cellDuration / 60) + 'ч ' + (cellDuration % 60) + 'м' : cellDuration + 'м') + '</div>';
        if (cellAvg > 0) html += '<div style="font-size:8px;color:rgba(255,255,255,.4);line-height:1.2">👁 ' + cellAvg + '</div>';
      } else if (hasActivity) {
        html += '<div style="width:5px;height:5px;border-radius:50%;background:#a855f7;margin:4px auto 0"></div>';
      }
      html += '</div>';
    }
    html += '</div></div>';
    if (Object.keys(mcDays).length) {
      html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:16px">';
      html += renderMiniGrid('⏱ Время в эфире (мин)', 'totalMins');
      html += renderMiniGrid('📈 Средние зрители', 'avgViewers');
      html += renderMiniGrid('🔥 Пик зрителей', 'maxViewers');
      html += '</div>';
    }
    html += '</div><div id="streamDayDetail" style="margin-top:16px"></div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p class="muted" style="padding:20px;text-align:center">❌ Ошибка загрузки: ' + e.message + '</p>';
  }
}

async function showStreamDay(login, userId, year, month, day) {
  const detailDiv = document.getElementById('streamDayDetail');
  if (!detailDiv) return;
  const safe = login.replace(/[^a-z0-9]/gi, '');
  const calContainer = document.getElementById('streamCalendarContainer_' + safe);
  detailDiv.innerHTML = '<p class="muted" style="padding:20px;text-align:center">📊 Загрузка данных...</p>';
  detailDiv.dataset.login = login;
  detailDiv.dataset.day = String(day) + '-' + String(month) + '-' + String(year);
  detailDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const startOfDay = new Date(year, month - 1, day).getTime();
    const endOfDay = startOfDay + 86400000;
    const cached = _streamVodCache[login];
    let vods = [];
    if (cached) vods = cached.vods.filter(v => { const t = new Date(v.created_at).getTime(); return t >= startOfDay && t < endOfDay; });
    let chunkData = {};
    try {
      const dateStr = String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const snap = await db.ref('stream-chunks/' + login + '/' + dateStr).once('value');
      chunkData = snap.val() || {};
    } catch (e) {}
    const chunkTimestamps = Object.keys(chunkData).sort();
    const peakViewers = chunkTimestamps.length ? Math.max(1, ...chunkTimestamps.map(t => chunkData[t].viewers || 0)) : 0;
    const avgViewers = chunkTimestamps.length ? Math.round(chunkTimestamps.reduce((s, t) => s + (chunkData[t].viewers || 0), 0) / chunkTimestamps.length) : 0;
    const realDurationMin = chunkTimestamps.reduce((s, t) => s + (chunkData[t].durationMins || 15), 0);
    const durationMin = realDurationMin || chunkTimestamps.length * 15;
    const watchTimeMins = chunkTimestamps.reduce((s, t) => s + (chunkData[t].watchTimeMins || 0), 0);
    const followersGained = chunkTimestamps.reduce((s, t) => s + (chunkData[t].followersGained || 0), 0);
    const games = new Set(chunkTimestamps.map(t => chunkData[t].game).filter(Boolean));
    const firstChunk = chunkTimestamps.length ? chunkData[chunkTimestamps[0]] : null;
    let perfClass = 'neutral', perfLabel = 'На уровне', trendClass = 'neutral', trendLabel = 'Стабильно';
    if (cached && cached.vods.length > 1) {
      const allAvgs = cached.vods.filter(v => v.view_count > 0).map(v => v.view_count || 0);
      const allAvg = allAvgs.length ? allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length : 0;
      if (avgViewers > allAvg * 1.15) { perfClass = 'above'; perfLabel = 'Выше среднего'; }
      else if (avgViewers < allAvg * 0.85) { perfClass = 'below'; perfLabel = 'Ниже среднего'; }
      const sortedVods = [...cached.vods].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const currentIdx = sortedVods.findIndex(v => { const t = new Date(v.created_at).getTime(); return t >= startOfDay && t < endOfDay; });
      if (currentIdx >= 0 && currentIdx < sortedVods.length - 1) {
        const prev = sortedVods[currentIdx + 1];
        const prevAvg = prev.view_count || 0;
        if (avgViewers > prevAvg * 1.1) { trendClass = 'positive'; trendLabel = 'Рост ↗'; }
        else if (avgViewers < prevAvg * 0.9) { trendClass = 'negative'; trendLabel = 'Падение ↘'; }
      }
    }
    const perfColors = { above: '#4ade80', below: '#ef4444', neutral: '#a855f7' };
    const trendColors = { positive: '#4ade80', negative: '#ef4444', neutral: '#a855f7' };
    let html = '<div class="page-card" style="margin-top:0">';
    html += '<div style="padding:0 0 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border)">';
    html += '<div><h2 style="font-size:22px">🎬 ' + String(day).padStart(2, '0') + '.' + String(month).padStart(2, '0') + '.' + year + '</h2><p class="muted" style="font-size:12px">' + login + '</p></div>';
    html += '<button class="btn" onclick="closeStreamDay()" style="padding:8px 16px;font-size:13px">← Назад к календарю</button></div>';
    if (chunkTimestamps.length > 0 || vods.length > 0) {
      html += '<div style="display:flex;gap:0;flex-wrap:wrap;margin-top:16px;border-radius:12px;overflow:hidden;border:1px solid rgba(168,85,247,.1);background:rgba(255,255,255,.015)">';
      html += '<div style="flex:1;min-width:100px;padding:10px 16px;text-align:center;border-right:1px solid rgba(168,85,247,.06)"><p class="muted" style="font-size:10px;text-transform:uppercase">Начало</p><b style="font-size:13px">' + (chunkTimestamps.length ? new Date(Number(chunkTimestamps[0])).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) + ' (МСК)' : '—') + '</b></div>';
      html += '<div style="flex:1;min-width:100px;padding:10px 16px;text-align:center;border-right:1px solid rgba(168,85,247,.06)"><p class="muted" style="font-size:10px;text-transform:uppercase">Длительность</p><b style="font-size:13px">' + (durationMin >= 60 ? Math.floor(durationMin / 60) + 'ч ' + (durationMin % 60) + 'м' : durationMin + 'м') + '</b></div>';
      html += '<div style="flex:1;min-width:100px;padding:10px 16px;text-align:center;border-right:1px solid rgba(168,85,247,.06)"><p class="muted" style="font-size:10px;text-transform:uppercase">Время просмотра</p><b style="font-size:13px">' + (watchTimeMins >= 60 ? Math.floor(watchTimeMins / 60) + 'ч ' + (watchTimeMins % 60) + 'м' : watchTimeMins + 'м') + '</b></div>';
      html += '<div style="flex:1;min-width:100px;padding:10px 16px;text-align:center"><p class="muted" style="font-size:10px;text-transform:uppercase">Новые фоловеры</p><b style="font-size:13px;color:#4ade80">+' + followersGained + '</b></div></div>';
      html += '<div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px">';
      html += '<div style="padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><p class="muted" style="font-size:11px;text-transform:uppercase">Средние зрители</p><span style="font-size:11px;color:' + perfColors[perfClass] + '">' + perfLabel + '</span></div><strong style="font-size:36px;color:#a855f7">' + avgViewers + '</strong><div style="margin-top:10px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><div style="height:100%;width:' + (peakViewers > 0 ? Math.min(100, Math.round(avgViewers / peakViewers * 100)) : 0) + '%;border-radius:2px;background:linear-gradient(90deg,#a855f7,#7c3aed)"></div></div></div>';
      html += '<div style="padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><p class="muted" style="font-size:11px;text-transform:uppercase">Пик зрителей</p><span style="font-size:11px;color:' + trendColors[trendClass] + '">' + trendLabel + '</span></div><strong style="font-size:36px;color:white">' + peakViewers + '</strong><div style="margin-top:10px;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><div style="height:100%;width:100%;border-radius:2px;background:linear-gradient(90deg,#7c3aed,#a855f7)"></div></div></div></div>';
      const gameData = {};
      for (const ts of chunkTimestamps) {
        const c = chunkData[ts]; const g = c.game || 'Unknown';
        if (!gameData[g]) gameData[g] = { watchMins: 0, count: 0, sumViewers: 0, maxViewers: 0 };
        gameData[g].watchMins += c.watchTimeMins || 0; gameData[g].count++; gameData[g].sumViewers += c.viewers || 0;
        if ((c.viewers || 0) > gameData[g].maxViewers) gameData[g].maxViewers = c.viewers || 0;
      }
      if (Object.keys(gameData).length) {
        html += '<div style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">';
        for (const [g, gd] of Object.entries(gameData)) {
          const gAvg = Math.round(gd.sumViewers / gd.count);
          html += '<div style="padding:14px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--border)"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#a855f7,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:14px">🎮</div><b style="font-size:14px">' + g + '</b></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px"><div><span class="muted">Средние:</span> <b style="color:#a855f7">' + gAvg + '</b></div><div><span class="muted">Макс:</span> <b>' + gd.maxViewers + '</b></div><div><span class="muted">Время:</span> <b>' + Math.floor(gd.watchMins / 60) + 'ч ' + (gd.watchMins % 60) + 'м</b></div></div></div>';
        }
        html += '</div>';
      }
      if (chunkTimestamps.length > 0) {
        html += '<div style="margin-top:16px;padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border);position:relative">';
        html += '<p style="font-size:13px;font-weight:600;margin-bottom:12px">📈 Зрители</p><div style="display:flex;gap:2px;align-items:flex-end;height:120px">';
        const barH = 110;
        for (const ts of chunkTimestamps) {
          const ch = chunkData[ts];
          const h = Math.max(4, Math.round(ch.viewers / peakViewers * barH));
          const color = ch.viewers > peakViewers * 0.7 ? '#a855f7' : ch.viewers > peakViewers * 0.3 ? '#7c3aed' : '#4ade80';
          const timeStr = new Date(Number(ts)).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) + ' (МСК)';
          html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;position:relative" onmouseover="this.querySelector(\'.bar-tip\').style.display=\'block\';this.querySelector(\'.chart-bar\').style.opacity=\'.8\'" onmouseout="this.querySelector(\'.bar-tip\').style.display=\'none\';this.querySelector(\'.chart-bar\').style.opacity=\'1\'">';
          html += '<div class="bar-tip" style="display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#1a1a2e;border:1px solid rgba(168,85,247,.3);color:white;padding:4px 8px;border-radius:8px;font-size:10px;white-space:nowrap;z-index:10;margin-bottom:6px;pointer-events:none">' + ch.viewers + ' зр. · ' + timeStr + (ch.game ? ' · ' + ch.game : '') + '</div>';
          html += '<div class="chart-bar" style="width:100%;height:' + h + 'px;border-radius:3px 3px 0 0;background:' + color + ';min-width:4px;transition:opacity .2s;cursor:pointer"></div></div>';
        }
        html += '</div><div style="display:flex;justify-content:space-between;margin-top:6px">';
        html += '<span style="font-size:9px;color:var(--muted)">' + new Date(Number(chunkTimestamps[0])).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) + ' (МСК)</span>';
        html += '<span style="font-size:9px;color:var(--muted)">' + new Date(Number(chunkTimestamps[chunkTimestamps.length - 1])).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) + ' (МСК)</span></div></div>';
      }
      if (vods.length > 0) {
        html += '<div style="margin-top:16px;padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)"><p style="font-size:13px;font-weight:600;margin-bottom:12px">🎬 Записи стримов (' + vods.length + ')</p>';
        for (const vod of vods) {
          const dur = (vod.duration || '').replace(/^PT/, '').replace(/H/, 'ч ').replace(/M/, 'м ').replace(/S/, 'с');
          html += '<div style="display:flex;gap:12px;padding:10px;border-radius:12px;background:rgba(255,255,255,.03);margin-bottom:6px;align-items:center">';
          if (vod.thumbnail_url) {
            const thumb = vod.thumbnail_url.indexOf('%') === -1 ? vod.thumbnail_url : vod.thumbnail_url.replace('{width}', '160').replace('{height}', '90');
            html += '<img src="' + thumb + '" style="width:72px;height:40px;border-radius:6px;object-fit:cover">';
          }
          html += '<div style="flex:1;min-width:0"><a href="' + (vod.url || '#') + '" target="_blank" style="color:white;font-weight:600;font-size:13px;text-decoration:none">' + (vod.title || '') + '</a>';
          html += '<div style="display:flex;gap:12px;margin-top:3px"><span class="muted" style="font-size:11px">⏱ ' + dur + '</span><span class="muted" style="font-size:11px">👁 ' + (vod.view_count || 0) + '</span>';
          if (vod.game) html += '<span class="muted" style="font-size:11px">🎮 ' + vod.game + '</span>';
          html += '</div></div></div>';
        }
        html += '</div>';
      }
    } else {
      html += '<div style="margin-top:20px;padding:40px 20px;text-align:center"><p class="muted">Нет данных стримов за этот день</p></div>';
    }
    html += '</div>';
    detailDiv.innerHTML = html;
    detailDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    detailDiv.innerHTML = '<p class="muted" style="padding:20px;text-align:center">❌ Ошибка: ' + e.message + '</p>';
  }
}

function closeStreamDay() {
  const detailDiv = document.getElementById('streamDayDetail');
  if (!detailDiv) return;
  const login = detailDiv.dataset.login || '';
  detailDiv.innerHTML = '';
  delete detailDiv.dataset.day;
  delete detailDiv.dataset.login;
  if (login) {
    const safe = login.replace(/[^a-z0-9]/gi, '');
    const calContainer = document.getElementById('streamCalendarContainer_' + safe);
    if (calContainer) calContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function openViewerProfile(viewerId) {
  if (!viewerId) return;
  viewerTracker.stop();
  currentViewerProfileId = viewerId;
  currentOpenCreator = null;
  try {
    const [allSnap, members] = await Promise.all([
      db.ref('all-viewers/' + viewerId).once('value'),
      loadTwitchUsers()
    ]);
    const v = allSnap.val();
    if (!v) { alert('Нет данных об этом зрителе'); return; }
    const allMembers = members.filter(m => m.roles && (m.roles.squad || m.roles.academy));
    const channels = v.channels || {};
    const categories = v.categories || {};
    const chList = Object.keys(channels);
    const catList = Object.entries(categories).sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
    const displayName = v.displayName || v.login || viewerId;
    const login = v.login || '';
    const avatar = v.profileImageUrl || '';
    const createdAt = v.createdAt || '';
    const description = v.description || '';
    const firstSeen = v.firstSeen || 0;
    const lastSeen = v.lastSeen || 0;
    const daysSinceCreate = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : null;
    const duration = lastSeen - firstSeen;
    const durHours = Math.floor(duration / 3600000);
    const durMin = Math.floor((duration % 3600000) / 60000);
    let twitchInfo = null;
    const token = localStorage.getItem('twitchAccessToken');
    if (token && login) {
      try {
        const uRes = await fetch('https://api.twitch.tv/helix/users?login=' + login, {
          headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID }
        });
        const uData = await uRes.json();
        twitchInfo = uData.data && uData.data[0] ? uData.data[0] : null;
      } catch (e) {}
    }
    const now = Date.now();
    const analysis = viewerTracker.analyzeViewer({ login, displayName, createdAt, description, profileImageUrl: avatar, firstSeen, lastSeen });
    let isCurrentlyLive = false;
    let currentChannel = '';
    for (const m of allMembers) {
      if (m.isLive && viewerTracker.viewers && viewerTracker.viewers[viewerId]) { isCurrentlyLive = true; currentChannel = m.displayName; break; }
    }
    const channelDetails = await Promise.all(chList.map(async (ch) => {
      const chData = channels[ch];
      const member = allMembers.find(m => m.login.toLowerCase() === ch.toLowerCase());
      return {
        login: ch,
        displayName: member ? member.displayName : ch,
        avatar: member ? member.profileImageUrl : '',
        firstSeen: chData.firstSeen || 0,
        lastSeen: chData.lastSeen || 0,
        game: member && member.isLive ? member.gameName : (squads.main.members.concat(squads.academy.members).find(m => m.name.toLowerCase() === ch.toLowerCase())?.content?.map(c => c[0]).join(', ') || ''),
        isLive: member ? member.isLive : false
      };
    }));
    channelDetails.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    const totalHours = channelDetails.reduce((s, c) => { const d = (c.lastSeen || now) - (c.firstSeen || now); return s + d; }, 0);
    const totalHoursDisplay = Math.floor(totalHours / 3600000);
    const totalMinDisplay = Math.floor((totalHours % 3600000) / 60000);
    document.getElementById('creatorPage').innerHTML = `
      <div class="page-card fade">
        <button class="btn" onclick="renderViewersPage()">← Назад к зрителям</button>
        <div style="display:grid;grid-template-columns:320px 1fr;gap:24px;margin-top:24px">
          <div class="left-stack">
            <div class="profile big">
              <div class="profile-head">
                ${avatar ? '<img class="avatar" src="' + avatar + '" style="object-fit:cover">' : '<div class="avatar" style="background:linear-gradient(135deg,#888,var(--muted))"></div>'}
                <div><h2>${displayName}</h2><p class="muted">${login ? '@' + login : ''}</p></div>
              </div>
              <div class="metric-grid" style="grid-template-columns:1fr 1fr">
                <div class="metric"><p>Аккаунт</p><strong>${daysSinceCreate !== null ? daysSinceCreate + ' дн.' : '—'}</strong></div>
                <div class="metric"><p>Всего сессий</p><strong>${chList.length}</strong></div>
                <div class="metric"><p>Общее время</p><strong>${totalHoursDisplay}ч ${totalMinDisplay}мин</strong></div>
                <div class="metric"><p>Риск</p><strong style="color:${analysis.color}">${analysis.score}%</strong></div>
              </div>
              ${description ? '<div style="margin-top:12px;padding:10px;border-radius:12px;background:rgba(255,255,255,.04);font-size:13px;color:var(--muted)">' + description.slice(0, 100) + '</div>' : ''}
              ${analysis.reasons.length ? '<div style="margin-top:12px;padding:10px;border-radius:12px;background:rgba(239,68,68,.08);font-size:12px;line-height:1.7">' + analysis.reasons.map(r => '<div>' + r + '</div>').join('') + '</div>' : ''}
            </div>
            ${catList.length ? `
            <div class="card">
              <h2 style="font-size:18px">🎮 Интересы (категории)</h2>
              <p class="muted" style="font-size:13px;margin-bottom:12px">Какие игры/категории смотрит</p>
              ${catList.map(([cat, data]) => {
                const maxCount = catList[0]?.[1]?.count || 1;
                const pct = Math.round((data.count || 0) / maxCount * 100);
                return '<div class="content-item" style="padding:10px;margin-top:6px"><span style="font-size:14px">' + cat.slice(0, 40) + '</span><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden"><div style="width:' + pct + '%;height:100%;border-radius:2px;background:linear-gradient(90deg,#a855f7,#7c3aed)"></div></div><span style="font-size:13px;font-weight:700;color:#a855f7">' + data.count + '</span></div></div>';
              }).join('')}
            </div>` : ''}
          </div>
          <div>
            <div class="card">
              <h2 style="font-size:18px">📺 Каналы (${chList.length})</h2>
              <p class="muted" style="font-size:13px;margin-bottom:12px">Каналы RGB, в которых был замечен зритель</p>
              ${chList.length ? '<div style="overflow-x:auto"><table class="table"><thead><tr><th>Канал</th><th>Статус</th><th>Впервые</th><th>Последний раз</th><th></th></tr></thead><tbody>' + channelDetails.map(ch => {
                const firstStr = ch.firstSeen ? new Date(ch.firstSeen).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
                const lastStr = ch.lastSeen ? new Date(ch.lastSeen).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
                let statusHtml = '';
                if (ch.isOnlineNow) statusHtml = '<span style="color:#4ade80;font-weight:600">● Сейчас в чате</span>';
                else if (ch.isLive) statusHtml = '<span style="color:#22d3ee">● В эфире (не в чате)</span>';
                else statusHtml = '<span class="muted">○ Офлайн</span>';
                return '<tr onclick="' + (ch.isLive ? "openCreator('" + ch.login + "')" : '') + '" style="cursor:' + (ch.isLive ? 'pointer' : 'default') + '"><td><div class="creator-cell">' + (ch.avatar ? '<img class="mini-avatar" src="' + ch.avatar + '" style="object-fit:cover;border-radius:50%">' : '<div class="mini-avatar"></div>') + '<div><b>' + ch.displayName + '</b><p class="muted">@' + ch.login + '</p></div></div></td><td>' + statusHtml + '</td><td style="font-size:13px">' + firstStr + '</td><td style="font-size:13px">' + lastStr + '</td><td>' + (ch.isLive ? '<span style="color:var(--purple);font-size:12px">→</span>' : '') + '</td></tr>';
              }).join('') + '</tbody></table></div>' : '<p class="muted">Нет данных о каналах</p>'}
            </div>
            ${Object.keys(categories).length ? '<div style="margin-top:16px"><div style="padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)"><h3 style="font-size:16px;margin-bottom:12px">🎮 Интересы (категории)</h3><div style="display:flex;flex-wrap:wrap;gap:8px">' + catList.map(([cat, data]) => '<span class="tag" style="font-size:12px;padding:6px 12px;background:rgba(168,85,247,.08);border-color:rgba(168,85,247,.15)">' + cat.slice(0, 30) + ' <span style="color:var(--muted);font-size:11px">(' + (data.count || 0) + ')</span></span>').join('') + '</div></div></div>' : ''}
          </div>
        </div>
        <p class="muted" style="font-size:12px;margin-top:20px">🕐 Проверено: ${msk().full}</p>
      </div>`;
    show('creatorPage');
  } catch (e) {
    document.getElementById('creatorPage').innerHTML = '<p style="color:#ef4444">❌ Ошибка: ' + e.message + '</p>';
  }
}

function renderTrackerStats(login, userId) {
  setActiveTab(login, 'tracker');
  viewerTracker.stop();
  const safe = login.replace(/[^a-z0-9]/gi, '');
  hideAllTabs(login, 'trackerContainer_' + safe);
  const container = document.getElementById('trackerContainer_' + safe);
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = '<p class="muted" style="padding:20px;text-align:center">📊 Загрузка...</p>';
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const getTt = async () => {
    const workerUrl = await getBotWorkerUrl();
    if (workerUrl) {
      try { const r = await fetch(workerUrl + '/api/tracker-summary?login=' + encodeURIComponent(login)); if (r.ok) return r.json(); } catch (e) {}
    }
    try { const r = await fetch('https://twitchtracker.com/api/channels/summary/' + login); if (r.ok) return r.json(); } catch (e) {}
    return null;
  };
  const totalFollowersLive = _creatorFollowersCache[login] || 0;
  const getSubs = async () => {
    const token = localStorage.getItem('twitchAccessToken');
    if (!token || !currentTwitchUser?.id) return null;
    if (currentTwitchUser.id !== userId) return null;
    try {
      const r = await fetch('https://api.twitch.tv/helix/subscriptions?broadcaster_id=' + userId + '&moderator_id=' + userId + '&first=1', {
        headers: { 'Authorization': 'Bearer ' + token, 'Client-Id': TWITCH_CLIENT_ID }
      });
      if (r.ok) { const d = await r.json(); return d.total || 0; }
    } catch (e) {}
    return null;
  };
  Promise.all([
    getTt(), getSubs(),
    db.ref('stream-chunks/' + login).once('value').then(s => s.val() || {})
  ]).then(([ttData, subsCount, chunks]) => {
    const ttKeys = ttData && typeof ttData === 'object' ? Object.keys(ttData) : [];
    let csvStreams = 0, snapDays = 0, totalMinutes = 0, totalWatchTime = 0, totalFollowers = 0;
    let sumAvgViewers = 0, maxPeakViewers = 0, snapViewerSamples = 0, snapViewerSum = 0, snapPeak = 0;
    const allGames = new Set();
    const allDates = new Set();
    const csvDates = new Set();
    for (const dateStr of Object.keys(chunks)) {
      const dayChunks = chunks[dateStr];
      let daySnapViewers = [], daySnapPeak = 0;
      for (const ts of Object.keys(dayChunks)) {
        const c = dayChunks[ts];
        if (c.source === 'sullygnome-csv') {
          csvStreams++; totalMinutes += c.durationMins || 0; totalWatchTime += c.watchTimeMins || 0;
          totalFollowers += c.followersGained || 0; sumAvgViewers += c.viewers || 0;
          if ((c.peakViewers || 0) > maxPeakViewers) maxPeakViewers = c.peakViewers;
          if (c.games) c.games.split(',').forEach(g => allGames.add(g.trim()));
          csvDates.add(dateStr);
        } else {
          daySnapViewers.push(c.viewers || 0);
          if ((c.viewers || 0) > daySnapPeak) daySnapPeak = c.viewers || 0;
          totalMinutes += c.durationMins || 15; totalWatchTime += c.watchTimeMins || 0;
          totalFollowers += c.followersGained || 0; if (c.game) allGames.add(c.game);
        }
      }
      if (daySnapViewers.length) {
        snapDays++; snapViewerSum += daySnapViewers.reduce((a, b) => a + b, 0);
        snapViewerSamples += daySnapViewers.length;
        if (daySnapPeak > snapPeak) snapPeak = daySnapPeak;
        allDates.add(dateStr);
      }
      if (csvDates.has(dateStr)) allDates.add(dateStr);
    }
    if (!csvStreams && snapViewerSamples) { maxPeakViewers = snapPeak; sumAvgViewers = snapViewerSum; }
    const totalStreams = csvStreams || snapDays;
    const sgAvgViewers = totalStreams ? Math.round(sumAvgViewers / totalStreams) : snapViewerSamples ? Math.round(snapViewerSum / snapViewerSamples) : 0;
    const sgHours = Math.floor(totalMinutes / 60);
    const sgMins = totalMinutes % 60;
    let html = '<div class="page-card" style="margin-top:24px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">';
    html += '<h2 style="font-size:24px">📊 Общие данные: @' + login + '</h2>';
    html += '<button class="btn" onclick="renderTrackerStats(\'' + login + '\', \'' + userId + '\')" style="padding:8px 14px;font-size:13px">🔄 Обновить</button></div>';
    if (ttKeys.length) {
      const ttm = ttData.minutes_streamed || 0;
      const tth = Math.floor(ttm / 60); const ttmi = ttm % 60;
      html += '<h3 style="font-size:16px;margin-bottom:12px">📈 TwitchTracker — 30 дней</h3>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)">';
      html += '<div class="metric"><p>📈 Средние</p><strong style="font-size:22px;color:#a855f7">' + (ttData.avg_viewers || 0) + '</strong></div>';
      html += '<div class="metric"><p>🔥 Пик</p><strong style="font-size:22px;color:#a855f7">' + (ttData.max_viewers || 0) + '</strong></div>';
      html += '<div class="metric"><p>⏱ Эфир</p><strong style="font-size:22px">' + tth + 'ч ' + ttmi + 'м</strong></div>';
      html += '<div class="metric"><p>👁 Часов просмотра</p><strong style="font-size:22px">' + (ttData.hours_watched || 0).toLocaleString('ru-RU') + '</strong></div>';
      html += '<div class="metric"><p>📊 Новые фоловеры (30д)</p><strong style="font-size:22px">+' + (ttData.followers || 0).toLocaleString('ru-RU') + '</strong></div>';
      html += '<div class="metric"><p>👥 Всего фоловеров</p><strong style="font-size:22px;color:#4ade80">' + totalFollowersLive.toLocaleString('ru-RU') + '</strong></div>';
      if (subsCount !== null) html += '<div class="metric"><p>💰 Платная подписка</p><strong style="font-size:22px;color:#fbbf24">' + subsCount.toLocaleString('ru-RU') + '</strong></div>';
      if (ttData.rank) html += '<div class="metric"><p>🏆 Рейтинг</p><strong style="font-size:22px">#' + ttData.rank + '</strong></div>';
      html += '</div>';
    } else {
      html += '<h3 style="font-size:16px;margin-bottom:12px">📈 TwitchTracker</h3>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)">';
      html += '<div class="metric"><p>👥 Всего фоловеров</p><strong style="font-size:22px;color:#4ade80">' + totalFollowersLive.toLocaleString('ru-RU') + '</strong></div>';
      if (subsCount !== null) html += '<div class="metric"><p>💰 Платная подписка</p><strong style="font-size:22px;color:#fbbf24">' + subsCount.toLocaleString('ru-RU') + '</strong></div>';
      html += '</div>';
    }
    if (totalStreams > 0) {
      html += '<h3 style="font-size:16px;margin-bottom:12px">📊 SullyGnome — импортированные стримы</h3>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px;padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid var(--border)">';
      html += '<div class="metric"><p>🎬 Стримов</p><strong style="font-size:22px">' + totalStreams + '</strong></div>';
      html += '<div class="metric"><p>📅 Дней</p><strong style="font-size:22px">' + allDates.size + '</strong></div>';
      html += '<div class="metric"><p>⏱ В эфире</p><strong style="font-size:22px">' + sgHours + 'ч ' + sgMins + 'м</strong></div>';
      html += '<div class="metric"><p>📈 Средние</p><strong style="font-size:22px;color:#a855f7">' + sgAvgViewers + '</strong></div>';
      html += '<div class="metric"><p>🔥 Пик</p><strong style="font-size:22px;color:#a855f7">' + maxPeakViewers + '</strong></div>';
      html += '<div class="metric"><p>👁 Время просмотра</p><strong style="font-size:22px">' + Math.floor(totalWatchTime / 60) + 'ч ' + (totalWatchTime % 60) + 'м</strong></div>';
      html += '<div class="metric"><p>📊 Новые фоловеры</p><strong style="font-size:22px">' + totalFollowers + '</strong></div>';
      if (allGames.size) html += '<div class="metric" style="grid-column:1/-1"><p>🎮 Игры</p><strong style="font-size:14px">' + [...allGames].join(', ') + '</strong></div>';
      html += '</div>';
    } else {
      html += '<h3 style="font-size:16px;margin-bottom:12px">📊 SullyGnome</h3><p class="muted" style="margin-bottom:24px">Нет импортированных данных</p>';
    }
    html += '<p class="muted" style="font-size:12px">Данные обновлены: ' + msk().full + '</p></div>';
    container.innerHTML = html;
  }).catch(e => { container.innerHTML = '<p class="muted" style="padding:20px;text-align:center">❌ Ошибка: ' + e.message + '</p>'; });
}
