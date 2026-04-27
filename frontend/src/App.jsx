import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import {
  deleteWnbaResultsEntry,
  fetchWnbaModel,
  fetchWnbaResultsTracker,
  saveWnbaResultsEntry,
} from "./api";
import {
  buildMatchup,
  buildScenarioPlayer,
  buildTeamSnapshot,
  createInitialScenarioState,
  normalizeTeamMinutes,
  rankTeamSnapshots,
} from "./wnbaModel";

const STORAGE_KEY = "wnba-trader-scenario-v1";
const OVERRIDE_STORAGE_KEY = "wnba-trader-team-overrides-v1";

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createResultsForm() {
  return {
    id: "",
    date: localDateString(),
    time: "",
    homeTeamId: "",
    awayTeamId: "",
    myTotal: "",
    closingTotal: "",
    mySpread: "",
    closingSpread: "",
    injury: "N",
    actualTotal: "",
    actualSpread: "",
  };
}

function entryIdFromParts(date, homeTeamId, awayTeamId) {
  return [date || "no-date", homeTeamId || "no-home", awayTeamId || "no-away"].join("|");
}

function toNumericOrNull(value) {
  if (value === "" || value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function findResultsEntryId(entries, date, homeTeamId, awayTeamId) {
  return (
    entries.find(
      (entry) =>
        entry.date === date && entry.homeTeamId === homeTeamId && entry.awayTeamId === awayTeamId
    )?.id || ""
  );
}

function formatNumber(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "--";
  return Number(value).toFixed(digits);
}

function formatSigned(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "--";
  const numeric = Number(value);
  if (numeric === 0) return numeric.toFixed(digits);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(digits)}`;
}

function formatPercent(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "--";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function formatLine(side, margin) {
  if (margin == null || Number.isNaN(margin)) return "--";
  const numeric = Number(margin);
  if (numeric === 0) return `${side} PK`;
  return `${side} ${numeric > 0 ? "-" : "+"}${Math.abs(numeric).toFixed(1)}`;
}

function matchupSpreadToHomeLine(spread) {
  if (spread == null || Number.isNaN(spread)) return "";
  return Number((-Number(spread)).toFixed(1));
}

function formatTimeLabel(value) {
  if (!value) return "";
  const [hoursRaw, minutesRaw] = String(value).split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return String(value);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function timeSortValue(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const [hoursRaw, minutesRaw] = String(value).split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NEGATIVE_INFINITY;
  return hours * 60 + minutes;
}

function usePersistedScenario(model) {
  const [scenarioState, setScenarioState] = useState(null);

  useEffect(() => {
    if (!model) return;
    const baseState = createInitialScenarioState(model);
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        setScenarioState(baseState);
        return;
      }

      const parsed = JSON.parse(saved);
      const merged = {};
      for (const team of model.teams) {
        const savedTeam = parsed?.[team.teamId];
        const baseTeam = baseState[team.teamId];
        if (!savedTeam) {
          merged[team.teamId] = baseTeam;
          continue;
        }
        merged[team.teamId] = {
          teamId: team.teamId,
          players: Array.isArray(savedTeam.players)
            ? savedTeam.players.map((player) => ({
                ...player,
                projectedMinutes: Number(player.projectedMinutes) || 0,
                active: player.active !== false,
              }))
            : baseTeam.players,
        };
      }
      setScenarioState(merged);
    } catch {
      setScenarioState(baseState);
    }
  }, [model]);

  useEffect(() => {
    if (!scenarioState) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarioState));
  }, [scenarioState]);

  return [scenarioState, setScenarioState];
}

function usePersistedTeamOverrides(model) {
  const [teamOverrides, setTeamOverrides] = useState({});

  useEffect(() => {
    if (!model) return;
    try {
      const saved = window.localStorage.getItem(OVERRIDE_STORAGE_KEY);
      if (!saved) {
        setTeamOverrides({});
        return;
      }
      const parsed = JSON.parse(saved);
      const cleaned = {};
      for (const team of model.teams) {
        if (parsed?.[team.teamId]) {
          cleaned[team.teamId] = parsed[team.teamId];
        }
      }
      setTeamOverrides(cleaned);
    } catch {
      setTeamOverrides({});
    }
  }, [model]);

  useEffect(() => {
    window.localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(teamOverrides));
  }, [teamOverrides]);

  return [teamOverrides, setTeamOverrides];
}

function MetricCard({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function SectionHeader({ eyebrow, title, detail, actions }) {
  return (
    <div className="section-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {detail ? <p className="section-detail">{detail}</p> : null}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </div>
  );
}

function App() {
  const [model, setModel] = useState(null);
  const [resultsTracker, setResultsTracker] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState("team-lab");
  const [selectedTeamId, setSelectedTeamId] = useState("NYL");
  const [awayTeamId, setAwayTeamId] = useState("CON");
  const [homeTeamId, setHomeTeamId] = useState("NYL");
  const [teamSearch, setTeamSearch] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [resultsTeamSearch, setResultsTeamSearch] = useState("");
  const [resultsForm, setResultsForm] = useState(createResultsForm());
  const [isSavingResults, setIsSavingResults] = useState(false);
  const [isDeletingResults, setIsDeletingResults] = useState(false);
  const [isPending, startTransition] = useTransition();

  const deferredTeamSearch = useDeferredValue(teamSearch);
  const deferredPlayerSearch = useDeferredValue(playerSearch);
  const deferredResultsTeamSearch = useDeferredValue(resultsTeamSearch);
  const [scenarioState, setScenarioState] = usePersistedScenario(model);
  const [teamOverrides, setTeamOverrides] = usePersistedTeamOverrides(model);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setIsLoading(true);
        const [workbookPayload, resultsPayload] = await Promise.all([
          fetchWnbaModel(),
          fetchWnbaResultsTracker(),
        ]);
        if (cancelled) return;
        setModel(workbookPayload);
        setResultsTracker(resultsPayload);
        setError("");
      } catch (loadError) {
        if (!cancelled) {
          setError(String(loadError.message || loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const rankedSnapshots = useMemo(() => {
    if (!model || !scenarioState) return [];
    const snapshots = model.teams.map((team) =>
      buildTeamSnapshot(team, scenarioState[team.teamId], teamOverrides[team.teamId] || {})
    );
    return rankTeamSnapshots(snapshots);
  }, [model, scenarioState, teamOverrides]);

  const snapshotsByTeamId = useMemo(
    () => Object.fromEntries(rankedSnapshots.map((team) => [team.teamId, team])),
    [rankedSnapshots]
  );

  const selectedBaseTeam = useMemo(
    () => model?.teams.find((team) => team.teamId === selectedTeamId) || null,
    [model, selectedTeamId]
  );

  const selectedTeam = snapshotsByTeamId[selectedTeamId] || null;
  const awayTeam = snapshotsByTeamId[awayTeamId] || null;
  const homeTeam = snapshotsByTeamId[homeTeamId] || null;

  const baseAwayTeam = useMemo(
    () => model?.teams.find((team) => team.teamId === awayTeamId) || null,
    [model, awayTeamId]
  );
  const baseHomeTeam = useMemo(
    () => model?.teams.find((team) => team.teamId === homeTeamId) || null,
    [model, homeTeamId]
  );

  const matchup = useMemo(() => {
    if (!awayTeam || !homeTeam || !model) return null;
    return buildMatchup(homeTeam, awayTeam, model.league.averages);
  }, [awayTeam, homeTeam, model]);

  const baseMatchup = useMemo(() => {
    if (!baseAwayTeam || !baseHomeTeam || !model) return null;
    return buildMatchup(
      { ...baseHomeTeam, baseSummary: baseHomeTeam.summary, aggregate: baseHomeTeam.aggregate },
      { ...baseAwayTeam, baseSummary: baseAwayTeam.summary, aggregate: baseAwayTeam.aggregate },
      model.league.averages
    );
  }, [baseAwayTeam, baseHomeTeam, model]);

  const filteredTeams = useMemo(() => {
    const query = deferredTeamSearch.trim().toLowerCase();
    return rankedSnapshots.filter((team) => {
      if (!query) return true;
      return (
        team.displayName.toLowerCase().includes(query) ||
        team.shortName.toLowerCase().includes(query) ||
        team.teamId.toLowerCase().includes(query)
      );
    });
  }, [rankedSnapshots, deferredTeamSearch]);

  const resultsEntries = resultsTracker?.entries || [];
  const resultsTeamTrends = resultsTracker?.teamTrends || [];

  const sortedResultsEntries = useMemo(() => {
    return [...resultsEntries].sort((left, right) => {
      const leftFinal = left.actualTotal != null || left.actualSpread != null;
      const rightFinal = right.actualTotal != null || right.actualSpread != null;
      if (leftFinal !== rightFinal) return leftFinal ? 1 : -1;
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      const leftTime = timeSortValue(left.time);
      const rightTime = timeSortValue(right.time);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return (left.updatedAt || "").localeCompare(right.updatedAt || "");
    });
  }, [resultsEntries]);

  const filteredResultsTeamTrends = useMemo(() => {
    const query = deferredResultsTeamSearch.trim().toLowerCase();
    return resultsTeamTrends.filter((team) => {
      if (!query) return true;
      return (
        team.displayName.toLowerCase().includes(query) ||
        team.shortName.toLowerCase().includes(query) ||
        team.teamId.toLowerCase().includes(query)
      );
    });
  }, [resultsTeamTrends, deferredResultsTeamSearch]);

  const selectedTeamTrend = useMemo(
    () => resultsTeamTrends.find((team) => team.teamId === selectedTeamId) || null,
    [resultsTeamTrends, selectedTeamId]
  );

  const resultsEntryPreview = useMemo(() => {
    const myTotal = toNumericOrNull(resultsForm.myTotal);
    const closingTotal = toNumericOrNull(resultsForm.closingTotal);
    const mySpread = toNumericOrNull(resultsForm.mySpread);
    const closingSpread = toNumericOrNull(resultsForm.closingSpread);
    const actualTotal = toNumericOrNull(resultsForm.actualTotal);
    const actualSpread = toNumericOrNull(resultsForm.actualSpread);

    return {
      closingTotalDiff:
        myTotal != null && closingTotal != null ? Number((closingTotal - myTotal).toFixed(2)) : null,
      closingSpreadDiff:
        mySpread != null && closingSpread != null ? Number((closingSpread - mySpread).toFixed(2)) : null,
      actualTotalDiff:
        myTotal != null && actualTotal != null ? Number((actualTotal - myTotal).toFixed(2)) : null,
      actualSpreadDiff:
        mySpread != null && actualSpread != null ? Number((actualSpread - mySpread).toFixed(2)) : null,
    };
  }, [resultsForm]);

  const addablePlayers = useMemo(() => {
    if (!model || !selectedTeam) return [];
    const existingBaseIds = new Set(selectedTeam.players.map((player) => player.basePlayerId || player.id));
    const query = deferredPlayerSearch.trim().toLowerCase();
    return model.players
      .filter((player) => !existingBaseIds.has(player.id))
      .filter((player) => {
        if (!query) return true;
        return (
          player.name.toLowerCase().includes(query) ||
          player.teamId.toLowerCase().includes(query) ||
          player.teamName.toLowerCase().includes(query)
        );
      })
      .slice(0, 16);
  }, [model, selectedTeam, deferredPlayerSearch]);

  const modifiedTeamsCount = useMemo(() => {
    if (!model || !rankedSnapshots.length) return 0;
    return rankedSnapshots.filter((team) => team.changes.length > 0).length;
  }, [model, rankedSnapshots]);

  function updateTeamState(teamId, updater) {
    startTransition(() => {
      setScenarioState((current) => ({
        ...current,
        [teamId]: updater(current[teamId]),
      }));
    });
  }

  function updateTeamOverride(teamId, key, nextValue) {
    const numeric = nextValue === "" ? null : Number(nextValue);
    startTransition(() => {
      setTeamOverrides((current) => {
        const teamOverride = { ...(current[teamId] || {}) };
        if (nextValue === "" || !Number.isFinite(numeric)) {
          delete teamOverride[key];
        } else {
          teamOverride[key] = numeric;
        }
        const next = { ...current };
        if (Object.keys(teamOverride).length) {
          next[teamId] = teamOverride;
        } else {
          delete next[teamId];
        }
        return next;
      });
    });
  }

  function handleTogglePlayer(teamId, scenarioId) {
    updateTeamState(teamId, (teamState) => ({
      ...teamState,
      players: teamState.players.map((player) =>
        player.scenarioId === scenarioId ? { ...player, active: !player.active } : player
      ),
    }));
  }

  function handleMinutesChange(teamId, scenarioId, nextValue) {
    const numeric = Number(nextValue);
    updateTeamState(teamId, (teamState) => ({
      ...teamState,
      players: teamState.players.map((player) =>
        player.scenarioId === scenarioId
          ? { ...player, projectedMinutes: Number.isFinite(numeric) ? Math.max(numeric, 0) : 0 }
          : player
      ),
    }));
  }

  function handleRemovePlayer(teamId, scenarioId) {
    updateTeamState(teamId, (teamState) => ({
      ...teamState,
      players: teamState.players.flatMap((player) => {
        if (player.scenarioId !== scenarioId) return [player];
        if (player.added) return [];
        return [{ ...player, active: false, projectedMinutes: 0 }];
      }),
    }));
  }

  function handleAddPlayer(player) {
    if (!selectedTeamId) return;
    updateTeamState(selectedTeamId, (teamState) => ({
      ...teamState,
      players: [...teamState.players, buildScenarioPlayer(player, selectedTeamId)],
    }));
  }

  function handleResetTeam(teamId) {
    if (!model) return;
    startTransition(() => {
      const freshState = createInitialScenarioState(model);
      setScenarioState((current) => ({
        ...current,
        [teamId]: freshState[teamId],
      }));
      setTeamOverrides((current) => {
        const next = { ...current };
        delete next[teamId];
        return next;
      });
    });
  }

  function handleNormalizeTeam(teamId) {
    updateTeamState(teamId, (teamState) => normalizeTeamMinutes(teamState));
  }

  function handleResetAll() {
    if (!model) return;
    startTransition(() => {
      setScenarioState(createInitialScenarioState(model));
      setTeamOverrides({});
    });
  }

  function handleResultsFormChange(key, value) {
    setResultsForm((current) => {
      const next = {
        ...current,
        [key]: value,
      };

      if (key === "date" || key === "homeTeamId" || key === "awayTeamId") {
        next.id = current.id
          ? current.id
          : findResultsEntryId(resultsEntries, next.date, next.homeTeamId, next.awayTeamId);
      }

      return next;
    });
  }

  function handleLoadCurrentMatchup() {
    if (!matchup) return;
    const date = localDateString();
    const existingId = findResultsEntryId(resultsEntries, date, homeTeamId, awayTeamId);
    const existingEntry = existingId ? resultsEntries.find((entry) => entry.id === existingId) : null;

    setResultsForm({
      id: existingId,
      date,
      time: existingEntry?.time || "",
      homeTeamId,
      awayTeamId,
      myTotal: matchup.total,
      closingTotal: existingEntry?.closingTotal ?? "",
      mySpread: existingEntry?.mySpread ?? matchupSpreadToHomeLine(matchup.spread),
      closingSpread: existingEntry?.closingSpread ?? "",
      injury: existingEntry?.injury || "N",
      actualTotal: existingEntry?.actualTotal ?? "",
      actualSpread: existingEntry?.actualSpread ?? "",
    });
    setView("results-tracker");
  }

  function handleEditResultsEntry(entry) {
    setResultsForm({
      id: entry.id,
      date: entry.date,
      time: entry.time || "",
      homeTeamId: entry.homeTeamId,
      awayTeamId: entry.awayTeamId,
      myTotal: entry.myTotal ?? "",
      closingTotal: entry.closingTotal ?? "",
      mySpread: entry.mySpread ?? "",
      closingSpread: entry.closingSpread ?? "",
      injury: entry.injury || "N",
      actualTotal: entry.actualTotal ?? "",
      actualSpread: entry.actualSpread ?? "",
    });
  }

  function handleResetResultsForm() {
    setResultsForm(createResultsForm());
  }

  async function handleDeleteResults() {
    const entryId =
      resultsForm.id ||
      findResultsEntryId(resultsEntries, resultsForm.date, resultsForm.homeTeamId, resultsForm.awayTeamId);

    if (!entryId) {
      setError("Pick an existing tracked row before deleting it.");
      return;
    }

    try {
      setIsDeletingResults(true);
      const nextTracker = await deleteWnbaResultsEntry(entryId);
      setResultsTracker(nextTracker);
      setResultsForm(createResultsForm());
      setError("");
    } catch (deleteError) {
      setError(String(deleteError.message || deleteError));
    } finally {
      setIsDeletingResults(false);
    }
  }

  async function handleSaveResults() {
      const payload = {
        id:
          resultsForm.id ||
          entryIdFromParts(resultsForm.date, resultsForm.homeTeamId, resultsForm.awayTeamId),
        date: resultsForm.date,
        time: resultsForm.time,
        homeTeamId: resultsForm.homeTeamId,
        awayTeamId: resultsForm.awayTeamId,
      myTotal: toNumericOrNull(resultsForm.myTotal),
      closingTotal: toNumericOrNull(resultsForm.closingTotal),
      mySpread: toNumericOrNull(resultsForm.mySpread),
      closingSpread: toNumericOrNull(resultsForm.closingSpread),
      injury: resultsForm.injury,
      actualTotal: toNumericOrNull(resultsForm.actualTotal),
      actualSpread: toNumericOrNull(resultsForm.actualSpread),
    };

    if (!payload.date || !payload.homeTeamId || !payload.awayTeamId) {
      setError("Results tracker entries need a date, home team, and away team.");
      return;
    }

    try {
      setIsSavingResults(true);
      const nextTracker = await saveWnbaResultsEntry(payload);
      setResultsTracker(nextTracker);
      setResultsForm((current) => ({
        ...current,
        id: payload.id,
      }));
      setError("");
    } catch (saveError) {
      setError(String(saveError.message || saveError));
    } finally {
      setIsSavingResults(false);
    }
  }

  if (isLoading || !model || !scenarioState) {
    if (!isLoading && error) {
      return (
        <main className="app-shell">
          <section className="error-banner">{error}</section>
        </main>
      );
    }

    return (
      <main className="app-shell">
        <section className="panel loading-panel">
          <p className="eyebrow">WNBA Pricing Console</p>
          <h2>Loading workbook model…</h2>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="tab-strip">
          {[
            ["team-lab", "Team Lab"],
            ["matchup-studio", "Matchup Studio"],
            ["results-tracker", "Results Tracker"],
            ["league-board", "League Board"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={view === id ? "tab-button active" : "tab-button"}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="toolbar-actions">
          <div className="toolbar-stats">
            <span>{model.teams.length} teams</span>
            <span>{model.players.length} players</span>
            <span>{resultsEntries.length} tracked games</span>
            <span>{modifiedTeamsCount} modified</span>
          </div>
          <input
            value={teamSearch}
            onChange={(event) => setTeamSearch(event.target.value)}
            placeholder="Search teams"
          />
          <button type="button" className="secondary-button" onClick={handleResetAll}>
            Reset all scenarios
          </button>
        </div>
      </section>

      {error ? <section className="error-banner">{error}</section> : null}

      {view === "team-lab" ? (
        <section className="workspace">
          <aside className="sidebar-panel">
            <SectionHeader
              eyebrow="League board"
              title="Adjusted team ladder"
              detail="Best team is pinned at 0.0 and everyone else is shown relative to that number."
            />

            <div className="team-list">
              {filteredTeams.map((team) => (
                <button
                  key={team.teamId}
                  type="button"
                  className={selectedTeamId === team.teamId ? "team-row active" : "team-row"}
                  onClick={() => setSelectedTeamId(team.teamId)}
                >
                  <div>
                    <span className="team-code">{team.teamId}</span>
                    <strong>{team.displayName}</strong>
                    <small>{team.conference}</small>
                  </div>
                  <div className="team-row-metrics">
                    <span>{formatNumber(team.relativeRating, 1)}</span>
                    <small>Rating {formatNumber(team.summary.rating, 1)}</small>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {selectedTeam && selectedBaseTeam ? (
            <section className="content-column">
              <article className="panel detail-panel">
                <SectionHeader
                  eyebrow={selectedTeam.teamId}
                  title={selectedTeam.displayName}
                  detail={`Coach: ${selectedTeam.coach || "Unknown"} • ${selectedTeam.conference}`}
                  actions={
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleNormalizeTeam(selectedTeam.teamId)}
                      >
                        Normalize to 200 min
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleResetTeam(selectedTeam.teamId)}
                      >
                        Reset team
                      </button>
                    </>
                  }
                />

                <div className="metrics-grid">
                  <MetricCard
                    label="Line rating"
                    value={formatNumber(selectedTeam.summary.rating, 1)}
                    detail={`Relative ${formatNumber(selectedTeam.relativeRating, 1)} • Base ${formatNumber(
                      selectedBaseTeam.summary.rating,
                      1
                    )}`}
                  />
                  <MetricCard
                    label="Offense"
                    value={formatNumber(selectedTeam.summary.oppp, 3)}
                    detail={`Δ ${formatSigned(
                      selectedTeam.summary.oppp - selectedBaseTeam.summary.oppp,
                      3
                    )}`}
                    tone={selectedTeam.summary.oppp > selectedBaseTeam.summary.oppp ? "positive" : "neutral"}
                  />
                  <MetricCard
                    label="Defense"
                    value={formatNumber(selectedTeam.summary.dppp, 3)}
                    detail={`Δ ${formatSigned(
                      selectedTeam.summary.dppp - selectedBaseTeam.summary.dppp,
                      3
                    )}`}
                    tone={selectedTeam.summary.dppp < selectedBaseTeam.summary.dppp ? "positive" : "neutral"}
                  />
                  <MetricCard
                    label="Pace"
                    value={formatNumber(selectedTeam.summary.pace40, 2)}
                    detail={`Base ${formatNumber(selectedBaseTeam.summary.pace40, 2)}`}
                  />
                  <MetricCard
                    label="Power"
                    value={formatNumber(selectedTeam.summary.wRating, 1)}
                    detail={`Base ${formatNumber(selectedBaseTeam.summary.wRating, 1)}`}
                  />
                  <MetricCard
                    label="Team Total"
                    value={formatNumber(selectedTeam.summary.teamTotal, 2)}
                    detail={`Base ${formatNumber(selectedBaseTeam.summary.teamTotal, 2)}`}
                  />
                  <MetricCard
                    label="Minutes"
                    value={formatNumber(selectedTeam.aggregate.totalMinutes, 1)}
                    detail={`${selectedTeam.aggregate.activeCount} active players`}
                    tone={
                      Math.abs(selectedTeam.aggregate.totalMinutes - 200) <= 1 ? "positive" : "warning"
                    }
                  />
                </div>

                  <div className="insight-grid">
                    <article className="subpanel">
                      <h3>Market overrides</h3>
                    <div className="override-grid">
                      {[
                        ["rating", "Line rating", 1],
                        ["oppp", "O PPP", 3],
                        ["dppp", "D PPP", 3],
                        ["pace40", "Pace/40", 2],
                        ["hca", "HCA", 2],
                      ].map(([key, label, stepDigits]) => (
                        <label key={key} className="override-field">
                          <span>{label}</span>
                          <input
                            type="number"
                            step={stepDigits === 3 ? "0.001" : stepDigits === 2 ? "0.01" : "0.1"}
                            value={teamOverrides[selectedTeam.teamId]?.[key] ?? ""}
                            placeholder={formatNumber(selectedTeam.summary[key], stepDigits)}
                            onChange={(event) =>
                              updateTeamOverride(selectedTeam.teamId, key, event.target.value)
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <div className="override-note">
                      Blank means use the live roster-driven number. Entering a value locks that field until
                      you clear it or reset the team.
                    </div>
                  </article>

                    <article className="subpanel">
                      <h3>Core drivers</h3>
                      <div className="driver-grid">
                      <div>
                        <span>Talent</span>
                        <strong>{formatNumber(selectedTeam.aggregate.normalizedTalent, 2)}</strong>
                        <small>Base {formatNumber(selectedTeam.baseAggregate.normalizedTalent, 2)}</small>
                      </div>
                      <div>
                        <span>Creation</span>
                        <strong>{formatNumber(selectedTeam.aggregate.creationGrade, 2)}</strong>
                        <small>Base {formatNumber(selectedTeam.baseAggregate.creationGrade, 2)}</small>
                      </div>
                      <div>
                        <span>Defense</span>
                        <strong>{formatNumber(selectedTeam.aggregate.defenseGrade, 2)}</strong>
                        <small>Base {formatNumber(selectedTeam.baseAggregate.defenseGrade, 2)}</small>
                      </div>
                      <div>
                        <span>PtsCreated/100</span>
                        <strong>{formatNumber(selectedTeam.aggregate.pointsCreated100, 2)}</strong>
                        <small>Base {formatNumber(selectedTeam.baseAggregate.pointsCreated100, 2)}</small>
                        </div>
                      </div>
                    </article>

                    <article className="subpanel">
                      <h3>Tracker feedback</h3>
                      <div className="driver-grid">
                        <div>
                          <span>Spread vs close</span>
                          <strong>{formatSigned(selectedTeamTrend?.agSpreadClosing, 2)}</strong>
                          <small>{selectedTeamTrend?.gamesTracked ?? 0} tracked games</small>
                        </div>
                        <div>
                          <span>Spread vs actual</span>
                          <strong>{formatSigned(selectedTeamTrend?.ahSpreadActual, 2)}</strong>
                          <small>Result-driven spread edge</small>
                        </div>
                        <div>
                          <span>Total vs close</span>
                          <strong>{formatSigned(selectedTeamTrend?.aiTotalClosing, 2)}</strong>
                          <small>Close total minus your total</small>
                        </div>
                        <div>
                          <span>Total vs actual</span>
                          <strong>{formatSigned(selectedTeamTrend?.ajTotalActual, 2)}</strong>
                          <small>Actual total minus your total</small>
                        </div>
                      </div>
                    </article>

                    <article className="subpanel">
                      <h3>Scenario log</h3>
                    <div className="change-list">
                      {selectedTeam.changes.length ? (
                        selectedTeam.changes.map((change) => (
                          <div key={change.scenarioId} className="change-row">
                            <strong>{change.name}</strong>
                            <span>
                              {change.added
                                ? `Added from ${change.sourceTeamId}`
                                : change.active
                                  ? `Minutes ${formatSigned(change.deltaMinutes)}`
                                  : "Removed from active roster"}
                            </span>
                            <small>Impact {formatNumber(change.impact, 2)}</small>
                          </div>
                        ))
                      ) : (
                        <div className="empty-state">No active scenario changes for this team yet.</div>
                      )}
                    </div>
                  </article>
                </div>
              </article>

                <div className="two-column team-lab-bottom-grid">
                  <article className="panel roster-panel-wide">
                  <SectionHeader
                    eyebrow="Roster editor"
                    title="Active team sheet"
                    detail="Toggle injuries, shift minutes, or remove players entirely from the active model."
                  />

                  <div className="roster-table">
                    <div className="roster-head">
                      <span>On</span>
                      <span>Player</span>
                      <span>Min</span>
                      <span>TPV</span>
                      <span>Off</span>
                      <span>Eff</span>
                      <span>Create</span>
                      <span>Def</span>
                      <span />
                    </div>

                    {selectedTeam.players
                      .slice()
                      .sort((left, right) => (right.teamPointsValue || 0) - (left.teamPointsValue || 0))
                      .map((player) => (
                        <div
                          key={player.scenarioId}
                          className={player.active === false ? "roster-row inactive" : "roster-row"}
                        >
                          <label className="checkbox-cell">
                            <input
                              type="checkbox"
                              checked={player.active !== false}
                              onChange={() => handleTogglePlayer(selectedTeam.teamId, player.scenarioId)}
                            />
                          </label>
                          <div className="player-cell">
                            <strong>{player.name}</strong>
                            <small>
                              {player.added ? `Scenario add from ${player.teamName}` : player.teamName}
                            </small>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={player.projectedMinutes ?? 0}
                            onChange={(event) =>
                              handleMinutesChange(selectedTeam.teamId, player.scenarioId, event.target.value)
                            }
                          />
                          <span>{formatNumber(player.teamPointsValue, 2)}</span>
                          <span>{formatNumber(player.pointsCreated100, 1)}</span>
                          <span>{formatNumber(player.efficiencyGrade, 1)}</span>
                          <span>{formatNumber(player.creationGrade, 1)}</span>
                          <span>{formatNumber(player.defenseGrade, 1)}</span>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => handleRemovePlayer(selectedTeam.teamId, player.scenarioId)}
                          >
                            {player.added ? "Delete" : "Scratch"}
                          </button>
                        </div>
                      ))}
                  </div>
                </article>

                  <article className="panel player-pool-panel">
                  <SectionHeader
                    eyebrow="Player pool"
                    title="Add a player to this team"
                    detail="Useful for injury replacements, hypothetical signings, and quick trade scenarios."
                  />

                  <input
                    value={playerSearch}
                    onChange={(event) => setPlayerSearch(event.target.value)}
                    placeholder="Search players or source team"
                  />

                  <div className="player-pool">
                    {addablePlayers.map((player) => (
                      <div key={player.id} className="player-pool-row">
                        <div>
                          <strong>{player.name}</strong>
                          <small>
                            {player.teamName} • TPV {formatNumber(player.teamPointsValue, 2)} • {formatNumber(
                              player.projectedMinutes,
                              1
                            )} min
                          </small>
                        </div>
                        <button type="button" className="secondary-button" onClick={() => handleAddPlayer(player)}>
                          Add
                        </button>
                      </div>
                    ))}

                    {!addablePlayers.length ? (
                      <div className="empty-state">No players matched the current search.</div>
                    ) : null}
                  </div>
                </article>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      {view === "matchup-studio" && awayTeam && homeTeam && matchup ? (
        <section className="workspace matchup-workspace">
          <article className="panel matchup-panel">
            <SectionHeader
              eyebrow="Matchup studio"
              title="Instant spread and total builder"
              detail="Spread is driven off the workbook rating column plus home-court advantage. Total is driven from pace and team efficiency."
              actions={
                <button type="button" className="secondary-button" onClick={handleLoadCurrentMatchup}>
                  Push to results tracker
                </button>
              }
            />

            <div className="matchup-controls">
              <label>
                <span>Away team</span>
                <select value={awayTeamId} onChange={(event) => setAwayTeamId(event.target.value)}>
                  {model.teams.map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Home team</span>
                <select value={homeTeamId} onChange={(event) => setHomeTeamId(event.target.value)}>
                  {model.teams.map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="metrics-grid">
              <MetricCard
                label="Spread"
                value={formatLine(homeTeam.teamId, matchup.spread)}
                detail={
                  baseMatchup
                    ? `Move ${formatSigned(matchup.spread - baseMatchup.spread)} vs base`
                    : "Base unavailable"
                }
                tone={matchup.spread > 0 ? "positive" : "neutral"}
              />
              <MetricCard
                label="Total"
                value={formatNumber(matchup.total, 1)}
                detail={baseMatchup ? `Move ${formatSigned(matchup.total - baseMatchup.total)} vs base` : ""}
              />
              <MetricCard
                label={`${homeTeam.teamId} team total`}
                value={formatNumber(matchup.homeTeamTotal, 1)}
                detail={`${formatPercent(matchup.homeWinProbability, 1)} win probability`}
              />
              <MetricCard
                label={`${awayTeam.teamId} team total`}
                value={formatNumber(matchup.awayTeamTotal, 1)}
                detail={`${formatPercent(matchup.awayWinProbability, 1)} win probability`}
              />
              <MetricCard label="Game pace" value={formatNumber(matchup.pace, 2)} detail="Blended tempo" />
              <MetricCard
                label="PPP blend"
                value={`${formatNumber(matchup.homePpp, 3)} / ${formatNumber(matchup.awayPpp, 3)}`}
                detail={`${homeTeam.teamId} / ${awayTeam.teamId}`}
              />
            </div>

            <div className="two-column">
              {[awayTeam, homeTeam].map((team) => (
                <article key={team.teamId} className="subpanel">
                  <h3>{team.displayName}</h3>
                  <div className="mini-grid">
                    <div>
                      <span>Relative</span>
                      <strong>{formatNumber(team.relativeRating, 1)}</strong>
                    </div>
                    <div>
                      <span>Line rating</span>
                      <strong>{formatNumber(team.summary.rating, 1)}</strong>
                    </div>
                    <div>
                      <span>O PPP</span>
                      <strong>{formatNumber(team.summary.oppp, 3)}</strong>
                    </div>
                    <div>
                      <span>D PPP</span>
                      <strong>{formatNumber(team.summary.dppp, 3)}</strong>
                    </div>
                    <div>
                      <span>Pace</span>
                      <strong>{formatNumber(team.summary.pace40, 2)}</strong>
                    </div>
                    <div>
                      <span>Minutes</span>
                      <strong>{formatNumber(team.aggregate.totalMinutes, 1)}</strong>
                    </div>
                  </div>

                  <div className="change-list compact">
                    {team.changes.length ? (
                      team.changes.slice(0, 6).map((change) => (
                        <div key={change.scenarioId} className="change-row">
                          <strong>{change.name}</strong>
                          <span>
                            {change.added
                              ? `Added from ${change.sourceTeamId}`
                              : change.active
                                ? `Min ${formatSigned(change.deltaMinutes)}`
                                : "Out"}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state">No active adjustments.</div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {view === "results-tracker" ? (
        <section className="workspace results-workspace">
          <article className="panel results-panel">
            <SectionHeader
              eyebrow="Results tracking"
              title="Grade your numbers vs close and actual"
              detail="Use the current matchup studio price or edit any row manually. Positive spread trend means the team should have been priced stronger than your number. Positive total trend means the market or result landed higher than your total."
              actions={
                <>
                  <button type="button" className="secondary-button" onClick={handleLoadCurrentMatchup}>
                    Use current matchup
                  </button>
                  <button type="button" className="secondary-button" onClick={handleResetResultsForm}>
                    New row
                  </button>
                </>
              }
            />

              <div className="results-form-grid">
                <label>
                  <span>Date</span>
                <input
                  type="date"
                  value={resultsForm.date}
                  onChange={(event) => handleResultsFormChange("date", event.target.value)}
                  />
                </label>
                <label>
                  <span>Time</span>
                  <input
                    type="time"
                    value={resultsForm.time}
                    onChange={(event) => handleResultsFormChange("time", event.target.value)}
                  />
                </label>
                <label>
                  <span>Home team</span>
                  <select
                  value={resultsForm.homeTeamId}
                  onChange={(event) => handleResultsFormChange("homeTeamId", event.target.value)}
                >
                  <option value="">Select</option>
                  {model.teams.map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Away team</span>
                <select
                  value={resultsForm.awayTeamId}
                  onChange={(event) => handleResultsFormChange("awayTeamId", event.target.value)}
                >
                  <option value="">Select</option>
                  {model.teams.map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Injury flag</span>
                <input
                  value={resultsForm.injury}
                  onChange={(event) => handleResultsFormChange("injury", event.target.value)}
                  placeholder="N / notes"
                />
              </label>
              <label>
                <span>My total</span>
                <input
                  type="number"
                  step="0.1"
                  value={resultsForm.myTotal}
                  onChange={(event) => handleResultsFormChange("myTotal", event.target.value)}
                />
              </label>
              <label>
                <span>Closing total</span>
                <input
                  type="number"
                  step="0.1"
                  value={resultsForm.closingTotal}
                  onChange={(event) => handleResultsFormChange("closingTotal", event.target.value)}
                />
              </label>
              <label>
                <span>Actual total</span>
                <input
                  type="number"
                  step="0.1"
                  value={resultsForm.actualTotal}
                  onChange={(event) => handleResultsFormChange("actualTotal", event.target.value)}
                />
              </label>
              <label>
                <span>My spread</span>
                <input
                  type="number"
                  step="0.1"
                  value={resultsForm.mySpread}
                  onChange={(event) => handleResultsFormChange("mySpread", event.target.value)}
                />
              </label>
              <label>
                <span>Closing spread</span>
                <input
                  type="number"
                  step="0.1"
                  value={resultsForm.closingSpread}
                  onChange={(event) => handleResultsFormChange("closingSpread", event.target.value)}
                />
              </label>
              <label>
                <span>Actual spread</span>
                <input
                  type="number"
                  step="0.1"
                  value={resultsForm.actualSpread}
                  onChange={(event) => handleResultsFormChange("actualSpread", event.target.value)}
                />
              </label>
            </div>

            <div className="metrics-grid compact-metrics">
              <MetricCard
                label="Close total diff"
                value={formatSigned(resultsEntryPreview.closingTotalDiff, 1)}
                detail="CL total - my total"
              />
              <MetricCard
                label="Close spread diff"
                value={formatSigned(resultsEntryPreview.closingSpreadDiff, 1)}
                detail="CL spread - my spread"
              />
              <MetricCard
                label="Actual total diff"
                value={formatSigned(resultsEntryPreview.actualTotalDiff, 1)}
                detail="Actual total - my total"
              />
              <MetricCard
                label="Actual spread diff"
                value={formatSigned(resultsEntryPreview.actualSpreadDiff, 1)}
                detail="Actual spread - my spread"
              />
            </div>

            <div className="results-actions">
              <div className="results-action-buttons">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleSaveResults}
                  disabled={isSavingResults}
                >
                  {isSavingResults ? "Saving..." : "Save tracked row"}
                </button>
                <button
                  type="button"
                  className="ghost-button danger-button"
                  onClick={handleDeleteResults}
                  disabled={isDeletingResults || (!resultsForm.id && !findResultsEntryId(resultsEntries, resultsForm.date, resultsForm.homeTeamId, resultsForm.awayTeamId))}
                >
                  {isDeletingResults ? "Deleting..." : "Delete tracked row"}
                </button>
              </div>
              <div className="override-note">
                Saved rows persist through refresh and relaunch because they are written to the tracker store,
                not just the browser.
              </div>
            </div>

            <div className="two-column results-two-column">
              <article className="subpanel">
                <div className="results-table-head">
                  <h3>Tracked games</h3>
                </div>
                <div className="results-entry-table">
                  <div className="results-entry-head">
                    <span>Date</span>
                    <span>Matchup</span>
                    <span>My tot</span>
                    <span>CL tot</span>
                    <span>Act tot</span>
                    <span>My spr</span>
                    <span>CL spr</span>
                    <span>Act spr</span>
                    <span>CL Δ</span>
                    <span>Act Δ</span>
                  </div>
                  {sortedResultsEntries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={[
                        "results-entry-row",
                        resultsForm.id === entry.id ? "active" : "",
                        entry.actualTotal != null || entry.actualSpread != null ? "graded" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => handleEditResultsEntry(entry)}
                    >
                      <div className="results-date-cell">
                        <strong>{entry.date}</strong>
                        <small>{formatTimeLabel(entry.time) || "No time"}</small>
                      </div>
                      <div>
                        <strong>
                          {entry.awayTeamId} @ {entry.homeTeamId}
                        </strong>
                        <small>
                          {[formatTimeLabel(entry.time), entry.injury || "N"].filter(Boolean).join(" • ")}
                        </small>
                      </div>
                      <span>{formatNumber(entry.myTotal, 1)}</span>
                      <span>{formatNumber(entry.closingTotal, 1)}</span>
                      <span>{formatNumber(entry.actualTotal, 1)}</span>
                      <span>{formatNumber(entry.mySpread, 1)}</span>
                      <span>{formatNumber(entry.closingSpread, 1)}</span>
                      <span>{formatNumber(entry.actualSpread, 1)}</span>
                      <span>{formatSigned(entry.closingSpreadDiff, 1)}</span>
                      <span>{formatSigned(entry.actualSpreadDiff, 1)}</span>
                    </button>
                  ))}
                </div>
              </article>

              <article className="subpanel">
                <div className="results-table-head">
                  <h3>Team trend board</h3>
                  <input
                    value={resultsTeamSearch}
                    onChange={(event) => setResultsTeamSearch(event.target.value)}
                    placeholder="Search team trends"
                  />
                </div>

                <div className="team-trend-table">
                  <div className="team-trend-head">
                    <span>Team</span>
                    <span>AG Spread / Close</span>
                    <span>AH Spread / Actual</span>
                    <span>AI Total / Close</span>
                    <span>AJ Total / Actual</span>
                    <span>Games</span>
                  </div>

                  {filteredResultsTeamTrends.map((team) => (
                    <div key={team.teamId} className="team-trend-row">
                      <div>
                        <strong>{team.displayName}</strong>
                        <small>{team.teamId}</small>
                      </div>
                      <span>{formatSigned(team.agSpreadClosing, 2)}</span>
                      <span>{formatSigned(team.ahSpreadActual, 2)}</span>
                      <span>{formatSigned(team.aiTotalClosing, 2)}</span>
                      <span>{formatSigned(team.ajTotalActual, 2)}</span>
                      <span>{team.gamesTracked}</span>
                    </div>
                  ))}
                </div>

                <div className="team-trend-splits">
                  {filteredResultsTeamTrends.slice(0, 6).map((team) => (
                    <div key={`${team.teamId}-splits`} className="change-row split-row">
                      <strong>{team.teamId}</strong>
                      <span>
                        HF {formatSigned(team.splits.homeFavoriteClose, 1)} /{" "}
                        {formatSigned(team.splits.homeFavoriteActual, 1)}
                      </span>
                      <span>
                        AF {formatSigned(team.splits.awayFavoriteClose, 1)} /{" "}
                        {formatSigned(team.splits.awayFavoriteActual, 1)}
                      </span>
                      <span>
                        HD {formatSigned(team.splits.homeDogClose, 1)} /{" "}
                        {formatSigned(team.splits.homeDogActual, 1)}
                      </span>
                      <span>
                        AD {formatSigned(team.splits.awayDogClose, 1)} /{" "}
                        {formatSigned(team.splits.awayDogActual, 1)}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </article>
        </section>
      ) : null}

      {view === "league-board" ? (
        <section className="workspace league-board-workspace">
          <article className="panel full-panel">
            <SectionHeader
              eyebrow="League board"
              title="Current scenario ranking"
              detail="This board updates off the same active scenario state you’re using in team lab and matchup studio."
            />

              <div className="board-table">
                <div className="board-head">
                  <span>Rank</span>
                  <span>Team</span>
                  <span>Rel</span>
                  <span>Line</span>
                  <span>W</span>
                  <span>O PPP</span>
                  <span>D PPP</span>
                  <span>Pace</span>
                  <span>Total</span>
                <span>Minutes</span>
                <span>Changes</span>
              </div>

              {rankedSnapshots.map((team) => (
                <button
                  key={team.teamId}
                  type="button"
                  className="board-row"
                  onClick={() => {
                    setSelectedTeamId(team.teamId);
                    setView("team-lab");
                  }}
                >
                  <span>{team.rank}</span>
                  <div>
                    <strong>{team.displayName}</strong>
                    <small>{team.teamId}</small>
                  </div>
                  <span>{formatNumber(team.relativeRating, 1)}</span>
                  <span>{formatNumber(team.summary.rating, 1)}</span>
                  <span>{formatNumber(team.summary.wRating, 1)}</span>
                  <span>{formatNumber(team.summary.oppp, 3)}</span>
                  <span>{formatNumber(team.summary.dppp, 3)}</span>
                  <span>{formatNumber(team.summary.pace40, 2)}</span>
                  <span>{formatNumber(team.summary.teamTotal, 2)}</span>
                  <span>{formatNumber(team.aggregate.totalMinutes, 1)}</span>
                  <span>{team.changes.length}</span>
                </button>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}

export default App;
