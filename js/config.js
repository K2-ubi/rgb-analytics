const firebaseConfig = {
  apiKey: "AIzaSyCzJoJovKJGMjeFHHw3iFliDg3dQn0ZEAI",
  authDomain: "rgbsquad-892a2.firebaseapp.com",
  databaseURL: "https://rgbsquad-892a2-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "rgbsquad-892a2",
  storageBucket: "rgbsquad-892a2.firebasestorage.app",
  messagingSenderId: "972966480164",
  appId: "1:972966480164:web:9303693952a413abf78bb1"
};

firebase.initializeApp(firebaseConfig);

const RECAPTCHA_SITE_KEY = '6LeCGPIsAAAAALrxMigz3znA2CT5wbKm8rBPkUWv';
if (typeof firebase.appCheck !== 'undefined' && RECAPTCHA_SITE_KEY) {
  firebase.appCheck().activate(RECAPTCHA_SITE_KEY, true);
}

const db = firebase.database();
const authReady = firebase.auth().signInAnonymously()
  .then(() => console.log('Firebase anonymous auth OK'))
  .catch(e => console.warn('Firebase anonymous auth failed:', e));

const TWITCH_CLIENT_ID = 'a26lg52682u7ja24bam0p8lnahs7lg';
const CACHE_TTL = 20000;
const BOT_CACHE_TTL = 60000;
const BOT_INFO_TTL = 120000;

// Supabase (почва для перехода). Когда проект готов — впиши url и anonKey,
// включи enabled: true, и dataLayer сам переключится на чтение из PostgREST.
// DDL: supabase/schema.sql. Синк: scripts/sync-rtdb-to-supabase.js.
window.CONFIG = {
  supabase: {
    enabled: true,
    url: 'https://rnoufrqqrgpanngkyciq.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJub3VmcnFxcmdwYW5uZ2t5Y2lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTk0ODAsImV4cCI6MjEwNTEzNTQ4MH0.uTdZDhfCiF0gvv_ANaHCMso_Qjn8_2dmTvEDAU0j8DI'
  }
};

window.__RECAPTCHA_SITE_KEY = RECAPTCHA_SITE_KEY;
fetch('/api/firebase-config').then(r => r.json()).then(cfg => {
  if (cfg.recaptchaSiteKey && cfg.recaptchaSiteKey !== RECAPTCHA_SITE_KEY) {
    window.__RECAPTCHA_SITE_KEY = cfg.recaptchaSiteKey;
  }
}).catch(() => {});

async function getAppCheckToken() {
  try {
    if (typeof firebase.appCheck === 'undefined' || !window.__RECAPTCHA_SITE_KEY) return '';
    const result = await firebase.appCheck().getToken(false);
    return result.token;
  } catch { return ''; }
}
