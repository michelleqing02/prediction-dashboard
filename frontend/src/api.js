export async function fetchGames() {
  const response = await fetch("/games");
  return response.json();
}

export async function fetchBooks() {
  const response = await fetch("/books");
  return response.json();
}

export async function fetchOdds({ gameId, sportsbook, marketType }) {
  const params = new URLSearchParams();
  params.set("game_id", gameId);
  if (sportsbook) params.set("sportsbook", sportsbook);
  if (marketType) params.set("marketType", marketType);
  const response = await fetch(`/odds?${params.toString()}`);
  return response.json();
}

export async function fetchPredictionMarkets({ platform, category, search }) {
  const params = new URLSearchParams();
  if (platform) params.set("platform", platform);
  if (category) params.set("category", category);
  if (search) params.set("search", search);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/prediction-markets${suffix}`);
  return response.json();
}
