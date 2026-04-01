const categorySelect = document.getElementById("categorySelect");
const searchInput = document.getElementById("searchInput");
const updatedAtEl = document.getElementById("updatedAt");
const sourceModeEl = document.getElementById("sourceMode");
const errorBannerEl = document.getElementById("errorBanner");
const heroMetricsEl = document.getElementById("heroMetrics");
const sportTabsEl = document.getElementById("sportTabs");
const alertCountEl = document.getElementById("alertCount");
const alertsEl = document.getElementById("alerts");
const traderBoardEl = document.getElementById("traderBoard");
const detailTitleEl = document.getElementById("detailTitle");
const detailSubtitleEl = document.getElementById("detailSubtitle");
const openVenueLinkEl = document.getElementById("openVenueLink");
const signalsEl = document.getElementById("signals");
const depthRowsEl = document.getElementById("depthRows");
const pocketsEl = document.getElementById("pockets");

const VENUES = [
  { key: "kalshi", label: "Kalshi" },
  { key: "polymarket", label: "Polymarket" },
];

const state = {
  dashboard: null,
  selectedSport: "",
  selectedCategory: "",
  selectedMarketId: "",
  selectedVenueKey: "polymarket",
};

categorySelect.addEventListener("change", () => {
  state.selectedCategory = categorySelect.value;
  loadDashboard();
});

let searchTimer = null;
searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(loadDashboard, 250);
});

function formatPercent(value) {
  if (value == null) return "--";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatDelta(value) {
  if (!value) return "Flat";
  const cents = Math.abs(Number(value) * 100).toFixed(1);
  return `${value > 0 ? "+" : "-"}${cents}c`;
}

function formatSpread(value) {
  if (value == null) return "--";
  return `${Math.abs(Number(value) * 100).toFixed(1)}c`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function toneClass(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function venueModeLabel(sourceStatus) {
  return VENUES.map((venue) => `${venue.label} ${sourceStatus?.[venue.key]?.mode || "--"}`).join(" / ");
}

function marketRowsFromDashboard(dashboard) {
  const groupedIds = new Set();
  const rows = [];

  for (const group of dashboard.comparables || []) {
    const venues = {};
    for (const venue of VENUES) {
      venues[venue.key] = group.markets.find((market) => market.platformKey === venue.key) || null;
      if (venues[venue.key]) groupedIds.add(venues[venue.key].id);
    }

    rows.push({
      id: group.id,
      title: group.title,
      sport: group.sport || group.kalshi?.sport || group.polymarket?.sport || "",
      category: group.category,
      group,
      venues,
      rowType: "comparable",
      alertCount: group.alertCount || 0,
      priceGap: group.priceGap,
    });
  }

  for (const market of dashboard.markets || []) {
    if (groupedIds.has(market.id)) continue;

    rows.push({
      id: market.id,
      title: market.title,
      sport: market.sport || "",
      category: market.category,
      group: null,
      venues: {
        kalshi: market.platformKey === "kalshi" ? market : null,
        polymarket: market.platformKey === "polymarket" ? market : null,
      },
      rowType: "single",
      alertCount: market.alerts?.length || 0,
      priceGap: null,
    });
  }

  return rows.sort((a, b) => {
    const liquidityA = VENUES.reduce((sum, venue) => sum + Number(a.venues[venue.key]?.liquidityUsd || 0), 0);
    const liquidityB = VENUES.reduce((sum, venue) => sum + Number(b.venues[venue.key]?.liquidityUsd || 0), 0);
    return liquidityB - liquidityA;
  });
}

function selectedVenueMarket() {
  const dashboard = state.dashboard;
  if (!dashboard) return null;
  const rows = marketRowsFromDashboard(dashboard);
  const row = rows.find((item) => item.id === state.selectedMarketId) || rows[0] || null;
  if (!row) return null;
  return row.venues[state.selectedVenueKey] || row.venues.polymarket || row.venues.kalshi || null;
}

async function loadDashboard() {
  try {
    const params = new URLSearchParams();
    if (state.selectedCategory) params.set("category", state.selectedCategory);
    if (state.selectedSport) params.set("sport", state.selectedSport);
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());

    const response = await fetch(`/api/prediction-markets?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load dashboard");
    }

    state.dashboard = payload;
    const rows = marketRowsFromDashboard(payload);
    const rowExists = rows.some((row) => row.id === state.selectedMarketId);
    if (!rowExists) {
      state.selectedMarketId = rows[0]?.id || "";
      state.selectedVenueKey = rows[0]?.venues.polymarket ? "polymarket" : "kalshi";
    }

    renderCategoryOptions(payload.categories || []);
    renderSportTabs(payload.sports || []);
    renderDashboard();
    setError("");
  } catch (error) {
    setError(String(error.message || error));
  }
}

function setError(message) {
  if (!message) {
    errorBannerEl.classList.add("hidden");
    errorBannerEl.textContent = "";
    return;
  }

  errorBannerEl.classList.remove("hidden");
  errorBannerEl.textContent = message;
}

function renderCategoryOptions(categories) {
  const current = state.selectedCategory;
  categorySelect.innerHTML = '<option value="">All categories</option>';
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    if (category === current) option.selected = true;
    categorySelect.appendChild(option);
  }
}

function renderSportTabs(sports) {
  const tabs = ["", ...sports];
  sportTabsEl.innerHTML = tabs
    .map((sport) => {
      const label = sport || "All";
      const active = sport === state.selectedSport ? "active" : "";
      return `<button type="button" class="sport-tab ${active}" data-sport="${escapeHtml(sport)}">${escapeHtml(label)}</button>`;
    })
    .join("");

  for (const button of sportTabsEl.querySelectorAll(".sport-tab")) {
    button.addEventListener("click", () => {
      state.selectedSport = button.dataset.sport || "";
      loadDashboard();
    });
  }
}

function renderDashboard() {
  const dashboard = state.dashboard;
  const rows = marketRowsFromDashboard(dashboard);
  const selectedMarket = selectedVenueMarket();

  updatedAtEl.textContent = dashboard.generatedAt
    ? new Date(dashboard.generatedAt).toLocaleTimeString()
    : "--";
  sourceModeEl.textContent = venueModeLabel(dashboard.sourceStatus);

  heroMetricsEl.innerHTML = [
    metricTile("Rows", rows.length),
    metricTile("Reported liquidity", formatCurrency(dashboard.summary.totalLiquidityUsd)),
    metricTile("24h traded volume", formatCurrency(dashboard.summary.totalVolume24hUsd)),
    metricTile("Alerts", dashboard.summary.activeAlerts),
  ].join("");

  renderAlerts(dashboard.alerts || []);
  renderBoard(rows);
  renderDetail(selectedMarket);
}

function metricTile(label, value) {
  return `<div class="metric-tile"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderAlerts(alerts) {
  alertCountEl.textContent = alerts.length;
  if (!alerts.length) {
    alertsEl.innerHTML = '<div class="empty-card slim">No major changes flagged in the latest snapshot.</div>';
    return;
  }

  alertsEl.innerHTML = alerts
    .slice(0, 8)
    .map(
      (alert) => `
        <div class="alert-card ${escapeHtml(alert.intensity)}">
          <strong>${escapeHtml(alert.label)}</strong>
          <span>${escapeHtml(alert.platform)} | ${escapeHtml(alert.marketTitle)}</span>
        </div>
      `
    )
    .join("");
}

function renderBoard(rows) {
  const header = `
    <div class="board-row board-header">
      <div class="market-col sticky-left">Market</div>
      <div class="meta-col">Sport</div>
      <div class="meta-col">Gap</div>
      ${VENUES.map(
        (venue) => `
          <div class="venue-col">
            <div class="venue-head">${venue.label}</div>
            <div class="venue-subhead">YES | Bid/Ask | Spr | Liq | 24h Vol</div>
          </div>
        `
      ).join("")}
    </div>
  `;

  const body = rows.length
    ? rows.map((row) => renderBoardRow(row)).join("")
    : '<div class="empty-card">No markets matched the current filters.</div>';

  traderBoardEl.innerHTML = header + body;

  for (const button of traderBoardEl.querySelectorAll(".board-row-button")) {
    button.addEventListener("click", () => {
      state.selectedMarketId = button.dataset.rowId;
      state.selectedVenueKey = button.dataset.venue || state.selectedVenueKey;
      renderDashboard();
    });
  }
}

function renderBoardRow(row) {
  const selected = row.id === state.selectedMarketId ? "selected" : "";
  const marketLabel = row.rowType === "comparable" ? row.title : `${row.title}`;
  const categoryText = row.category && row.sport ? `${row.category} | ${row.sport}` : row.category || row.sport || "--";

  return `
    <div class="board-row ${selected}">
      <button type="button" class="board-row-button market-col sticky-left" data-row-id="${escapeHtml(row.id)}">
        <strong>${escapeHtml(marketLabel)}</strong>
        <small>${escapeHtml(categoryText)}</small>
        <small>${row.alertCount ? `${row.alertCount} alert${row.alertCount === 1 ? "" : "s"}` : "No alerts"}</small>
      </button>
      <div class="meta-col">${escapeHtml(row.sport || "--")}</div>
      <div class="meta-col ${toneClass(row.priceGap)}">${row.priceGap == null ? "--" : escapeHtml(formatDelta(row.priceGap))}</div>
      ${VENUES.map((venue) => renderVenueCell(row, venue)).join("")}
    </div>
  `;
}

function renderVenueCell(row, venue) {
  const market = row.venues[venue.key];
  if (!market) {
    const mode = state.dashboard?.sourceStatus?.[venue.key]?.mode || "--";
    return `<div class="venue-col muted-cell"><span>${escapeHtml(mode === "error" ? "No live market" : "--")}</span></div>`;
  }

  const selected = row.id === state.selectedMarketId && state.selectedVenueKey === venue.key ? "venue-selected" : "";
  return `
    <button type="button" class="board-row-button venue-col ${selected}" data-row-id="${escapeHtml(row.id)}" data-venue="${escapeHtml(venue.key)}">
      <strong>${escapeHtml(formatPercent(market.yesPrice))}</strong>
      <span class="bidask">${escapeHtml(formatPercent(market.topBid?.price))} / ${escapeHtml(formatPercent(market.topAsk?.price))}</span>
      <span class="metric-inline">Spr ${escapeHtml(formatSpread(market.spread))}</span>
      <span class="metric-inline">Liq ${escapeHtml(formatCurrency(market.liquidityUsd))}</span>
      <span class="metric-inline">Vol ${escapeHtml(formatCurrency(market.volume24hUsd))}</span>
    </button>
  `;
}

function renderDetail(market) {
  if (!market) {
    detailTitleEl.textContent = "Pick a market";
    detailSubtitleEl.textContent = "Choose a market row to inspect venue detail.";
    openVenueLinkEl.classList.add("hidden");
    signalsEl.innerHTML = '<div class="empty-card">No market selected.</div>';
    depthRowsEl.innerHTML = '<div class="empty-card">No orderbook depth available.</div>';
    pocketsEl.innerHTML = '<div class="empty-card">No midpoint liquidity pockets available.</div>';
    return;
  }

  detailTitleEl.textContent = market.title;
  detailSubtitleEl.textContent = market.sport
    ? `${market.platform} | ${market.category} | ${market.sport} | ${market.subtitle}`
    : `${market.platform} | ${market.category} | ${market.subtitle}`;

  if (market.url) {
    openVenueLinkEl.href = market.url;
    openVenueLinkEl.classList.remove("hidden");
  } else {
    openVenueLinkEl.classList.add("hidden");
  }

  signalsEl.innerHTML = [
    signalCard("YES price", formatPercent(market.yesPrice), `${formatDelta(market.priceChange)} vs prior snapshot`, market.priceChange),
    signalCard("Reported liquidity", formatCurrency(market.liquidityUsd), market.liquidityChangeUsd ? `${market.liquidityChangeUsd > 0 ? "+" : "-"}${formatCurrency(Math.abs(market.liquidityChangeUsd))} since prior snapshot` : "No change yet", market.liquidityChangeUsd),
    signalCard("24h traded volume", formatCurrency(market.volume24hUsd), `Open interest ${formatCurrency(market.openInterestUsd)}`, 0),
    signalCard("Spread", formatSpread(market.spread), `Bid ${formatPercent(market.topBid?.price)} / Ask ${formatPercent(market.topAsk?.price)}`, market.spread ? -market.spread : 0),
    signalCard("Bid book notional", formatCurrency(market.totalBidNotionalUsd), `${formatCompactNumber(market.totalBidSize)} resting shares/contracts`, 0),
    signalCard("Ask book notional", formatCurrency(market.totalAskNotionalUsd), `${formatCompactNumber(market.totalAskSize)} resting shares/contracts`, 0),
  ].join("");

  renderDepth(market);
  renderPockets(market);
}

function signalCard(label, value, note, toneValue) {
  return `
    <div class="signal-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small class="${toneClass(toneValue)}">${escapeHtml(note)}</small>
    </div>
  `;
}

function renderDepth(market) {
  const bids = market.yesBook?.bids || [];
  const asks = market.yesBook?.asks || [];
  const rows = Math.max(bids.length, asks.length);

  if (!rows) {
    depthRowsEl.innerHTML = '<div class="empty-card">No orderbook depth available.</div>';
    return;
  }

  depthRowsEl.innerHTML = Array.from({ length: rows }, (_, index) => {
    const bid = bids[index];
    const ask = asks[index];
    return `
      <div class="depth-row">
        <span>${bid ? escapeHtml(formatPercent(bid.price)) : "--"}</span>
        <span>${bid ? escapeHtml(formatCompactNumber(bid.size)) : "--"}</span>
        <span>${ask ? escapeHtml(formatPercent(ask.price)) : "--"}</span>
        <span>${ask ? escapeHtml(formatCompactNumber(ask.size)) : "--"}</span>
      </div>
    `;
  }).join("");
}

function renderPockets(market) {
  const levels = market.focusDepth || [];
  if (!levels.length) {
    pocketsEl.innerHTML = '<div class="empty-card">No midpoint liquidity pockets available.</div>';
    return;
  }

  pocketsEl.innerHTML = levels
    .map(
      (level) => `
        <div class="pocket-row">
          <strong>${escapeHtml(formatPercent(level.price))}</strong>
          <span>${escapeHtml(formatCompactNumber(level.size))} resting size</span>
        </div>
      `
    )
    .join("");
}

async function init() {
  await loadDashboard();
  window.setInterval(loadDashboard, 30000);
}

init();
