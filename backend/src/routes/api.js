const express = require("express");
const { getLatestWcbbFuturesDashboard } = require("../services/wcbbFuturesService");
const { getPredictionMarketDashboard } = require("../services/predictionMarketCompService");
const {
  getWcbbMatchPerformanceOverview,
  getWcbbMatchPerformanceEventDetail,
} = require("../services/wcbbMatchPerformanceService");

function createApiRouter(store) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    const snapshot = store.getSnapshot();
    res.json({
      ok: true,
      lastUpdated: snapshot.lastUpdated,
      books: snapshot.health,
    });
  });

  router.get("/books", (_req, res) => {
    const snapshot = store.getSnapshot();
    res.json({
      books: snapshot.books,
      lastUpdated: snapshot.lastUpdated,
    });
  });

  router.get("/games", (_req, res) => {
    const snapshot = store.getSnapshot();
    res.json({
      games: snapshot.games.map((game) => ({
        id: game.id,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        startsAt: game.startsAt,
        marketCount: game.markets.length,
      })),
      lastUpdated: snapshot.lastUpdated,
    });
  });

  router.get("/markets", (req, res) => {
    const snapshot = store.getSnapshot();
    const { type, sportsbook } = req.query;
    const rows = [];

    for (const game of snapshot.games) {
      for (const market of game.markets) {
        if (type && market.type !== type) continue;
        const quotes = sportsbook
          ? market.quotes.filter((quote) => quote.sportsbook === sportsbook)
          : market.quotes;

        rows.push({
          gameId: game.id,
          awayTeam: game.awayTeam,
          homeTeam: game.homeTeam,
          marketId: market.id,
          type: market.type,
          player: market.player,
          stat: market.stat,
          bestQuote: market.bestQuote,
          holdPercent: market.holdPercent,
          arbitrage: market.arbitrage,
          quotes,
        });
      }
    }

    res.json({
      markets: rows,
      lastUpdated: snapshot.lastUpdated,
    });
  });

  router.get("/odds", (req, res) => {
    const snapshot = store.getSnapshot();
    const { game_id: gameId, sportsbook, marketType } = req.query;
    const game = snapshot.games.find((item) => item.id === gameId);

    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }

    const markets = game.markets
      .filter((market) => (marketType ? market.type === marketType : true))
      .map((market) => ({
        ...market,
        quotes: market.quotes.filter((quote) => (sportsbook ? quote.sportsbook === sportsbook : true)),
      }));

    res.json({
      game: {
        id: game.id,
        awayTeam: game.awayTeam,
        homeTeam: game.homeTeam,
        startsAt: game.startsAt,
      },
      markets,
      lastUpdated: snapshot.lastUpdated,
    });
  });

  router.get("/history", (req, res) => {
    const { gameId, marketId, sportsbook, selectionKey } = req.query;
    if (!gameId || !marketId || !sportsbook || !selectionKey) {
      res.status(400).json({ error: "Missing required query parameters" });
      return;
    }

    res.json({
      history: store.getHistory(gameId, marketId, sportsbook, selectionKey),
    });
  });

  router.get("/api/wcbb-futures", async (_req, res) => {
    try {
      const payload = await getLatestWcbbFuturesDashboard();
      res.json(payload);
    } catch (error) {
      res.status(500).json({
        error: "Failed to load WCBB futures dashboard data",
        detail: String(error.message || error),
      });
    }
  });

  router.get("/api/wcbb-performance", async (_req, res) => {
    try {
      const payload = await getWcbbMatchPerformanceOverview();
      res.json(payload);
    } catch (error) {
      res.status(500).json({
        error: "Failed to load WCBB match performance dashboard data",
        detail: String(error.message || error),
      });
    }
  });

  router.get("/api/wcbb-performance/event-details", async (req, res) => {
    const { event_key: eventKey } = req.query;
    if (!eventKey) {
      res.status(400).json({ error: "Missing required query parameter: event_key" });
      return;
    }

    try {
      const payload = await getWcbbMatchPerformanceEventDetail(eventKey);
      res.json(payload);
    } catch (error) {
      res.status(500).json({
        error: "Failed to load WCBB match performance event detail",
        detail: String(error.message || error),
      });
    }
  });

  router.get("/api/prediction-markets", async (req, res) => {
    try {
      const payload = await getPredictionMarketDashboard({
        platform: req.query.platform || "",
        category: req.query.category || "",
        sport: req.query.sport || "",
        search: req.query.search || "",
      });
      res.json(payload);
    } catch (error) {
      res.status(500).json({
        error: "Failed to load prediction market comp dashboard data",
        detail: String(error.message || error),
      });
    }
  });

  return router;
}

module.exports = createApiRouter;
