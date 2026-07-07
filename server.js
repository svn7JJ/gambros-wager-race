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
  buildVersion: "weighted-games-2026-07-07",
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

// Walk the JSON tree and pull out anything that looks like a wagering user.
// LuxDrop has added non-case games over time, so a user can have wager totals
// spread across game-specific child objects. Sum those, but prefer explicit
// total wager fields when they are present to avoid double-counting breakdowns.
function extractPlayers(raw) {
  const players = new Map();

  const PRIMARY_NAME_KEYS = ["username", "displayName", "playerName", "nickname"];
  const FALLBACK_NAME_KEYS = ["user", "name"];
  const USER_ID_KEYS = ["userId", "playerId", "accountId", "id"];
  const TOTAL_WAGER_KEYS = [
    "totalWagered", "totalAmountWagered", "totalWager", "wagerTotal",
    "totalBetAmount", "totalAmountBet", "totalBet", "totalBetted",
    "totalStaked", "totalStake", "turnover", "volume", "totalVolume",
    "casinoWagered", "casinoWager", "gameWagered", "gamesWagered",
    "allWagered", "allGameWagered", "allGamesWagered",
  ];
  const PART_WAGER_KEYS = [
    "wagered", "amountWagered", "wager", "wagerAmount", "betAmount",
    "amountBet", "stake", "caseWagered", "casesWagered", "caseOpeningWagered",
    "blackjackWagered", "blackjackWager", "minesWagered", "mineWagered",
    "minesWager", "mineWager", "gameWager", "gameWagered",
  ];
  const GENERIC_AMOUNT_KEYS = [
    "amount", "amountUsd", "usd", "value", "total", "sum", "gross",
    "bet", "bets", "stake", "volume", "turnover",
  ];
  const RAW_BET_KEYS = [
    "totalBets", "totalBetAmount", "totalBetsAmount", "totalBetValue",
    "totalBetsValue", "betsTotal", "betTotal", "betValue", "betsValue",
    "stakeTotal", "staked",
  ];
  const GAME_WORDS = [
    "blackjack", "mines", "mine", "case", "cases", "caseopening",
    "slots", "slot", "roulette", "crash", "dice", "plinko", "limbo",
    "keno", "tower", "coinflip", "casino", "game", "games",
  ];

  const toNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[$,]/g, "").trim();
    if (cleaned === "" || Number.isNaN(Number(cleaned))) return null;
    return Number(cleaned);
  };

  const pickStr = (obj, keys) => {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
      if (value && typeof value === "object" && typeof value.username === "string") {
        return value.username.trim();
      }
    }
    return null;
  };

  const hasAnyKey = (obj, keys) => keys.some((key) => obj[key] != null);
  const normKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  const totalWagerKeySet = new Set(TOTAL_WAGER_KEYS.map(normKey));
  const partWagerKeySet = new Set(PART_WAGER_KEYS.map(normKey));
  const genericAmountKeySet = new Set(GENERIC_AMOUNT_KEYS.map(normKey));
  const rawBetKeySet = new Set(RAW_BET_KEYS.map(normKey));
  const isBadAmountKey = (key) => (
    /(deposit|withdraw|commission|earn|revenue|profit|balance|bonus|reward|prize|win|won|loss|net|fee|rake)/i.test(key)
  );
  const isCountKey = (key) => /(count|number|qty|quantity|placed|rounds|games)$/i.test(key) || /^totalbets$/i.test(key);
  const isTotalWagerKey = (key) => totalWagerKeySet.has(normKey(key));
  const isPartWagerKey = (key) => {
    const normalized = normKey(key);
    if (partWagerKeySet.has(normalized)) return true;
    if (isBadAmountKey(key) || isCountKey(normalized)) return false;
    if (/wager|wagered|stake|turnover|volume/.test(normalized)) return true;
    return /bet/.test(normalized) && /amount|value|usd|total/.test(normalized);
  };
  const contextHasBadMoney = (text) => isBadAmountKey(text) || /(withdraw|deposit|commission|bonus|reward|profit)/i.test(text);
  const contextHasWager = (text) => /wager|wagered|stake|turnover|volume|bet|bets/.test(normKey(text));
  const contextHasGame = (text) => {
    const normalized = normKey(text);
    return GAME_WORDS.some((word) => normalized.includes(word));
  };
  const isGenericAmountKey = (key) => genericAmountKeySet.has(normKey(key));
  const isRawBetKey = (key) => rawBetKeySet.has(normKey(key));
  const gameMultiplier = (key, node, context) => {
    const marker = ["type", "kind", "game", "gameType", "category", "name", "label"]
      .map((k) => node && node[k])
      .filter((v) => typeof v === "string")
      .join(".");
    const text = normKey(`${context}.${key}.${marker}`);
    if (text.includes("blackjack")) return 0.05;
    return 1;
  };
  const genericAmountLooksLikeWager = (key, node, context) => {
    if (!isGenericAmountKey(key) || contextHasBadMoney(`${context}.${key}`) || isCountKey(key)) return false;
    const marker = ["type", "kind", "game", "gameType", "category", "name", "label"]
      .map((k) => node[k])
      .filter((v) => typeof v === "string")
      .join(".");
    if (marker && contextHasBadMoney(marker)) return false;
    if (contextHasWager(`${context}.${key}`) || contextHasGame(`${context}.${key}`)) return true;

    return marker && !contextHasBadMoney(marker) && (contextHasWager(marker) || contextHasGame(marker));
  };
  const isCaseContext = (text) => /case|cases|caseopening/.test(normKey(text));

  const collectWagerIn = (node, context = "") => {
    if (!node || typeof node !== "object") {
      return { total: 0, generic: 0, game: 0, caseGame: 0, nested: 0 };
    }
    if (Array.isArray(node)) {
      return node.reduce((sum, item) => {
        const part = collectWagerIn(item, context);
        sum.total = Math.max(sum.total, part.total);
        sum.generic += part.generic;
        sum.game += part.game;
        sum.caseGame += part.caseGame;
        sum.nested += part.nested;
        return sum;
      }, { total: 0, generic: 0, game: 0, caseGame: 0, nested: 0 });
    }

    const totals = [];
    let generic = 0;
    let game = 0;
    let caseGame = 0;
    let nested = 0;

    for (const [key, value] of Object.entries(node)) {
      const number = toNumber(value);
      if (number != null && number > 0) {
        if (isTotalWagerKey(key) && !contextHasGame(context)) {
          totals.push(number);
        } else if (isTotalWagerKey(key)) {
          game += number;
          if (isCaseContext(`${context}.${key}`)) caseGame += number;
        } else if (isRawBetKey(key) && contextHasGame(`${context}.${key}`)) {
          const credited = number * gameMultiplier(key, node, context);
          game += credited;
          if (isCaseContext(`${context}.${key}`)) caseGame += credited;
        } else if (isPartWagerKey(key)) {
          if (contextHasGame(`${context}.${key}`) || contextHasGame(key)) {
            game += number;
            if (isCaseContext(`${context}.${key}`)) caseGame += number;
          } else {
            generic += number;
          }
        } else if (genericAmountLooksLikeWager(key, node, context)) {
          const credited = number * gameMultiplier(key, node, context);
          game += credited;
          if (isCaseContext(`${context}.${key}`) || isCaseContext(node.game || node.gameType || node.type || "")) {
            caseGame += credited;
          }
        }
        continue;
      }

      if (value && typeof value === "object") {
        const part = collectWagerIn(value, `${context}.${key}`);
        totals.push(part.total);
        generic += part.generic;
        game += part.game;
        caseGame += part.caseGame;
        nested += part.nested;
      }
    }

    return {
      total: Math.max(0, ...totals),
      generic,
      game,
      caseGame,
      nested,
    };
  };

  const sumWagerIn = (node) => {
    const collected = collectWagerIn(node);
    const gameBreakdown = collected.game + collected.nested;
    let parts = gameBreakdown;

    if (collected.generic > 0) {
      const genericDuplicatesCase = collected.caseGame > 0 && Math.abs(collected.generic - collected.caseGame) < 0.01;
      const genericDuplicatesAllGames = gameBreakdown > 0 && Math.abs(collected.generic - gameBreakdown) < 0.01;
      if (!genericDuplicatesCase && !genericDuplicatesAllGames) {
        parts += collected.generic;
      }
    }

    return Math.max(collected.total, parts, collected.generic);
  };

  const playerName = (node) => {
    const hasChildPlayers = Object.entries(node).some(([key, value]) => (
      Array.isArray(value) && /(users|players|affiliates|codes|results|data)/i.test(key)
    ));
    if (hasChildPlayers) return null;
    const primary = pickStr(node, PRIMARY_NAME_KEYS);
    if (primary) return primary;
    if (hasAnyKey(node, USER_ID_KEYS)) return pickStr(node, FALLBACK_NAME_KEYS);
    return null;
  };

  const addPlayer = (username, wagered) => {
    if (!username || wagered <= 0) return;
    const key = username.toLowerCase();
    const existing = players.get(key);
    if (existing) {
      existing.wagered += wagered;
      return;
    }
    players.set(key, { username, wagered });
  };

  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== "object") return;

    const name = playerName(node);
    const wagered = sumWagerIn(node);

    if (name && wagered > 0) {
      addPlayer(name, wagered);
      return;
    }

    Object.values(node).forEach(walk);
  };

  walk(raw);
  return Array.from(players.values());
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function debugLuxdropShape(raw, wantedNames = []) {
  const wanted = new Set(wantedNames.map((name) => String(name).trim().toLowerCase()).filter(Boolean));
  const targets = [3105.28, 2918, 1240.23, 1134.57, 724.27, 628.53, 369.68, 245.83, 71.13, 10.79];
  const toNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[$,]/g, "").trim();
    if (cleaned === "" || Number.isNaN(Number(cleaned))) return null;
    return Number(cleaned);
  };
  const findName = (obj) => {
    for (const key of ["username", "displayName", "playerName", "nickname", "user", "name"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object" && typeof value.username === "string") return value.username.trim();
    }
    return null;
  };

  const players = [];
  const targetMatches = [];

  const numericLeaves = (node, path = "") => {
    const leaves = [];
    if (!node || typeof node !== "object") return leaves;
    if (Array.isArray(node)) {
      node.forEach((item, index) => leaves.push(...numericLeaves(item, `${path}[${index}]`)));
      return leaves;
    }
    for (const [key, value] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      const number = toNumber(value);
      if (number != null) {
        leaves.push({ path: nextPath, key, value: number });
        for (const target of targets) {
          if (Math.abs(number - target) < 0.02) {
            targetMatches.push({ path: nextPath, key, value: number, target });
          }
        }
      } else if (value && typeof value === "object") {
        leaves.push(...numericLeaves(value, nextPath));
      }
    }
    return leaves;
  };

  const walk = (node, path = "") => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof node !== "object") return;

    const username = findName(node);
    if (username && (wanted.size === 0 || wanted.has(username.toLowerCase()))) {
      players.push({
        path,
        username,
        keys: Object.keys(node),
        numeric: numericLeaves(node, path).slice(0, 120),
      });
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") walk(value, path ? `${path}.${key}` : key);
    }
  };

  walk(raw);
  numericLeaves(raw);
  return {
    rootType: Array.isArray(raw) ? "array" : typeof raw,
    rootKeys: raw && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw) : [],
    players: players.slice(0, 20),
    targetMatches: targetMatches.slice(0, 200),
  };
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
app.get("/__debug-luxdrop-shape", async (req, res) => {
  if (!API_KEY || req.get("x-debug-key") !== API_KEY) {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const dateRange = getRaceWindow(req.query);
    const raw = await fetchLuxdrop(dateRange);
    const names = String(req.query.names || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    res.json(debugLuxdropShape(raw, names));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.body || err.message || "Debug failed" });
  }
});

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
