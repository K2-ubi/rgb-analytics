const https = require('https');

const FIREBASE_DB_URL = 'https://rgb-analytics-default-rtdb.firebaseio.com';
const FIREBASE_DB_SECRET = 'CGve6ffhjdQD7nNJZ0dnXawLoJ02mjEiTqpamc1o';

const LOGIN = 'k2gemer';

const streams = [
  { date: '2026-05-15', time: '07:56', mins: 199, watchMins: 597, avg: 3, peak: 7, followers: 2, games: 'Minecraft' },
  { date: '2026-05-13', time: '09:08', mins: 172, watchMins: 344, avg: 2, peak: 14, followers: 5, games: 'Minecraft' },
  { date: '2026-05-13', time: '05:30', mins: 60, watchMins: 300, avg: 5, peak: 8, followers: 0, games: 'Minecraft' },
  { date: '2026-05-12', time: '05:27', mins: 213, watchMins: 1065, avg: 5, peak: 9, followers: 3, games: 'Minecraft' },
  { date: '2026-05-10', time: '14:02', mins: 1138, watchMins: 4552, avg: 4, peak: 12, followers: 18, games: 'Minecraft,Just Chatting' },
  { date: '2026-05-10', time: '07:26', mins: 199, watchMins: 796, avg: 4, peak: 9, followers: 0, games: 'Minecraft' },
  { date: '2026-04-27', time: '09:40', mins: 260, watchMins: 780, avg: 3, peak: 8, followers: 4, games: 'Just Chatting,Gorilla Showdown,Hollow Knight: Silksong' },
  { date: '2026-04-26', time: '09:36', mins: 54, watchMins: 162, avg: 3, peak: 7, followers: 0, games: 'Hollow Knight,Hollow Knight Silksong' },
  { date: '2026-04-25', time: '12:21', mins: 24, watchMins: 48, avg: 2, peak: 4, followers: 0, games: 'Ready or Not' },
  { date: '2026-04-21', time: '08:53', mins: 172, watchMins: 688, avg: 4, peak: 9, followers: 0, games: 'Ready or Not' },
  { date: '2026-04-20', time: '15:28', mins: 272, watchMins: 1360, avg: 5, peak: 10, followers: 1, games: 'Just Chatting,Minecraft' },
  { date: '2026-04-20', time: '05:12', mins: 18, watchMins: 72, avg: 4, peak: 8, followers: 0, games: 'Just Chatting,Minecraft' },
  { date: '2026-04-18', time: '16:04', mins: 146, watchMins: 730, avg: 5, peak: 10, followers: 0, games: 'Unlisted on Twitch,Strinova,Just Chatting' },
  { date: '2026-04-17', time: '19:48', mins: 177, watchMins: 1062, avg: 6, peak: 17, followers: 0, games: 'Just Chatting,Umbra,Strinova,Dying Light' },
  { date: '2026-04-16', time: '02:06', mins: 1014, watchMins: 3042, avg: 3, peak: 10, followers: 1, games: 'Just Chatting,Minecraft,Noita,I\'m Only Sleeping,Hozy,Yunyun Syndrome!?: Rhythm Psychosis,Viewfinder,DON\'T SCREAM TOGETHER' },
  { date: '2026-04-15', time: '14:57', mins: 348, watchMins: 1044, avg: 3, peak: 11, followers: 0, games: 'Minecraft,Just Chatting,Strinova' },
];

function firebasePatch(path, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(path + '.json?auth=' + FIREBASE_DB_SECRET, FIREBASE_DB_URL);
    const body = JSON.stringify(data);
    const req = https.request(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } }, res => {
      let r = '';
      res.on('data', c => r += c);
      res.on('end', () => { try { resolve(JSON.parse(r)); } catch { resolve(r); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Importing ' + streams.length + ' streams for ' + LOGIN);
  let imported = 0;

  for (const s of streams) {
    const [h, m] = s.time.split(':').map(Number);
    const startDate = new Date(Date.UTC(
      parseInt(s.date.slice(0, 4)),
      parseInt(s.date.slice(5, 7)) - 1,
      parseInt(s.date.slice(8, 10)),
      h, m
    ));
    const chunkTs = startDate.getTime();

    const chunk = {
      viewers: s.avg,
      peakViewers: s.peak,
      watchTimeMins: s.watchMins,
      followersGained: s.followers,
      game: s.games.split(',')[0].trim(),
      games: s.games,
      title: 'SullyGnome import',
      durationMins: s.mins,
      updatedAt: chunkTs,
      source: 'sullygnome-csv'
    };

    const chunkPath = 'stream-chunks/' + LOGIN + '/' + s.date + '/' + chunkTs;
    try {
      await firebasePatch(chunkPath, chunk);
      console.log('  \u2713 ' + s.date + ' (' + s.mins + 'min, avg ' + s.avg + ', peak ' + s.peak + ')');
      imported++;
    } catch (e) {
      console.log('  \u2717 ' + s.date + ': ' + e.message);
    }
  }

  console.log('\nImported ' + imported + '/' + streams.length + ' stream days to Firebase');
}

main().catch(e => console.error('Error:', e));
