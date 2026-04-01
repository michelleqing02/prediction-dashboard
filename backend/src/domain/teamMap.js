const TEAM_ALIASES = {
  "las vegas aces": "Las Vegas Aces",
  aces: "Las Vegas Aces",
  "new york liberty": "New York Liberty",
  liberty: "New York Liberty",
  "connecticut sun": "Connecticut Sun",
  sun: "Connecticut Sun",
  "seattle storm": "Seattle Storm",
  storm: "Seattle Storm",
  "phoenix mercury": "Phoenix Mercury",
  mercury: "Phoenix Mercury",
  "minnesota lynx": "Minnesota Lynx",
  lynx: "Minnesota Lynx",
  "indiana fever": "Indiana Fever",
  fever: "Indiana Fever",
  "chicago sky": "Chicago Sky",
  sky: "Chicago Sky",
  "atlanta dream": "Atlanta Dream",
  dream: "Atlanta Dream",
  "dallas wings": "Dallas Wings",
  wings: "Dallas Wings",
  "washington mystics": "Washington Mystics",
  mystics: "Washington Mystics",
  "los angeles sparks": "Los Angeles Sparks",
  "la sparks": "Los Angeles Sparks",
};

function canonicalTeamName(name) {
  if (!name) return "Unknown Team";
  const key = String(name).trim().toLowerCase();
  return TEAM_ALIASES[key] || name;
}

module.exports = {
  canonicalTeamName,
};
