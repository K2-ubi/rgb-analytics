const ROUTES = {
  '/': { render: 'renderHome', auth: true },
  '/dashboard': { render: 'renderHome', auth: true },
  '/dashboard/home': { render: 'renderHome', auth: true },
  '/dashboard/ya': { render: 'renderMyProfile', auth: true },
  '/dashboard/me': { render: 'renderMyProfile', auth: true },
  '/dashboard/squad': { render: 'renderSquad', auth: true, role: 'squad' },
  '/dashboard/academy': { render: 'renderAcademy', auth: true, role: 'academy' },
  '/dashboard/viewers': { render: 'renderViewersPage', auth: true },
  '/dashboard/checkuser': { render: 'renderCheckUser', auth: true },
  '/dashboard/watching': { render: 'renderWatching', auth: true },
  '/dashboard/similar': { render: 'renderSimilar', auth: true },
  '/admin': { render: 'renderAdminPanel', auth: true, admin: true },
  '/banned': { render: 'renderBannedPage', auth: false },
};

let _currentRoute = '/';
let _routeGuardRunning = false;
let _bannedCache = null;
let _bannedCacheTime = 0;
const BANNED_CACHE_TTL = 60000;

async function checkBannedCached(login) {
  const now = Date.now();
  if (_bannedCache !== null && now - _bannedCacheTime < BANNED_CACHE_TTL) return _bannedCache;
  try {
    const snap = await db.ref('squad/_bans').once('value');
    const bans = snap.val() || {};
    _bannedCache = bans.users && bans.users[(login || '').toLowerCase()] ? true : false;
    _bannedCacheTime = now;
    return _bannedCache;
  } catch (e) {}
  return false;
}

function matchRoute(path) {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  return ROUTES[clean] || null;
}

async function routeGuard(path) {
  if (_routeGuardRunning) return false;
  _routeGuardRunning = true;

  try {
    const route = matchRoute(path);
    if (!route) {
      navigate('/dashboard', true);
      return false;
    }

    if (path === '/banned') {
      _currentRoute = path;
      return true;
    }

    const appEl = document.getElementById('app');
    const authBlock = document.getElementById('authBlock');

    if (!appEl || !authBlock) return false;

    const isAuthed = appEl.classList.contains('authorized');

    if (route.auth && !isAuthed) {
      if (restoreSession() && localStorage.getItem('twitchAccessToken')) {
        appEl.classList.add('authorized');
        authBlock.style.display = 'none';
        renderSidebarUser();
      } else if (window.location.hash.includes('access_token')) {
        authBlock.innerHTML = '<div class="logo" style="width:80px;height:80px;margin:0 auto"></div><p class="muted" style="text-align:center;margin-top:20px">Авторизация…</p>';
      } else {
        authBlock.style.display = 'flex';
        appEl.classList.remove('authorized');
        _currentRoute = path;
        return true;
      }
    }

    if (route.admin && !isAdmin()) {
      navigate('/dashboard', true);
      return false;
    }

    if (route.role && !isAdmin()) {
      if (!currentUserRoles || !currentUserRoles[route.role]) {
        navigate('/dashboard', true);
        return false;
      }
    }

    if (route.auth && currentTwitchUser) {
      const banned = await checkBannedCached(currentTwitchUser.login);
      if (banned) {
        navigate('/banned', true);
        return false;
      }
    }

    _currentRoute = path;
    return true;
  } finally {
    _routeGuardRunning = false;
  }
}

function navigate(path, replace) {
  const route = matchRoute(path);
  if (!route) {
    path = '/dashboard';
  }

  if (replace) {
    history.replaceState(null, '', path);
  } else {
    history.pushState(null, '', path);
  }

  handleRoute();
}

const PATH_TO_PAGE = {
  '/': 'home',
  '/dashboard': 'home',
  '/dashboard/home': 'home',
  '/dashboard/ya': 'me',
  '/dashboard/me': 'me',
  '/dashboard/squad': 'squad',
  '/dashboard/academy': 'academy',
  '/dashboard/viewers': 'viewers',
  '/dashboard/checkuser': 'checkuser',
  '/dashboard/watching': 'watching',
  '/dashboard/similar': 'similar',
  '/admin': 'admin',
};

async function handleRoute() {
  const path = window.location.pathname;
  const passed = await routeGuard(path);
  if (!passed) return;

  const route = matchRoute(path);
  if (!route) return;

  const appEl = document.getElementById('app');
  const authBlock = document.getElementById('authBlock');

  if (path === '/banned') {
    renderBannedPage();
    if (appEl) appEl.classList.remove('authorized');
    if (authBlock) authBlock.style.display = 'none';
    return;
  }

  const page = PATH_TO_PAGE[path] || null;
  if (page && typeof activeNav === 'function') {
    activeNav(page);
  }

  if (typeof window[route.render] === 'function') {
    window[route.render]();
  }
}

window.addEventListener('popstate', () => {
  handleRoute();
});

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('//')) return;
  if (href.startsWith('/api/')) return;

  e.preventDefault();
  navigate(href);
});

function clearRouteCache() {
  _bannedCache = null;
  _bannedCacheTime = 0;
}

function renderBannedPage() {
  const main = document.querySelector('.main');
  if (!main) return;

  const pages = ['homePage', 'squadPage', 'creatorPage', 'viewersPage', 'checkUserPage', 'infoPage'];
  pages.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.add('hidden');
  });
  const ap = document.getElementById('adminPanel');
  if (ap) ap.classList.add('hidden');

  main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:80vh">
      <div style="text-align:center;max-width:500px">
        <div style="font-size:72px;margin-bottom:20px">⛔</div>
        <h1 style="font-size:32px;margin-bottom:12px">Доступ запрещён</h1>
        <p class="muted" style="font-size:16px;line-height:1.6">Ваш IP или аккаунт находится в бан-листе.<br>Если вы считаете это ошибкой — свяжитесь с администратором.</p>
      </div>
    </div>`;
}

function renderSquad() {
  openSquad('squad');
}

function renderAcademy() {
  openSquad('academy');
}

function renderWatching() {
  renderInfo('watching');
}

function renderSimilar() {
  renderInfo('similar');
}

if (typeof initApp === 'function') {
  initApp();
}
