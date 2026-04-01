const logger = require("./utils/logger");
const createApp = require("./app");
const config = require("./config");

if (config.network.allowInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const store = {
  getSnapshot() {
    return {
      games: [],
      books: [],
      lastUpdated: null,
      health: {},
    };
  },
  getHistory() {
    return [];
  },
};

const app = createApp(store);

app.listen(config.app.port, async () => {
  logger.info("Backend listening", { port: config.app.port });
});
