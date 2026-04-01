const { execFile } = require("child_process");

function runDatabricksQuery(sql, { profile = "DEFAULT", timeoutMs = 120000 } = {}) {
  const normalizedSql = String(sql).replace(/\s+/g, " ").trim();
  return new Promise((resolve, reject) => {
    execFile(
      "databricks",
      [
        "experimental",
        "aitools",
        "tools",
        "query",
        normalizedSql,
        "--profile",
        profile,
        "--output",
        "json",
      ],
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message));
          return;
        }

        try {
          resolve(extractJson(`${stdout || ""}\n${stderr || ""}`));
        } catch (parseError) {
          reject(new Error(`Failed to parse Databricks output: ${parseError.message}`));
        }
      }
    );
  });
}

function extractJson(output) {
  const trimmed = String(output || "").trim();
  const arrayStart = trimmed.indexOf("[");
  const objectStart = trimmed.indexOf("{");
  const startCandidates = [arrayStart, objectStart].filter((value) => value >= 0);
  const start = Math.min(...startCandidates);

  if (!Number.isFinite(start)) {
    throw new Error("No JSON payload found");
  }

  const opening = trimmed[start];
  const closing = opening === "[" ? "]" : "}";
  const end = trimmed.lastIndexOf(closing);

  if (end < start) {
    throw new Error("Incomplete JSON payload");
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

module.exports = {
  runDatabricksQuery,
};
