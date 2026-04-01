function isoMinutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function buildBookPayload(book, offset = 0) {
  return {
    sportsbook: book,
    pulledAt: new Date().toISOString(),
    games: [
      {
        externalId: `${book}-lv-ny`,
        homeTeam: "New York Liberty",
        awayTeam: "Las Vegas Aces",
        startsAt: isoMinutesFromNow(35),
        markets: [
          {
            type: "moneyline",
            selections: [
              { label: "Las Vegas Aces", odds: +140 + offset, side: "away" },
              { label: "New York Liberty", odds: -158 - offset, side: "home" },
            ],
          },
          {
            type: "spread",
            selections: [
              { label: "Las Vegas Aces", line: +3.5, odds: -108 + offset, side: "away" },
              { label: "New York Liberty", line: -3.5, odds: -112 - offset, side: "home" },
            ],
          },
          {
            type: "total",
            selections: [
              { label: "Over", line: 167.5, odds: -110, side: "over" },
              { label: "Under", line: 167.5, odds: -110, side: "under" },
            ],
          },
          {
            type: "player_prop",
            player: "A'ja Wilson",
            stat: "Points",
            selections: [
              { label: "Over", line: 24.5, odds: -115 + offset, side: "over" },
              { label: "Under", line: 24.5, odds: -105 - offset, side: "under" },
            ],
          },
        ],
      },
      {
        externalId: `${book}-ind-con`,
        homeTeam: "Connecticut Sun",
        awayTeam: "Indiana Fever",
        startsAt: isoMinutesFromNow(110),
        markets: [
          {
            type: "moneyline",
            selections: [
              { label: "Indiana Fever", odds: +122 + offset, side: "away" },
              { label: "Connecticut Sun", odds: -138 - offset, side: "home" },
            ],
          },
          {
            type: "spread",
            selections: [
              { label: "Indiana Fever", line: +2.5, odds: -109, side: "away" },
              { label: "Connecticut Sun", line: -2.5, odds: -111, side: "home" },
            ],
          },
          {
            type: "total",
            selections: [
              { label: "Over", line: 162.5, odds: -108, side: "over" },
              { label: "Under", line: 162.5, odds: -112, side: "under" },
            ],
          },
          {
            type: "player_prop",
            player: "Caitlin Clark",
            stat: "Assists",
            selections: [
              { label: "Over", line: 8.5, odds: +104 + offset, side: "over" },
              { label: "Under", line: 8.5, odds: -120 - offset, side: "under" },
            ],
          },
        ],
      },
    ],
  };
}

module.exports = {
  buildBookPayload,
};
