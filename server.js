const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════════
//  RACE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════
const RACE_CONFIG = {
  name: "GAMBROS × LUXDROP",
  title: "WAGER RACE",
  subtitle: "All eligible LuxDrop wagers count. Pick your dates, climb the leaderboard.",
  startDate: "2026-06-16",
  endDate: "2026-07-18T23:59:59Z",
  // Total prize pool scales with the community's total wager.
  // The tier with the highest minWager <= totalWagered is the active tier.
  prizeTiers: [
    { minWager: 0,      prizePool: 100, first: 100, second: 0,   third: 0  },
    { minWager: 1000,   prizePool: 200, first: 150, second: 50,  third: 0  },
    { minWager: 5000,   prizePool: 300, first: 200, second: 75,  third: 25 },
    { minWager: 15000,  prizePool: 400, first: 250, second: 100, third: 50 },
    { minWager: 30000,  prizePool: 500, first: 300, second: 125, third: 75 },
  ],
  maxPrizePool: 500,
  prizePoolLabel: "$500 MAX PRIZE · GROWS WITH WAGER",
  signupLink: "https://luxdrop.com/r/gambros",
  brandLeft: "GAMBROS",
  brandRight: "LUXDROP",
  buildVersion: "documented-wager-field-2026-07-07",
};

// ═══════════════════════════════════════════════════════════════════
//  LUXDROP API
// ═══════════════════════════════════════════════════════════════════
const API_KEY = process.env.API_KEY || "";
const AFFILIATE_CODES = process.env.AFFILIATE_CODES || "Gambroslux";
const LUXDROP_BASE = "https://api.luxdrop.com/external/affiliates";
const SNAPSHOT_DIR = path.join(__dirname, "snapshots");
const SNAPSHOT_CONFIG_FILE = path.join(SNAPSHOT_DIR, "render-race-config.json");
const SNAPSHOT_DATA_FILE = path.join(SNAPSHOT_DIR, "render-race-data.json");
const USE_SNAPSHOT = process.env.USE_SNAPSHOT === "1";

function sendSnapshot(res, file) {
  if (!fs.existsSync(file)) return false;
  if (file === SNAPSHOT_DATA_FILE) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(data.players)) {
      data.players = data.players.map(({ deposited, ...player }) => player);
    }
    if (data.stats) delete data.stats.totalDeposited;
    res.json(data);
    return true;
  }
  res.type("application/json").send(fs.readFileSync(file, "utf8"));
  return true;
}

function hasDateFilter(query = {}) {
  return query.startDate != null || query.endDate != null;
}

// ═══════════════════════════════════════════════════════════════════
//  CACHE — 45 second TTL so the API isn't hammered
// ═══════════════════════════════════════════════════════════════════
let apiCache = new Map();
const CACHE_TTL = 45 * 1000;

function normalizeDate(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw { status: 400, body: `Invalid date '${text}'. Use YYYY-MM-DD.` };
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw { status: 400, body: `Invalid date '${text}'. Use YYYY-MM-DD.` };
  }
  return text;
}

function getRaceWindow(query = {}) {
  const startDate = normalizeDate(query.startDate) || RACE_CONFIG.startDate;
  const endDate = normalizeDate(query.endDate) || RACE_CONFIG.endDate.slice(0, 10);
  if (startDate && endDate && startDate > endDate) {
    throw { status: 400, body: "startDate must be before or equal to endDate." };
  }
  return { startDate, endDate };
}

async function fetchLuxdrop({ startDate, endDate }) {
  const now = Date.now();

  const qs = new URLSearchParams({
    codes: AFFILIATE_CODES,
  });
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", endDate);
  const url = `${LUXDROP_BASE}?${qs}`;
  const cached = apiCache.get(url);
  if (cached && now - cached.time < CACHE_TTL) {
    return cached.data;
  }

  console.log(`  ->  Fetching: ${url}`);

  // Cloudflare sits in front of luxdrop.com and rejects requests with default
  // Node fetch fingerprints. Send a full real-Chrome header set: every UA, hint,
  // Sec-Fetch-*, Origin, Referer. Cloudflare's "Bot Fight Mode" rejects requests
  // missing these client hints, so populate them all.
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": API_KEY,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "Origin": "https://luxdrop.com",
      "Referer": "https://luxdrop.com/",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    // Surface whether Cloudflare blocked us (so the UI can stop labeling it
    // as 'Invalid API key') by sniffing the response body.
    const isCloudflareBlock = /cloudflare/i.test(text) && /(blocked|attention required|ray id)/i.test(text);
    throw { status: response.status, body: text, cloudflare: isCloudflareBlock };
  }

  const json = await response.json();
  apiCache.set(url, { time: now, data: json });
  return json;
}

// The documented LuxDrop external endpoint currently returns a flat affiliate
// array with one wagered number per user. Use that value directly; if LuxDrop
// adds game breakdown fields later, this keeps the parser from inventing totals
// from unrelated numeric columns.
function extractPlayers(raw) {
  const toNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[$,]/g, "").trim();
    if (cleaned === "" || Number.isNaN(Number(cleaned))) return null;
    return Number(cleaned);
  };

  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(walk);
    if (typeof node.username === "string") {
      const wagered = toNumber(node.wagered);
      return wagered > 0 ? [{ username: node.username.trim(), wagered }] : [];
    }
    return Object.values(node).flatMap(walk);
  };

  return rows.length ? walk(rows) : walk(raw);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// Compute the active prize tier and progress toward the next one based on the
// community's total wager. Returns prizes ready to render plus tier metadata.
function computePrizeStatus(totalWagered) {
  const tiers = RACE_CONFIG.prizeTiers;
  let activeIdx = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (totalWagered >= tiers[i].minWager) activeIdx = i;
  }
  const active = tiers[activeIdx];
  const next = tiers[activeIdx + 1] || null;
  const toDollar = (n) => (n > 0 ? `$${n}` : "—");
  return {
    prizes: [
      { place: "1st", reward: toDollar(active.first) },
      { place: "2nd", reward: toDollar(active.second) },
      { place: "3rd", reward: toDollar(active.third) },
    ],
    tierIndex: activeIdx,
    tierCount: tiers.length,
    currentPrizePool: active.prizePool,
    nextPrizePool: next ? next.prizePool : null,
    nextThreshold: next ? next.minWager : null,
    remainingToNext: next ? Math.max(0, next.minWager - totalWagered) : 0,
    maxPrizePool: tiers[tiers.length - 1].prizePool,
    // Kept for older cached clients that still read the first-place fields.
    currentFirst: active.first,
    nextFirst: next ? next.first : null,
    ladder: tiers.map((t, i) => ({
      prizePool: t.prizePool,
      first: t.first,
      threshold: t.minWager,
      active: i === activeIdx,
      passed: i < activeIdx,
    })),
  };
}

// ─── Race config endpoint ────────────────────────────────────────
app.get("/race-config", (_req, res) => {
  res.json(RACE_CONFIG);
});

// ─── Leaderboard data endpoint ───────────────────────────────────
app.get("/race-data", async (req, res) => {
  if (USE_SNAPSHOT && !hasDateFilter(req.query) && sendSnapshot(res, SNAPSHOT_DATA_FILE)) return;

  if (!API_KEY) {
    if (USE_SNAPSHOT && hasDateFilter(req.query)) {
      let dateRange = null;
      try {
        dateRange = getRaceWindow(req.query);
      } catch (_) {
        dateRange = null;
      }
      return res.status(503).json({
        error: "Date filtering needs live LuxDrop API data. This local preview is running from an old snapshot, so it cannot recalculate wager totals for a different date range.",
        dateRange,
      });
    }
    return res.status(500).json({
      error: "API_KEY environment variable not set.",
    });
  }

  try {
    const dateRange = getRaceWindow(req.query);
    const raw = await fetchLuxdrop(dateRange);
    const players = extractPlayers(raw)
      .filter((p) => p.wagered > 0)
      .sort((a, b) => b.wagered - a.wagered)
      .map((p, i) => ({ ...p, wagered: roundMoney(p.wagered), rank: i + 1 }));

    const totalWagered = roundMoney(players.reduce((s, p) => s + p.wagered, 0));
    const prizeStatus = computePrizeStatus(totalWagered);

    res.json({
      players,
      prizes: prizeStatus.prizes,
      prizeStatus,
      dateRange,
      stats: {
        totalWagered,
        playerCount: players.length,
      },
      source: {
        endpoint: "/external/affiliates",
        wagerField: "wagered",
        note: "LuxDrop's documented external endpoint currently returns one wagered total per referral and does not include blackjack/mines breakdown fields.",
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("  x  API error:", err);
    const status = err.status || 502;
    let msg = "Failed to fetch data from LuxDrop API";
    if (err.cloudflare) {
      msg = "Blocked by Cloudflare in front of LuxDrop. The API key is fine — Cloudflare is rejecting the request itself. Ask LuxDrop to allowlist this server's IP/User-Agent in their Cloudflare WAF.";
    } else if (status === 400) {
      msg = err.body || "Invalid date filter";
    } else if (status === 401) {
      msg = "Invalid API key for LuxDrop";
    } else if (status === 403) {
      msg = "LuxDrop refused the request (403). Could be a bad key or an upstream block.";
    } else if (status === 404) {
      msg = "Affiliate code not found";
    }
    res.status(status).json({ error: msg, detail: err.body || null, cloudflare: !!err.cloudflare });
  }
});

// ─── Health check ────────────────────────────────────────────────
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ─── Live Reload via SSE (only when files are watchable) ─────────
const publicDir = path.join(__dirname, "public");
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

try {
  let debounce = null;
  fs.watch(publicDir, { recursive: true }, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      console.log("  ~  File changed - reloading browsers...");
      reloadClients.forEach((r) => r.write("data: reload\n\n"));
    }, 200);
  });
} catch (_) { /* fs.watch may not work on all platforms; non-fatal */ }

// ─── Serve frontend ──────────────────────────────────────────────
app.use(
  express.static(publicDir, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  })
);

// ─── Start ───────────────────────────────────────────────────────
function startServer() {
  app.listen(PORT, () => {
    console.log("");
    console.log("  ======================================================");
    console.log("   GAMBROS × LUXDROP WAGER RACE");
    console.log(`   http://localhost:${PORT}`);
    console.log("  ======================================================");
    console.log("");
    if (USE_SNAPSHOT) {
      console.log("   Snapshot: serving scraped Render data");
      if (!API_KEY) {
        console.log("   API_KEY not set, so live LuxDrop fetching is disabled.");
        console.log("   Set API_KEY and unset USE_SNAPSHOT to fetch live data.");
      }
      console.log("");
    } else if (!API_KEY) {
      console.log("  !! API_KEY not set. Set it before running live data:");
      console.log("     export API_KEY=...");
      console.log("     export AFFILIATE_CODES=Gambroslux");
      console.log("     export USE_SNAPSHOT=1  # optional old scraped snapshot preview");
      console.log("");
    } else {
      console.log(`   API Key:  ${API_KEY.slice(0, 4)}****`);
      console.log(`   Codes:    ${AFFILIATE_CODES}`);
      console.log(`   Race:     ${RACE_CONFIG.name} ${RACE_CONFIG.title}`);
      console.log(`   Ends:     ${RACE_CONFIG.endDate}`);
      console.log("");
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  computePrizeStatus,
  extractPlayers,
  getRaceWindow,
  roundMoney,
  startServer,
};
