const express = require("express");
const cors = require("cors");
const path = require("path");
const createApiRouter = require("./routes/api");

function createApp(store) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/", createApiRouter(store));
  app.get("/wcbb-performance", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "wcbb-performance.html"));
  });
  app.get("/wcbb-futures", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "wcbb-futures.html"));
  });
  app.get("/prediction-markets", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "prediction-markets.html"));
  });
  app.use(express.static(path.join(__dirname, "..", "public")));
  return app;
}

module.exports = createApp;
