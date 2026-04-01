const logger = require("./logger");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}, retryOptions = {}) {
  const retries = retryOptions.retries ?? 2;
  const delayMs = retryOptions.delayMs ?? 600;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }

      logger.warn("Retrying failed request", {
        url,
        attempt: attempt + 1,
        error: String(error.message || error),
      });
      await sleep(delayMs * (attempt + 1));
    }
  }

  throw new Error("Unexpected fetch failure");
}

module.exports = {
  sleep,
  fetchJson,
};
