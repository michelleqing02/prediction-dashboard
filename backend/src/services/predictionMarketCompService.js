const config = require("../config");
const { fetchJson } = require("../utils/http");
const { impliedProbability } = require("../utils/odds");
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
  { tagSlug: "nhl", sport: "NHL" },
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
  ["maple leafs", "toronto maple leafs"],
  ["tor maple leafs", "toronto maple leafs"],
  ["islanders", "new york islanders"],
  ["nyi islanders", "new york islanders"],
  ["senators", "ottawa senators"],
  ["ott senators", "ottawa senators"],
  ["panthers", "florida panthers"],
  ["fla panthers", "florida panthers"],
  ["penguins", "pittsburgh penguins"],
  ["pit penguins", "pittsburgh penguins"],
  ["devils", "new jersey devils"],
  ["nj devils", "new jersey devils"],
  ["lightning", "tampa bay lightning"],
  ["tb lightning", "tampa bay lightning"],
  ["canadiens", "montreal canadiens"],
  ["mtl canadiens", "montreal canadiens"],
  ["flyers", "philadelphia flyers"],
  ["phi flyers", "philadelphia flyers"],
  ["red wings", "detroit red wings"],
  ["det red wings", "detroit red wings"],
  ["blue jackets", "columbus blue jackets"],
  ["cbj blue jackets", "columbus blue jackets"],
  ["sabres", "buffalo sabres"],
  ["buf sabres", "buffalo sabres"],
  ["jets", "winnipeg jets"],
  ["wpg jets", "winnipeg jets"],
  ["blues", "st. louis blues"],
  ["stl blues", "st. louis blues"],
  ["wild", "minnesota wild"],
  ["min wild", "minnesota wild"],
  ["stars", "dallas stars"],
  ["dal stars", "dallas stars"],
  ["hurricanes", "carolina hurricanes"],
  ["car hurricanes", "carolina hurricanes"],
  ["blackhawks", "chicago blackhawks"],
  ["chi blackhawks", "chicago blackhawks"],
  ["predators", "nashville predators"],
  ["nsh predators", "nashville predators"],
  ["utah", "utah mammoth"],
  ["uta mammoth", "utah mammoth"],
  ["flames", "calgary flames"],
  ["cgy flames", "calgary flames"],
  ["avalanche", "colorado avalanche"],
  ["col avalanche", "colorado avalanche"],
  ["golden knights", "vegas golden knights"],
  ["vgk golden knights", "vegas golden knights"],
  ["kraken", "seattle kraken"],
  ["sea kraken", "seattle kraken"],
  ["sharks", "san jose sharks"],
  ["sj sharks", "san jose sharks"],
  ["ducks", "anaheim ducks"],
  ["ana ducks", "anaheim ducks"],
  ["canucks", "vancouver canucks"],
  ["van canucks", "vancouver canucks"],
  ["kings", "los angeles kings"],
  ["la kings", "los angeles kings"],
]);
const TEAM_CODE_PREFIXES = new Set([
  "nyi", "tor", "ott", "fla", "pit", "nj", "tb", "mtl", "phi", "det", "cbj", "buf", "wpg", "stl",
  "min", "dal", "car", "chi", "nsh", "uta", "cgy", "col", "vgk", "sea", "sj", "ana", "van", "la",
  "edm", "wsh", "bos", "nyr", "fla", "mon",
]);
const NHL_TEAM_CODES = new Map([
  ["ANA", "anaheim ducks"],
  ["BOS", "boston bruins"],
  ["BUF", "buffalo sabres"],
  ["CAR", "carolina hurricanes"],
  ["CBJ", "columbus blue jackets"],
  ["CGY", "calgary flames"],
  ["CHI", "chicago blackhawks"],
  ["COL", "colorado avalanche"],
  ["DAL", "dallas stars"],
  ["DET", "detroit red wings"],
  ["EDM", "edmonton oilers"],
  ["FLA", "florida panthers"],
  ["LA", "los angeles kings"],
  ["MIN", "minnesota wild"],
  ["MTL", "montreal canadiens"],
  ["NJ", "new jersey devils"],
  ["NSH", "nashville predators"],
  ["NYI", "new york islanders"],
  ["NYR", "new york rangers"],
  ["OTT", "ottawa senators"],
  ["PHI", "philadelphia flyers"],
  ["PIT", "pittsburgh penguins"],
  ["SEA", "seattle kraken"],
  ["SJ", "san jose sharks"],
  ["STL", "st. louis blues"],
  ["TB", "tampa bay lightning"],
  ["TOR", "toronto maple leafs"],
  ["UTA", "utah mammoth"],
  ["VAN", "vancouver canucks"],
  ["VGK", "vegas golden knights"],
  ["WPG", "winnipeg jets"],
  ["WSH", "washington capitals"],
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
const MONTH_INDEX = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

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
  if (parts.length >= 2 && TEAM_CODE_PREFIXES.has(parts[0])) {
    parts.shift();
  }
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

function parseKalshiGameDate(value) {
  const match = String(value || "").toUpperCase().match(/-(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = 2000 + Number(yearText);
  const month = MONTH_INDEX[monthText];
  const day = Number(dayText);
  if (!Number.isFinite(year) || month == null || !Number.isFinite(day)) return null;
  return new Date(Date.UTC(year, month, day, 23, 59, 59)).toISOString();
}

function currentEasternDateParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return { year, month, day };
}

function currentEasternYmd(now = new Date()) {
  const { year, month, day } = currentEasternDateParts(now);
  return `${year}-${month}-${day}`;
}

function easternYmd(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return currentEasternYmd(date);
}

function currentKalshiDateCode(now = new Date()) {
  const { year, month, day } = currentEasternDateParts(now);
  const monthCodes = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${year.slice(2)}${monthCodes[Number(month) - 1]}${day}`;
}

function normalizeTeamPhrase(value) {
  return normalizeSelectionKey(String(value || "").replace(/\bvs\.?\b/gi, " ").replace(/\bat\b/gi, " "));
}

function normalizeGameLabel(value) {
  const parts = normalizeText(value)
    .replace(/\bvs\.?\b/g, " ")
    .replace(/\bat\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return parts.join(" ");
}

function gameKeyFromTeams(sport, dateKey, teams) {
  const uniqueTeams = [...new Set(teams.map((team) => normalizeTeamPhrase(team)).filter(Boolean))].sort();
  return `${sport}|${dateKey}|${uniqueTeams.join("|")}`;
}

function parseKalshiNhlTeamsFromTicker(value) {
  const ticker = String(value || "").toUpperCase();
  const match = ticker.match(/KXNHLGAME-\d{2}[A-Z]{3}\d{2}([A-Z]+)-/);
  if (!match) return [];
  const compact = match[1];
  const codes = [...NHL_TEAM_CODES.keys()].sort((a, b) => b.length - a.length);
  for (const first of codes) {
    if (!compact.startsWith(first)) continue;
    const second = compact.slice(first.length);
    if (NHL_TEAM_CODES.has(second)) {
      return [NHL_TEAM_CODES.get(first), NHL_TEAM_CODES.get(second)];
    }
  }
  return [];
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

async function fetchPolymarketTodayNhlEvents(baseUrl) {
  const payload = await fetchJson(
    `${baseUrl}/events?active=true&closed=false&tag_slug=nhl&limit=200&offset=0`,
    {},
    { retries: 1, delayMs: 500 }
  );

  const todayKey = currentEasternYmd();
  return (Array.isArray(payload) ? payload : []).filter((event) =>
    String(event.slug || "").startsWith("nhl-") &&
    String(event.slug || "").endsWith(todayKey)
  );
}

function buildPolymarketOutcomeRows(event, market, options = {}) {
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
    const yesPrice = clampProbability(toNumber(outcomePrices[index]));

    return {
      id: `polymarket-${market.slug || market.id}-${options.idSuffix || "row"}-${index}`,
      platform: "Polymarket",
      platformKey: "polymarket",
      title: market.question || event.title || market.slug,
      subtitle: options.subtitle || event.title || market.slug,
      category: options.category || marketTypeLabel(market.sportsMarketType) || "General",
      sport: options.sport || "NHL",
      selectionLabel,
      selectionKey: normalizeSelectionKey(selectionLabel),
      compareGroupType: options.compareGroupType || null,
      compareParentLabel: options.compareParentLabel || options.subtitle || event.title,
      compareGroupKey: options.compareGroupKey || null,
      compareGameKey: options.compareGameKey || null,
      compareRowKey: options.compareRowKeyBuilder ? options.compareRowKeyBuilder(selectionLabel, index) : normalizeSelectionKey(selectionLabel),
      compareRowLabel: options.compareRowLabelBuilder ? options.compareRowLabelBuilder(selectionLabel, index) : selectionLabel,
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
      expiresAt: market.gameStartTime || event.startDate || event.endDate || market.endDate || null,
      yesBook: {
        bids: bestBid ? [{ price: bestBid, size: 0 }] : [],
        asks: bestAsk ? [{ price: bestAsk, size: 0 }] : [],
      },
    };
  });
}

async function fetchPolymarketTodayNhlMarkets(baseUrl) {
  const events = await fetchPolymarketTodayNhlEvents(baseUrl);

  return events.flatMap((event) => {
    const teams = Array.isArray(event.teams) && event.teams.length
      ? event.teams.map((team) => team.name)
      : String(event.title || "").split(/\s+vs\.\s+/i);
    const compareGameKey = gameKeyFromTeams("NHL", currentEasternYmd(), teams);
    const markets = Array.isArray(event.markets) ? event.markets : [];

    return markets.flatMap((market) => {
      const marketType = String(market.sportsMarketType || "").toLowerCase();
      if (marketType === "moneyline") {
        return buildPolymarketOutcomeRows(event, market, {
          idSuffix: "moneyline",
          subtitle: event.title,
          category: "Moneyline",
          sport: "NHL",
          compareGameKey,
          compareParentLabel: event.title,
          compareGroupType: "nhl-game",
          compareRowKeyBuilder: (selectionLabel) => `moneyline|${normalizeSelectionKey(selectionLabel)}`,
          compareRowLabelBuilder: (selectionLabel) => `Moneyline | ${selectionLabel}`,
        });
      }

      if (marketType === "totals") {
        const line = market.line ?? market.groupItemTitle ?? "";
        return buildPolymarketOutcomeRows(event, market, {
          idSuffix: "total",
          subtitle: event.title,
          category: "Total",
          sport: "NHL",
          compareGameKey,
          compareParentLabel: event.title,
          compareGroupType: "nhl-game",
          compareRowKeyBuilder: (selectionLabel) => `total|${line}|${normalizeSelectionKey(selectionLabel)}`,
          compareRowLabelBuilder: (selectionLabel) => `Total ${line} | ${selectionLabel}`,
        });
      }

      if (marketType === "spreads") {
        const line = market.line ?? market.groupItemTitle ?? "";
        return buildPolymarketOutcomeRows(event, market, {
          idSuffix: "spread",
          subtitle: event.title,
          category: "Spread",
          sport: "NHL",
          compareGameKey,
          compareParentLabel: event.title,
          compareGroupType: "nhl-game",
          compareRowKeyBuilder: (selectionLabel) => `spread|${line}|${normalizeSelectionKey(selectionLabel)}`,
          compareRowLabelBuilder: (selectionLabel) => `Spread ${line} | ${selectionLabel}`,
        });
      }

      return [];
    });
  });
}

function sportsbookSelectionLabel(marketKey, selectionName, event) {
  if (marketKey === "totals") return selectionName;
  if (selectionName === event.home_team) return event.home_team;
  if (selectionName === event.away_team) return event.away_team;
  return selectionName;
}

function sportsbookCompareRowKey(marketKey, selectionName, event, point) {
  const normalizedSelection = normalizeSelectionKey(sportsbookSelectionLabel(marketKey, selectionName, event));
  if (marketKey === "totals") return `total|${point ?? ""}|${normalizedSelection}`;
  if (marketKey === "spreads") return `spread|${point ?? ""}|${normalizedSelection}`;
  return `moneyline|${normalizedSelection}`;
}

function sportsbookCompareRowLabel(marketKey, selectionName, point) {
  if (marketKey === "totals") return `Total ${point ?? "--"} | ${selectionName}`;
  if (marketKey === "spreads") return `Spread ${point ?? "--"} | ${selectionName}`;
  return `Moneyline | ${selectionName}`;
}

async function fetchFanduelNhlMarkets() {
  const url = new URL(`${config.app.oddsApiBaseUrl}/sports/icehockey_nhl/odds`);
  url.searchParams.set("apiKey", config.app.oddsApiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h,spreads,totals");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("bookmakers", "fanduel");

  const payload = await fetchJson(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
      },
    },
    { retries: 1, delayMs: 500 }
  );

  const todayKey = currentEasternYmd();

  return (Array.isArray(payload) ? payload : [])
    .filter((event) => easternYmd(event.commence_time) === todayKey)
    .flatMap((event) => {
      const bookmaker = Array.isArray(event.bookmakers)
        ? event.bookmakers.find((entry) => entry.key === "fanduel")
        : null;
      const teams = [event.away_team, event.home_team].filter(Boolean);
      const compareGameKey = teams.length === 2 ? gameKeyFromTeams("NHL", todayKey, teams) : null;

      return (bookmaker?.markets || []).flatMap((market) => {
        const marketKey = String(market.key || "");
        const category =
          marketKey === "h2h" ? "Moneyline" :
          marketKey === "spreads" ? "Spread" :
          marketKey === "totals" ? "Total" :
          null;

        if (!category) return [];

        return (market.outcomes || []).map((selection, index) => {
          const yesPrice = clampProbability(impliedProbability(selection.price));
          const selectionLabel = sportsbookSelectionLabel(marketKey, selection.name, event);
          const compareParentLabel = normalizeCompareLabel(`${event.away_team} @ ${event.home_team}`);

          return {
            id: `fanduel-${event.id}-${marketKey}-${index}-${String(selection.name || "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
            platform: "FanDuel",
            platformKey: "fanduel",
            title: `${compareParentLabel} ${category}`,
            subtitle: compareParentLabel,
            category,
            sport: "NHL",
            selectionLabel,
            selectionKey: normalizeSelectionKey(selectionLabel),
            compareGroupType: "nhl-game",
            compareParentLabel,
            compareGameKey,
            compareRowKey: sportsbookCompareRowKey(marketKey, selection.name, event, selection.point),
            compareRowLabel: sportsbookCompareRowLabel(marketKey, selectionLabel, selection.point),
            url: config.books?.fanduel?.publicUrl || "",
            yesPrice,
            noPrice: clampProbability(1 - yesPrice),
            lastPrice: yesPrice,
            liquidityUsd: 0,
            volume24hUsd: 0,
            openInterestUsd: 0,
            expiresAt: event.commence_time || null,
            line: selection.point ?? null,
            americanOdds: Number(selection.price),
            pulledAt: bookmaker?.last_update || market.last_update || null,
            yesBook: {
              bids: [],
              asks: [],
            },
          };
        });
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
      rawMarket.liquidityLabel ||
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
      const haystack = [
        market.title,
        market.subtitle,
        market.category,
        market.sport || "",
        market.selectionLabel || "",
        market.compareParentLabel || "",
        market.compareGroupLabel || "",
        market.compareRowLabel || "",
        market.selectionKey || "",
        market.line == null ? "" : String(market.line),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(filters.search.toLowerCase())) return false;
    }
    return true;
  });
}

function isActiveMarket(market, now = Date.now()) {
  if (!market?.expiresAt) return true;
  const expiresAt = new Date(market.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt > now;
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
  const todayKalshiCode = currentKalshiDateCode();
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

  const gameSeriesTickers = ["KXNCAAMBGAME", "KXNCAAWBGAME", "KXNHLGAME"];
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
    const gameDate = parseKalshiGameDate(market.ticker || market.event_ticker || market.series_ticker);
    const isNhlGame = String(market.ticker || "").startsWith("KXNHLGAME-");
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
    const compareParentLabel = normalizeCompareLabel(
      isNhlGame
        ? String(market.title || "").replace(/\s+Winner\?/i, "")
        : market.title || "College Basketball Game Winner"
    );
    const nhlTeams = isNhlGame ? parseKalshiNhlTeamsFromTicker(market.ticker) : [];
    const compareGameKey =
      isNhlGame && nhlTeams.length === 2
        ? gameKeyFromTeams("NHL", currentEasternYmd(), nhlTeams)
        : null;

    return {
      id: `kalshi-${market.ticker}`,
      platform: "Kalshi",
      platformKey: "kalshi",
      title: market.title || market.subtitle || market.ticker,
      subtitle: compareParentLabel,
      category: "Moneyline",
      sport: isNhlGame ? "NHL" : "College Basketball",
      selectionLabel,
      selectionKey: normalizeSelectionKey(selectionLabel),
      compareGroupType: isNhlGame ? "nhl-game" : "game-winner",
      compareParentLabel,
      compareGameKey,
      compareRowKey: `moneyline|${normalizeSelectionKey(selectionLabel)}`,
      compareRowLabel: `Moneyline | ${selectionLabel}`,
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
      expiresAt: gameDate || market.expiration_time || market.close_time || null,
      yesBook: {
        bids: yesBid ? [{ price: yesBid, size: Math.max(0, toNumber(market.yes_bid_size) || toNumber(market.yes_bid_size_fp) || 0) }] : [],
        asks: yesAsk ? [{ price: yesAsk, size: Math.max(0, toNumber(market.yes_ask_size) || toNumber(market.yes_ask_size_fp) || 0) }] : [],
      },
    };
  }).filter((market) => {
    if (market.sport !== "NHL") return true;
    return String(market.id || "").includes(todayKalshiCode);
  });

  const featuredGameMarkets = featuredGamePayloads.flatMap(({ configEntry, payload }) => {
    const event = payload?.event || {};
    const markets = Array.isArray(payload?.markets) ? payload.markets : [];

    return markets.map((market) => {
      const gameDate = parseKalshiGameDate(market.ticker || market.event_ticker || configEntry.kalshiEventTicker);
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
        expiresAt: gameDate || market.expiration_time || event.expected_expiration_time || null,
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
  const todayNhlMarkets = await fetchPolymarketTodayNhlMarkets(gammaBaseUrl);

  const deduped = new Map();
  for (const market of [...featuredMarkets, ...featuredGameMarkets, ...todayNhlMarkets]) {
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
  const now = Date.now();
  const [kalshiSource, polymarketSource, fanduelSource] = await Promise.all([
    loadSource("kalshi", fetchKalshiMarkets, mockData.kalshi),
    loadSource("polymarket", fetchPolymarketMarkets, mockData.polymarket),
    loadSource("fanduel", fetchFanduelNhlMarkets, []),
  ]);

  const normalizedMarkets = [...kalshiSource.markets, ...polymarketSource.markets, ...fanduelSource.markets]
    .map(normalizeMarket)
    .filter((market) => isActiveMarket(market, now))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);

  pruneAndRecordHistory(normalizedMarkets, now);

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
      fanduel: { mode: fanduelSource.mode, error: fanduelSource.error },
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
