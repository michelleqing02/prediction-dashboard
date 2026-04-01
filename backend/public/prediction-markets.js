const categorySelect = document.getElementById("categorySelect");
const searchInput = document.getElementById("searchInput");
const updatedAtEl = document.getElementById("updatedAt");
const sourceModeEl = document.getElementById("sourceMode");
const errorBannerEl = document.getElementById("errorBanner");
const heroMetricsEl = document.getElementById("heroMetrics");
const sportTabsEl = document.getElementById("sportTabs");
const venueTabsEl = document.getElementById("venueTabs");
const alertCountEl = document.getElementById("alertCount");
const alertsEl = document.getElementById("alerts");
const traderBoardEl = document.getElementById("traderBoard");
const boardTitleEl = document.getElementById("boardTitle");
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
  selectedVenueKey: "polymarket",
  selectedMarketId: "",
  expandedGroupIds: [],
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

function currentVenue() {
  return VENUES.find((venue) => venue.key === state.selectedVenueKey) || VENUES[0];
}

function venueMarketsFromDashboard(dashboard) {
  return (dashboard.markets || [])
    .filter((market) => market.platformKey === state.selectedVenueKey)
    .sort((a, b) => {
      const aGame = isGameMarket(a) ? 1 : 0;
      const bGame = isGameMarket(b) ? 1 : 0;
      if (aGame !== bGame) return bGame - aGame;

      const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;

      return Number(b.liquidityUsd || 0) - Number(a.liquidityUsd || 0);
    });
}

function isGameMarket(market) {
  const category = String(market.category || "").toLowerCase();
  return [
    "moneyline",
    "spreads",
    "totals",
    "first half moneyline",
    "first half spreads",
    "first half totals",
    "points",
    "rebounds",
    "assists",
  ].includes(category);
}

function selectedVenueMarket() {
  const markets = venueMarketsFromDashboard(state.dashboard || { markets: [] });
  return markets.find((market) => market.id === state.selectedMarketId) || markets[0] || null;
}

function groupTitleForMarket(market) {
  if (market.platformKey === "polymarket") {
    return market.subtitle || market.category || market.title;
  }

  return market.category || market.subtitle || market.title;
}

function buildMarketGroups(markets) {
  const groups = new Map();

  for (const market of markets) {
    const title = groupTitleForMarket(market);
    const key = `${market.platformKey}|${market.sport || ""}|${title}`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        id: key,
        title,
        sport: market.sport || "",
        platformKey: market.platformKey,
        markets: [market],
      });
      continue;
    }

    existing.markets.push(market);
  }

  return [...groups.values()]
    .map((group) => {
      group.markets.sort((a, b) => {
        const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        return Number(b.liquidityUsd || 0) - Number(a.liquidityUsd || 0);
      });

      group.totalLiquidityUsd = group.markets.reduce((sum, market) => sum + Number(market.liquidityUsd || 0), 0);
      group.totalVolume24hUsd = group.markets.reduce((sum, market) => sum + Number(market.volume24hUsd || 0), 0);
      group.alertCount = group.markets.reduce((sum, market) => sum + Number(market.alerts?.length || 0), 0);
      group.hasGameMarkets = group.markets.some(isGameMarket);
      group.firstExpiresAt = group.markets.reduce((earliest, market) => {
        const time = market.expiresAt ? new Date(market.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        return Math.min(earliest, time);
      }, Number.MAX_SAFE_INTEGER);
      return group;
    })
    .sort((a, b) => {
      if (a.hasGameMarkets !== b.hasGameMarkets) return Number(b.hasGameMarkets) - Number(a.hasGameMarkets);
      if (a.firstExpiresAt !== b.firstExpiresAt) return a.firstExpiresAt - b.firstExpiresAt;
      return b.totalLiquidityUsd - a.totalLiquidityUsd;
    });
}

function syncExpandedGroups(groups) {
  const validIds = new Set(groups.map((group) => group.id));
  state.expandedGroupIds = state.expandedGroupIds.filter((id) => validIds.has(id));

  if (state.selectedMarketId) {
    const selectedGroup = groups.find((group) => group.markets.some((market) => market.id === state.selectedMarketId));
    if (selectedGroup && !state.expandedGroupIds.includes(selectedGroup.id)) {
      state.expandedGroupIds.push(selectedGroup.id);
    }
  }

  if (!state.expandedGroupIds.length && groups.length) {
    state.expandedGroupIds = groups.slice(0, 6).map((group) => group.id);
  }
}

async function loadDashboard() {
  try {
    const params = new URLSearchParams();
    if (state.selectedVenueKey) params.set("platform", state.selectedVenueKey);
    if (state.selectedCategory) params.set("category", state.selectedCategory);
    if (state.selectedSport) params.set("sport", state.selectedSport);
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());

    const response = await fetch(`/api/prediction-markets?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load dashboard");
    }

    state.dashboard = payload;
    const venueMarkets = venueMarketsFromDashboard(payload);
    const venueGroups = buildMarketGroups(venueMarkets);
    const marketExists = venueMarkets.some((market) => market.id === state.selectedMarketId);
    if (!marketExists) {
      state.selectedMarketId = venueMarkets[0]?.id || "";
    }
    syncExpandedGroups(venueGroups);

    renderCategoryOptions(payload.categories || []);
    renderSportTabs(payload.sports || []);
    renderVenueTabs(payload.sourceStatus || {});
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

function renderVenueTabs(sourceStatus) {
  venueTabsEl.innerHTML = VENUES.map((venue) => {
    const active = venue.key === state.selectedVenueKey ? "active" : "";
    const mode = sourceStatus?.[venue.key]?.mode || "--";
    return `<button type="button" class="sport-tab ${active}" data-venue="${escapeHtml(venue.key)}">${escapeHtml(venue.label)} | ${escapeHtml(mode)}</button>`;
  }).join("");

  for (const button of venueTabsEl.querySelectorAll(".sport-tab")) {
    button.addEventListener("click", () => {
      state.selectedVenueKey = button.dataset.venue || "polymarket";
      loadDashboard();
    });
  }
}

function renderDashboard() {
  const dashboard = state.dashboard;
  const venue = currentVenue();
  const venueStatus = dashboard.sourceStatus?.[venue.key] || {};
  const venueMarkets = venueMarketsFromDashboard(dashboard);
  const venueGroups = buildMarketGroups(venueMarkets);
  const selectedMarket = selectedVenueMarket();

  updatedAtEl.textContent = dashboard.generatedAt
    ? new Date(dashboard.generatedAt).toLocaleTimeString()
    : "--";
  sourceModeEl.textContent = venueModeLabel(dashboard.sourceStatus);
  boardTitleEl.textContent = `${venue.label} markets${state.selectedSport ? ` | ${state.selectedSport}` : ""}`;

  heroMetricsEl.innerHTML = [
    metricTile("Markets", venueMarkets.length),
    metricTile("Groups", venueGroups.length),
    metricTile("Venue", venue.label),
    metricTile("Source mode", venueStatus.mode || "--"),
    metricTile(
      "Reported liquidity",
      formatCurrency(venueMarkets.reduce((sum, market) => sum + Number(market.liquidityUsd || 0), 0))
    ),
    metricTile(
      "24h traded volume",
      formatCurrency(venueMarkets.reduce((sum, market) => sum + Number(market.volume24hUsd || 0), 0))
    ),
    metricTile(
      "Alerts",
      venueMarkets.reduce((sum, market) => sum + Number(market.alerts?.length || 0), 0)
    ),
  ].join("");

  renderAlerts(
    (dashboard.alerts || []).filter((alert) => alert.platform.toLowerCase() === venue.label.toLowerCase())
  );
  renderBoard(venueGroups, venue, venueStatus);
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

function renderBoard(groups, venue, venueStatus) {
  const header = `
    <div class="board-row board-header single-venue">
      <div class="market-col sticky-left">Market</div>
      <div class="meta-col">Sport</div>
      <div class="meta-col">Alerts</div>
      <div class="venue-col">
        <div class="venue-head">${venue.label}</div>
        <div class="venue-subhead">YES | Bid/Ask | Spr | Liq | 24h Vol</div>
      </div>
    </div>
  `;

  const body = groups.length
    ? groups.map((group) => renderGroupRow(group)).join("")
    : `<div class="empty-card">No ${escapeHtml(venue.label)} markets matched the current filters${state.selectedSport ? ` for ${escapeHtml(state.selectedSport)}` : ""}${venueStatus.mode === "error" ? `. Source error: ${escapeHtml(venueStatus.error || "unknown")}` : ""}.</div>`;

  traderBoardEl.innerHTML = header + body;

  for (const button of traderBoardEl.querySelectorAll(".group-row-button")) {
    button.addEventListener("click", () => {
      const groupId = button.dataset.groupId;
      if (!groupId) return;

      if (state.expandedGroupIds.includes(groupId)) {
        state.expandedGroupIds = state.expandedGroupIds.filter((id) => id !== groupId);
      } else {
        state.expandedGroupIds = [...state.expandedGroupIds, groupId];
      }

      renderDashboard();
    });
  }

  for (const button of traderBoardEl.querySelectorAll(".board-row-button")) {
    button.addEventListener("click", () => {
      state.selectedMarketId = button.dataset.marketId;
      renderDashboard();
    });
  }
}

function renderGroupRow(group) {
  const expanded = state.expandedGroupIds.includes(group.id);
  const firstMarket = group.markets[0];
  const categoryText = [
    group.sport || "--",
    `${group.markets.length} selection${group.markets.length === 1 ? "" : "s"}`,
  ].join(" | ");

  return `
    <div class="board-group">
      <div class="board-row single-venue group-row ${expanded ? "expanded" : ""}">
        <button type="button" class="group-row-button market-col sticky-left" data-group-id="${escapeHtml(group.id)}">
          <strong>${expanded ? "▾" : "▸"} ${escapeHtml(group.title)}</strong>
          <small>${escapeHtml(categoryText)}</small>
          <small>${group.alertCount ? `${group.alertCount} alert${group.alertCount === 1 ? "" : "s"}` : "Click to expand"}</small>
        </button>
        <div class="meta-col">${escapeHtml(group.sport || "--")}</div>
        <div class="meta-col">${group.alertCount || "--"}</div>
        <button type="button" class="group-row-button venue-col" data-group-id="${escapeHtml(group.id)}">
          <strong>${escapeHtml(formatCurrency(group.totalLiquidityUsd))}</strong>
          <span class="bidask">${escapeHtml(formatCompactNumber(group.markets.length))} selections</span>
          <span class="metric-inline">Top ${escapeHtml(firstMarket.category || "--")}</span>
          <span class="metric-inline">Vol ${escapeHtml(formatCurrency(group.totalVolume24hUsd))}</span>
        </button>
      </div>
      ${expanded ? group.markets.map((market) => renderBoardRow(market)).join("") : ""}
    </div>
  `;
}

function renderBoardRow(market) {
  const selected = market.id === state.selectedMarketId ? "selected" : "";
  const categoryText = market.category && market.sport ? `${market.category} | ${market.sport}` : market.category || market.sport || "--";

  return `
    <div class="board-row single-venue child-row ${selected}">
      <button type="button" class="board-row-button market-col sticky-left" data-market-id="${escapeHtml(market.id)}">
        <strong>${escapeHtml(market.title)}</strong>
        <small>${escapeHtml(categoryText)}</small>
        <small>${market.alerts?.length ? `${market.alerts.length} alert${market.alerts.length === 1 ? "" : "s"}` : "No alerts"}</small>
      </button>
      <div class="meta-col">${escapeHtml(market.sport || "--")}</div>
      <div class="meta-col">${market.alerts?.length || "--"}</div>
      <button type="button" class="board-row-button venue-col ${selected ? "venue-selected" : ""}" data-market-id="${escapeHtml(market.id)}">
        <strong>${escapeHtml(formatPercent(market.yesPrice))}</strong>
        <span class="bidask">${escapeHtml(formatPercent(market.topBid?.price))} / ${escapeHtml(formatPercent(market.topAsk?.price))}</span>
        <span class="metric-inline">Spr ${escapeHtml(formatSpread(market.spread))}</span>
        <span class="metric-inline">Liq ${escapeHtml(formatCurrency(market.liquidityUsd))}</span>
        <span class="metric-inline">Vol ${escapeHtml(formatCurrency(market.volume24hUsd))}</span>
      </button>
    </div>
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
