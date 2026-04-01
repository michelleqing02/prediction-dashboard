function log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const suffix = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${timestamp}] [${level}] ${message}${suffix}`);
}

module.exports = {
  info(message, meta) {
    log("INFO", message, meta);
  },
  warn(message, meta) {
    log("WARN", message, meta);
  },
  error(message, meta) {
    log("ERROR", message, meta);
  },
};
