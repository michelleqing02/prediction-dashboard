const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { TEAM_METADATA } = require("./wnbaWorkbookService");

const DEFAULT_RESULTS_WORKBOOK_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "data-vscoderesultsWNBA.xlsx"
);
const STORE_PATH = path.join(__dirname, "..", "..", "data", "wnba-results-tracker-store.json");
const SHEET_NAME = "2026 Results";

const COL = {
  date: 0,
  home: 1,
  away: 2,
  myTotal: 3,
  closingTotal: 4,
  mySpread: 5,
  closingSpread: 6,
  injury: 7,
  actualTotal: 12,
  actualSpread: 13,
};

function asNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function excelDateToDateString(value) {
  const numeric = asNumber(value);
  if (!numeric) return "";
  const epoch = Date.UTC(1899, 11, 30);
  const millis = epoch + numeric * 24 * 60 * 60 * 1000;
  return new Date(millis).toISOString().slice(0, 10);
}

function entryIdFromParts(date, homeTeamId, awayTeamId) {
  return [date || "no-date", homeTeamId || "no-home", awayTeamId || "no-away"].join("|");
}

function normalizeEntry(rawEntry, fallbackId = "") {
  const date = asText(rawEntry.date);
  const time = asText(rawEntry.time);
  const homeTeamId = asText(rawEntry.homeTeamId || rawEntry.home);
  const awayTeamId = asText(rawEntry.awayTeamId || rawEntry.away);
  const id = asText(rawEntry.id) || entryIdFromParts(date, homeTeamId, awayTeamId) || fallbackId;

  return {
    id,
    source: asText(rawEntry.source) || "saved",
    date,
    time,
    homeTeamId,
    awayTeamId,
    myTotal: asNumber(rawEntry.myTotal),
    closingTotal: asNumber(rawEntry.closingTotal),
    mySpread: asNumber(rawEntry.mySpread),
    closingSpread: asNumber(rawEntry.closingSpread),
    injury: asText(rawEntry.injury),
    actualTotal: asNumber(rawEntry.actualTotal),
    actualSpread: asNumber(rawEntry.actualSpread),
    updatedAt: asText(rawEntry.updatedAt) || new Date().toISOString(),
  };
}

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function loadSavedEntries() {
  ensureStoreDir();
  if (!fs.existsSync(STORE_PATH)) {
    return {
      entriesById: {},
      deletedEntryIds: [],
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    const entries = raw?.entriesById || {};
    return {
      entriesById: Object.fromEntries(
        Object.entries(entries).map(([entryId, entry]) => [entryId, normalizeEntry(entry, entryId)])
      ),
      deletedEntryIds: Array.isArray(raw?.deletedEntryIds) ? raw.deletedEntryIds.map(asText).filter(Boolean) : [],
    };
  } catch {
    return {
      entriesById: {},
      deletedEntryIds: [],
    };
  }
}

function persistSavedEntries({ entriesById, deletedEntryIds }) {
  ensureStoreDir();
  fs.writeFileSync(
    STORE_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        entriesById,
        deletedEntryIds,
      },
      null,
      2
    )
  );
}

function parseWorkbookEntries() {
  if (!fs.existsSync(DEFAULT_RESULTS_WORKBOOK_PATH)) {
    return [];
  }

  const workbook = XLSX.readFile(DEFAULT_RESULTS_WORKBOOK_PATH);
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const entries = [];

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const date = excelDateToDateString(row[COL.date]);
    const homeTeamId = asText(row[COL.home]);
    const awayTeamId = asText(row[COL.away]);
    if (!date || !homeTeamId || !awayTeamId) continue;

    entries.push(
      normalizeEntry(
        {
          id: entryIdFromParts(date, homeTeamId, awayTeamId),
          source: "workbook",
          date,
          homeTeamId,
          awayTeamId,
          myTotal: row[COL.myTotal],
          closingTotal: row[COL.closingTotal],
          mySpread: row[COL.mySpread],
          closingSpread: row[COL.closingSpread],
          injury: row[COL.injury],
          actualTotal: row[COL.actualTotal],
          actualSpread: row[COL.actualSpread],
        },
        `row-${rowIndex + 1}`
      )
    );
  }

  return entries;
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return null;
  return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length, 2);
}

function enrichEntry(entry) {
  const closingTotalDiff =
    entry.closingTotal != null && entry.myTotal != null ? round(entry.closingTotal - entry.myTotal, 2) : null;
  const actualTotalDiff =
    entry.actualTotal != null && entry.myTotal != null ? round(entry.actualTotal - entry.myTotal, 2) : null;
  const closingSpreadDiff =
    entry.closingSpread != null && entry.mySpread != null
      ? round(entry.closingSpread - entry.mySpread, 2)
      : null;
  const actualSpreadDiff =
    entry.actualSpread != null && entry.mySpread != null ? round(entry.actualSpread - entry.mySpread, 2) : null;

  return {
    ...entry,
    closingTotalDiff,
    actualTotalDiff,
    closingSpreadDiff,
    actualSpreadDiff,
  };
}

function teamAdjustedSpreadDiff(entry, teamId, actual = false) {
  const targetSpread = actual ? entry.actualSpread : entry.closingSpread;
  if (entry.mySpread == null || targetSpread == null) return null;
  if (teamId === entry.homeTeamId) {
    return round(entry.mySpread - targetSpread, 2);
  }
  if (teamId === entry.awayTeamId) {
    return round(targetSpread - entry.mySpread, 2);
  }
  return null;
}

function buildTeamTrendRows(entries) {
  return Object.entries(TEAM_METADATA)
    .map(([teamId, metadata]) => {
      const teamEntries = entries.filter(
        (entry) => entry.homeTeamId === teamId || entry.awayTeamId === teamId
      );

      const spreadCloseAll = [];
      const spreadActualAll = [];
      const totalCloseAll = [];
      const totalActualAll = [];

      const homeFavoriteClose = [];
      const homeFavoriteActual = [];
      const awayFavoriteClose = [];
      const awayFavoriteActual = [];
      const homeDogClose = [];
      const homeDogActual = [];
      const awayDogClose = [];
      const awayDogActual = [];

      for (const entry of teamEntries) {
        const closeSpreadDiff = teamAdjustedSpreadDiff(entry, teamId, false);
        const actualSpreadDiff = teamAdjustedSpreadDiff(entry, teamId, true);
        if (closeSpreadDiff != null) spreadCloseAll.push(closeSpreadDiff);
        if (actualSpreadDiff != null) spreadActualAll.push(actualSpreadDiff);
        if (entry.closingTotalDiff != null) totalCloseAll.push(entry.closingTotalDiff);
        if (entry.actualTotalDiff != null) totalActualAll.push(entry.actualTotalDiff);

        if (teamId === entry.homeTeamId && entry.mySpread != null) {
          if (entry.mySpread < 0) {
            if (closeSpreadDiff != null) homeFavoriteClose.push(closeSpreadDiff);
            if (actualSpreadDiff != null) homeFavoriteActual.push(actualSpreadDiff);
          } else if (entry.mySpread > 0) {
            if (closeSpreadDiff != null) homeDogClose.push(closeSpreadDiff);
            if (actualSpreadDiff != null) homeDogActual.push(actualSpreadDiff);
          }
        }

        if (teamId === entry.awayTeamId && entry.mySpread != null) {
          if (entry.mySpread > 0) {
            if (closeSpreadDiff != null) awayFavoriteClose.push(closeSpreadDiff);
            if (actualSpreadDiff != null) awayFavoriteActual.push(actualSpreadDiff);
          } else if (entry.mySpread < 0) {
            if (closeSpreadDiff != null) awayDogClose.push(closeSpreadDiff);
            if (actualSpreadDiff != null) awayDogActual.push(actualSpreadDiff);
          }
        }
      }

      return {
        teamId,
        displayName: metadata.displayName,
        shortName: metadata.shortName,
        gamesTracked: teamEntries.length,
        agSpreadClosing: average(spreadCloseAll),
        ahSpreadActual: average(spreadActualAll),
        aiTotalClosing: average(totalCloseAll),
        ajTotalActual: average(totalActualAll),
        splits: {
          homeFavoriteClose: average(homeFavoriteClose),
          homeFavoriteActual: average(homeFavoriteActual),
          awayFavoriteClose: average(awayFavoriteClose),
          awayFavoriteActual: average(awayFavoriteActual),
          homeDogClose: average(homeDogClose),
          homeDogActual: average(homeDogActual),
          awayDogClose: average(awayDogClose),
          awayDogActual: average(awayDogActual),
        },
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function loadResultsTracker() {
  const workbookEntries = parseWorkbookEntries();
  const { entriesById: savedEntriesById, deletedEntryIds } = loadSavedEntries();
  const deletedIds = new Set(deletedEntryIds);
  const mergedEntriesById = Object.fromEntries(workbookEntries.map((entry) => [entry.id, entry]));

  for (const [entryId, savedEntry] of Object.entries(savedEntriesById)) {
    mergedEntriesById[entryId] = normalizeEntry(
      {
        ...mergedEntriesById[entryId],
        ...savedEntry,
      },
      entryId
    );
  }

  const entries = Object.values(mergedEntriesById)
    .filter((entry) => !deletedIds.has(entry.id))
    .map(enrichEntry)
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      return left.homeTeamId.localeCompare(right.homeTeamId) || left.awayTeamId.localeCompare(right.awayTeamId);
    });

  return {
    generatedAt: new Date().toISOString(),
    workbookPath: DEFAULT_RESULTS_WORKBOOK_PATH,
    entries,
    teamTrends: buildTeamTrendRows(entries),
  };
}

function saveResultsTrackerEntry(rawEntry) {
  if (rawEntry && (rawEntry.deleteEntryId || rawEntry.action === "delete")) {
    return deleteResultsTrackerEntry(rawEntry.deleteEntryId || rawEntry.id);
  }

  const entry = normalizeEntry(rawEntry);
  if (!entry.date || !entry.homeTeamId || !entry.awayTeamId) {
    throw new Error("Date, homeTeamId, and awayTeamId are required");
  }

  const { entriesById: savedEntriesById, deletedEntryIds } = loadSavedEntries();
  savedEntriesById[entry.id] = {
    ...entry,
    updatedAt: new Date().toISOString(),
  };
  persistSavedEntries({
    entriesById: savedEntriesById,
    deletedEntryIds: deletedEntryIds.filter((entryId) => entryId !== entry.id),
  });
  return loadResultsTracker();
}

function deleteResultsTrackerEntry(entryId) {
  const normalizedId = asText(entryId);
  if (!normalizedId) {
    throw new Error("Entry id is required");
  }

  const { entriesById: savedEntriesById, deletedEntryIds } = loadSavedEntries();
  delete savedEntriesById[normalizedId];

  const nextDeletedEntryIds = Array.from(new Set([...deletedEntryIds, normalizedId]));
  persistSavedEntries({
    entriesById: savedEntriesById,
    deletedEntryIds: nextDeletedEntryIds,
  });

  return loadResultsTracker();
}

module.exports = {
  loadResultsTracker,
  saveResultsTrackerEntry,
  deleteResultsTrackerEntry,
  entryIdFromParts,
};
