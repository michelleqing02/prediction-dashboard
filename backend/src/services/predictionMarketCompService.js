const config = require("../config");
const { fetchJson } = require("../utils/http");
const mockData = require("../adapters/predictionMarketMockData");

let snapshotCache = {
  expiresAt: 0,
  payload: null,
};

let previousMarketState = new Map();

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
  { tagSlug: "nba", sport: "NBA" },
  { tagSlug: "nhl", sport: "NHL" },
];

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

function kalshiCategoryLabel(market) {
  const eventTicker = String(market.event_ticker || "");
  if (eventTicker.startsWith("KXMVESPORTSMULTIGAMEEXTENDED")) return "Multi Game Combo";
  if (eventTicker.startsWith("KXMVECROSSCATEGORY")) return "Cross Category Combo";
  if (eventTicker.startsWith("KXMVESPORTS")) return "Sports Combo";
  return marketTypeLabel(market.category || market.event_ticker || "General");
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

  return {
    ...rawMarket,
    sport: rawMarket.sport || inferSport(rawMarket),
    matchTokens: titleTokens(rawMarket.title),
    priceChange,
    liquidityChangeUsd,
    spread: depth.spread,
    topBid: depth.topBid,
    topAsk: depth.topAsk,
    totalBidSize: depth.bidSize,
    totalAskSize: depth.askSize,
    totalBidNotionalUsd: depth.bidNotional,
    totalAskNotionalUsd: depth.askNotional,
    focusDepth: depth.nearestLevels,
    alerts: buildAlertFlags(rawMarket, previous),
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
  const candidates = await fetchKalshiMarketPages(baseUrl);
  const selected = keepLiveSportsMarkets(
    candidates.filter((market) => !market.status || market.status === "open" || market.status === "active")
  );

  return selected
    .map((market) => {
      const yesBid = clampProbability(toNumber(market.yes_bid) / 100);
      const yesAsk = clampProbability(toNumber(market.yes_ask) / 100);
      const lastPrice = clampProbability(toNumber(market.last_price) / 100 || yesAsk || yesBid || 0.5);
      const yesPrice = lastPrice || yesAsk || yesBid || 0.5;
      const noPrice = clampProbability(1 - yesPrice);
      const impliedBidSize = toNumber(market.yes_bid_dollars) || toNumber(market.volume) || 0;
      const impliedAskSize = toNumber(market.yes_ask_dollars) || toNumber(market.liquidity) || 0;
      const sport = inferSport({
        title: market.title,
        subtitle: market.subtitle || market.series_ticker,
        category: market.category || market.event_ticker,
        sport: market.sport,
      });

      return {
        id: `kalshi-${market.ticker}`,
        platform: "Kalshi",
        platformKey: "kalshi",
        title: market.title || market.subtitle || market.ticker,
        subtitle: market.subtitle || market.series_ticker || "Kalshi market",
        category: kalshiCategoryLabel(market),
        sport,
        url: `${config.predictionMarkets.kalshiWebBaseUrl.replace(/\/$/, "")}/market/${market.ticker}`,
        yesPrice,
        noPrice,
        lastPrice,
        liquidityUsd: toNumber(market.liquidity) || toNumber(market.dollar_volume),
        volume24hUsd: toNumber(market.volume_24h) || toNumber(market.dollar_volume),
        openInterestUsd: toNumber(market.open_interest) || toNumber(market.dollar_volume),
        expiresAt: market.expiration_time || market.close_time || null,
        yesBook: {
          bids: yesBid ? [{ price: yesBid, size: impliedBidSize }] : [],
          asks: yesAsk ? [{ price: yesAsk, size: impliedAskSize }] : [],
        },
      };
    })
    .filter((market) => market.sport);
}

async function fetchPolymarketMarkets() {
  const gammaBaseUrl = config.predictionMarkets.polymarketGammaBaseUrl.replace(/\/$/, "");
  const eventGroups = await Promise.all(
    POLYMARKET_SPORT_TAGS.map(async ({ tagSlug, sport }) => ({
      sport,
      events: await fetchPolymarketSportEventPages(gammaBaseUrl, tagSlug),
    }))
  );

  return eventGroups
    .flatMap(({ sport, events }) =>
      events.flatMap((event) =>
        (Array.isArray(event.markets) ? event.markets : []).map((market) => {
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
            subtitle: event.title || market.description || event.slug || market.slug || "Polymarket market",
            category:
              marketTypeLabel(market.sportsMarketType) ||
              event.subcategory ||
              event.category ||
              "General",
            sport,
            url: `${config.predictionMarkets.polymarketWebBaseUrl.replace(/\/$/, "")}/event/${event.slug || market.slug || market.id}`,
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
              toNumber(event.volume24hr),
            openInterestUsd: toNumber(event.openInterest) || toNumber(market.volumeNum),
            expiresAt: market.eventStartTime || market.gameStartTime || event.endDate || market.endDate || null,
            yesBook: {
              bids: bestBid ? [{ price: bestBid, size: 0 }] : [],
              asks: bestAsk ? [{ price: bestAsk, size: 0 }] : [],
            },
          };
        })
      )
    )
    .filter((market) => market.sport);
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

  previousMarketState = new Map(
    normalizedMarkets.map((market) => [
      market.id,
      {
        yesPrice: market.yesPrice,
        liquidityUsd: market.liquidityUsd,
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
      totalLiquidityUsd: normalizedMarkets.reduce((sum, market) => sum + market.liquidityUsd, 0),
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
  const limitedMarkets =
    config.predictionMarkets.marketLimit > 0
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
