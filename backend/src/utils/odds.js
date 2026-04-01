function toAmerican(value, format = "american") {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  if (format === "american") return Math.trunc(numeric);

  if (format === "decimal") {
    if (numeric >= 2) return Math.round((numeric - 1) * 100);
    return Math.round(-100 / (numeric - 1));
  }

  return Math.trunc(numeric);
}

function impliedProbability(americanOdds) {
  const odds = Number(americanOdds);
  if (!Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function holdPercent(selectionProbabilities) {
  const total = selectionProbabilities.reduce((sum, value) => sum + (value || 0), 0);
  return total ? (total - 1) * 100 : null;
}

module.exports = {
  toAmerican,
  impliedProbability,
  holdPercent,
};
