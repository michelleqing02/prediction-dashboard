const { runDatabricksQuery } = require("./databricksCli");

const EVENT_AGG_TABLE = "sandbox.shared.codex_wcbb_match_performance_2026_event_agg";
const MARKET_AGG_TABLE = "sandbox.shared.codex_wcbb_match_performance_2026_market_agg";
const SELECTION_AGG_TABLE = "sandbox.shared.codex_wcbb_match_performance_2026_selection_agg";

const OVERVIEW_SQL = `
  SELECT
    event_key,
    season_label,
    competition_name,
    event_date,
    event_name,
    live_bucket,
    stake_factor,
    stake_factor_band,
    ticket_count,
    bettor_count,
    handle,
    gross_gaming_revenue,
    margin,
    over_handle,
    over_ggr,
    over_margin,
    under_handle,
    under_ggr,
    under_margin,
    moneyline_handle,
    spread_handle,
    total_handle,
    other_handle,
    first_bet_date,
    last_bet_date,
    aggregated_at
  FROM ${EVENT_AGG_TABLE}
  ORDER BY event_date DESC, handle DESC, event_name ASC
`;

function buildEventDetailSql(tableName, eventKey, orderBy) {
  return `
    SELECT *
    FROM ${tableName}
    WHERE event_key = '${escapeSqlLiteral(eventKey)}'
    ORDER BY ${orderBy}
  `;
}

async function getWcbbMatchPerformanceOverview() {
  const rows = await runDatabricksQuery(OVERVIEW_SQL, { timeoutMs: 180000 });
  const normalizedRows = rows.map(normalizeEventRow);
  const sortedStakeFactors = Array.from(
    new Set(
      normalizedRows
        .map((row) => row.stakeFactor)
        .filter((value) => Number.isFinite(value))
    )
  ).sort((left, right) => left - right);

  return {
    meta: {
      title: "Women's College Basketball Match Performance",
      seasonLabel: "2025-2026",
      seasonStart: "2026-02-01",
      competitionName: "wncaab matches",
      sourceTable: EVENT_AGG_TABLE,
      eventCount: new Set(normalizedRows.map((row) => row.eventKey)).size,
      stakeFactors: sortedStakeFactors,
      refreshedAt: normalizedRows[0]?.aggregatedAt || null,
      firstBetDate: minDate(normalizedRows.map((row) => row.firstBetDate)),
      lastBetDate: maxDate(normalizedRows.map((row) => row.lastBetDate)),
      notes: [
        "Season window starts February 1, 2026 and includes wncaab match betting only.",
        "Rows are pre-aggregated in Databricks to keep the dashboard fast.",
        "Margin is gross gaming revenue divided by handle.",
        "Over and under margins only use selections whose names begin with over or under.",
        "Stake factor can be filtered by band or by exact factor value.",
      ],
    },
    rows: normalizedRows,
  };
}

async function getWcbbMatchPerformanceEventDetail(eventKey) {
  const [marketRows, selectionRows] = await Promise.all([
    runDatabricksQuery(buildEventDetailSql(MARKET_AGG_TABLE, eventKey, "handle DESC, market_name ASC"), { timeoutMs: 180000 }),
    runDatabricksQuery(
      buildEventDetailSql(SELECTION_AGG_TABLE, eventKey, "market_name ASC, handle DESC, selection_name ASC"),
      { timeoutMs: 180000 }
    ),
  ]);

  const normalizedMarkets = marketRows.map(normalizeMarketRow);
  const normalizedSelections = selectionRows.map(normalizeSelectionRow);
  const event = normalizedMarkets[0] || normalizedSelections[0] || null;

  return {
    meta: {
      eventKey,
      eventName: event?.eventName || null,
      eventDate: event?.eventDate || null,
      competitionName: event?.competitionName || null,
      marketSourceTable: MARKET_AGG_TABLE,
      selectionSourceTable: SELECTION_AGG_TABLE,
      refreshedAt: event?.aggregatedAt || null,
    },
    markets: normalizedMarkets,
    selections: normalizedSelections,
  };
}

function normalizeEventRow(row) {
  return {
    eventKey: row.event_key,
    seasonLabel: row.season_label,
    competitionName: row.competition_name,
    eventDate: row.event_date,
    eventName: row.event_name,
    liveBucket: row.live_bucket,
    stakeFactor: toNumber(row.stake_factor),
    stakeFactorBand: row.stake_factor_band,
    ticketCount: toNumber(row.ticket_count),
    bettorCount: toNumber(row.bettor_count),
    handle: toNumber(row.handle),
    grossGamingRevenue: toNumber(row.gross_gaming_revenue),
    margin: toNumber(row.margin),
    overHandle: toNumber(row.over_handle),
    overGgr: toNumber(row.over_ggr),
    overMargin: toNumber(row.over_margin),
    underHandle: toNumber(row.under_handle),
    underGgr: toNumber(row.under_ggr),
    underMargin: toNumber(row.under_margin),
    moneylineHandle: toNumber(row.moneyline_handle),
    spreadHandle: toNumber(row.spread_handle),
    totalHandle: toNumber(row.total_handle),
    otherHandle: toNumber(row.other_handle),
    firstBetDate: row.first_bet_date,
    lastBetDate: row.last_bet_date,
    aggregatedAt: row.aggregated_at,
  };
}

function normalizeMarketRow(row) {
  return {
    eventKey: row.event_key,
    seasonLabel: row.season_label,
    competitionName: row.competition_name,
    eventDate: row.event_date,
    eventName: row.event_name,
    marketKey: row.market_key,
    marketName: row.market_name,
    marketTypeGroup: row.market_type_group,
    periodGroup: row.period_group,
    liveBucket: row.live_bucket,
    stakeFactor: toNumber(row.stake_factor),
    stakeFactorBand: row.stake_factor_band,
    ticketCount: toNumber(row.ticket_count),
    bettorCount: toNumber(row.bettor_count),
    handle: toNumber(row.handle),
    grossGamingRevenue: toNumber(row.gross_gaming_revenue),
    margin: toNumber(row.margin),
    overHandle: toNumber(row.over_handle),
    overGgr: toNumber(row.over_ggr),
    overMargin: toNumber(row.over_margin),
    underHandle: toNumber(row.under_handle),
    underGgr: toNumber(row.under_ggr),
    underMargin: toNumber(row.under_margin),
    firstBetDate: row.first_bet_date,
    lastBetDate: row.last_bet_date,
    aggregatedAt: row.aggregated_at,
  };
}

function normalizeSelectionRow(row) {
  return {
    eventKey: row.event_key,
    seasonLabel: row.season_label,
    competitionName: row.competition_name,
    eventDate: row.event_date,
    eventName: row.event_name,
    marketKey: row.market_key,
    marketName: row.market_name,
    marketTypeGroup: row.market_type_group,
    periodGroup: row.period_group,
    selectionName: row.selection_name,
    selectionSide: row.selection_side,
    liveBucket: row.live_bucket,
    stakeFactor: toNumber(row.stake_factor),
    stakeFactorBand: row.stake_factor_band,
    ticketCount: toNumber(row.ticket_count),
    bettorCount: toNumber(row.bettor_count),
    handle: toNumber(row.handle),
    grossGamingRevenue: toNumber(row.gross_gaming_revenue),
    margin: toNumber(row.margin),
    firstBetDate: row.first_bet_date,
    lastBetDate: row.last_bet_date,
    aggregatedAt: row.aggregated_at,
  };
}

function escapeSqlLiteral(value) {
  return String(value || "").replaceAll("'", "''");
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
  getWcbbMatchPerformanceOverview,
  getWcbbMatchPerformanceEventDetail,
};
