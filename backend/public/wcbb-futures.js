const summaryCardsEl = document.getElementById("summaryCards");
const notesListEl = document.getElementById("notesList");
const marketsEl = document.getElementById("markets");
const availabilityBadgeEl = document.getElementById("availabilityBadge");
const dataWindowEl = document.getElementById("dataWindow");
const searchInputEl = document.getElementById("searchInput");
const competitionFilterEl = document.getElementById("competitionFilter");
const sortSelectEl = document.getElementById("sortSelect");
const resultsTitleEl = document.getElementById("resultsTitle");

const state = {
  payload: null,
  search: "",
  competition: "all",
  sort: "handle_desc",
};

loadDashboard();

async function loadDashboard() {
  try {
    const payload = await fetch("/api/wcbb-futures").then(assertJson);
    state.payload = payload;
    hydrateControls(payload.meta.competitions || []);
    renderSummary(payload.meta, payload.summary);
    renderNotes(payload.meta);
    renderMarkets();
  } catch (error) {
    availabilityBadgeEl.textContent = "Dashboard data unavailable";
    marketsEl.innerHTML = `<div class="empty-state">${escapeHtml(String(error.message || error))}</div>`;
  }
}

function assertJson(response) {
  if (!response.ok) {
    return response.json().then((body) => {
      throw new Error(body.detail || body.error || `Request failed with ${response.status}`);
    });
  }

  return response.json();
}

function hydrateControls(competitions) {
  competitionFilterEl.innerHTML = [
    `<option value="all">All competitions</option>`,
    ...competitions.map((competition) => `<option value="${escapeHtml(competition)}">${escapeHtml(competition)}</option>`),
  ].join("");

  searchInputEl.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderMarkets();
  });

  competitionFilterEl.addEventListener("change", (event) => {
    state.competition = event.target.value;
    renderMarkets();
  });

  sortSelectEl.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderMarkets();
  });
}

function renderSummary(meta, summary) {
  const cards = [
    { label: "Season", value: meta.seasonLabel },
    { label: "Markets", value: formatInteger(meta.marketCount) },
    { label: "Total Handle", value: formatCurrency(summary.totalHandle) },
    { label: "Straight Liability", value: formatCurrency(summary.totalPotentialLiability) },
    { label: "Open Handle", value: formatCurrency(summary.totalOpenHandle) },
    { label: "Current GGR", value: formatCurrency(summary.totalGrossGamingRevenue) },
    { label: "Settled GGR", value: formatCurrency(summary.totalSettledGgr) },
    { label: "Weighted Margin", value: formatPercent(summary.weightedMargin) },
    { label: "Tickets", value: formatInteger(summary.totalTickets) },
    { label: "Open Tickets", value: formatInteger(summary.totalOpenTickets) },
    {
      label: "Top Handle Market",
      value: summary.topHandleMarket ? summary.topHandleMarket.marketName : "--",
      subtle: summary.topHandleMarket ? summary.topHandleMarket.eventName : "",
    },
    {
      label: "Top Liability Market",
      value: summary.topLiabilityMarket ? summary.topLiabilityMarket.marketName : "--",
      subtle: summary.topLiabilityMarket ? summary.topLiabilityMarket.eventName : "",
    },
    { label: "Aggregate Refreshed", value: formatDateTime(meta.aggregatedAt) },
  ];

  summaryCardsEl.innerHTML = cards
    .map(
      (card) => `
      <article class="meta-card">
        <div class="label">${escapeHtml(card.label)}</div>
        <div class="value">${escapeHtml(card.value)}</div>
        ${card.subtle ? `<div class="subtle">${escapeHtml(card.subtle)}</div>` : ""}
      </article>
    `
    )
    .join("");

  availabilityBadgeEl.textContent = `${formatInteger(meta.marketCount)} season markets loaded`;
  dataWindowEl.innerHTML = `
    <span class="data-pill">First Bet ${escapeHtml(meta.firstBetDate || "--")}</span>
    <span class="data-pill">Last Bet ${escapeHtml(meta.lastBetDate || "--")}</span>
    <span class="data-pill">Source ${escapeHtml(meta.sourceTable)}</span>
  `;
}

function renderNotes(meta) {
  notesListEl.innerHTML = (meta.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

function renderMarkets() {
  const payload = state.payload;
  if (!payload) return;

  const filteredMarkets = payload.markets
    .filter((market) => {
      if (state.competition !== "all" && market.competitionName !== state.competition) {
        return false;
      }

      if (!state.search) return true;

      const haystack = [
        market.competitionName,
        market.eventName,
        market.marketName,
        ...market.selections.map((row) => row.selectionName),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(state.search);
    })
    .sort(sortMarkets);

  resultsTitleEl.textContent = `${formatInteger(filteredMarkets.length)} markets`;

  if (!filteredMarkets.length) {
    marketsEl.innerHTML = '<div class="empty-state">No season markets match the current filters.</div>';
    return;
  }

  marketsEl.innerHTML = filteredMarkets.map(renderMarketCard).join("");
}

function sortMarkets(left, right) {
  switch (state.sort) {
    case "liability_desc":
      return right.potentialLiability - left.potentialLiability;
    case "payout_desc":
      return right.potentialPayout - left.potentialPayout;
    case "ggr_desc":
      return right.grossGamingRevenue - left.grossGamingRevenue;
    case "tickets_desc":
      return right.ticketCount - left.ticketCount;
    case "recent_desc":
      return String(right.lastBetDate).localeCompare(String(left.lastBetDate));
    case "handle_desc":
    default:
      return right.handle - left.handle;
  }
}

function renderMarketCard(market) {
  const selectionRows = market.selections || [];

  return `
    <details class="market-card">
      <summary class="market-summary">
        <div class="market-main">
          <span class="competition-pill">${escapeHtml(market.competitionName)}</span>
          <h3>${escapeHtml(market.marketName)}</h3>
          <p>${escapeHtml(market.eventName)}</p>
        </div>
        <div class="market-metrics">
          ${renderMetric("Handle", formatCurrency(market.handle))}
          ${renderMetric("Straight Liability", formatCurrency(market.straightPotentialLiability))}
          ${renderMetric("Open Handle", formatCurrency(market.openHandle))}
          ${renderMetric("Current GGR", formatCurrency(market.grossGamingRevenue), market.grossGamingRevenue >= 0 ? "positive" : "negative")}
          ${renderMetric("Margin", formatPercent(market.margin))}
          ${renderMetric("Avg Price", formatDecimal(market.weightedAvgPrice))}
          ${renderMetric("Open", formatInteger(market.openTicketCount))}
        </div>
      </summary>
      <div class="market-detail">
        <div class="detail-grid">
          ${renderDetail("Handle Share", formatPercent(market.handleShare))}
          ${renderDetail("Avg Ticket", formatCurrency(market.avgTicketSize))}
          ${renderDetail("Straight Handle", formatCurrency(market.straightHandle))}
          ${renderDetail("Straight Payout", formatCurrency(market.straightPotentialPayout))}
          ${renderDetail("Proxy Liability", formatCurrency(market.potentialLiability))}
          ${renderDetail("Settled GGR", formatCurrency(market.settledGgr))}
          ${renderDetail("Actual Winnings", formatCurrency(market.actualWinnings))}
          ${renderDetail("Approx Bettors", formatInteger(market.bettorCount))}
          ${renderDetail("Singles", formatInteger(market.singleTicketCount))}
          ${renderDetail("Parlays", formatInteger(market.parlayTicketCount))}
          ${renderDetail("First Bet", escapeHtml(market.firstBetDate || "--"))}
          ${renderDetail("Last Bet", escapeHtml(market.lastBetDate || "--"))}
          ${renderDetail("Selections", formatInteger(market.selectionCount))}
        </div>
        <div class="state-section">
          <div class="state-header">
            <p class="eyebrow">Selection Breakout</p>
            <span>${formatInteger(market.selectionCount)} selections</span>
          </div>
          ${
            selectionRows.length
              ? `
                <div class="state-table">
                  <div class="state-table-head">
                    <span>Selection</span>
                    <span>Handle</span>
                    <span>Straight Liab</span>
                    <span>Avg Price</span>
                    <span>Tickets</span>
                    <span>Open</span>
                  </div>
                  ${selectionRows.map(renderSelectionRow).join("")}
                </div>
              `
              : '<div class="empty-state compact">No selection rows surfaced for this market.</div>'
          }
        </div>
      </div>
    </details>
  `;
}

function renderMetric(label, value, tone = "") {
  return `
    <div class="metric-block ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderDetail(label, value) {
  return `
    <div class="detail-card">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderSelectionRow(row) {
  return `
    <div class="state-table-row">
      <span>${escapeHtml(row.selectionName)}</span>
      <span>${formatCurrency(row.handle)}</span>
      <span>${formatCurrency(row.straightPotentialLiability)}</span>
      <span>${formatDecimal(row.weightedAvgPrice)}</span>
      <span>${formatInteger(row.ticketCount)}</span>
      <span>${formatInteger(row.openTicketCount)}</span>
    </div>
  `;
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

function formatDecimal(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "--";
  return `${number.toFixed(2)}x`;
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
