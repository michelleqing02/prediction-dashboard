const { runDatabricksQuery } = require("./databricksCli");

const AGG_TABLE = "sandbox.shared.codex_wcbb_futures_2025_2026_dashboard_agg";
const SELECTION_AGG_TABLE = "sandbox.shared.codex_wcbb_futures_2025_2026_selection_agg";

const DASHBOARD_SQL = `
  SELECT
    season_label,
    location_code,
    competition_name,
    event_name,
    market_name,
    ticket_count,
    bettor_count,
    single_ticket_count,
    parlay_ticket_count,
    open_ticket_count,
    handle,
    avg_ticket_size,
    open_handle,
    straight_handle,
    straight_potential_payout,
    straight_potential_liability,
    potential_payout_proxy,
    potential_liability_proxy,
    actual_winnings,
    gross_gaming_revenue,
    settled_ggr,
    margin,
    weighted_avg_price,
    first_bet_date,
    last_bet_date,
    aggregated_at
  FROM ${AGG_TABLE}
  ORDER BY
    CASE WHEN location_code = 'ALL' THEN 0 ELSE 1 END,
    handle DESC,
    event_name ASC,
    market_name ASC
`;

const SELECTION_SQL = `
  SELECT
    competition_name,
    event_name,
    market_name,
    selection_name,
    ticket_count,
    bettor_count,
    single_ticket_count,
    parlay_ticket_count,
    open_ticket_count,
    handle,
    avg_ticket_size,
    open_handle,
    potential_payout_proxy,
    potential_liability_proxy,
    straight_handle,
    straight_potential_payout,
    straight_potential_liability,
    actual_winnings,
    gross_gaming_revenue,
    settled_ggr,
    margin,
    weighted_avg_price,
    first_bet_date,
    last_bet_date,
    aggregated_at
  FROM ${SELECTION_AGG_TABLE}
  ORDER BY
    event_name ASC,
    market_name ASC,
    handle DESC,
    selection_name ASC
`;

async function getLatestWcbbFuturesDashboard() {
  const [rows, selectionRows] = await Promise.all([
    runDatabricksQuery(DASHBOARD_SQL),
    runDatabricksQuery(SELECTION_SQL),
  ]);

  const normalizedRows = rows.map(normalizeRow);
  const normalizedSelections = selectionRows.map(normalizeSelectionRow);
  const overallRows = normalizedRows.filter((row) => row.locationCode === "ALL");

  const selectionsByMarket = new Map();
  for (const row of normalizedSelections) {
    const key = toMarketKey(row.competitionName, row.eventName, row.marketName);
    if (!selectionsByMarket.has(key)) {
      selectionsByMarket.set(key, []);
    }
    selectionsByMarket.get(key).push(row);
  }

  const totalHandle = overallRows.reduce((sum, row) => sum + row.handle, 0);
  const totalGrossGamingRevenue = overallRows.reduce((sum, row) => sum + row.grossGamingRevenue, 0);
  const totalPotentialPayout = overallRows.reduce((sum, row) => sum + row.potentialPayout, 0);
  const totalPotentialLiability = overallRows.reduce((sum, row) => sum + row.straightPotentialLiability, 0);
  const totalOpenHandle = overallRows.reduce((sum, row) => sum + row.openHandle, 0);
  const totalSettledGgr = overallRows.reduce((sum, row) => sum + row.settledGgr, 0);
  const totalActualWinnings = overallRows.reduce((sum, row) => sum + row.actualWinnings, 0);
  const totalTickets = overallRows.reduce((sum, row) => sum + row.ticketCount, 0);
  const totalOpenTickets = overallRows.reduce((sum, row) => sum + row.openTicketCount, 0);

  const markets = overallRows.map((row) => {
    const key = toMarketKey(row.competitionName, row.eventName, row.marketName);
    const selections = (selectionsByMarket.get(key) || []).sort((left, right) => right.handle - left.handle);

    return {
      ...row,
      marketKey: key,
      handleShare: totalHandle ? row.handle / totalHandle : 0,
      selections,
      selectionCount: selections.length,
    };
  });

  const topHandleMarket = summarizeTopMarket(markets[0] || null);
  const topLiabilityMarket = summarizeTopMarket(
    markets.slice().sort((left, right) => right.straightPotentialLiability - left.straightPotentialLiability)[0] || null
  );

  return {
    meta: {
      seasonLabel: "2025-2026",
      seasonStart: "2025-11-03",
      seasonEnd: "2026-04-05",
      marketCount: markets.length,
      sourceTable: AGG_TABLE,
      selectionSourceTable: SELECTION_AGG_TABLE,
      aggregatedAt: markets[0]?.aggregatedAt || null,
      firstBetDate: minDate(markets.map((row) => row.firstBetDate)),
      lastBetDate: maxDate(markets.map((row) => row.lastBetDate)),
      competitions: Array.from(new Set(markets.map((row) => row.competitionName))).sort(),
      notes: [
        "Season window is November 3, 2025 through April 5, 2026.",
        "Average price is weighted by handle and shown in decimal odds.",
        "Straight liability uses straight single bets only, which is much more interpretable than parlay-inflated payout sums.",
        "Proxy payout/liability still exists in the data layer, but the UI now emphasizes straight-only exposure.",
        "Current GGR includes open futures activity, while settled GGR only includes bets that are no longer open.",
        "Bettor counts are market-level distinct counts, not a global deduped season bettor total.",
        "Each market now expands by selection instead of state, which is a better fit for futures exposure review.",
      ],
    },
    summary: {
      totalHandle,
      totalPotentialPayout,
      totalPotentialLiability,
      totalOpenHandle,
      totalSettledGgr,
      totalActualWinnings,
      totalGrossGamingRevenue,
      totalTickets,
      totalOpenTickets,
      weightedMargin: totalHandle ? totalGrossGamingRevenue / totalHandle : 0,
      topHandleMarket,
      topLiabilityMarket,
    },
    markets,
  };
}

function normalizeRow(row) {
  return {
    seasonLabel: row.season_label,
    locationCode: row.location_code,
    competitionName: row.competition_name,
    eventName: row.event_name,
    marketName: row.market_name,
    ticketCount: toNumber(row.ticket_count),
    bettorCount: toNumber(row.bettor_count),
    singleTicketCount: toNumber(row.single_ticket_count),
    parlayTicketCount: toNumber(row.parlay_ticket_count),
    openTicketCount: toNumber(row.open_ticket_count),
    handle: toNumber(row.handle),
    avgTicketSize: toNumber(row.avg_ticket_size),
    openHandle: toNumber(row.open_handle),
    straightHandle: toNumber(row.straight_handle),
    straightPotentialPayout: toNumber(row.straight_potential_payout),
    straightPotentialLiability: toNumber(row.straight_potential_liability),
    potentialPayout: toNumber(row.potential_payout_proxy ?? row.potential_payout),
    potentialLiability: toNumber(row.potential_liability_proxy ?? row.potential_liability),
    actualWinnings: toNumber(row.actual_winnings),
    grossGamingRevenue: toNumber(row.gross_gaming_revenue),
    settledGgr: toNumber(row.settled_ggr),
    margin: toNumber(row.margin),
    weightedAvgPrice: toNumber(row.weighted_avg_price),
    firstBetDate: row.first_bet_date,
    lastBetDate: row.last_bet_date,
    aggregatedAt: row.aggregated_at,
  };
}

function normalizeSelectionRow(row) {
  return {
    competitionName: row.competition_name,
    eventName: row.event_name,
    marketName: row.market_name,
    selectionName: row.selection_name,
    ticketCount: toNumber(row.ticket_count),
    bettorCount: toNumber(row.bettor_count),
    singleTicketCount: toNumber(row.single_ticket_count),
    parlayTicketCount: toNumber(row.parlay_ticket_count),
    openTicketCount: toNumber(row.open_ticket_count),
    handle: toNumber(row.handle),
    avgTicketSize: toNumber(row.avg_ticket_size),
    openHandle: toNumber(row.open_handle),
    straightHandle: toNumber(row.straight_handle),
    straightPotentialPayout: toNumber(row.straight_potential_payout),
    straightPotentialLiability: toNumber(row.straight_potential_liability),
    potentialPayout: toNumber(row.potential_payout_proxy ?? row.potential_payout),
    potentialLiability: toNumber(row.potential_liability_proxy ?? row.potential_liability),
    actualWinnings: toNumber(row.actual_winnings),
    grossGamingRevenue: toNumber(row.gross_gaming_revenue),
    settledGgr: toNumber(row.settled_ggr),
    margin: toNumber(row.margin),
    weightedAvgPrice: toNumber(row.weighted_avg_price),
    firstBetDate: row.first_bet_date,
    lastBetDate: row.last_bet_date,
    aggregatedAt: row.aggregated_at,
  };
}

function summarizeTopMarket(row) {
  if (!row) return null;

  return {
    competitionName: row.competitionName,
    eventName: row.eventName,
    marketName: row.marketName,
    handle: row.handle,
    straightPotentialLiability: row.straightPotentialLiability,
    grossGamingRevenue: row.grossGamingRevenue,
  };
}

function toMarketKey(competitionName, eventName, marketName) {
  return [competitionName, eventName, marketName].join("::");
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function minDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[0] || null;
}

function maxDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[dates.length - 1] || null;
}

module.exports = {
  getLatestWcbbFuturesDashboard,
};
