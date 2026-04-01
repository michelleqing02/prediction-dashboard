const { OddsApiBookAdapter } = require("./oddsApiAdapter");
const { buildBookPayload } = require("./mockData");

class BookmakerAdapter extends OddsApiBookAdapter {
  constructor(config) {
    super({ sportsbook: "Bookmaker", bookmakerKey: "unsupported", config });
  }

  mockPayload() {
    return buildBookPayload("Bookmaker", -4);
  }
}

module.exports = BookmakerAdapter;
