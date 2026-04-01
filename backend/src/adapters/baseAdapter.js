const { fetchJson, sleep } = require("../utils/http");

class BaseAdapter {
  constructor({ sportsbook, config }) {
    this.sportsbook = sportsbook;
    this.config = config;
  }

  async fetchMarkets() {
    await sleep(50);
    const raw = this.shouldUseRealFeed() ? await this.fetchRaw() : this.mockPayload();
    return this.normalize(raw);
  }

  shouldUseRealFeed() {
    return Boolean(this.config.enableRealFetch && this.config.publicUrl);
  }

  async fetchRaw() {
    return fetchJson(this.config.publicUrl, {
      headers: {
        Accept: "application/json",
      },
    });
  }

  mockPayload() {
    throw new Error(`mockPayload not implemented for ${this.sportsbook}`);
  }

  normalize() {
    throw new Error(`normalize not implemented for ${this.sportsbook}`);
  }
}

module.exports = BaseAdapter;
