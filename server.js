const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════════
//  RACE CONFIGURATION — Edit these for each wager race
// ═══════════════════════════════════════════════════════════════════
const RACE_CONFIG = {
  name: "MAY WAGER RACE",
  subtitle: "Wager the most on Damble to climb the leaderboard",
  startDate: "2026-05-01",
  endDate: "2026-06-01",
  prizes: [
    { place: "1st", reward: "$375" },
    { place: "2nd", reward: "$260" },
    { place: "3rd", reward: "$115" },
  ],
  signupLink: "https://www.damble.io/?dialog=auth&tab=register&referralCode=damble-Gambros",
  brandName: "GAMBROS",
};

// Damble returns cumulative all-time wager stats for each referral.
// These reset baselines remove all wager/bet totals already present
// before the May race window, so the leaderboard only shows growth
// above this point through 2026-06-01 00:00.
const RACE_BASELINES = {
  "alinyogi": { wagered: 12.28, bets: 49 },
  "allisonbrown": { wagered: 139.12, bets: 219 },
  "banderasb": { wagered: 47577.17, bets: 9282 },
  "Barney": { wagered: 245.79, bets: 395 },
  "C4LD0Y": { wagered: 54046, bets: 28376 },
  "dabestyeti ": { wagered: 24.09, bets: 57 },
  "Doyouhavekids": { wagered: 42.31, bets: 290 },
  "dyluzumaki": { wagered: 334087.43, bets: 15332 },
  "Eradicate": { wagered: 48.15, bets: 482 },
  "giuseppo": { wagered: 84.68, bets: 95 },
  "jackliamwestwood14_c5ner": { wagered: 4043.33, bets: 847 },
  "JJO420": { wagered: 828.3, bets: 62 },
  "JordanE23": { wagered: 3511.93, bets: 2353 },
  "kubul195": { wagered: 43.92, bets: 116 },
  "Madgam09": { wagered: 29.85, bets: 8 },
  "samali prate": { wagered: 2258.67, bets: 921 },
  "sevenjj": { wagered: 5824.5, bets: 284 },
  "Tasa": { wagered: 110, bets: 737 },
  "willyjoes": { wagered: 23.14, bets: 66 },
  "YetiSpins": { wagered: 209632.26, bets: 18465 },
  "zakwestwood1": { wagered: 13776.93, bets: 6289 },
};

// ═══════════════════════════════════════════════════════════════════
//  API CREDENTIALS
// ═══════════════════════════════════════════════════════════════════
const API_KEY = process.env.API_KEY || "";
const PARTNER_EMAIL = process.env.PARTNER_EMAIL || "";
const DAMBLE_BASE = "https://server.damble.io/api/v1/partners";

// ═══════════════════════════════════════════════════════════════════
//  API CACHE — avoids hammering Damble on every browser refresh
//  Data refreshes every 60 seconds server-side
// ═══════════════════════════════════════════════════════════════════
let apiCache = {};
const CACHE_TTL = 60 * 1000; // 60 seconds

async function cachedFetch(endpoint) {
  const now = Date.now();
  if (apiCache[endpoint] && (now - apiCache[endpoint].time) < CACHE_TTL) {
    return apiCache[endpoint].data;
  }

  const url = DAMBLE_BASE + endpoint;
  console.log(`  ->  Fetching: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": API_KEY,
      "x-partner-email": PARTNER_EMAIL,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw { status: response.status, body: text };
  }

  const json = await response.json();
  apiCache[endpoint] = { time: now, data: json };
  return json;
}

// ─── Race config endpoint ────────────────────────────────────────
app.get("/race-config", (_req, res) => {
  res.json(RACE_CONFIG);
});

// ─── Leaderboard data endpoint (aggregated, clean) ───────────────
app.get("/race-data", async (_req, res) => {
  if (!API_KEY || !PARTNER_EMAIL) {
    return res.status(500).json({
      error: "Credentials not set. Run with: set API_KEY=... && set PARTNER_EMAIL=... && node server.js",
    });
  }

  try {
    // Fetch both endpoints in parallel
    const [usersJson, overviewJson] = await Promise.all([
      cachedFetch("/affiliate/stats/earnings-per-user"),
      cachedFetch("/affiliate/stats/overview"),
    ]);

    const users = usersJson.data || usersJson;
    const overviewRaw = overviewJson.data || overviewJson;
    const overview = overviewRaw.overview || overviewRaw;

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(200).json({
        players: [],
        stats: { totalWagered: 0, totalBets: 0, playerCount: 0, activeCount: 0 },
      });
    }

    // Convert cumulative API totals into May race totals by subtracting
    // the reset baseline for each existing referral.
    const players = users
      .map((u) => {
        const username = u.username || "Unknown";
        const baseline = RACE_BASELINES[username] || { wagered: 0, bets: 0 };
        return {
          username,
          wagered: Math.max(0, (u.totalAmountWagered || 0) - baseline.wagered),
          bets: Math.max(0, (u.totalBetsPlaced || 0) - baseline.bets),
          commission: u.totalCommissionEarnedUsd || 0,
          thisMonth: u.thisMonthEarningsUsd || 0,
          lastMonth: u.lastMonthEarningsUsd || 0,
          isActive: u.isActive || false,
          firstActivity: u.firstCommissionAt || null,
          lastActivity: u.lastCommissionAt || null,
        };
      })
      .filter((p) => p.wagered > 0 || p.bets > 0)
      .sort((a, b) => b.wagered - a.wagered)
      .map((p, i) => ({ ...p, rank: i + 1 }));

    // Aggregate stats
    const totalWagered = players.reduce((s, p) => s + p.wagered, 0);
    const totalBets = players.reduce((s, p) => s + p.bets, 0);
    const activeCount = players.filter((p) => p.isActive).length;

    res.json({
      players: players,
      stats: {
        totalWagered: totalWagered,
        totalBets: totalBets,
        playerCount: players.length,
        activeCount: activeCount,
      },
    });
  } catch (err) {
    console.error("  x  API error:", err);
    const status = err.status || 502;
    let msg = "Failed to fetch data from Damble API";
    if (status === 401) msg = "Invalid API key or email";
    if (status === 403) msg = "Account is not an affiliate partner";
    res.status(status).json({ error: msg });
  }
});

// ─── Live Reload via SSE ─────────────────────────────────────────
let reloadClients = [];
app.get("/__reload", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("data: connected\n\n");
  reloadClients.push(res);
  req.on("close", () => {
    reloadClients = reloadClients.filter((c) => c !== res);
  });
});

const publicDir = path.join(__dirname, "public");
let debounce = null;
fs.watch(publicDir, { recursive: true }, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.log("  ~  File changed - reloading browsers...");
    reloadClients.forEach((r) => r.write("data: reload\n\n"));
  }, 200);
});

// ─── Serve frontend ──────────────────────────────────────────────
app.use(
  express.static(publicDir, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  })
);

// ─── Start ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("");
  console.log("  ======================================================");
  console.log("   GAMBROS WAGER RACE");
  console.log(`   http://localhost:${PORT}`);
  console.log("   Live reload: ON");
  console.log("  ======================================================");
  console.log("");
  if (!API_KEY || !PARTNER_EMAIL) {
    console.log("  !! Credentials not set. Run with:");
    console.log("");
    console.log("     set API_KEY=1f1cIRNwmM");
    console.log("     set PARTNER_EMAIL=Taygambros@outlook.com");
    console.log("     node server.js");
    console.log("");
  } else {
    console.log(`   API Key:  ${API_KEY.slice(0, 4)}****`);
    console.log(`   Email:    ${PARTNER_EMAIL}`);
    console.log(`   Race:     ${RACE_CONFIG.name}`);
    console.log(`   Period:   ${RACE_CONFIG.startDate} -> ${RACE_CONFIG.endDate}`);
    console.log("");
    console.log("   Edit files in /public - browser refreshes automatically.");
    console.log("");
  }
});
