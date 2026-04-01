const { holdPercent } = require("../utils/odds");

function buildGameId(awayTeam, homeTeam) {
  return `${awayTeam.toLowerCase().replaceAll(" ", "-")}__${homeTeam
    .toLowerCase()
    .replaceAll(" ", "-")}`;
}

function selectionKey(selection, market) {
  return [
    market.type,
    market.player || "",
    market.stat || "",
    selection.label || "",
    selection.side || "",
    selection.line ?? "",
  ].join("|");
}

function aggregateGames(bookPayloads) {
  const gameMap = new Map();
  const bookSet = new Set();
  const health = {};

  for (const payload of bookPayloads) {
    const { sportsbook, ok, games = [], error, pulledAt } = payload;
    bookSet.add(sportsbook);
    health[sportsbook] = {
      ok,
      pulledAt,
      error: error || null,
      gameCount: games.length,
    };

    for (const rawGame of games) {
      const gameId = buildGameId(rawGame.awayTeam, rawGame.homeTeam);
      if (!gameMap.has(gameId)) {
        gameMap.set(gameId, {
          id: gameId,
          homeTeam: rawGame.homeTeam,
          awayTeam: rawGame.awayTeam,
          startsAt: rawGame.startsAt,
          markets: [],
        });
      }

      const game = gameMap.get(gameId);

      for (const rawMarket of rawGame.markets) {
        const marketId = [rawMarket.type, rawMarket.player || "", rawMarket.stat || ""].join(":");
        let market = game.markets.find((item) => item.id === marketId);

        if (!market) {
          market = {
            id: marketId,
            type: rawMarket.type,
            player: rawMarket.player || null,
            stat: rawMarket.stat || null,
            quotes: [],
            bestQuote: null,
            arbitrage: null,
            holdPercent: null,
          };
          game.markets.push(market);
        }

        for (const rawSelection of rawMarket.selections) {
          market.quotes.push({
            sportsbook,
            label: rawSelection.label,
            side: rawSelection.side,
            line: rawSelection.line,
            americanOdds: rawSelection.americanOdds,
            impliedProbability: rawSelection.impliedProbability,
            updatedAt: rawGame.pulledAt || pulledAt || new Date().toISOString(),
            selectionKey: selectionKey(rawSelection, rawMarket),
          });
        }
      }
    }
  }

  const games = Array.from(gameMap.values())
    .map((game) => ({
      ...game,
      markets: game.markets.map(enrichMarket).sort(compareMarkets),
    }))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

  return {
    games,
    books: Array.from(bookSet).sort(),
    health,
  };
}

function enrichMarket(market) {
  const grouped = new Map();

  for (const quote of market.quotes) {
    const key = quote.selectionKey;
    const current = grouped.get(key);
    if (!current || quote.americanOdds > current.americanOdds) {
      grouped.set(key, quote);
    }
  }

  const bestBySelection = Array.from(grouped.values());
  const probabilities = bestBySelection.map((quote) => quote.impliedProbability).filter(Boolean);

  return {
    ...market,
    bestQuote: bestBySelection.sort((a, b) => b.americanOdds - a.americanOdds)[0] || null,
    holdPercent: probabilities.length >= 2 ? holdPercent(probabilities) : null,
    arbitrage: buildArbitrage(bestBySelection),
  };
}

function buildArbitrage(bestBySelection) {
  if (bestBySelection.length !== 2) return null;
  const totalProbability = bestBySelection.reduce(
    (sum, quote) => sum + (quote.impliedProbability || 0),
    0
  );

  return {
    isArb: totalProbability > 0 && totalProbability < 1,
    combinedProbability: totalProbability,
  };
}

function compareMarkets(a, b) {
  const order = ["moneyline", "spread", "total", "player_prop", "outright"];
  return order.indexOf(a.type) - order.indexOf(b.type);
}

module.exports = {
  aggregateGames,
};
