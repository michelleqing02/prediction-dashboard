const express = require("express");
const cors = require("cors");
const path = require("path");
const createApiRouter = require("./routes/api");

function createApp(store) {
  const app = express();
  const publicDir = path.join(__dirname, "..", "public");
  const frontendDistDir = path.join(__dirname, "..", "..", "frontend", "dist");
  const frontendIndexPath = path.join(frontendDistDir, "index.html");
  app.use(cors());
  app.use(express.json());
  app.use("/", createApiRouter(store));
  app.get("/wcbb-performance", (_req, res) => {
    res.sendFile(path.join(publicDir, "wcbb-performance.html"));
  });
  app.get("/wcbb-futures", (_req, res) => {
    res.sendFile(path.join(publicDir, "wcbb-futures.html"));
  });
  app.get("/prediction-markets", (_req, res) => {
    res.sendFile(path.join(publicDir, "prediction-markets.html"));
  });
  app.get("/prediction-markets-mockup", (_req, res) => {
    res.sendFile(path.join(publicDir, "prediction-markets-mockup.html"));
  });
  app.get("/prediction-markets-mockup-launch", (_req, res) => {
    res.sendFile(path.join(publicDir, "prediction-markets-mockup-launch.html"));
  });

  app.get("/", (_req, res) => {
    res.sendFile(frontendIndexPath);
  });

  app.use(express.static(frontendDistDir));
  app.use(express.static(publicDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    res.sendFile(frontendIndexPath, (error) => {
      if (error) {
        next();
      }
    });
  });
  return app;
}

module.exports = createApp;
