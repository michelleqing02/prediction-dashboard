const config = require("../config");
const { fetchJson } = require("../utils/http");
const mockData = require("../adapters/predictionMarketMockData");

let snapshotCache = {
  expiresAt: 0,
  payload: null,
};

let previousMarketState = new Map();
let marketHistory = new Map();
const HISTORY_RETENTION_MS = 2 * 60 * 60 * 1000;

const SPORT_KEYWORDS = {
  "College Basketball": [
    "college basketball",
    "march madness",
    "final four",
    "ncaa",
    "duke",
    "uconn",
    "auburn",
    "arkansas st",
  ],
  NBA: [
    "nba",
    "finals",
    "celtics",
    "knicks",
    "76ers",
    "philadelphia 76ers",
    "orlando magic",
    "miami heat",
    "jokic",
    "jalen brunson",
    "jayson tatum",
    "jaylen brown",
    "derrick white",
    "banchero",
    "wembanyama",
    "durant",
    "maxey",
    "de'aaron fox",
    "towns",
    "embiid",
    "herro",
    "adebayo",
    "murray",
    "de rozan",
  ],
  NHL: [
    "nhl",
    "stanley cup",
    "carolina hurricanes",
    "florida panthers",
    "oilers",
    "dallas stars",
    "colorado avalanche",
    "vegas golden knights",
    "tampa bay lightning",
    "los angeles kings",
    "new jersey devils",
    "winnipeg jets",
    "anaheim ducks",
    "goals scored",
  ],
};

const POLYMARKET_SPORT_TAGS = [
  { tagSlug: "ncaab", sport: "College Basketball" },
];
const FEATURED_COLLEGE_BASKETBALL_COMPARE_MARKETS = [
  {
    key: "wcbb-championship",
    sport: "College Basketball",
    label: "Women's College Basketball Championship",
    kalshiEventTicker: "KXWMARMAD-26",
    kalshiUrl: "https://kalshi.com/markets/kxwmarmad/march-tournament-w/kxwmarmad-26",
    polymarketEventSlug: "2026-womens-ncaa-tournament-winner",
    polymarketUrl: "https://polymarket.com/event/2026-womens-ncaa-tournament-winner",
  },
  {
    key: "mcbb-championship",
    sport: "College Basketball",
    label: "Men's College Basketball Championship",
    kalshiEventTicker: "KXMARMAD-26",
    kalshiUrl: "https://kalshi.com/markets/kxmarmad/march-tournament/kxmarmad-26",
    polymarketEventSlug: "2026-ncaa-tournament-winner",
    polymarketUrl: "https://polymarket.com/event/2026-ncaa-tournament-winner",
  },
];
const FEATURED_COLLEGE_BASKETBALL_COMPARE_GAMES = [
  {
    key: "mcbb-game-arizona-michigan",
    sport: "College Basketball",
    label: "Arizona Wildcats vs. Michigan Wolverines",
    kalshiEventTicker: "KXNCAAMBGAME-26APR04MICHARIZ",
    kalshiUrl: "https://kalshi.com/markets/kxncaambgame/mens-college-basketball-game/kxncaambgame-26apr04michariz",
    polymarketEventSlug: "cbb-arz-mich-2026-04-04",
    polymarketUrl: "https://polymarket.com/sports/cbb/cbb-arz-mich-2026-04-04",
  },
  {
    key: "mcbb-game-uconn-illinois",
    sport: "College Basketball",
    label: "Connecticut Huskies vs. Illinois Fighting Illini",
    kalshiEventTicker: "KXNCAAMBGAME-26APR04ILLCONN",
    kalshiUrl: "https://kalshi.com/markets/kxncaambgame/mens-college-basketball-mens-game/kxncaambgame-26apr04illconn",
    polymarketEventSlug: "cbb-uconn-ill-2026-04-04",
    polymarketUrl: "https://polymarket.com/sports/cbb/cbb-uconn-ill-2026-04-04",
  },
];
const TEAM_ALIASES = new Map([
  ["uconn", "connecticut"],
  ["connecticut", "connecticut"],
  ["unc", "north carolina"],
  ["scar", "south carolina"],
  ["usc", "southern california"],
  ["ole miss", "mississippi"],
  ["miami fl", "miami"],
]);
const TEAM_SUFFIX_WORDS = new Set([
  "tigers",
  "wildcats",
  "wolverines",
  "spartans",
  "owls",
  "illini",
  "longhorns",
  "trojans",
  "bulldogs",
  "volunteers",
  "boilermakers",
  "cardinals",
  "jayhawks",
  "hawks",
  "hurricanes",
  "bearcats",
  "gaels",
  "lobos",
  "zips",
  "rams",
  "ramses",
  "tar",
  "heels",
  "bulls",
  "bobcats",
  "musketeers",
  "panthers",
  "camels",
  "huskies",
  "bears",
  "bruins",
  "gamecocks",
  "sooners",
  "golden",
  "eagles",
  "fighting",
]);

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeSelectionKey(value) {
  let normalized = normalizeText(value)
    .replace(/\b(st)\b/g, "state")
    .replace(/\buniv\b/g, "university")
    .replace(/\s+/g, " ")
    .trim();

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length >= 2 && TEAM_SUFFIX_WORDS.has(parts[parts.length - 1])) {
    parts.pop();
  }
  if (parts.length >= 2 && TEAM_SUFFIX_WORDS.has(parts[parts.length - 1])) {
    parts.pop();
  }
  normalized = parts.join(" ").trim() || normalized;

  return TEAM_ALIASES.get(normalized) || normalized;
}

function normalizeCompareLabel(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampProbability(value) {
  return Math.min(1, Math.max(0, value));
}

function titleTokens(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/(ing|ed|es|s)$/, ""))
    .filter(Boolean)
    .filter((token) => !["the", "a", "an", "will", "who", "what", "is", "by", "in", "to", "of"].includes(token));
}

function inferSport(rawMarket) {
  const haystack = normalizeText([
    rawMarket.title,
    rawMarket.question,
    rawMarket.subtitle,
    rawMarket.description,
    rawMarket.category,
    rawMarket.series_ticker,
    rawMarket.event_ticker,
    rawMarket.slug,
  ]
    .filter(Boolean)
    .join(" "));

  for (const [sport, keywords] of Object.entries(SPORT_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return sport;
    }
  }

  return rawMarket.sport || "";
}

function marketTypeLabel(value) {
  if (!value) return "General";
  return String(value)
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function featuredChampionshipLabel() {
  return "Women's College Basketball Championship";
}

function teamLabelFromTitle(title) {
  const match = String(title || "").match(/^Will (.+?) win/i);
  return match ? match[1].trim() : String(title || "").trim();
}

function kalshiCategoryLabel(market) {
  const eventTicker = String(market.event_ticker || "");
  if (eventTicker.startsWith("KXMVESPORTSMULTIGAMEEXTENDED")) return "Multi Game Combo";
  if (eventTicker.startsWith("KXMVECROSSCATEGORY")) return "Cross Category Combo";
  if (eventTicker.startsWith("KXMVESPORTS")) return "Sports Combo";
  return marketTypeLabel(market.category || market.event_ticker || "General");
}

function splitKalshiSelections(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildKalshiComponents(market) {
  const labels = splitKalshiSelections(market.yes_sub_title || market.title);
  const legs = Array.isArray(market.mve_selected_legs) ? market.mve_selected_legs : [];

  if (!labels.length && !legs.length) return [];

  return labels.map((label, index) => ({
    id: `${market.ticker}-leg-${index}`,
    label,
    side: legs[index]?.side || (/^no\s/i.test(label) ? "no" : "yes"),
    marketTicker: legs[index]?.market_ticker || "",
    eventTicker: legs[index]?.event_ticker || "",
  }));
}

function keepLiveSportsMarkets(markets) {
  return markets
    .filter((market) => inferSport(market))
    .sort((a, b) => {
      const liquidityDelta = toNumber(b.liquidityUsd || b.liquidity || b.liquidityNum) - toNumber(a.liquidityUsd || a.liquidity || a.liquidityNum);
      if (liquidityDelta !== 0) return liquidityDelta;
      return toNumber(b.volume24hUsd || b.volume_24h || b.volume24hr || b.oneDayVolume) - toNumber(a.volume24hUsd || a.volume_24h || a.volume24hr || a.oneDayVolume);
    });
}

async function fetchKalshiMarketPages(baseUrl) {
  const allMarkets = [];
  let cursor = "";

  for (let page = 0; page < config.predictionMarkets.marketScanPages; page += 1) {
    const params = new URLSearchParams();
    params.set("limit", String(config.predictionMarkets.marketScanLimit));
    params.set("status", "open");
    if (cursor) params.set("cursor", cursor);

    const payload = await fetchJson(`${baseUrl}/markets?${params.toString()}`, {}, { retries: 1, delayMs: 500 });
    const pageMarkets = Array.isArray(payload?.markets) ? payload.markets : [];
    allMarkets.push(...pageMarkets);

    if (!payload?.cursor || !pageMarkets.length) {
      break;
    }

    cursor = payload.cursor;
  }

  return allMarkets;
}

async function fetchPolymarketMarketPages(baseUrl) {
  const allMarkets = [];

  for (let page = 0; page < config.predictionMarkets.marketScanPages; page += 1) {
    const offset = page * config.predictionMarkets.marketScanLimit;
    const params = new URLSearchParams();
    params.set("active", "true");
    params.set("closed", "false");
    params.set("limit", String(config.predictionMarkets.marketScanLimit));
    params.set("offset", String(offset));

    const payload = await fetchJson(`${baseUrl}/markets?${params.toString()}`, {}, { retries: 1, delayMs: 500 });
    const pageMarkets = Array.isArray(payload) ? payload : [];
    allMarkets.push(...pageMarkets);

    if (!pageMarkets.length) {
      break;
    }
  }

  return allMarkets;
}

async function fetchPolymarketSportEventPages(baseUrl, tagSlug) {
  const allEvents = [];

  for (let page = 0; page < config.predictionMarkets.marketScanPages; page += 1) {
    const offset = page * config.predictionMarkets.marketScanLimit;
    const params = new URLSearchParams();
    params.set("active", "true");
    params.set("closed", "false");
    params.set("order", "-startDate");
    params.set("tag_slug", tagSlug);
    params.set("limit", String(config.predictionMarkets.marketScanLimit));
    params.set("offset", String(offset));

    const payload = await fetchJson(`${baseUrl}/events?${params.toString()}`, {}, { retries: 1, delayMs: 500 });
    const pageEvents = Array.isArray(payload) ? payload : [];
    allEvents.push(...pageEvents);

    if (!pageEvents.length || pageEvents.length < config.predictionMarkets.marketScanLimit) {
      break;
    }
  }

  return allEvents;
}

async function fetchPolymarketCollegeBasketballGameEvents(baseUrl) {
  const allEvents = [];

  for (let page = 0; page < config.predictionMarkets.marketScanPages; page += 1) {
    const offset = page * 500;
    const payload = await fetchJson(
      `${baseUrl}/events?active=true&closed=false&limit=500&offset=${offset}`,
      {},
      { retries: 1, delayMs: 500 }
    );

    const pageEvents = Array.isArray(payload) ? payload : [];
    allEvents.push(...pageEvents);

    if (!pageEvents.length || pageEvents.length < 500) {
      break;
    }
  }

  return allEvents.filter((event) => /^cbb-/i.test(String(event.slug || "")));
}

async function fetchPolymarketFeaturedEvent(baseUrl, configEntry) {
  const payload = await fetchJson(
    `${baseUrl}/events?slug=${encodeURIComponent(configEntry.polymarketEventSlug)}`,
    {},
    { retries: 1, delayMs: 500 }
  );

  const event = Array.isArray(payload) ? payload[0] : null;
  if (!event) return [];

  const eventMarkets = Array.isArray(event.markets) ? event.markets : [];

  return eventMarkets
    .filter((market) => market.active && !market.closed)
    .map((market) => {
      const bestBid = clampProbability(toNumber(market.bestBid));
      const bestAsk = clampProbability(toNumber(market.bestAsk));
      const yesPrice = clampProbability(
        toNumber(market.lastTradePrice) ||
          bestBid ||
          bestAsk ||
          0.5
      );

      return {
        id: `polymarket-${market.slug || market.id}`,
        platform: "Polymarket",
        platformKey: "polymarket",
        title: market.question || event.title || market.slug,
        subtitle: configEntry.label,
        category: configEntry.label,
        sport: configEntry.sport,
        selectionLabel: market.groupItemTitle || teamLabelFromTitle(market.question),
        selectionKey: normalizeSelectionKey(market.groupItemTitle || teamLabelFromTitle(market.question)),
        compareGroupType: "championship",
        compareParentLabel: configEntry.label,
        compareGroupKey: configEntry.key,
        compareGroupLabel: configEntry.label,
        url: configEntry.polymarketUrl,
        yesPrice,
        noPrice: clampProbability(1 - yesPrice),
        lastPrice: yesPrice,
        liquidityUsd:
          toNumber(market.liquidityClob) ||
          toNumber(market.liquidityNum) ||
          toNumber(event.liquidityClob) ||
          toNumber(event.liquidity),
        volume24hUsd:
          toNumber(market.volume24hrClob) ||
          toNumber(market.volume24hr) ||
          0,
        openInterestUsd: toNumber(event.openInterest) || toNumber(market.volumeNum),
        expiresAt: market.endDate || event.endDate || null,
        yesBook: {
          bids: bestBid ? [{ price: bestBid, size: 0 }] : [],
          asks: bestAsk ? [{ price: bestAsk, size: 0 }] : [],
        },
      };
    });
}

async function fetchPolymarketFeaturedGameEvent(baseUrl, configEntry) {
  const payload = await fetchJson(
    `${baseUrl}/events?slug=${encodeURIComponent(configEntry.polymarketEventSlug)}`,
    {},
    { retries: 1, delayMs: 500 }
  );

  const event = Array.isArray(payload) ? payload[0] : null;
  if (!event) return [];
  const markets = Array.isArray(event.markets) ? event.markets : [];

  const featuredWinnerMarket = markets.find((market) => {
    const outcomes = JSON.parse(market.outcomes || "[]");
    if (!Array.isArray(outcomes) || outcomes.length !== 2) {
      return false;
    }

    const normalizedOutcomes = outcomes.map((outcome) => normalizeSelectionKey(outcome));
    if (normalizedOutcomes.some((outcome) => ["over", "under", "yes", "no"].includes(outcome))) {
      return false;
    }

    const question = normalizeText(market.question || "");
    const eventTitle = normalizeText(event.title || configEntry.label || "");
    return question === eventTitle || String(market.slug || "") === configEntry.polymarketEventSlug;
  });

  const winnerMarkets = featuredWinnerMarket ? [featuredWinnerMarket] : [];

  return winnerMarkets.flatMap((market) => {
    const outcomes = JSON.parse(market.outcomes || "[]");
    const outcomePrices = JSON.parse(market.outcomePrices || "[]");
    if (!Array.isArray(outcomes) || !Array.isArray(outcomePrices) || !outcomes.length) {
      return [];
    }

    const marketBestBid = clampProbability(toNumber(market.bestBid));
    const marketBestAsk = clampProbability(toNumber(market.bestAsk));

    return outcomes.map((selectionLabel, index) => {
      const isPrimaryOutcome = index === 0;
      const bestBid = isPrimaryOutcome
        ? marketBestBid
        : clampProbability(marketBestAsk ? 1 - marketBestAsk : 0);
      const bestAsk = isPrimaryOutcome
        ? marketBestAsk
        : clampProbability(marketBestBid ? 1 - marketBestBid : 0);

      return {
        id: `polymarket-${market.slug || market.id}-featured-${index}`,
        platform: "Polymarket",
        platformKey: "polymarket",
        title: market.question || event.title || market.slug,
        subtitle: configEntry.label,
        category: "Game Winner",
        sport: configEntry.sport,
        selectionLabel,
        selectionKey: normalizeSelectionKey(selectionLabel),
        compareGroupType: "game-winner",
        compareParentLabel: configEntry.label,
        compareGroupKey: configEntry.key,
        compareGroupLabel: configEntry.label,
        url: configEntry.polymarketUrl,
        yesPrice: clampProbability(toNumber(outcomePrices[index])),
        noPrice: clampProbability(1 - toNumber(outcomePrices[index])),
        lastPrice: clampProbability(toNumber(outcomePrices[index])),
        liquidityUsd: toNumber(market.liquidityClob) || toNumber(event.liquidity),
        volume24hUsd: toNumber(market.volume24hrClob) || toNumber(event.volume24hr),
        openInterestUsd: toNumber(event.openInterest) || toNumber(market.volumeNum),
        expiresAt: market.gameStartTime || event.startDate || event.endDate || null,
        yesBook: {
          bids: bestBid ? [{ price: bestBid, size: 0 }] : [],
          asks: bestAsk ? [{ price: bestAsk, size: 0 }] : [],
        },
      };
    });
  });
}

function computeDepthMetrics(book) {
  const bids = Array.isArray(book?.bids) ? [...book.bids] : [];
  const asks = Array.isArray(book?.asks) ? [...book.asks] : [];
  const topBid = bids[0] || null;
  const topAsk = asks[0] || null;
  const spread = topBid && topAsk ? Math.max(0, topAsk.price - topBid.price) : null;
  const bidSize = bids.reduce((sum, level) => sum + toNumber(level.size), 0);
  const askSize = asks.reduce((sum, level) => sum + toNumber(level.size), 0);
  const bidNotional = bids.reduce((sum, level) => sum + toNumber(level.size) * toNumber(level.price), 0);
  const askNotional = asks.reduce((sum, level) => sum + toNumber(level.size) * toNumber(level.price), 0);
  const nearestLevels = [...bids, ...asks]
    .sort((a, b) => Math.abs(a.price - 0.5) - Math.abs(b.price - 0.5))
    .slice(0, 4);

  return {
    topBid,
    topAsk,
    spread,
    bidSize,
    askSize,
    bidNotional,
    askNotional,
    nearestLevels,
  };
}

function buildAlertFlags(current, previous) {
  const alerts = [];
  if (!previous) return alerts;

  const priceDelta = current.yesPrice - previous.yesPrice;
  const liquidityDelta = current.liquidityUsd - previous.liquidityUsd;
  const volumeDelta = current.volume24hUsd - previous.volume24hUsd;

  if (Math.abs(priceDelta) >= 0.03) {
    alerts.push({
      type: "price",
      label: `${priceDelta > 0 ? "YES up" : "YES down"} ${Math.abs(priceDelta * 100).toFixed(1)}c`,
      intensity: Math.abs(priceDelta) >= 0.05 ? "high" : "medium",
    });
  }

  if (Math.abs(liquidityDelta) >= 20000) {
    alerts.push({
      type: "liquidity",
      label: `${liquidityDelta > 0 ? "Liquidity added" : "Liquidity pulled"} ${formatCompactCurrency(Math.abs(liquidityDelta))}`,
      intensity: Math.abs(liquidityDelta) >= 50000 ? "high" : "medium",
    });
  }

  if (Math.abs(volumeDelta) >= 15000) {
    alerts.push({
      type: "activity",
      label: `Flow changed ${formatCompactCurrency(Math.abs(volumeDelta))}`,
      intensity: "medium",
    });
  }

  return alerts;
}

function pruneAndRecordHistory(markets, timestamp) {
  const nextHistory = new Map();

  for (const market of markets) {
    const prior = marketHistory.get(market.id) || [];
    const kept = prior.filter((entry) => timestamp - entry.timestamp <= HISTORY_RETENTION_MS);
    kept.push({
      timestamp,
      yesPrice: market.yesPrice,
      displayLiquidityUsd: market.displayLiquidityUsd || market.liquidityUsd || 0,
    });
    nextHistory.set(market.id, kept);
  }

  marketHistory = nextHistory;
}

function valueAtWindow(history, now, windowMs, field) {
  if (!Array.isArray(history) || !history.length) return null;
  const cutoff = now - windowMs;
  const candidates = history.filter((entry) => entry.timestamp <= cutoff);
  if (candidates.length) return candidates[candidates.length - 1][field];
  return history[0][field];
}

function formatCompactCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function normalizeMarket(rawMarket) {
  const depth = computeDepthMetrics(rawMarket.yesBook);
  const previous = previousMarketState.get(rawMarket.id);
  const liquidityChangeUsd = previous ? rawMarket.liquidityUsd - previous.liquidityUsd : 0;
  const priceChange = previous ? rawMarket.yesPrice - previous.yesPrice : rawMarket.yesPrice - rawMarket.lastPrice;
  const displayLiquidityUsd =
    rawMarket.platformKey === "kalshi" && toNumber(rawMarket.liquidityUsd) <= 0
      ? depth.bidNotional + depth.askNotional
      : rawMarket.liquidityUsd;
  const history = marketHistory.get(rawMarket.id) || [];
  const priceChange5m = rawMarket.yesPrice - toNumber(valueAtWindow(history, Date.now(), 5 * 60 * 1000, "yesPrice"), rawMarket.yesPrice);
  const priceChange1h = rawMarket.yesPrice - toNumber(valueAtWindow(history, Date.now(), 60 * 60 * 1000, "yesPrice"), rawMarket.yesPrice);
  const displayLiquidityChange1h =
    displayLiquidityUsd -
    toNumber(valueAtWindow(history, Date.now(), 60 * 60 * 1000, "displayLiquidityUsd"), displayLiquidityUsd);
  const alerts = buildAlertFlags(rawMarket, previous);

  if (Math.abs(priceChange1h) >= 0.05) {
    alerts.push({
      type: "price-window",
      label: `${priceChange1h > 0 ? "1h YES up" : "1h YES down"} ${Math.abs(priceChange1h * 100).toFixed(1)}c`,
      intensity: Math.abs(priceChange1h) >= 0.1 ? "high" : "medium",
    });
  }

  return {
    ...rawMarket,
    sport: rawMarket.sport || inferSport(rawMarket),
    matchTokens: titleTokens(rawMarket.title),
    priceChange,
    priceChange5m,
    priceChange1h,
    liquidityChangeUsd,
    displayLiquidityUsd,
    displayLiquidityChange1h,
    liquidityLabel:
      rawMarket.platformKey === "kalshi" && toNumber(rawMarket.liquidityUsd) <= 0
        ? "Visible depth"
        : "Reported liquidity",
    spread: depth.spread,
    topBid: depth.topBid,
    topAsk: depth.topAsk,
    totalBidSize: depth.bidSize,
    totalAskSize: depth.askSize,
    totalBidNotionalUsd: depth.bidNotional,
    totalAskNotionalUsd: depth.askNotional,
    focusDepth: depth.nearestLevels,
    alerts,
  };
}

function similarityScore(tokensA, tokensB) {
  const a = new Set(tokensA);
  const b = new Set(tokensB);
  const overlap = [...a].filter((token) => b.has(token)).length;
  if (!a.size || !b.size) return 0;
  return overlap / Math.max(a.size, b.size);
}

function applyFilters(markets, filters) {
  return markets.filter((market) => {
    if (filters.platform && market.platformKey !== filters.platform) return false;
    if (filters.category && market.category.toLowerCase() !== filters.category.toLowerCase()) return false;
    if (filters.sport && (market.sport || "").toLowerCase() !== filters.sport.toLowerCase()) return false;
    if (filters.search) {
      const haystack = `${market.title} ${market.subtitle} ${market.category} ${market.sport || ""}`.toLowerCase();
      if (!haystack.includes(filters.search.toLowerCase())) return false;
    }
    return true;
  });
}

function groupComparableMarkets(markets) {
  const groups = [];
  for (const market of markets) {
    const match = groups.find((group) => {
      if (group.category !== market.category) return false;
      return similarityScore(group.matchTokens, market.matchTokens) >= 0.45;
    });

    if (!match) {
      groups.push({
        id: `${market.category.toLowerCase()}-${market.matchTokens.slice(0, 4).join("-") || market.id}`,
        title: market.title,
        category: market.category,
        sport: market.sport,
        matchTokens: market.matchTokens,
        markets: [],
      });
      groups[groups.length - 1].markets.push(market);
      continue;
    }

    match.markets.push(market);
  }

  return groups
    .map((group) => {
      const kalshi = group.markets.find((market) => market.platformKey === "kalshi") || null;
      const polymarket = group.markets.find((market) => market.platformKey === "polymarket") || null;
      const priceGap = kalshi && polymarket ? polymarket.yesPrice - kalshi.yesPrice : null;
      const totalLiquidityUsd = group.markets.reduce((sum, market) => sum + market.liquidityUsd, 0);

      return {
        ...group,
        kalshi,
        polymarket,
        priceGap,
        totalLiquidityUsd,
        alertCount: group.markets.reduce((sum, market) => sum + market.alerts.length, 0),
      };
    })
    .sort((a, b) => {
      const scoreA = Math.abs(a.priceGap || 0) * 100000 + a.totalLiquidityUsd + a.alertCount * 20000;
      const scoreB = Math.abs(b.priceGap || 0) * 100000 + b.totalLiquidityUsd + b.alertCount * 20000;
      return scoreB - scoreA;
    });
}

async function fetchKalshiMarkets() {
  const baseUrl = config.predictionMarkets.kalshiBaseUrl.replace(/\/$/, "");
  const eventPayloads = await Promise.all(
    FEATURED_COLLEGE_BASKETBALL_COMPARE_MARKETS.map(async (configEntry) => ({
      configEntry,
      payload: await fetchJson(
        `${baseUrl}/events/${configEntry.kalshiEventTicker}`,
        {},
        { retries: 1, delayMs: 500 }
      ),
    }))
  );
  const featuredGamePayloads = await Promise.all(
    FEATURED_COLLEGE_BASKETBALL_COMPARE_GAMES.map(async (configEntry) => ({
      configEntry,
      payload: await fetchJson(
        `${baseUrl}/events/${configEntry.kalshiEventTicker}`,
        {},
        { retries: 1, delayMs: 500 }
      ),
    }))
  );

  const championshipMarkets = eventPayloads.flatMap(({ configEntry, payload }) => {
    const event = payload?.event || {};
    const markets = Array.isArray(payload?.markets) ? payload.markets : [];

    return markets
      .filter((market) => !market.status || market.status === "open" || market.status === "active" || market.status === "initialized")
      .map((market) => {
        const yesBid = clampProbability(
          toNumber(market.yes_bid_dollars) ||
            toNumber(market.yes_bid) / 100
        );
        const yesAsk = clampProbability(
          toNumber(market.yes_ask_dollars) ||
            toNumber(market.yes_ask) / 100
        );
        const lastPrice = clampProbability(
          toNumber(market.last_price) / 100 ||
            toNumber(market.last_price_dollars) ||
            yesAsk ||
            yesBid ||
            0.5
        );
        const yesPrice = lastPrice || yesAsk || yesBid || 0.5;
        const noPrice = clampProbability(1 - yesPrice);
        const bidSize = Math.max(0, toNumber(market.yes_bid_size) || toNumber(market.yes_bid_size_fp) || 0);
        const askSize = Math.max(0, toNumber(market.yes_ask_size) || toNumber(market.yes_ask_size_fp) || 0);
        const liquidityUsd =
          toNumber(market.liquidity_dollars) ||
          toNumber(market.liquidity) ||
          toNumber(event.liquidity_dollars) ||
          toNumber(event.liquidity);
        const volume24hUsd =
          toNumber(market.volume_24h_dollars) ||
          toNumber(market.volume_24h) ||
          toNumber(market.volume_24h_fp) ||
          toNumber(market.volume) ||
          0;
        const openInterestUsd =
          toNumber(market.open_interest_dollars) ||
          toNumber(market.open_interest) ||
          toNumber(market.open_interest_fp) ||
          0;
        const selectionLabel = teamLabelFromTitle(market.title);

        return {
          id: `kalshi-${market.ticker}`,
          platform: "Kalshi",
          platformKey: "kalshi",
          title: market.title || market.subtitle || market.ticker,
          subtitle: configEntry.label,
          category: configEntry.label,
          sport: configEntry.sport,
          selectionLabel,
          selectionKey: normalizeSelectionKey(selectionLabel),
          compareGroupType: "championship",
          compareParentLabel: configEntry.label,
          compareGroupKey: configEntry.key,
          compareGroupLabel: configEntry.label,
          components: [],
          url: configEntry.kalshiUrl,
          yesPrice,
          noPrice,
          lastPrice,
          liquidityUsd,
          volume24hUsd,
          openInterestUsd,
          expiresAt: market.expiration_time || market.close_time || event.settlement_timer || null,
          yesBook: {
            bids: yesBid ? [{ price: yesBid, size: bidSize }] : [],
            asks: yesAsk ? [{ price: yesAsk, size: askSize }] : [],
          },
        };
      });
  });

  const gameSeriesTickers = ["KXNCAAMBGAME", "KXNCAAWBGAME"];
  const gameMarketPayloads = await Promise.all(
    gameSeriesTickers.map((seriesTicker) =>
      fetchJson(
        `${baseUrl}/markets?limit=100&status=open&series_ticker=${encodeURIComponent(seriesTicker)}`,
        {},
        { retries: 1, delayMs: 500 }
      )
    )
  );

  const gameMarkets = gameMarketPayloads
    .flatMap((payload) => (Array.isArray(payload?.markets) ? payload.markets : []))
    .filter((market) => String(market.title || "").includes("Winner"));

  const normalizedGameMarkets = gameMarkets.map((market) => {
    const yesBid = clampProbability(
      toNumber(market.yes_bid_dollars) ||
        toNumber(market.yes_bid) / 100
    );
    const yesAsk = clampProbability(
      toNumber(market.yes_ask_dollars) ||
        toNumber(market.yes_ask) / 100
    );
    const lastPrice = clampProbability(
      toNumber(market.last_price) / 100 ||
        toNumber(market.last_price_dollars) ||
        yesAsk ||
        yesBid ||
        0.5
    );
    const yesPrice = lastPrice || yesAsk || yesBid || 0.5;
    const selectionLabel = market.yes_sub_title || teamLabelFromTitle(market.title);
    const compareParentLabel = normalizeCompareLabel(market.title || "College Basketball Game Winner");

    return {
      id: `kalshi-${market.ticker}`,
      platform: "Kalshi",
      platformKey: "kalshi",
      title: market.title || market.subtitle || market.ticker,
      subtitle: compareParentLabel,
      category: "Game Winner",
      sport: "College Basketball",
      selectionLabel,
      selectionKey: normalizeSelectionKey(selectionLabel),
      compareGroupType: "game-winner",
      compareParentLabel,
      components: [],
      url: `${config.predictionMarkets.kalshiWebBaseUrl.replace(/\/$/, "")}/market/${market.ticker}`,
      yesPrice,
      noPrice: clampProbability(1 - yesPrice),
      lastPrice,
      liquidityUsd:
        toNumber(market.liquidity_dollars) ||
        toNumber(market.liquidity),
      volume24hUsd:
        toNumber(market.volume_24h_dollars) ||
        toNumber(market.volume_24h) ||
        toNumber(market.volume_24h_fp) ||
        toNumber(market.volume) ||
        0,
      openInterestUsd:
        toNumber(market.open_interest_dollars) ||
        toNumber(market.open_interest) ||
        toNumber(market.open_interest_fp) ||
        0,
      expiresAt: market.expiration_time || market.close_time || null,
      yesBook: {
        bids: yesBid ? [{ price: yesBid, size: Math.max(0, toNumber(market.yes_bid_size) || toNumber(market.yes_bid_size_fp) || 0) }] : [],
        asks: yesAsk ? [{ price: yesAsk, size: Math.max(0, toNumber(market.yes_ask_size) || toNumber(market.yes_ask_size_fp) || 0) }] : [],
      },
    };
  });

  const featuredGameMarkets = featuredGamePayloads.flatMap(({ configEntry, payload }) => {
    const event = payload?.event || {};
    const markets = Array.isArray(payload?.markets) ? payload.markets : [];

    return markets.map((market) => {
      const yesBid = clampProbability(toNumber(market.yes_bid_dollars) || toNumber(market.yes_bid) / 100);
      const yesAsk = clampProbability(toNumber(market.yes_ask_dollars) || toNumber(market.yes_ask) / 100);
      const yesPrice = clampProbability(toNumber(market.last_price_dollars) || yesAsk || yesBid || 0.5);
      const selectionLabel = market.yes_sub_title || market.no_sub_title || teamLabelFromTitle(market.title);

      return {
        id: `kalshi-${market.ticker}`,
        platform: "Kalshi",
        platformKey: "kalshi",
        title: market.title || event.title || market.ticker,
        subtitle: configEntry.label,
        category: "Game Winner",
        sport: configEntry.sport,
        selectionLabel,
        selectionKey: normalizeSelectionKey(selectionLabel),
        compareGroupType: "game-winner",
        compareParentLabel: configEntry.label,
        compareGroupKey: configEntry.key,
        compareGroupLabel: configEntry.label,
        components: [],
        url: configEntry.kalshiUrl,
        yesPrice,
        noPrice: clampProbability(1 - yesPrice),
        lastPrice: yesPrice,
        liquidityUsd: toNumber(market.liquidity_dollars) || toNumber(market.liquidity),
        volume24hUsd: toNumber(market.volume_24h_fp) || toNumber(market.volume),
        openInterestUsd: toNumber(market.open_interest_fp) || 0,
        expiresAt: market.expiration_time || event.expected_expiration_time || null,
        yesBook: {
          bids: yesBid ? [{ price: yesBid, size: Math.max(0, toNumber(market.yes_bid_size_fp) || 0) }] : [],
          asks: yesAsk ? [{ price: yesAsk, size: Math.max(0, toNumber(market.yes_ask_size_fp) || 0) }] : [],
        },
      };
    });
  });

  return [...championshipMarkets, ...normalizedGameMarkets, ...featuredGameMarkets];
}

async function fetchPolymarketMarkets() {
  const gammaBaseUrl = config.predictionMarkets.polymarketGammaBaseUrl.replace(/\/$/, "");
  const featuredGroups = await Promise.all(
    FEATURED_COLLEGE_BASKETBALL_COMPARE_MARKETS.map((configEntry) =>
      fetchPolymarketFeaturedEvent(gammaBaseUrl, configEntry)
    )
  );
  const featuredMarkets = featuredGroups.flat();
  const featuredGameGroups = await Promise.all(
    FEATURED_COLLEGE_BASKETBALL_COMPARE_GAMES.map((configEntry) =>
      fetchPolymarketFeaturedGameEvent(gammaBaseUrl, configEntry)
    )
  );
  const featuredGameMarkets = featuredGameGroups.flat();

  const deduped = new Map();
  for (const market of [...featuredMarkets, ...featuredGameMarkets]) {
    deduped.set(market.id, market);
  }

  return [...deduped.values()];
}

async function loadSource(sourceName, loader, fallback) {
  if (!config.predictionMarkets.enableLiveFetch) {
    return {
      sourceName,
      mode: "mock",
      markets: fallback.map((market) => ({ ...market })),
      error: null,
    };
  }

  try {
    const markets = await loader();
    if (!markets.length) throw new Error("No active markets returned");
    return {
      sourceName,
      mode: "live",
      markets,
      error: null,
    };
  } catch (error) {
    return {
      sourceName,
      mode: "error",
      markets: [],
      error: String(error.message || error),
    };
  }
}

async function buildDashboardPayload() {
  const [kalshiSource, polymarketSource] = await Promise.all([
    loadSource("kalshi", fetchKalshiMarkets, mockData.kalshi),
    loadSource("polymarket", fetchPolymarketMarkets, mockData.polymarket),
  ]);

  const normalizedMarkets = [...kalshiSource.markets, ...polymarketSource.markets]
    .map(normalizeMarket)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);

  pruneAndRecordHistory(normalizedMarkets, Date.now());

  previousMarketState = new Map(
    normalizedMarkets.map((market) => [
      market.id,
      {
        yesPrice: market.yesPrice,
        liquidityUsd: market.displayLiquidityUsd || market.liquidityUsd,
        volume24hUsd: market.volume24hUsd,
      },
    ])
  );

  const comparableGroups = groupComparableMarkets(normalizedMarkets);
  const alerts = normalizedMarkets
    .flatMap((market) =>
      market.alerts.map((alert) => ({
        ...alert,
        marketId: market.id,
        marketTitle: market.title,
        platform: market.platform,
      }))
    )
    .sort((a, b) => (a.intensity === "high" ? -1 : 1) - (b.intensity === "high" ? -1 : 1));

  const categories = [...new Set(normalizedMarkets.map((market) => market.category))].sort();
  const sports = [...new Set(normalizedMarkets.map((market) => market.sport).filter(Boolean))].sort();

  return {
    generatedAt: new Date().toISOString(),
    sourceStatus: {
      kalshi: { mode: kalshiSource.mode, error: kalshiSource.error },
      polymarket: { mode: polymarketSource.mode, error: polymarketSource.error },
    },
    categories,
    sports,
    summary: {
      totalMarkets: normalizedMarkets.length,
      comparableGroups: comparableGroups.length,
      totalLiquidityUsd: normalizedMarkets.reduce((sum, market) => sum + (market.displayLiquidityUsd || market.liquidityUsd), 0),
      totalVolume24hUsd: normalizedMarkets.reduce((sum, market) => sum + market.volume24hUsd, 0),
      activeAlerts: alerts.length,
    },
    alerts,
    comparables: comparableGroups,
    markets: normalizedMarkets,
  };
}

async function getPredictionMarketDashboard(filters = {}) {
  const now = Date.now();
  if (!snapshotCache.payload || snapshotCache.expiresAt <= now) {
    snapshotCache = {
      expiresAt: now + config.predictionMarkets.cacheTtlMs,
      payload: await buildDashboardPayload(),
    };
  }

  const filteredMarkets = applyFilters(snapshotCache.payload.markets, filters);
  const shouldBypassLimit = String(filters.sport || "").toLowerCase() === "college basketball";
  const limitedMarkets =
    !shouldBypassLimit && config.predictionMarkets.marketLimit > 0
      ? filteredMarkets.slice(0, config.predictionMarkets.marketLimit)
      : filteredMarkets;
  const allowedIds = new Set(limitedMarkets.map((market) => market.id));
  const comparables = snapshotCache.payload.comparables.filter((group) =>
    group.markets.some((market) => allowedIds.has(market.id))
  );
  const alerts = snapshotCache.payload.alerts.filter((alert) => allowedIds.has(alert.marketId));

  return {
    ...snapshotCache.payload,
    alerts,
    comparables,
    markets: limitedMarkets,
  };
}

module.exports = {
  getPredictionMarketDashboard,
};
