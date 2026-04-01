const { OddsApiBookAdapter } = require("./oddsApiAdapter");
const { buildBookPayload } = require("./mockData");

class DraftKingsAdapter extends OddsApiBookAdapter {
  constructor(config) {
    super({ sportsbook: "DraftKings", bookmakerKey: "draftkings", config });
  }

  mockPayload() {
    return buildBookPayload("DraftKings", 0);
  }
}

module.exports = DraftKingsAdapter;
