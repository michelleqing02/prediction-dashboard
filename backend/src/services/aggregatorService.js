const logger = require("../utils/logger");
const { sleep } = require("../utils/http");
const { aggregateGames } = require("./aggregation");

class AggregatorService {
  constructor({ adapters, store, pollIntervalMs }) {
    this.adapters = adapters;
    this.store = store;
    this.pollIntervalMs = pollIntervalMs;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    logger.info("Starting polling loop", { pollIntervalMs: this.pollIntervalMs });
    await this.tick();
    this.loop().catch((error) => {
      logger.error("Polling loop exited unexpectedly", { error: String(error.message || error) });
    });
  }

  async loop() {
    while (this.running) {
      await sleep(this.pollIntervalMs);
      await this.tick();
    }
  }

  async tick() {
    const results = await Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          const games = await adapter.fetchMarkets();
          return {
            sportsbook: adapter.sportsbook.toLowerCase(),
            ok: true,
            pulledAt: new Date().toISOString(),
            games,
          };
        } catch (error) {
          logger.warn("Adapter poll failed", {
            sportsbook: adapter.sportsbook,
            error: String(error.message || error),
          });

          return {
            sportsbook: adapter.sportsbook.toLowerCase(),
            ok: false,
            pulledAt: new Date().toISOString(),
            error: String(error.message || error),
            games: [],
          };
        }
      })
    );

    const aggregated = aggregateGames(results);
    this.store.updateSnapshot(aggregated);
    logger.info("Snapshot updated", {
      games: aggregated.games.length,
      books: aggregated.books.length,
    });
  }
}

module.exports = AggregatorService;
