const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const DEFAULT_WORKBOOK_PATH = path.join(__dirname, "..", "..", "..", "data-vscodeWNBA.xlsx");
const RESULTS_TRACKER_STORE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "data",
  "wnba-results-tracker-store.json"
);
const PRESEASON_RESULTS_CUTOFF = "2026-05-08";
const PACE_CALIBRATION = {
  currentWeight: 0.7,
  priorWeight: 0.2,
  playerProxyWeight: 0.1,
  globalTrim: -0.28,
  usageWeight: 0.18,
  selfCreationWeight: 6,
  creationWeight: 0.22,
  closeDiffScale: -0.05,
  closeDiffCap: 0.75,
  actualDiffScale: 0.006,
  actualDiffCap: 0.2,
  minPace: 76,
  maxPace: 82,
};

const TEAM_NAME_TO_ID = {
  "ATLANTA DREAM": "ATL",
  "CHICAGO SKY": "CHI",
  "CONNECTICUT SUN": "CON",
  "INDIANA FEVER": "IND",
  "NEW YORK LIBERTY": "NYL",
  "WASHINGTON MYSTICS": "WAS",
  "DALLAS WINGS": "DAL",
  "GOLDEN STATE VALKYRIES": "GSV",
  "LAS VEGAS ACES": "LVA",
  "LOS ANGELES SPARKS": "LAS",
  "MINNESOTA LYNX": "MIN",
  "PHOENIX MERCURY": "PHX",
  "SEATTLE STORM": "SEA",
  "Toronto Tempo": "TOR",
  "Portland Fire": "POR",
};

const TEAM_ID_TO_NAME = Object.fromEntries(
  Object.entries(TEAM_NAME_TO_ID).map(([name, id]) => [id, name])
);

const TEAM_METADATA = {
  ATL: { displayName: "Atlanta Dream", shortName: "Dream", conference: "Eastern" },
  CHI: { displayName: "Chicago Sky", shortName: "Sky", conference: "Eastern" },
  CON: { displayName: "Connecticut Sun", shortName: "Sun", conference: "Eastern" },
  DAL: { displayName: "Dallas Wings", shortName: "Wings", conference: "Western" },
  GSV: { displayName: "Golden State Valkyries", shortName: "Valkyries", conference: "Western" },
  IND: { displayName: "Indiana Fever", shortName: "Fever", conference: "Eastern" },
  LAS: { displayName: "Los Angeles Sparks", shortName: "Sparks", conference: "Western" },
  LVA: { displayName: "Las Vegas Aces", shortName: "Aces", conference: "Western" },
  MIN: { displayName: "Minnesota Lynx", shortName: "Lynx", conference: "Western" },
  NYL: { displayName: "New York Liberty", shortName: "Liberty", conference: "Eastern" },
  PHX: { displayName: "Phoenix Mercury", shortName: "Mercury", conference: "Western" },
  POR: { displayName: "Portland Fire", shortName: "Fire", conference: "Western" },
  SEA: { displayName: "Seattle Storm", shortName: "Storm", conference: "Western" },
  TOR: { displayName: "Toronto Tempo", shortName: "Tempo", conference: "Eastern" },
  WAS: { displayName: "Washington Mystics", shortName: "Mystics", conference: "Eastern" },
};

const UPDATED_SUMMARY_START_COL = 20;
const PRIOR_SUMMARY_START_COL = 0;

let cachedModel = null;
let cachedMtimeMs = 0;
let cachedTrackerMtimeMs = 0;

function asNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function excelDateToIso(value) {
  const numeric = asNumber(value);
  if (!numeric) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const millis = epoch + numeric * 24 * 60 * 60 * 1000;
  return new Date(millis).toISOString();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function computeRosterAggregate(players) {
  const activePlayers = players.filter((player) => player.active !== false);
  const totalMinutes = activePlayers.reduce((sum, player) => sum + (player.projectedMinutes || 0), 0);
  const weightedAverage = (key) => {
    if (!totalMinutes) return 0;
    const weighted = activePlayers.reduce((sum, player) => {
      const value = player[key];
      if (value == null) return sum;
      return sum + value * (player.projectedMinutes || 0);
    }, 0);
    return weighted / totalMinutes;
  };

  const teamPointsValue = activePlayers.reduce((sum, player) => sum + (player.teamPointsValue || 0), 0);
  const normalizedTalent = totalMinutes > 0 ? teamPointsValue * (200 / totalMinutes) : 0;
  const starImpact = activePlayers
    .map((player) => player.teamPointsValue || 0)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((sum, value) => sum + value, 0);

  return {
    activeCount: activePlayers.length,
    totalMinutes: round(totalMinutes, 1),
    teamPointsValue: round(teamPointsValue, 2),
    normalizedTalent: round(normalizedTalent, 2),
    starImpact: round(starImpact, 2),
    pointsCreated100: round(weightedAverage("pointsCreated100"), 2),
    selfCreationShare: round(weightedAverage("selfCreationShare"), 3),
    efficiencyGrade: round(weightedAverage("efficiencyGrade"), 2),
    creationGrade: round(weightedAverage("creationGrade"), 2),
    playmakingGrade: round(weightedAverage("playmakingGrade"), 2),
    portabilityGrade: round(weightedAverage("portabilityGrade"), 2),
    reboundingGrade: round(weightedAverage("reboundingGrade"), 2),
    defenseGrade: round(weightedAverage("defenseGrade"), 2),
    usageRate: round(weightedAverage("usageRate"), 2),
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function loadPreseasonTrackerSignals() {
  if (!fs.existsSync(RESULTS_TRACKER_STORE_PATH)) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(RESULTS_TRACKER_STORE_PATH, "utf8"));
  } catch (error) {
    return {};
  }

  const signalsByTeam = {};
  for (const entry of Object.values(parsed.entriesById || {})) {
    if (!entry?.date || entry.date >= PRESEASON_RESULTS_CUTOFF) continue;

    for (const teamId of [entry.homeTeamId, entry.awayTeamId]) {
      if (!teamId) continue;
      if (!signalsByTeam[teamId]) {
        signalsByTeam[teamId] = {
          closeDiffs: [],
          actualDiffs: [],
        };
      }

      if (asNumber(entry.myTotal) != null && asNumber(entry.closingTotal) != null) {
        signalsByTeam[teamId].closeDiffs.push(asNumber(entry.myTotal) - asNumber(entry.closingTotal));
      }

      if (asNumber(entry.myTotal) != null && asNumber(entry.actualTotal) != null) {
        signalsByTeam[teamId].actualDiffs.push(asNumber(entry.actualTotal) - asNumber(entry.myTotal));
      }
    }
  }

  return Object.fromEntries(
    Object.entries(signalsByTeam).map(([teamId, signal]) => [
      teamId,
      {
        closeDiffAvg: round(average(signal.closeDiffs), 2),
        actualDiffAvg: round(average(signal.actualDiffs), 2),
        closeSamples: signal.closeDiffs.length,
        actualSamples: signal.actualDiffs.length,
      },
    ])
  );
}

function applyPaceCalibration(teams) {
  if (!teams.length) return teams;

  const trackerSignals = loadPreseasonTrackerSignals();
  const leagueContext = {
    averagePace: average(teams.map((team) => team.summary.pace40 || 0)),
    averageUsage: average(teams.map((team) => team.aggregate.usageRate || 0)),
    averageSelfCreation: average(teams.map((team) => team.aggregate.selfCreationShare || 0)),
    averageCreation: average(teams.map((team) => team.aggregate.creationGrade || 0)),
  };

  return teams.map((team) => {
    const workbookPace40 = team.summary.pace40 || 0;
    const priorPace40 = team.priorSummary.pace40 || workbookPace40;
    const playerProxyPace =
      leagueContext.averagePace +
      PACE_CALIBRATION.usageWeight * ((team.aggregate.usageRate || 0) - leagueContext.averageUsage) +
      PACE_CALIBRATION.selfCreationWeight *
        ((team.aggregate.selfCreationShare || 0) - leagueContext.averageSelfCreation) +
      PACE_CALIBRATION.creationWeight *
        ((team.aggregate.creationGrade || 0) - leagueContext.averageCreation);

    const trackerSignal = trackerSignals[team.teamId] || {
      closeDiffAvg: 0,
      actualDiffAvg: 0,
      closeSamples: 0,
      actualSamples: 0,
    };

    const closeAdjustment = clamp(
      trackerSignal.closeDiffAvg * PACE_CALIBRATION.closeDiffScale,
      -PACE_CALIBRATION.closeDiffCap,
      PACE_CALIBRATION.closeDiffCap
    );
    const actualAdjustment = clamp(
      trackerSignal.actualDiffAvg * PACE_CALIBRATION.actualDiffScale,
      -PACE_CALIBRATION.actualDiffCap,
      PACE_CALIBRATION.actualDiffCap
    );

    const calibratedPace40 = clamp(
      PACE_CALIBRATION.currentWeight * workbookPace40 +
        PACE_CALIBRATION.priorWeight * priorPace40 +
        PACE_CALIBRATION.playerProxyWeight * playerProxyPace +
        PACE_CALIBRATION.globalTrim +
        closeAdjustment +
        actualAdjustment,
      PACE_CALIBRATION.minPace,
      PACE_CALIBRATION.maxPace
    );

    const adjustedSummary = {
      ...team.summary,
      pace40: round(calibratedPace40, 2),
      teamTotal: round((team.summary.oppp + team.summary.dppp) * calibratedPace40, 2),
    };

    return {
      ...team,
      summary: adjustedSummary,
      paceCalibration: {
        workbookPace40: round(workbookPace40, 2),
        priorPace40: round(priorPace40, 2),
        playerProxyPace: round(playerProxyPace, 2),
        globalTrim: PACE_CALIBRATION.globalTrim,
        closeDiffAvg: trackerSignal.closeDiffAvg,
        actualDiffAvg: trackerSignal.actualDiffAvg,
        closeSamples: trackerSignal.closeSamples,
        actualSamples: trackerSignal.actualSamples,
        closeAdjustment: round(closeAdjustment, 2),
        actualAdjustment: round(actualAdjustment, 2),
        finalPace40: round(calibratedPace40, 2),
      },
    };
  });
}

function parseSummaryTable(rows, startCol) {
  const teams = [];

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const teamId = asText(row[startCol]);
    if (!teamId) continue;
    if (teamId === "Avg") break;
    if (!TEAM_METADATA[teamId]) continue;

    teams.push({
      teamId,
      ...TEAM_METADATA[teamId],
      summary: {
        rating: asNumber(row[startCol + 1]) ?? 0,
        last15Rating: asNumber(row[startCol + 2]) ?? 0,
        totalsIp: asNumber(row[startCol + 3]) ?? 0,
        dppp: asNumber(row[startCol + 4]) ?? 0,
        last15Dppp: asNumber(row[startCol + 5]) ?? 0,
        oppp: asNumber(row[startCol + 6]) ?? 0,
        last15Oppp: asNumber(row[startCol + 7]) ?? 0,
        pace40: asNumber(row[startCol + 8]) ?? 0,
        playoffPace: asNumber(row[startCol + 9]) ?? 0,
        last15Pace: asNumber(row[startCol + 10]) ?? 0,
        teamTotal: asNumber(row[startCol + 11]) ?? 0,
        hca: asNumber(row[startCol + 12]) ?? 0,
        teamTotalWeight: asNumber(row[startCol + 13]) ?? 0,
        injuryFlag: asText(row[startCol + 14]) || "N",
        wRating: asNumber(row[startCol + 15]) ?? 0,
        injuredNotes: asText(row[startCol + 16]),
      },
    });
  }

  return teams;
}

function parsePlayerBlocks(rows) {
  const teams = [];
  const players = [];
  let currentTeamId = null;
  let currentCoach = "";

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const firstCell = asText(row[0]);
    if (!firstCell) continue;

    const mappedTeamId = TEAM_NAME_TO_ID[firstCell];
    if (mappedTeamId) {
      currentTeamId = mappedTeamId;
      currentCoach = "";
      teams.push({
        teamId: currentTeamId,
        ...TEAM_METADATA[currentTeamId],
        blockLabel: firstCell,
      });
      continue;
    }

    if (!currentTeamId) continue;

    if (firstCell.startsWith("Coach:")) {
      currentCoach = firstCell.replace("Coach:", "").trim();
      continue;
    }

    if (
      firstCell === "League Avg" ||
      firstCell === "TS%" ||
      firstCell === "Poss" ||
      firstCell === "Player Price = Production × Efficiency × Minutes × Role" ||
      firstCell === "Coach"
    ) {
      continue;
    }

    if (/^[A-Z ]+$/.test(firstCell) && TEAM_NAME_TO_ID[firstCell]) {
      continue;
    }

    const finalRating = asNumber(row[35]);
    const teamPointsValue = asNumber(row[36]);
    if (finalRating == null || teamPointsValue == null) continue;

    const playerId = `${currentTeamId}-${slugify(firstCell)}-${rowIndex}`;
    const projectedMinutes = asNumber(row[15]) ?? asNumber(row[18]) ?? 0;
    const roleAdj = asNumber(row[21]) ?? 1;
    const levelAdj = asNumber(row[22]) ?? 1;
    const defenseGrade = asNumber(row[19]) ?? 5;

    const player = {
      id: playerId,
      teamId: currentTeamId,
      teamName: TEAM_METADATA[currentTeamId].displayName,
      coach: currentCoach,
      name: firstCell,
      projectedMinutes: round(projectedMinutes, 1),
      defenseGrade: round(defenseGrade, 2),
      injuryRisk: asNumber(row[20]) ?? 0,
      roleAdj: round(roleAdj, 3),
      levelAdj: round(levelAdj || 1, 3),
      pointsCreated100: round(asNumber(row[23]) ?? 0, 2),
      selfCreationShare: round(asNumber(row[24]) ?? 0, 3),
      impactAnchorGrade: round(asNumber(row[25]) ?? 0, 2),
      efficiencyGrade: round(asNumber(row[26]) ?? 0, 2),
      creationGrade: round(asNumber(row[27]) ?? 0, 2),
      playmakingGrade: round(asNumber(row[28]) ?? 0, 2),
      portabilityGrade: round(asNumber(row[29]) ?? 0, 2),
      reboundingGrade: round(asNumber(row[30]) ?? 0, 2),
      defenseProxyGrade: round(asNumber(row[31]) ?? 0, 2),
      finalDefenseGrade: round(asNumber(row[32]) ?? defenseGrade, 2),
      availabilityGrade: round(asNumber(row[33]) ?? 0, 2),
      rawRating: round(asNumber(row[34]) ?? 0, 2),
      finalRating: round(finalRating, 2),
      teamPointsValue: round(teamPointsValue, 2),
      usageRate: round(asNumber(row[6]) ?? asNumber(row[11]) ?? 0, 2),
      trueShooting: round(asNumber(row[3]) ?? asNumber(row[1]) ?? 0, 4),
      effectiveFg: round(asNumber(row[4]) ?? asNumber(row[2]) ?? 0, 4),
      shotQuality: round(asNumber(row[5]) ?? 0, 3),
      ortg: round(asNumber(row[12]) ?? 0, 2),
      drtg: round(asNumber(row[13]) ?? 0, 2),
      bpm: round(asNumber(row[17]) ?? 0, 2),
      ws40: round(asNumber(row[14]) ?? 0, 3),
      active: true,
      sourceType: asNumber(row[1]) != null && asNumber(row[2]) != null ? "pro-or-blended" : "projection",
    };

    players.push(player);
  }

  return { teams, players };
}

function buildTeamModels(currentSummaryTeams, priorSummaryTeams, parsedPlayers) {
  const priorById = Object.fromEntries(priorSummaryTeams.map((team) => [team.teamId, team.summary]));
  const currentById = Object.fromEntries(currentSummaryTeams.map((team) => [team.teamId, team.summary]));
  const playersByTeam = parsedPlayers.reduce((accumulator, player) => {
    if (!accumulator[player.teamId]) accumulator[player.teamId] = [];
    accumulator[player.teamId].push(player);
    return accumulator;
  }, {});

  return currentSummaryTeams
    .map((team) => {
      const teamPlayers = (playersByTeam[team.teamId] || []).sort(
        (left, right) => right.teamPointsValue - left.teamPointsValue
      );
      const aggregate = computeRosterAggregate(teamPlayers);
      return {
        teamId: team.teamId,
        ...TEAM_METADATA[team.teamId],
        coach: teamPlayers[0]?.coach || "",
        summary: team.summary,
        priorSummary: priorById[team.teamId] || team.summary,
        aggregate,
        players: teamPlayers,
      };
    })
    .sort((left, right) => right.summary.wRating - left.summary.wRating);
}

function loadWorkbookModel() {
  const workbookPath = DEFAULT_WORKBOOK_PATH;
  const stat = fs.statSync(workbookPath);
  const trackerMtimeMs = fs.existsSync(RESULTS_TRACKER_STORE_PATH)
    ? fs.statSync(RESULTS_TRACKER_STORE_PATH).mtimeMs
    : 0;
  if (cachedModel && cachedMtimeMs === stat.mtimeMs && cachedTrackerMtimeMs === trackerMtimeMs) {
    return cachedModel;
  }

  const workbook = XLSX.readFile(workbookPath);
  const summaryRows = XLSX.utils.sheet_to_json(workbook.Sheets["2026"], { header: 1, defval: null });
  const ratingsRows = XLSX.utils.sheet_to_json(workbook.Sheets["2026 Team Ratings"], {
    header: 1,
    defval: null,
  });

  const currentSummaryTeams = parseSummaryTable(summaryRows, UPDATED_SUMMARY_START_COL);
  const priorSummaryTeams = parseSummaryTable(summaryRows, PRIOR_SUMMARY_START_COL);
  const { players } = parsePlayerBlocks(ratingsRows);
  const teams = applyPaceCalibration(buildTeamModels(currentSummaryTeams, priorSummaryTeams, players));

  const league = {
    generatedAt: new Date().toISOString(),
    workbookPath,
    workbookMtime: stat.mtime.toISOString(),
    workbookLastUpdateCell: excelDateToIso(summaryRows?.[0]?.[UPDATED_SUMMARY_START_COL + 1]),
    averages: {
      dppp: round(
        teams.reduce((sum, team) => sum + (team.summary.dppp || 0), 0) / Math.max(teams.length, 1),
        3
      ),
      oppp: round(
        teams.reduce((sum, team) => sum + (team.summary.oppp || 0), 0) / Math.max(teams.length, 1),
        3
      ),
      pace40: round(
        teams.reduce((sum, team) => sum + (team.summary.pace40 || 0), 0) / Math.max(teams.length, 1),
        2
      ),
      teamTotal: round(
        teams.reduce((sum, team) => sum + (team.summary.teamTotal || 0), 0) / Math.max(teams.length, 1),
        2
      ),
      wRating: round(
        teams.reduce((sum, team) => sum + (team.summary.wRating || 0), 0) / Math.max(teams.length, 1),
        2
      ),
    },
  };

  cachedModel = {
    league,
    teams,
    players: players.sort((left, right) => right.teamPointsValue - left.teamPointsValue),
  };
  cachedMtimeMs = stat.mtimeMs;
  cachedTrackerMtimeMs = trackerMtimeMs;
  return cachedModel;
}

module.exports = {
  loadWorkbookModel,
  computeRosterAggregate,
  TEAM_METADATA,
  TEAM_ID_TO_NAME,
};
