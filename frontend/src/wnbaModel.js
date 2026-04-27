const TEAM_CALC = {
  pointsCreated100: 0.002,
  efficiencyGrade: 0.008,
  creationGrade: 0.006,
  playmakingGrade: 0.004,
  normalizedTalent: 0.003,
  defenseGrade: 0.006,
  reboundingGrade: 0.003,
  defensiveTalent: 0.002,
  usageRate: 0.16,
  selfCreationShare: 0.35,
  paceCreation: 0.1,
  netToPower: 0.8,
  paceToPower: 0.08,
  netToRating: 0.85,
};

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function weightedAverage(players, key, totalMinutes) {
  if (!totalMinutes) return 0;
  const weighted = players.reduce((sum, player) => {
    const value = player[key];
    if (value == null) return sum;
    return sum + value * (player.projectedMinutes || 0);
  }, 0);
  return weighted / totalMinutes;
}

export function computeRosterAggregate(players) {
  const activePlayers = players.filter((player) => player.active !== false);
  const totalMinutes = activePlayers.reduce((sum, player) => sum + (player.projectedMinutes || 0), 0);
  const teamPointsValue = activePlayers.reduce((sum, player) => sum + (player.teamPointsValue || 0), 0);
  const normalizedTalent = totalMinutes > 0 ? teamPointsValue * (200 / totalMinutes) : 0;
  const sortedByImpact = [...activePlayers]
    .sort((left, right) => (right.teamPointsValue || 0) - (left.teamPointsValue || 0));

  return {
    activeCount: activePlayers.length,
    totalMinutes: round(totalMinutes, 1),
    teamPointsValue: round(teamPointsValue, 2),
    normalizedTalent: round(normalizedTalent, 2),
    starImpact: round(
      sortedByImpact.slice(0, 3).reduce((sum, player) => sum + (player.teamPointsValue || 0), 0),
      2
    ),
    pointsCreated100: round(weightedAverage(activePlayers, "pointsCreated100", totalMinutes), 2),
    selfCreationShare: round(weightedAverage(activePlayers, "selfCreationShare", totalMinutes), 3),
    efficiencyGrade: round(weightedAverage(activePlayers, "efficiencyGrade", totalMinutes), 2),
    creationGrade: round(weightedAverage(activePlayers, "creationGrade", totalMinutes), 2),
    playmakingGrade: round(weightedAverage(activePlayers, "playmakingGrade", totalMinutes), 2),
    portabilityGrade: round(weightedAverage(activePlayers, "portabilityGrade", totalMinutes), 2),
    reboundingGrade: round(weightedAverage(activePlayers, "reboundingGrade", totalMinutes), 2),
    defenseGrade: round(weightedAverage(activePlayers, "defenseGrade", totalMinutes), 2),
    usageRate: round(weightedAverage(activePlayers, "usageRate", totalMinutes), 2),
  };
}

export function createInitialScenarioState(model) {
  return Object.fromEntries(
    model.teams.map((team) => [
      team.teamId,
      {
        teamId: team.teamId,
        players: team.players.map((player) => ({
          ...player,
          scenarioId: player.id,
          basePlayerId: player.id,
          added: false,
          active: true,
        })),
      },
    ])
  );
}

export function buildTeamSnapshot(team, scenarioTeam, teamOverride = {}) {
  const aggregate = computeRosterAggregate(scenarioTeam.players);
  const baseAggregate = team.aggregate;
  const baseSummary = team.summary;

  const delta = {
    pointsCreated100: aggregate.pointsCreated100 - baseAggregate.pointsCreated100,
    selfCreationShare: aggregate.selfCreationShare - baseAggregate.selfCreationShare,
    efficiencyGrade: aggregate.efficiencyGrade - baseAggregate.efficiencyGrade,
    creationGrade: aggregate.creationGrade - baseAggregate.creationGrade,
    playmakingGrade: aggregate.playmakingGrade - baseAggregate.playmakingGrade,
    reboundingGrade: aggregate.reboundingGrade - baseAggregate.reboundingGrade,
    defenseGrade: aggregate.defenseGrade - baseAggregate.defenseGrade,
    normalizedTalent: aggregate.normalizedTalent - baseAggregate.normalizedTalent,
    usageRate: aggregate.usageRate - baseAggregate.usageRate,
  };

  const adjustedOppp = clamp(
    baseSummary.oppp +
      TEAM_CALC.pointsCreated100 * delta.pointsCreated100 +
      TEAM_CALC.efficiencyGrade * delta.efficiencyGrade +
      TEAM_CALC.creationGrade * delta.creationGrade +
      TEAM_CALC.playmakingGrade * delta.playmakingGrade +
      TEAM_CALC.normalizedTalent * delta.normalizedTalent,
    0.94,
    1.14
  );

  const adjustedDppp = clamp(
    baseSummary.dppp -
      TEAM_CALC.defenseGrade * delta.defenseGrade -
      TEAM_CALC.reboundingGrade * delta.reboundingGrade -
      TEAM_CALC.defensiveTalent * delta.normalizedTalent,
    0.94,
    1.14
  );

  const adjustedPace = clamp(
    baseSummary.pace40 +
      TEAM_CALC.usageRate * delta.usageRate +
      TEAM_CALC.selfCreationShare * delta.selfCreationShare +
      TEAM_CALC.paceCreation * delta.creationGrade,
    76,
    82.5
  );

  const baseNet = (baseSummary.oppp - baseSummary.dppp) * 100;
  const adjustedNet = (adjustedOppp - adjustedDppp) * 100;
  const adjustedWRating =
    baseSummary.wRating +
    TEAM_CALC.netToPower * (adjustedNet - baseNet) +
    TEAM_CALC.paceToPower * (adjustedPace - baseSummary.pace40);

  let adjustedRating = clamp(
    baseSummary.rating - TEAM_CALC.netToRating * (adjustedWRating - baseSummary.wRating),
    -5,
    30
  );
  let adjustedOpppFinal = adjustedOppp;
  let adjustedDpppFinal = adjustedDppp;
  let adjustedPaceFinal = adjustedPace;
  let adjustedWRatingFinal = adjustedWRating;
  let adjustedHcaFinal = baseSummary.hca || 0;

  if (Number.isFinite(teamOverride.oppp)) adjustedOpppFinal = teamOverride.oppp;
  if (Number.isFinite(teamOverride.dppp)) adjustedDpppFinal = teamOverride.dppp;
  if (Number.isFinite(teamOverride.pace40)) adjustedPaceFinal = teamOverride.pace40;
  if (Number.isFinite(teamOverride.wRating)) adjustedWRatingFinal = teamOverride.wRating;
  if (Number.isFinite(teamOverride.rating)) adjustedRating = teamOverride.rating;
  if (Number.isFinite(teamOverride.hca)) adjustedHcaFinal = teamOverride.hca;

  const playerChanges = scenarioTeam.players
    .filter(
      (player) =>
        player.added ||
        player.active === false ||
        Math.abs((player.projectedMinutes || 0) - (team.players.find((base) => base.id === player.basePlayerId)?.projectedMinutes || 0)) > 0.05
    )
    .map((player) => {
      const basePlayer = team.players.find((entry) => entry.id === player.basePlayerId);
      const previousMinutes = basePlayer?.projectedMinutes ?? 0;
      return {
        scenarioId: player.scenarioId,
        name: player.name,
        added: player.added,
        active: player.active !== false,
        previousMinutes,
        currentMinutes: player.projectedMinutes || 0,
        deltaMinutes: round((player.projectedMinutes || 0) - previousMinutes, 1),
        impact: round(player.teamPointsValue || 0, 2),
        sourceTeamId: basePlayer?.teamId || player.teamId,
      };
    });

  return {
    teamId: team.teamId,
    displayName: team.displayName,
    shortName: team.shortName,
    conference: team.conference,
    coach: team.coach,
    summary: {
      ...baseSummary,
      rating: round(adjustedRating, 2),
      oppp: round(adjustedOpppFinal, 3),
      dppp: round(adjustedDpppFinal, 3),
      pace40: round(adjustedPaceFinal, 2),
      teamTotal: round((adjustedOpppFinal + adjustedDpppFinal) * adjustedPaceFinal, 2),
      wRating: round(adjustedWRatingFinal, 2),
      hca: round(adjustedHcaFinal, 2),
    },
    baseSummary,
    aggregate,
    baseAggregate,
    delta,
    overrides: {
      rating:
        Number.isFinite(teamOverride.rating) && Math.abs(teamOverride.rating - baseSummary.rating) > 0.0001
          ? round(teamOverride.rating, 2)
          : null,
      oppp:
        Number.isFinite(teamOverride.oppp) && Math.abs(teamOverride.oppp - adjustedOppp) > 0.0001
          ? round(teamOverride.oppp, 3)
          : null,
      dppp:
        Number.isFinite(teamOverride.dppp) && Math.abs(teamOverride.dppp - adjustedDppp) > 0.0001
          ? round(teamOverride.dppp, 3)
          : null,
      pace40:
        Number.isFinite(teamOverride.pace40) && Math.abs(teamOverride.pace40 - adjustedPace) > 0.0001
          ? round(teamOverride.pace40, 2)
          : null,
      hca:
        Number.isFinite(teamOverride.hca) && Math.abs(teamOverride.hca - (baseSummary.hca || 0)) > 0.0001
          ? round(teamOverride.hca, 2)
          : null,
    },
    players: scenarioTeam.players,
    changes: playerChanges,
  };
}

export function rankTeamSnapshots(teamSnapshots) {
  const sorted = [...teamSnapshots].sort(
    (left, right) =>
      left.summary.rating - right.summary.rating || right.summary.wRating - left.summary.wRating
  );
  const best = sorted[0]?.summary.rating ?? 0;
  return sorted.map((team, index) => ({
    ...team,
    rank: index + 1,
    relativeRating: round(team.summary.rating - best, 1),
  }));
}

export function buildMatchup(homeTeam, awayTeam, leagueAverages) {
  const leagueBaseline = (leagueAverages.oppp + leagueAverages.dppp) / 2;
  const pace = round((homeTeam.summary.pace40 + awayTeam.summary.pace40) / 2, 2);

  const homePpp = round(
    leagueBaseline +
      ((homeTeam.summary.oppp - leagueBaseline) + (awayTeam.summary.dppp - leagueBaseline)) / 2,
    3
  );
  const awayPpp = round(
    leagueBaseline +
      ((awayTeam.summary.oppp - leagueBaseline) + (homeTeam.summary.dppp - leagueBaseline)) / 2,
    3
  );

  const efficiencyTotal = round((homePpp + awayPpp) * pace, 1);
  const ratingSpread = round(
    awayTeam.summary.rating - homeTeam.summary.rating + (homeTeam.summary.hca || 0),
    1
  );

  const homePoints = round(efficiencyTotal / 2 + ratingSpread / 2, 2);
  const awayPoints = round(efficiencyTotal / 2 - ratingSpread / 2, 2);
  const total = round(homePoints + awayPoints, 1);

  const homeWinProbability = clamp(1 / (1 + Math.exp(-0.145 * ratingSpread)), 0.02, 0.98);

  return {
    pace,
    homePpp,
    awayPpp,
    homePoints,
    awayPoints,
    spread: ratingSpread,
    total,
    homeTeamTotal: round(homePoints, 1),
    awayTeamTotal: round(awayPoints, 1),
    homeWinProbability: round(homeWinProbability, 3),
    awayWinProbability: round(1 - homeWinProbability, 3),
    ratingSpread,
    efficiencyTotal,
  };
}

export function normalizeTeamMinutes(teamState) {
  const activePlayers = teamState.players.filter((player) => player.active !== false);
  const totalMinutes = activePlayers.reduce((sum, player) => sum + (player.projectedMinutes || 0), 0);
  if (!totalMinutes) return teamState;
  const scale = 200 / totalMinutes;
  return {
    ...teamState,
    players: teamState.players.map((player) =>
      player.active === false
        ? player
        : { ...player, projectedMinutes: round((player.projectedMinutes || 0) * scale, 1) }
    ),
  };
}

export function buildScenarioPlayer(player, targetTeamId) {
  return {
    ...player,
    scenarioId: `${player.id}-scenario-${targetTeamId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    basePlayerId: player.id,
    teamId: targetTeamId,
    active: true,
    added: true,
  };
}
