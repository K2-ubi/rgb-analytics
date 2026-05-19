export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.status(200).json({
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    databaseURL: process.env.FIREBASE_DB_URL || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '',
    twitchClientId: process.env.TWITCH_CLIENT_ID || '',
  });
}
