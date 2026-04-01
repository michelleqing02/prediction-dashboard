const gameSelect = document.getElementById("gameSelect");
const bookSelect = document.getElementById("bookSelect");
const marketSelect = document.getElementById("marketSelect");
const gamesGrid = document.getElementById("gamesGrid");
const marketsEl = document.getElementById("markets");
const updatedAtEl = document.getElementById("updatedAt");

let state = {
  games: [],
  books: [],
  selectedGameId: "",
};

gameSelect.addEventListener("change", () => {
  state.selectedGameId = gameSelect.value;
  renderGames();
  loadOdds();
});

bookSelect.addEventListener("change", loadOdds);
marketSelect.addEventListener("change", loadOdds);

async function init() {
  await loadMeta();
  await loadOdds();
  window.setInterval(async () => {
    await loadMeta();
    await loadOdds();
  }, 15000);
}

async function loadMeta() {
  const [gamesPayload, booksPayload] = await Promise.all([
    fetch("/games").then((response) => response.json()),
    fetch("/books").then((response) => response.json()),
  ]);

  state.games = gamesPayload.games || [];
  state.books = booksPayload.books || [];

  if (!state.selectedGameId && state.games.length) {
    state.selectedGameId = state.games[0].id;
  }

  renderBookOptions();
  renderGameOptions();
  renderGames();
  updatedAtEl.textContent = gamesPayload.lastUpdated
    ? new Date(gamesPayload.lastUpdated).toLocaleTimeString()
    : "--";
}

async function loadOdds() {
  if (!state.selectedGameId) {
    marketsEl.innerHTML = '<div class="empty-state">No games available.</div>';
    return;
  }

  const params = new URLSearchParams();
  params.set("game_id", state.selectedGameId);
  if (bookSelect.value) params.set("sportsbook", bookSelect.value);
  if (marketSelect.value) params.set("marketType", marketSelect.value);

  const payload = await fetch(`/odds?${params.toString()}`).then((response) => response.json());
  updatedAtEl.textContent = payload.lastUpdated
    ? new Date(payload.lastUpdated).toLocaleTimeString()
    : "--";
  renderMarkets(payload.markets || []);
}

function renderBookOptions() {
  const current = bookSelect.value;
  bookSelect.innerHTML = '<option value="">All books</option>';
  for (const book of state.books) {
    const option = document.createElement("option");
    option.value = book;
    option.textContent = book;
    if (book === current) option.selected = true;
    bookSelect.appendChild(option);
  }
}

function renderGameOptions() {
  gameSelect.innerHTML = "";
  for (const game of state.games) {
    const option = document.createElement("option");
    option.value = game.id;
    option.textContent = formatGameLabel(game);
    option.selected = game.id === state.selectedGameId;
    gameSelect.appendChild(option);
  }
}

function renderGames() {
  gamesGrid.innerHTML = "";
  for (const game of state.games) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = game.id === state.selectedGameId ? "game-card active" : "game-card";
    card.innerHTML = `
      <span class="game-time">${new Date(game.startsAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}</span>
      <strong>${escapeHtml(formatGameLabel(game))}</strong>
      <small>${game.marketCount} markets</small>
    `;
    card.addEventListener("click", () => {
      state.selectedGameId = game.id;
      gameSelect.value = game.id;
      renderGames();
      loadOdds();
    });
    gamesGrid.appendChild(card);
  }
}

function renderMarkets(markets) {
  marketsEl.innerHTML = "";
  if (!markets.length) {
    marketsEl.innerHTML = '<div class="empty-state">No markets match the current filters.</div>';
    return;
  }

  for (const market of markets) {
    const card = document.createElement("article");
    card.className = "market-card";

    const rows = market.quotes
      .map((quote) => {
        const isBest =
          market.bestQuote &&
          market.bestQuote.selectionKey === quote.selectionKey &&
          market.bestQuote.sportsbook === quote.sportsbook &&
          market.bestQuote.americanOdds === quote.americanOdds;

        return `
          <div class="${isBest ? "quote-row best" : "quote-row"}">
            <span>${escapeHtml(quote.sportsbook)}</span>
            <span>${escapeHtml(quote.label)}</span>
            <span>${quote.line ?? "--"}</span>
            <span>${formatAmerican(quote.americanOdds)}</span>
            <span>${quote.impliedProbability ? `${(quote.impliedProbability * 100).toFixed(1)}%` : "--"}</span>
          </div>
        `;
      })
      .join("");

    card.innerHTML = `
      <div class="market-header">
        <div>
          <p class="eyebrow">${escapeHtml(market.type.replace("_", " "))}</p>
          <h2>${escapeHtml(formatMarketTitle(market))}</h2>
        </div>
        <div class="market-metrics">
          <span>Hold ${market.holdPercent == null ? "--" : `${market.holdPercent.toFixed(2)}%`}</span>
          <span class="${market.arbitrage?.isArb ? "arb positive" : "arb"}">${market.arbitrage?.isArb ? "Arb candidate" : "No arb"}</span>
        </div>
      </div>
      <div class="quotes-table">
        <div class="quotes-head">
          <span>Book</span>
          <span>Selection</span>
          <span>Line</span>
          <span>Odds</span>
          <span>Implied</span>
        </div>
        ${rows}
      </div>
    `;

    marketsEl.appendChild(card);
  }
}

function formatAmerican(value) {
  if (value == null) return "--";
  return value > 0 ? `+${value}` : `${value}`;
}

function formatGameLabel(game) {
  if (game.awayTeam === "Outrights") {
    return game.homeTeam;
  }
  if (game.homeTeam === "Outrights") {
    return game.awayTeam;
  }
  return `${game.awayTeam} at ${game.homeTeam}`;
}

function formatMarketTitle(market) {
  if (market.type === "outright") {
    return market.stat || "Outright market";
  }
  if (market.player) {
    return `${market.player} ${market.stat}`;
  }
  return `${market.type} market`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
