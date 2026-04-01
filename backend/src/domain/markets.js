const MARKET_TYPES = {
  moneyline: "moneyline",
  spread: "spread",
  total: "total",
  player_prop: "player_prop",
  outright: "outright",
};

function canonicalMarketType(value) {
  const key = String(value || "").toLowerCase();
  if (["moneyline", "ml", "h2h"].includes(key)) return MARKET_TYPES.moneyline;
  if (["spread", "spreads", "line"].includes(key)) return MARKET_TYPES.spread;
  if (["total", "totals", "ou", "over_under"].includes(key)) return MARKET_TYPES.total;
  if (["player_prop", "playerprops", "prop", "props"].includes(key)) return MARKET_TYPES.player_prop;
  if (["outright", "outrights", "futures"].includes(key)) return MARKET_TYPES.outright;
  return key || "unknown";
}

module.exports = {
  MARKET_TYPES,
  canonicalMarketType,
};
