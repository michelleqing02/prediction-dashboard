const { OddsApiBookAdapter } = require("./oddsApiAdapter");
const { buildBookPayload } = require("./mockData");

class BetOnlineAdapter extends OddsApiBookAdapter {
  constructor(config) {
    super({ sportsbook: "BetOnline", bookmakerKey: "betonlineag", config });
  }

  mockPayload() {
    return buildBookPayload("BetOnline", -2);
  }
}

module.exports = BetOnlineAdapter;
