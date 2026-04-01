const { fetchJson } = require("../utils/http");
const { canonicalMarketType } = require("../domain/markets");
const { canonicalTeamName } = require("../domain/teamMap");
const { impliedProbability, toAmerican } = require("../utils/odds");

const MARKET_KEY_MAP = {
  h2h: "moneyline",
  spreads: "spread",
  totals: "total",
  outrights: "outright",
};

const BOOK_TITLE_MAP = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betonlineag: "BetOnline",
  pinnacle: "Pinnacle",
  bookmaker: "Bookmaker",
};

class OddsApiBookAdapter {
  constructor({ sportsbook, bookmakerKey, config }) {
    this.sportsbook = sportsbook;
    this.bookmakerKey = bookmakerKey;
    this.config = config;
  }

  async fetchMarkets() {
    if (this.config.enableRealFetch && !this.shouldUseRealFeed()) {
      throw new Error(`Live feed not configured for ${this.sportsbook}`);
    }

    const raw = this.shouldUseRealFeed() ? await this.fetchRaw() : this.mockPayload();
    return this.normalize(raw);
  }

  shouldUseRealFeed() {
    return Boolean(
      this.config.enableRealFetch &&
      this.config.oddsApiKey &&
      this.bookmakerKey &&
      this.bookmakerKey !== "unsupported"
    );
  }

  async fetchRaw() {
    const url = new URL(`${this.config.oddsApiBaseUrl}/sports/${this.config.oddsApiSport}/odds`);
    url.searchParams.set("apiKey", this.config.oddsApiKey);
    url.searchParams.set("regions", "us,eu");
    url.searchParams.set("markets", "h2h,spreads,totals,outrights");
    url.searchParams.set("oddsFormat", "american");
    url.searchParams.set("bookmakers", this.bookmakerKey);

    return fetchJson(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });
  }

  mockPayload() {
    throw new Error("mockPayload must be implemented by concrete adapters");
  }

  normalize(raw) {
    if (raw && Array.isArray(raw.games)) {
      return raw.games.map((game) => ({
        sportsbook: this.sportsbook.toLowerCase(),
        externalGameId: game.externalId,
        homeTeam: canonicalTeamName(game.homeTeam),
        awayTeam: canonicalTeamName(game.awayTeam),
        startsAt: game.startsAt,
        pulledAt: raw.pulledAt,
        markets: (game.markets || []).map((market) => ({
          type: canonicalMarketType(market.type),
          player: market.player || null,
          stat: market.stat || null,
          selections: (market.selections || []).map((selection) => {
            const americanOdds = toAmerican(selection.odds, "american");
            return {
              label: selection.label,
              side: selection.side,
              line: selection.line ?? null,
              americanOdds,
              impliedProbability: impliedProbability(americanOdds),
            };
          }),
        })),
      }));
    }

    return (raw || []).map((event) => {
      const bookmaker = (event.bookmakers || []).find((item) => item.key === this.bookmakerKey);

      return {
        sportsbook: this.sportsbook.toLowerCase(),
        externalGameId: event.id,
        homeTeam: canonicalTeamName(event.home_team || event.title || "Outrights"),
        awayTeam: canonicalTeamName(event.away_team || event.description || this.sportsbook),
        startsAt: event.commence_time || new Date().toISOString(),
        pulledAt: bookmaker?.last_update || new Date().toISOString(),
        markets: (bookmaker?.markets || []).map((market) => ({
          type: canonicalMarketType(MARKET_KEY_MAP[market.key] || market.key),
          player: null,
          stat: event.description || event.title || null,
          selections: (market.outcomes || []).map((selection) => {
            const americanOdds = toAmerican(selection.price, "american");
            return {
              label: selection.name,
              side: deriveSide(selection.name, event, market.key),
              line: selection.point ?? null,
              americanOdds,
              impliedProbability: impliedProbability(americanOdds),
            };
          }),
        })),
      };
    });
  }
}

function deriveSide(name, event, marketKey) {
  if (marketKey === "outrights") return "outright";
  if (name === event.away_team) return "away";
  if (name === event.home_team) return "home";
  if (name === "Over") return "over";
  if (name === "Under") return "under";
  return "other";
}

module.exports = {
  OddsApiBookAdapter,
  BOOK_TITLE_MAP,
};
