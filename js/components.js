const squads = {
  main: {
    title: 'RGB-Squad', label: 'PRIMARY CREATOR TEAM', members: [
      {
        name: 'K2gemer',
        role: 'Minecraft Creator',
        avg: 8,
        followers: 117,
        hours: '12.2h',
        watch: '826h',
        gain: '+26',
        consistency: '5 days',
        retention: 62,
        momentum: '+38%',
        density: '62%',
        status: 'Online',
        content: [['Minecraft', '166h', 92], ['Just Chatting', '24h', 38], ['PEAK', '15h', 18]],
        forecast: [['December', '9–11'], ['January', '11–14'], ['February', '13–16']]
      },
      {
        name: 'Mak_Kallster',
        role: 'Variety Creator',
        avg: 6.6,
        followers: 229,
        hours: '18.4h',
        watch: '2859h',
        gain: '+14',
        consistency: '4 days',
        retention: 58,
        momentum: '+24%',
        density: '58%',
        status: 'Online',
        content: [['Just Chatting', '82h', 80], ['Subnautica', '46h', 48], ['Khazan', '28h', 32]],
        forecast: [['December', '7–9'], ['January', '8–10'], ['February', '10–12']]
      },
      {
        name: 'Minilloshka',
        role: 'Gaming Creator',
        avg: 5.8,
        followers: 154,
        hours: '9.5h',
        watch: '898h',
        gain: '+9',
        consistency: '5 days',
        retention: 51,
        momentum: '+18%',
        density: '51%',
        status: 'Offline',
        content: [['League of Legends', '64h', 78], ['Subnautica', '32h', 42], ['Variety', '21h', 28]],
        forecast: [['December', '6–8'], ['January', '7–9'], ['February', '8–10']]
      }
    ]
  },
  academy: {
    title: 'RGB-Academy', label: 'DEVELOPMENT PROGRAM', members: [
      {
        name: 'Nekisekai',
        role: 'Academy Creator',
        avg: 2.4,
        followers: 91,
        hours: '6.2h',
        watch: '288h',
        gain: '+5',
        consistency: '3 days',
        retention: 44,
        momentum: '+19%',
        density: '44%',
        status: 'Online',
        content: [['Minecraft', '24h', 64], ['Just Chatting', '8h', 26], ['Indie', '6h', 18]],
        forecast: [['December', '3–5'], ['January', '4–6'], ['February', '5–7']]
      },
      {
        name: 'Priganov',
        role: 'Academy Creator',
        avg: 1.8,
        followers: 76,
        hours: '4.8h',
        watch: '216h',
        gain: '+3',
        consistency: '2 days',
        retention: 38,
        momentum: '+14%',
        density: '38%',
        status: 'Offline',
        content: [['Minecraft', '18h', 58], ['Variety', '7h', 24], ['Chatting', '5h', 16]],
        forecast: [['December', '2–4'], ['January', '3–5'], ['February', '4–6']]
      },
      {
        name: 'NewCreator',
        role: 'Academy Creator',
        avg: 0.9,
        followers: 41,
        hours: '3.1h',
        watch: '108h',
        gain: '+2',
        consistency: '2 days',
        retention: 29,
        momentum: '+8%',
        density: '29%',
        status: 'Offline',
        content: [['Minecraft', '12h', 46], ['Training', '6h', 22], ['Variety', '4h', 14]],
        forecast: [['December', '1–3'], ['January', '2–4'], ['February', '3–5']]
      }
    ]
  }
};

const pages = ['homePage', 'squadPage', 'creatorPage', 'viewersPage', 'checkUserPage', 'infoPage'];
const allMembers = [...squads.main.members, ...squads.academy.members];

function renderAdminButton() {
  const nav = document.querySelector('.nav');
  let btn = document.getElementById('adminNavBtn');
  if (isAdmin()) {
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'adminNavBtn';
      btn.dataset.page = 'admin';
      btn.textContent = '⚙️ Admin';
      nav.appendChild(btn);
      btn.addEventListener('click', () => {
        activeNav('admin');
        navigate('/admin');
      });
    }
  } else {
    if (btn) btn.remove();
  }
}

function renderSidebarUser() {
  const u = currentTwitchUser;
  if (!u) return;
  const brand = document.querySelector('.brand');
  const imp = isImpersonating();
  brand.innerHTML = `
    <img class="logo" src="${u.profile_image_url}" alt="" style="object-fit:cover">
    <div><h1>${u.display_name}</h1><p class="muted">${rolesDisplay()}${imp ? ' <span style="color:#fde047;font-size:11px">(симуляция)</span>' : ''}</p></div>
  `;
  const existingBadge = document.getElementById('impersonateBadge');
  if (existingBadge) existingBadge.remove();
  if (imp) {
    const sidebar = document.querySelector('.sidebar');
    const badge = document.createElement('div');
    badge.id = 'impersonateBadge';
    badge.className = 'impersonate-badge';
    badge.innerHTML = '<span>🔄 Симуляция</span><button onclick="restoreAdminAccount()">Вернуться на свой аккаунт</button>';
    const brandEl = document.querySelector('.brand');
    if (brandEl) brandEl.after(badge);
  }
}

function updateSquadNavButton() {
  const nav = document.querySelector('.nav');
  const existing = document.getElementById('squadSectionBtn');
  if (existing) existing.remove();
  if (!currentUserRoles?.squad && !currentUserRoles?.academy) return;
  const label = currentUserRoles?.squad ? '👥 Squad' : '🎓 Academy';
  const btn = document.createElement('button');
  btn.id = 'squadSectionBtn';
  btn.textContent = label;
  btn.dataset.page = 'squad';
  nav.appendChild(btn);
  btn.addEventListener('click', () => {
    activeNav('squad');
    navigate('/dashboard');
  });
}
