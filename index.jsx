import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  LineChart,
  Line,
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ============================================
// TWITCH API CONFIG
// ============================================
// Create .env.local:
// NEXT_PUBLIC_TWITCH_CLIENT_ID=your_client_id
// TWITCH_ACCESS_TOKEN=your_access_token
//
// You can get credentials from:
// https://dev.twitch.tv/console/apps
// ============================================

const nav = [
  'Overview',
  'Growth Analytics',
  'Retention',
  'Content Strategy',
  'Forecast',
  'Partner Network',
];

export default function TwitchGrowthDashboard() {
  const [channelData, setChannelData] = useState(null);
  const [loading, setLoading] = useState(true);

  // ============================================
  // DATABASE CHANNEL LIST
  // Replace this later with real DB fetch
  // ============================================
  const trackedChannels = ['K2gemer'];

  // ============================================
  // FETCH TWITCH DATA
  // ============================================
  useEffect(() => {
    async function fetchTwitchData() {
      try {
        const username = trackedChannels[0];

        // STEP 1: GET USER
        const userResponse = await fetch(
          `https://api.twitch.tv/helix/users?login=${username}`,
          {
            headers: {
              'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
              Authorization: `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
            },
          }
        );

        const userData = await userResponse.json();
        const user = userData.data?.[0];

        if (!user) return;

        // STEP 2: GET STREAM INFO
        const streamResponse = await fetch(
          `https://api.twitch.tv/helix/streams?user_id=${user.id}`,
          {
            headers: {
              'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
              Authorization: `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
            },
          }
        );

        const streamData = await streamResponse.json();
        const stream = streamData.data?.[0];

        // STEP 3: GET FOLLOWERS
        const followerResponse = await fetch(
          `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${user.id}`,
          {
            headers: {
              'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
              Authorization: `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
            },
          }
        );

        const followerData = await followerResponse.json();

        // ============================================
        // MOCK ANALYTICS CALCULATIONS
        // Replace later with database analytics
        // ============================================

        const analytics = {
          username: user.display_name,
          avatar: user.profile_image_url,
          followers: followerData.total || 0,
          isLive: !!stream,
          game: stream?.game_name || 'Offline',
          title: stream?.title || 'Currently Offline',

          metrics: {
            avgViewers: 8,
            watchHours: 826,
            momentum: 38,
            consistency: 84,
            health: 78,
          },

          growthData: [
            { month: 'Aug', viewers: 6 },
            { month: 'Sep', viewers: 2 },
            { month: 'Oct', viewers: 6 },
            { month: 'Nov', viewers: 8 },
          ],

          retentionData: [
            { week: 'W1', retention: 37 },
            { week: 'W2', retention: 48 },
            { week: 'W3', retention: 62 },
          ],
        };

        setChannelData(analytics);
      } catch (error) {
        console.error('Twitch API Error:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchTwitchData();
  }, []);

  // ============================================
  // LOADING SCREEN
  // ============================================
  if (loading || !channelData) {
    return (
      <div className="min-h-screen bg-[#07070a] flex items-center justify-center text-white">
        <div className="text-center">
          <div className="w-20 h-20 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin mx-auto mb-6" />
          <h1 className="text-3xl font-bold">Loading Twitch Analytics</h1>
          <p className="text-white/40 mt-2">
            Fetching live channel data...
          </p>
        </div>
      </div>
    );
  }

  const growthData = channelData.growthData;
  const retentionData = channelData.retentionData;

  const metrics = [
    {
      title: 'Followers',
      value: channelData.followers,
      change: 'Live Twitch Data',
    },
    {
      title: 'Avg Viewers',
      value: channelData.metrics.avgViewers,
      change: '+533% since August',
    },
    {
      title: 'Watch Hours',
      value: `${channelData.metrics.watchHours}h`,
      change: 'Calculated from analytics',
    },
    {
      title: 'Momentum',
      value: `+${channelData.metrics.momentum}%`,
      change: 'Organic acceleration',
    },
  ];
  return (
    <div className="min-h-screen bg-[#07070a] text-white overflow-hidden">
      {/* BACKGROUND */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-200px] left-[-200px] w-[500px] h-[500px] bg-purple-500/20 blur-[140px] rounded-full" />
        <div className="absolute bottom-[-250px] right-[-200px] w-[600px] h-[600px] bg-fuchsia-500/10 blur-[180px] rounded-full" />
      </div>

      <div className="relative flex">
        {/* SIDEBAR */}
        <aside className="w-[260px] min-h-screen border-r border-white/5 bg-black/20 backdrop-blur-2xl px-6 py-8 sticky top-0">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-4 mb-12">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-fuchsia-500 shadow-2xl shadow-purple-500/30" />

              <div>
                <h1 className="font-bold text-xl">K2gemer</h1>
                <p className="text-sm text-white/40">
                  Twitch Growth Intelligence
                </p>
              </div>
            </div>

            <nav className="space-y-3">
              {nav.map((item, i) => (
                <motion.div
                  key={item}
                  whileHover={{ scale: 1.02 }}
                  className={`rounded-2xl px-4 py-4 cursor-pointer transition-all border ${
                    i === 0
                      ? 'bg-purple-500/20 border-purple-500/30'
                      : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="text-sm font-medium">{item}</span>
                </motion.div>
              ))}
            </nav>

            <div className="mt-12 rounded-3xl border border-purple-500/20 bg-gradient-to-br from-purple-500/20 to-fuchsia-500/10 p-6">
              <p className="text-sm text-white/50 mb-2">Channel Health</p>

              <div className="flex items-end gap-2">
                <h2 className="text-5xl font-black">78</h2>
                <span className="text-white/40 mb-1">/100</span>
              </div>

              <div className="mt-5 h-3 rounded-full bg-white/10 overflow-hidden">
                <div className="w-[78%] h-full bg-gradient-to-r from-purple-500 to-fuchsia-500 rounded-full" />
              </div>
            </div>
          </motion.div>
        </aside>

        {/* MAIN WEBSITE */}
        <main className="flex-1 px-10 py-10">
          {/* HERO */}
          <section className="mb-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[40px] border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-10 relative overflow-hidden"
            >
              <div className="absolute right-0 top-0 w-[400px] h-[400px] bg-purple-500/10 blur-[120px] rounded-full" />

              <div className="relative z-10 flex items-start justify-between">
                <div className="max-w-[700px]">
                  <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/10 px-4 py-2 mb-6">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-sm text-white/70">
                      Organic Growth Active
                    </span>
                  </div>

                  <h1 className="text-6xl font-black leading-[1.05] tracking-tight max-w-[700px]">
                    Twitch Analytics & Growth Forecasting Platform
                  </h1>

                  <p className="text-white/50 text-lg mt-6 max-w-[620px] leading-relaxed">
                    Tracking the transformation of K2gemer from a
                    low-traffic Twitch affiliate into a growing Minecraft
                    community driven by retention, consistency, and
                    audience engagement.
                  </p>

                  <div className="flex gap-4 mt-10">
                    <button className="px-7 py-4 rounded-2xl bg-gradient-to-r from-purple-500 to-fuchsia-500 font-semibold shadow-2xl shadow-purple-500/30">
                      View Analytics
                    </button>

                    <button className="px-7 py-4 rounded-2xl border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 transition">
                      Partnership Inquiry
                    </button>
                  </div>
                </div>

                <div className="w-[320px] rounded-[32px] border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-purple-500 to-fuchsia-500" />

                    <div>
                      <h2 className="text-2xl font-bold">K2gemer</h2>
                      <p className="text-white/40">Minecraft Creator</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {metrics.map((metric) => (
                      <div
                        key={metric.title}
                        className="rounded-2xl border border-white/5 bg-white/[0.03] p-4"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-white/40">
                            {metric.title}
                          </p>
                          <div className="w-2 h-2 rounded-full bg-purple-400" />
                        </div>

                        <h3 className="text-3xl font-black mt-2">
                          {metric.value}
                        </h3>

                        <p className="text-xs text-white/40 mt-1">
                          {metric.change}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </section>

          {/* ANALYTICS GRID */}
          <section className="grid grid-cols-12 gap-6 mb-6">
            {/* GROWTH */}
            <div className="col-span-8 rounded-[32px] border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-8">
              <div className="flex items-start justify-between mb-10">
                <div>
                  <h2 className="text-3xl font-bold">
                    Organic Growth Momentum
                  </h2>
                  <p className="text-white/40 mt-2">
                    Real viewer growth excluding raid spikes and artificial
                    traffic.
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm text-white/40">Momentum Score</p>
                  <h3 className="text-4xl font-black text-green-400">
                    +38%
                  </h3>
                </div>
              </div>

              <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={growthData}>
                    <defs>
                      <linearGradient id="colorViewers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                      </linearGradient>
                    </defs>

                    <XAxis dataKey="month" stroke="#666" />
                    <YAxis stroke="#666" />
                    <Tooltip />

                    <Area
                      type="monotone"
                      dataKey="viewers"
                      stroke="#a855f7"
                      strokeWidth={4}
                      fill="url(#colorViewers)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* RETENTION */}
            <div className="col-span-4 rounded-[32px] border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold">Retention</h2>
                  <p className="text-white/40 text-sm mt-1">
                    Returning viewer trend
                  </p>
                </div>

                <div className="text-green-400 font-bold text-xl">
                  +12%
                </div>
              </div>

              <div className="space-y-8 mt-12">
                {retentionData.map((item) => (
                  <div key={item.week}>
                    <div className="flex justify-between mb-3">
                      <span className="text-white/50">{item.week}</span>
                      <span className="font-semibold">
                        {item.retention}%
                      </span>
                    </div>

                    <div className="h-4 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${item.retention}%` }}
                        transition={{ duration: 1 }}
                        className="h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-14 rounded-3xl border border-white/5 bg-black/20 p-6">
                <p className="text-sm text-white/40 mb-2">
                  Community Density
                </p>

                <h3 className="text-5xl font-black">62%</h3>

                <p className="text-white/40 mt-2 text-sm">
                  High chatter-to-viewer interaction ratio.
                </p>
              </div>
            </div>
          </section>

          {/* LOWER SECTION */}
          <section className="grid grid-cols-12 gap-6">
            {/* CONTENT */}
            <div className="col-span-4 rounded-[32px] border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-8">
              <h2 className="text-3xl font-bold mb-2">
                Content Performance
              </h2>

              <p className="text-white/40 mb-10">
                Streamed hours by category.
              </p>

              <div className="space-y-5">
                {[
                  ['Minecraft', '166h', 'bg-purple-500'],
                  ['Just Chatting', '24h', 'bg-fuchsia-500'],
                  ['PEAK', '15h', 'bg-blue-500'],
                  ['ScourgeBringer', '5.5h', 'bg-cyan-500'],
                ].map(([game, hours, color]) => (
                  <div
                    key={game}
                    className="rounded-3xl border border-white/5 bg-black/20 p-5"
                  >
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${color}`} />
                        <span className="font-semibold">{game}</span>
                      </div>

                      <span className="text-white/40">{hours}</span>
                    </div>

                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color}`}
                        style={{
                          width:
                            game === 'Minecraft'
                              ? '92%'
                              : game === 'Just Chatting'
                              ? '38%'
                              : '18%',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* FORECAST */}
            <div className="col-span-4 rounded-[32px] border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-8">
              <div className="flex items-start justify-between mb-10">
                <div>
                  <h2 className="text-3xl font-bold">Forecast</h2>
                  <p className="text-white/40 mt-2">
                    Predicted average viewers.
                  </p>
                </div>

                <div className="rounded-2xl border border-green-500/20 bg-green-500/10 px-4 py-2 text-green-400 font-semibold">
                  72% Confidence
                </div>
              </div>

              <div className="space-y-5 mt-10">
                {[
                  ['December 2025', '9–11'],
                  ['January 2026', '11–14'],
                  ['February 2026', '13–16'],
                ].map(([month, value]) => (
                  <div
                    key={month}
                    className="rounded-3xl border border-white/5 bg-black/20 p-6"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white/40 text-sm">{month}</p>
                        <h3 className="text-3xl font-black mt-2">
                          {value}
                        </h3>
                      </div>

                      <div className="w-14 h-14 rounded-2xl bg-purple-500/20 border border-purple-500/20 flex items-center justify-center">
                        ↗
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* STREAM FREQUENCY */}
            <div className="col-span-4 rounded-[32px] border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-8 relative overflow-hidden">
              <h2 className="text-3xl font-bold mb-2">
                Stream Consistency
              </h2>

              <p className="text-white/40 mb-10">
                Frequency and schedule stability tracking.
              </p>

              <div className="space-y-6">
                <div className="rounded-3xl border border-white/5 bg-black/20 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-white/40 text-sm">
                        Weekly Stream Frequency
                      </p>
                      <h3 className="text-5xl font-black mt-2">
                        5-7
                      </h3>
                    </div>

                    <div className="w-16 h-16 rounded-2xl bg-purple-500/20 border border-purple-500/20 flex items-center justify-center text-2xl">
                      📡
                    </div>
                  </div>

                  <div className="h-3 rounded-full bg-white/5 overflow-hidden mt-6">
                    <div className="w-[84%] h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500" />
                  </div>

                  <p className="text-white/40 text-sm mt-4">
                    Strong consistency improves Twitch discoverability and viewer retention.
                  </p>
                </div>

                <div className="rounded-3xl border border-white/5 bg-black/20 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <p className="text-white/40 text-sm">
                        Most Active Days
                      </p>
                      <h3 className="text-2xl font-bold mt-2">
                        Thu • Sat • Sun
                      </h3>
                    </div>

                    <div className="text-green-400 font-bold text-lg">
                      High Performance
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-2 mt-8">
                    {[
                      ['M', 35],
                      ['T', 62],
                      ['W', 58],
                      ['T', 92],
                      ['F', 40],
                      ['S', 100],
                      ['S', 95],
                    ].map(([day, level]) => (
                      <div
                        key={day}
                        className="flex flex-col items-center gap-2"
                      >
                        <div className="text-xs text-white/40">{day}</div>

                        <div className="w-full h-24 rounded-2xl bg-white/5 overflow-hidden flex items-end">
                          <div
                            className="w-full bg-gradient-to-t from-purple-500 to-fuchsia-500 rounded-2xl"
                            style={{ height: `${level}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-purple-500/20 bg-purple-500/10 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white/50">
                        Schedule Stability Score
                      </p>

                      <h3 className="text-4xl font-black mt-2">
                        84%
                      </h3>
                    </div>

                    <div className="text-green-400 font-bold text-xl">
                      Excellent
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
