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
  };

  function dayStr(offsetDays = 0, ts = Date.now()) {
    const d = new Date(ts + offsetDays * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Сообщения юзера за последние N дней: { date, msgId: { c, l, n, m, t } }
  async function getUserMessages(userId, days) {
    days = days || DATA.CHAT_TTL_DAYS;
    if (!userId) return {};
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

  // Сообщения, сгруппированные по каналам (для страницы юзера).
  async function getUserChatByChannel(userId, days) {
    const byDay = await getUserMessages(userId, days);
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

  // Для админки: лента рейдов за N дней
  async function getRaids(days) {
    days = days || 7;
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

  global.dataLayer = {
    CHAT_TTL_DAYS: DATA.CHAT_TTL_DAYS,
    dayStr,
    getUserMessages,
    getUserChatByChannel,
    getRaids,
  };
})(window);