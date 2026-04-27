const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

function bool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function number(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  network: {
    allowInsecureTls: bool("ALLOW_INSECURE_TLS", false),
  },
  app: {
    port: number("PORT", 4000),
    pollIntervalMs: number("POLL_INTERVAL_MS", 15000),
    storeHistoryLimit: number("STORE_HISTORY_LIMIT", 40),
    enableRealFetch: bool("ENABLE_REAL_FETCH", false),
    oddsApiKey: process.env.ODDS_API_KEY || "",
    oddsApiBaseUrl: process.env.ODDS_API_BASE_URL || "https://api.the-odds-api.com/v4",
    oddsApiSport: process.env.ODDS_API_SPORT || "basketball_wnba",
  },
  books: {
    draftkings: {
      enabled: bool("DRAFTKINGS_ENABLED", true),
      publicUrl: process.env.DRAFTKINGS_PUBLIC_URL || "",
    },
    fanduel: {
      enabled: bool("FANDUEL_ENABLED", true),
      publicUrl: process.env.FANDUEL_PUBLIC_URL || "",
    },
    betonline: {
      enabled: bool("BETONLINE_ENABLED", true),
      publicUrl: process.env.BETONLINE_PUBLIC_URL || "",
    },
    pinnacle: {
      enabled: bool("PINNACLE_ENABLED", true),
      publicUrl: process.env.PINNACLE_PUBLIC_URL || "",
    },
    bookmaker: {
      enabled: bool("BOOKMAKER_ENABLED", true),
      publicUrl: process.env.BOOKMAKER_PUBLIC_URL || "",
    },
  },
  predictionMarkets: {
    enableLiveFetch: bool("PREDICTION_MARKETS_ENABLE_LIVE_FETCH", false),
    cacheTtlMs: number("PREDICTION_MARKETS_CACHE_TTL_MS", 30000),
    marketLimit: number("PREDICTION_MARKETS_MARKET_LIMIT", 8),
    marketScanLimit: number("PREDICTION_MARKETS_SCAN_LIMIT", 200),
    marketScanPages: number("PREDICTION_MARKETS_SCAN_PAGES", 4),
    kalshiBaseUrl: process.env.KALSHI_API_BASE_URL || "https://api.elections.kalshi.com/trade-api/v2",
    kalshiWebBaseUrl: process.env.KALSHI_WEB_BASE_URL || "https://kalshi.com",
    polymarketGammaBaseUrl:
      process.env.POLYMARKET_GAMMA_BASE_URL || "https://gamma-api.polymarket.com",
    polymarketClobBaseUrl: process.env.POLYMARKET_CLOB_BASE_URL || "https://clob.polymarket.com",
    polymarketWebBaseUrl: process.env.POLYMARKET_WEB_BASE_URL || "https://polymarket.com",
  },
};
