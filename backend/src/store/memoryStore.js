class MemoryStore {
  constructor({ historyLimit = 40 } = {}) {
    this.historyLimit = historyLimit;
    this.state = {
      lastUpdated: null,
      games: [],
      books: [],
      history: new Map(),
      health: {},
    };
  }

  updateSnapshot({ games, books, health }) {
    this.state.games = games;
    this.state.books = books;
    this.state.health = health;
    this.state.lastUpdated = new Date().toISOString();

    for (const game of games) {
      for (const market of game.markets) {
        for (const quote of market.quotes) {
          const key = `${game.id}:${market.id}:${quote.sportsbook}:${quote.selectionKey}`;
          const existing = this.state.history.get(key) || [];
          existing.push({
            timestamp: quote.updatedAt,
            americanOdds: quote.americanOdds,
            line: quote.line,
          });
          this.state.history.set(key, existing.slice(-this.historyLimit));
        }
      }
    }
  }

  getSnapshot() {
    return {
      games: this.state.games,
      books: this.state.books,
      lastUpdated: this.state.lastUpdated,
      health: this.state.health,
    };
  }

  getHistory(gameId, marketId, sportsbook, selectionKey) {
    const key = `${gameId}:${marketId}:${sportsbook}:${selectionKey}`;
    return this.state.history.get(key) || [];
  }
}

module.exports = MemoryStore;
