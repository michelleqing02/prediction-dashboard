const { OddsApiBookAdapter } = require("./oddsApiAdapter");
const { buildBookPayload } = require("./mockData");

class PinnacleAdapter extends OddsApiBookAdapter {
  constructor(config) {
    super({ sportsbook: "Pinnacle", bookmakerKey: "pinnacle", config });
  }

  mockPayload() {
    return buildBookPayload("Pinnacle", 5);
  }
}

module.exports = PinnacleAdapter;
