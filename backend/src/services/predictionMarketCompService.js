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

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampProbability(value) {
  return Math.min(1, Math.max(0, value));
}

function titleTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/(ing|ed|es|s)$/, ""))
    .filter(Boolean)
    .filter((token) => !["the", "a", "an", "will", "who", "what", "is", "by", "in", "to", "of"].includes(token));
}

function inferSport(rawMarket) {
  const haystack = [
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
    .join(" ")
    .toLowerCase();

  for (const [sport, keywords] of Object.entries(SPORT_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return sport;
    }
  }

  return rawMarket.sport || "";
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
  const listPayload = await fetchJson(
    `${baseUrl}/markets?limit=${config.predictionMarkets.marketScanLimit}&status=open`,
    {},
    { retries: 1, delayMs: 500 }
  );

  const candidates = Array.isArray(listPayload?.markets) ? listPayload.markets : [];
  const selected = keepLiveSportsMarkets(
    candidates.filter((market) => !market.status || market.status === "open")
  );

  const markets = await Promise.all(
    selected.map(async (market) => {
      const orderbook = await fetchJson(
        `${baseUrl}/markets/${market.ticker}/orderbook`,
        {},
        { retries: 1, delayMs: 500 }
      );

      const yesBids = (orderbook?.orderbook_fp?.yes_dollars || []).map(([price, size]) => ({
        price: clampProbability(toNumber(price)),
        size: toNumber(size),
      }));

      const yesAsks = (orderbook?.orderbook_fp?.no_dollars || []).map(([price, size]) => ({
        price: clampProbability(1 - toNumber(price)),
        size: toNumber(size),
      }));

      const yesPrice = clampProbability(toNumber(market.last_price) / 100 || toNumber(market.yes_ask) / 100 || 0.5);
      const noPrice = clampProbability(1 - yesPrice);

      return {
        id: `kalshi-${market.ticker}`,
        platform: "Kalshi",
        platformKey: "kalshi",
        title: market.title || market.subtitle || market.ticker,
        subtitle: market.subtitle || market.series_ticker || "Kalshi market",
        category: market.category || market.event_ticker || "General",
        sport: inferSport({
          title: market.title,
          subtitle: market.subtitle || market.series_ticker,
          category: market.category || market.event_ticker,
          sport: market.sport,
        }),
        url: `${config.predictionMarkets.kalshiWebBaseUrl.replace(/\/$/, "")}/market/${market.ticker}`,
        yesPrice,
        noPrice,
        lastPrice: yesPrice,
        liquidityUsd: toNumber(market.liquidity) || toNumber(market.dollar_volume),
        volume24hUsd: toNumber(market.volume_24h) || toNumber(market.dollar_volume),
        openInterestUsd: toNumber(market.open_interest),
        expiresAt: market.expiration_time || market.close_time || null,
        yesBook: {
          bids: yesBids.sort((a, b) => b.price - a.price),
          asks: yesAsks.sort((a, b) => a.price - b.price),
        },
      };
    })
  );

  return markets;
}

async function fetchPolymarketMarkets() {
  const gammaBaseUrl = config.predictionMarkets.polymarketGammaBaseUrl.replace(/\/$/, "");
  const clobBaseUrl = config.predictionMarkets.polymarketClobBaseUrl.replace(/\/$/, "");
  const listPayload = await fetchJson(
    `${gammaBaseUrl}/markets?active=true&closed=false&limit=${config.predictionMarkets.marketScanLimit}`,
    {},
    { retries: 1, delayMs: 500 }
  );

  const selected = Array.isArray(listPayload) ? keepLiveSportsMarkets(listPayload) : [];
  const markets = await Promise.all(
    selected.map(async (market) => {
      const tokenIds = JSON.parse(market.clobTokenIds || "[]");
      const yesTokenId = tokenIds[0];
      const bookPayload = yesTokenId
        ? await fetchJson(`${clobBaseUrl}/book?token_id=${yesTokenId}`, {}, { retries: 1, delayMs: 500 })
        : { bids: [], asks: [] };

      const bids = (bookPayload?.bids || []).map((level) => ({
        price: clampProbability(toNumber(level.price)),
        size: toNumber(level.size),
      }));
      const asks = (bookPayload?.asks || []).map((level) => ({
        price: clampProbability(toNumber(level.price)),
        size: toNumber(level.size),
      }));

      const yesPrice = clampProbability(
        toNumber(market.lastTradePrice) ||
          toNumber(market.bestBid) ||
          toNumber(market.outcomePrices?.[0]) ||
          0.5
      );

      return {
        id: `polymarket-${market.slug || market.id}`,
        platform: "Polymarket",
        platformKey: "polymarket",
        title: market.question || market.title || market.slug,
        subtitle: market.description || market.slug || "Polymarket market",
        category: market.category || market.tags?.[0]?.label || "General",
        sport: inferSport({
          title: market.question || market.title || market.slug,
          subtitle: market.description || market.slug,
          category: market.category || market.tags?.[0]?.label,
          sport: market.sport,
        }),
        url: `${config.predictionMarkets.polymarketWebBaseUrl.replace(/\/$/, "")}/event/${market.slug || market.id}`,
        yesPrice,
        noPrice: clampProbability(1 - yesPrice),
        lastPrice: yesPrice,
        liquidityUsd: toNumber(market.liquidityNum) || toNumber(market.liquidity),
        volume24hUsd: toNumber(market.volume24hr) || toNumber(market.oneDayVolume),
        openInterestUsd: toNumber(market.openInterest) || toNumber(market.volumeNum),
        expiresAt: market.endDate || market.end_date_iso || null,
        yesBook: {
          bids: bids.sort((a, b) => b.price - a.price),
          asks: asks.sort((a, b) => a.price - b.price),
        },
      };
    })
  );

  return markets;
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
  const limitedMarkets = filteredMarkets.slice(0, config.predictionMarkets.marketLimit);
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
