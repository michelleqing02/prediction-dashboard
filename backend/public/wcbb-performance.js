const summaryGridEl = document.getElementById("summaryGrid");
const spotlightGridEl = document.getElementById("spotlightGrid");
const notesListEl = document.getElementById("notesList");
const metaPillsEl = document.getElementById("metaPills");
const statusBadgeEl = document.getElementById("statusBadge");
const resultsTitleEl = document.getElementById("resultsTitle");
const eventsEl = document.getElementById("events");
const searchInputEl = document.getElementById("searchInput");
const liveFilterEl = document.getElementById("liveFilter");
const stakeFilterEl = document.getElementById("stakeFilter");
const sortSelectEl = document.getElementById("sortSelect");

const state = {
  payload: null,
  detailCache: new Map(),
  openEvents: new Set(),
  search: "",
  live: "all",
  stake: "all",
  sort: "ggr_asc",
};

loadDashboard();

async function loadDashboard() {
  try {
    const payload = await fetch("/api/wcbb-performance").then(assertJson);
    state.payload = payload;
    hydrateControls(payload.meta);
    renderDashboard();
  } catch (error) {
    statusBadgeEl.textContent = "Dashboard unavailable";
    eventsEl.innerHTML = `<div class="empty-state">${escapeHtml(String(error.message || error))}</div>`;
  }
}

function hydrateControls(meta) {
  liveFilterEl.innerHTML = [
    `<option value="all">All bets</option>`,
    `<option value="Prematch">Prematch only</option>`,
    `<option value="Live">Live only</option>`,
  ].join("");

  const stakeOptions = [
    { value: "all", label: "All stake factors" },
    { value: "band:Limited (<1x)", label: "Limited (<1x)" },
    { value: "band:Standard (1x)", label: "Standard (1x)" },
    { value: "band:Elevated (>1x)", label: "Elevated (>1x)" },
    ...(meta.stakeFactors || []).map((value) => ({ value: `exact:${value}`, label: formatStakeFactor(value) })),
  ];

  stakeFilterEl.innerHTML = stakeOptions
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");

  notesListEl.innerHTML = (meta.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  metaPillsEl.innerHTML = [
    `Season start ${escapeHtml(meta.seasonStart || "--")}`,
    `Rows from ${escapeHtml(meta.sourceTable || "--")}`,
    `Refreshed ${escapeHtml(formatDateTime(meta.refreshedAt))}`,
  ]
    .map((label) => `<span class="meta-pill">${label}</span>`)
    .join("");

  searchInputEl.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderDashboard();
  });

  liveFilterEl.addEventListener("change", (event) => {
    state.live = event.target.value;
    renderDashboard();
  });

  stakeFilterEl.addEventListener("change", (event) => {
    state.stake = event.target.value;
    renderDashboard();
  });

  sortSelectEl.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderDashboard();
  });
}

function renderDashboard() {
  if (!state.payload) return;

  const filteredRows = filterRows(state.payload.rows);
  const events = aggregateEventRows(filteredRows).sort(sortEvents);
  renderSummary(events, filteredRows);
  renderSpotlights(events);
  renderEvents(events);
}

function filterRows(rows) {
  return rows.filter((row) => {
    if (state.live !== "all" && row.liveBucket !== state.live) {
      return false;
    }

    if (state.stake.startsWith("band:") && row.stakeFactorBand !== state.stake.slice(5)) {
      return false;
    }

    if (state.stake.startsWith("exact:")) {
      const target = Number(state.stake.slice(6));
      if (row.stakeFactor !== target) return false;
    }

    if (!state.search) return true;
    return `${row.eventName} ${row.competitionName}`.toLowerCase().includes(state.search);
  });
}

function aggregateEventRows(rows) {
  const byEvent = new Map();

  for (const row of rows) {
    const existing = byEvent.get(row.eventKey) || createEventAggregate(row);
    existing.ticketCount += row.ticketCount;
    existing.bettorCount += row.bettorCount;
    existing.handle += row.handle;
    existing.grossGamingRevenue += row.grossGamingRevenue;
    existing.overHandle += row.overHandle;
    existing.overGgr += row.overGgr;
    existing.underHandle += row.underHandle;
    existing.underGgr += row.underGgr;
    existing.moneylineHandle += row.moneylineHandle;
    existing.spreadHandle += row.spreadHandle;
    existing.totalHandle += row.totalHandle;
    existing.otherHandle += row.otherHandle;
    existing.liveMix[row.liveBucket] = (existing.liveMix[row.liveBucket] || 0) + row.handle;
    existing.firstBetDate = minText(existing.firstBetDate, row.firstBetDate);
    existing.lastBetDate = maxText(existing.lastBetDate, row.lastBetDate);
    byEvent.set(row.eventKey, existing);
  }

  return Array.from(byEvent.values()).map((event) => ({
    ...event,
    margin: ratio(event.grossGamingRevenue, event.handle),
    overMargin: ratio(event.overGgr, event.overHandle),
    underMargin: ratio(event.underGgr, event.underHandle),
    liveHandleShare: ratio(event.liveMix.Live || 0, event.handle),
  }));
}

function createEventAggregate(row) {
  return {
    eventKey: row.eventKey,
    eventDate: row.eventDate,
    eventName: row.eventName,
    competitionName: row.competitionName,
    firstBetDate: row.firstBetDate,
    lastBetDate: row.lastBetDate,
    ticketCount: 0,
    bettorCount: 0,
    handle: 0,
    grossGamingRevenue: 0,
    overHandle: 0,
    overGgr: 0,
    underHandle: 0,
    underGgr: 0,
    moneylineHandle: 0,
    spreadHandle: 0,
    totalHandle: 0,
    otherHandle: 0,
    liveMix: {},
  };
}

function renderSummary(events, rows) {
  const totalHandle = sum(events, "handle");
  const totalGgr = sum(events, "grossGamingRevenue");
  const totalTickets = sum(events, "ticketCount");
  const liveHandle = rows
    .filter((row) => row.liveBucket === "Live")
    .reduce((total, row) => total + row.handle, 0);
  const limitedHandle = rows
    .filter((row) => row.stakeFactorBand === "Limited (<1x)")
    .reduce((total, row) => total + row.handle, 0);

  const cards = [
    { label: "Games", value: formatInteger(events.length) },
    { label: "Handle", value: formatCurrency(totalHandle) },
    { label: "GGR", value: formatCurrency(totalGgr), tone: toneForValue(totalGgr) },
    { label: "Margin", value: formatPercent(ratio(totalGgr, totalHandle)), tone: toneForValue(totalGgr) },
    { label: "Tickets", value: formatInteger(totalTickets) },
    { label: "Live Handle Share", value: formatPercent(ratio(liveHandle, totalHandle)) },
    { label: "Limited Stake Share", value: formatPercent(ratio(limitedHandle, totalHandle)) },
    { label: "Date Window", value: formatDateWindow(events) },
  ];

  summaryGridEl.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card ${card.tone || ""}">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
        </article>
      `
    )
    .join("");

  statusBadgeEl.textContent = `${formatInteger(events.length)} games in view`;
}

function renderSpotlights(events) {
  const bestByGgr = events.slice().sort((left, right) => right.grossGamingRevenue - left.grossGamingRevenue)[0];
  const worstByGgr = events.slice().sort((left, right) => left.grossGamingRevenue - right.grossGamingRevenue)[0];
  const bestByMargin = events.slice().sort((left, right) => right.margin - left.margin)[0];
  const worstByMargin = events.slice().sort((left, right) => left.margin - right.margin)[0];

  const cards = [
    renderSpotlightCard("Best GGR", bestByGgr),
    renderSpotlightCard("Worst GGR", worstByGgr),
    renderSpotlightCard("Best Margin", bestByMargin, "margin"),
    renderSpotlightCard("Worst Margin", worstByMargin, "margin"),
  ];

  spotlightGridEl.innerHTML = cards.join("");
}

function renderSpotlightCard(label, event, metric = "grossGamingRevenue") {
  if (!event) {
    return `<article class="spotlight-card"><span>${escapeHtml(label)}</span><strong>--</strong></article>`;
  }

  const value = metric === "margin" ? formatPercent(event.margin) : formatCurrency(event.grossGamingRevenue);
  return `
    <article class="spotlight-card ${toneForValue(metric === "margin" ? event.margin : event.grossGamingRevenue)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <h3>${escapeHtml(event.eventName)}</h3>
      <p>${escapeHtml(event.eventDate || "--")}</p>
    </article>
  `;
}

function renderEvents(events) {
  resultsTitleEl.textContent = `${formatInteger(events.length)} games`;

  if (!events.length) {
    eventsEl.innerHTML = '<div class="empty-state">No games match the current filters.</div>';
    return;
  }

  eventsEl.innerHTML = events.map(renderEventCard).join("");
  for (const button of eventsEl.querySelectorAll("[data-event-key]")) {
    button.addEventListener("click", handleEventToggle);
  }
}

function renderEventCard(event) {
  const isOpen = state.openEvents.has(event.eventKey);
  return `
    <article class="event-card">
      <div class="event-topline">
        <div>
          <p class="event-date">${escapeHtml(event.eventDate || "--")}</p>
          <h3>${escapeHtml(event.eventName)}</h3>
          <p class="event-subtitle">${escapeHtml(event.competitionName)}</p>
        </div>
        <button class="detail-button" type="button" data-event-key="${escapeHtml(event.eventKey)}">
          ${isOpen ? "Hide market detail" : "Show market detail"}
        </button>
      </div>
      <div class="event-metrics">
        ${renderMetricBlock("Handle", formatCurrency(event.handle))}
        ${renderMetricBlock("GGR", formatCurrency(event.grossGamingRevenue), toneForValue(event.grossGamingRevenue))}
        ${renderMetricBlock("Margin", formatPercent(event.margin), toneForValue(event.grossGamingRevenue))}
        ${renderMetricBlock("Over Margin", formatPercent(event.overMargin), toneForValue(event.overGgr))}
        ${renderMetricBlock("Under Margin", formatPercent(event.underMargin), toneForValue(event.underGgr))}
        ${renderMetricBlock("Live Share", formatPercent(event.liveHandleShare))}
      </div>
      <div class="event-secondary">
        <span>${formatInteger(event.ticketCount)} tickets</span>
        <span>${formatInteger(event.bettorCount)} bettors</span>
        <span>Moneyline ${formatCurrency(event.moneylineHandle)}</span>
        <span>Spread ${formatCurrency(event.spreadHandle)}</span>
        <span>Totals ${formatCurrency(event.totalHandle)}</span>
      </div>
      <div class="detail-shell ${isOpen ? "open" : ""}" id="${escapeHtml(detailId(event.eventKey))}">
        ${isOpen ? renderEventDetailShell(event.eventKey) : ""}
      </div>
    </article>
  `;
}

function renderMetricBlock(label, value, tone = "") {
  return `
    <div class="metric-block ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function handleEventToggle(event) {
  const eventKey = event.currentTarget.dataset.eventKey;
  if (!eventKey) return;

  if (state.openEvents.has(eventKey)) {
    state.openEvents.delete(eventKey);
    renderDashboard();
    return;
  }

  state.openEvents.add(eventKey);
  renderDashboard();
  loadEventDetail(eventKey);
}

async function loadEventDetail(eventKey) {
  const shellEl = document.getElementById(detailId(eventKey));
  if (!shellEl) return;

  if (state.detailCache.has(eventKey)) {
    shellEl.innerHTML = renderEventDetail(state.detailCache.get(eventKey));
    return;
  }

  shellEl.innerHTML = '<div class="detail-loading">Loading market detail...</div>';

  try {
    const payload = await fetch(`/api/wcbb-performance/event-details?event_key=${encodeURIComponent(eventKey)}`).then(assertJson);
    state.detailCache.set(eventKey, payload);
    const targetEl = document.getElementById(detailId(eventKey));
    if (targetEl) {
      targetEl.innerHTML = renderEventDetail(payload);
    }
  } catch (error) {
    shellEl.innerHTML = `<div class="empty-state compact">${escapeHtml(String(error.message || error))}</div>`;
  }
}

function renderEventDetailShell(eventKey) {
  const payload = state.detailCache.get(eventKey);
  if (!payload) {
    return '<div class="detail-loading">Loading market detail...</div>';
  }
  return renderEventDetail(payload);
}

function renderEventDetail(payload) {
  const marketRows = filterRows(payload.markets || []);
  const selectionRows = filterRows(payload.selections || []);
  const markets = aggregateMarketRows(marketRows, selectionRows);

  if (!markets.length) {
    return '<div class="empty-state compact">No market detail matches the current filters.</div>';
  }

  return `
    <div class="market-table">
      <div class="market-table-head">
        <span>Market</span>
        <span>Group</span>
        <span>Handle</span>
        <span>GGR</span>
        <span>Margin</span>
        <span>Over Margin</span>
        <span>Under Margin</span>
        <span>Top Selection</span>
      </div>
      ${markets.map(renderMarketRow).join("")}
    </div>
  `;
}

function aggregateMarketRows(marketRows, selectionRows) {
  const selectionsByMarket = new Map();
  for (const row of selectionRows) {
    const bucket = selectionsByMarket.get(row.marketKey) || [];
    bucket.push(row);
    selectionsByMarket.set(row.marketKey, bucket);
  }

  const marketsByKey = new Map();
  for (const row of marketRows) {
    const existing = marketsByKey.get(row.marketKey) || {
      marketKey: row.marketKey,
      marketName: row.marketName,
      marketTypeGroup: row.marketTypeGroup,
      periodGroup: row.periodGroup,
      handle: 0,
      grossGamingRevenue: 0,
      overHandle: 0,
      overGgr: 0,
      underHandle: 0,
      underGgr: 0,
    };

    existing.handle += row.handle;
    existing.grossGamingRevenue += row.grossGamingRevenue;
    existing.overHandle += row.overHandle;
    existing.overGgr += row.overGgr;
    existing.underHandle += row.underHandle;
    existing.underGgr += row.underGgr;
    marketsByKey.set(row.marketKey, existing);
  }

  return Array.from(marketsByKey.values())
    .map((market) => {
      const selections = (selectionsByMarket.get(market.marketKey) || [])
        .reduce((map, row) => {
          const existing = map.get(row.selectionName) || {
            selectionName: row.selectionName,
            handle: 0,
            grossGamingRevenue: 0,
          };
          existing.handle += row.handle;
          existing.grossGamingRevenue += row.grossGamingRevenue;
          map.set(row.selectionName, existing);
          return map;
        }, new Map());

      const topSelection = Array.from(selections.values()).sort((left, right) => right.handle - left.handle)[0] || null;

      return {
        ...market,
        margin: ratio(market.grossGamingRevenue, market.handle),
        overMargin: ratio(market.overGgr, market.overHandle),
        underMargin: ratio(market.underGgr, market.underHandle),
        topSelection,
      };
    })
    .sort((left, right) => right.handle - left.handle);
}

function renderMarketRow(market) {
  return `
    <div class="market-table-row">
      <span>${escapeHtml(market.marketName)}</span>
      <span>${escapeHtml(`${market.marketTypeGroup} / ${market.periodGroup}`)}</span>
      <span>${formatCurrency(market.handle)}</span>
      <span class="${toneForValue(market.grossGamingRevenue)}">${formatCurrency(market.grossGamingRevenue)}</span>
      <span class="${toneForValue(market.grossGamingRevenue)}">${formatPercent(market.margin)}</span>
      <span class="${toneForValue(market.overGgr)}">${formatPercent(market.overMargin)}</span>
      <span class="${toneForValue(market.underGgr)}">${formatPercent(market.underMargin)}</span>
      <span>${market.topSelection ? `${escapeHtml(market.topSelection.selectionName)} · ${formatCurrency(market.topSelection.handle)}` : "--"}</span>
    </div>
  `;
}

function sortEvents(left, right) {
  switch (state.sort) {
    case "ggr_desc":
      return right.grossGamingRevenue - left.grossGamingRevenue;
    case "margin_asc":
      return left.margin - right.margin;
    case "margin_desc":
      return right.margin - left.margin;
    case "handle_desc":
      return right.handle - left.handle;
    case "event_date_desc":
      return String(right.eventDate).localeCompare(String(left.eventDate));
    case "ggr_asc":
    default:
      return left.grossGamingRevenue - right.grossGamingRevenue;
  }
}

function detailId(eventKey) {
  return `detail-${eventKey.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator === 0) return 0;
  return Number(numerator || 0) / denominator;
}

function toneForValue(value) {
  return Number(value || 0) >= 0 ? "positive" : "negative";
}

function minText(left, right) {
  return [left, right].filter(Boolean).sort()[0] || null;
}

function maxText(left, right) {
  const values = [left, right].filter(Boolean).sort();
  return values[values.length - 1] || null;
}

function formatStakeFactor(value) {
  const numeric = Number(value || 0);
  return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 2)}x`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDateWindow(events) {
  const dates = events.map((event) => event.eventDate).filter(Boolean).sort();
  if (!dates.length) return "--";
  return `${dates[0]} to ${dates[dates.length - 1]}`;
}

function assertJson(response) {
  if (!response.ok) {
    return response.json().then((body) => {
      throw new Error(body.detail || body.error || `Request failed with ${response.status}`);
    });
  }

  return response.json();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
