const { OddsApiBookAdapter } = require("./oddsApiAdapter");
const { buildBookPayload } = require("./mockData");

class FanDuelAdapter extends OddsApiBookAdapter {
  constructor(config) {
    super({ sportsbook: "FanDuel", bookmakerKey: "fanduel", config });
  }

  mockPayload() {
    return buildBookPayload("FanDuel", 3);
  }
}

module.exports = FanDuelAdapter;
