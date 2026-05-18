let currentTwitchUser = null;
let currentUserRoles = {};
let cachedUsers = null;
let cachedUsersTime = 0;
let currentOpenCreator = null;
let _creatorFollowersCache = {};
let currentViewerProfileId = null;
let refreshInterval = null;

const PAGE_ROUTES = {
  'home': '/dashboard',
  'me': '/dashboard/ya',
  'squad': '/dashboard/squad',
  'academy': '/dashboard/academy',
  'viewers': '/dashboard/viewers',
  'checkuser': '/dashboard/checkuser',
  'watching': '/dashboard/watching',
  'similar': '/dashboard/similar',
};

async function initApp() {
  try {
    await authReady;
    TG_PROXY_URL = await getTgProxyUrl();
    const app = document.getElementById('app');
    const authBlock = document.getElementById('authBlock');
    const path = window.location.pathname;

    if (path === '/banned') {
      app.classList.remove('authorized');
      authBlock.style.display = 'none';
      navigate('/banned', true);
      return;
    }

    const hasHash = window.location.hash.includes('access_token');
    const hasToken = !!localStorage.getItem('twitchAccessToken');

    if (hasHash) {
      authBlock.innerHTML = '<div class="logo" style="width:80px;height:80px;margin:0 auto"></div><p class="muted" style="text-align:center;margin-top:20px">Авторизация…</p>';
    }

    if (hasHash || (!restoreSession() || !hasToken)) {
      const ok = await checkTwitchAuth();
      if (ok) {
        app.classList.add('authorized');
        authBlock.style.display = 'none';
        renderAdminButton();
        renderSidebarUser();
        updateSquadNavButton();
        checkBotModeratorStatus();
        navigate('/dashboard', true);
        return;
      }
      app.classList.remove('authorized');
      authBlock.style.display = 'flex';
      return;
    }

    app.classList.add('authorized');
    authBlock.style.display = 'none';
    renderAdminButton();
    renderSidebarUser();
    updateSquadNavButton();
    checkBotModeratorStatus();
    navigate(path || '/dashboard', true);
  } catch (e) {
    console.error('initApp error:', e);
  }
}

document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => {
  viewerTracker.stop();
  currentViewerProfileId = null;
  currentOpenCreator = null;
  activeNav(b.dataset.page);
  const route = PAGE_ROUTES[b.dataset.page];
  if (route) navigate(route);
  else navigate('/dashboard');
}));

window.addEventListener('resize', drawChart);

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(async () => {
    try {
      cachedUsers = null;
      const members = await loadTwitchUsers(true);
      const homePage = document.getElementById('homePage');
      const squadPage = document.getElementById('squadPage');
      const creatorPage = document.getElementById('creatorPage');
      const viewersPage = document.getElementById('viewersPage');
      if (homePage && !homePage.classList.contains('hidden')) {
        viewerTracker.stop();
        await renderHome();
      } else if (squadPage && !squadPage.classList.contains('hidden')) {
        const activeBtn = document.querySelector('.nav button.active');
        if (activeBtn && activeBtn.dataset.page === 'squad') {
          viewerTracker.stop();
          await renderHome();
        }
      } else if (viewersPage && !viewersPage.classList.contains('hidden')) {
        await renderViewersPage();
      }
    } catch (e) {}
  }, 30000);
}

setTimeout(startAutoRefresh, 5000);
