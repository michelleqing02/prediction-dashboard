import { useEffect, useState } from "react";
import { fetchPredictionMarkets } from "./api";

function formatPercent(value) {
  if (value == null) return "--";
  return `${(value * 100).toFixed(1)}%`;
}

function formatDelta(value) {
  if (!value) return "Flat";
  const cents = Math.abs(value * 100).toFixed(1);
  return `${value > 0 ? "+" : "-"}${cents}c`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function signalTone(value, threshold = 0) {
  if (value > threshold) return "positive";
  if (value < threshold) return "negative";
  return "neutral";
}

export default function App() {
  const [dashboard, setDashboard] = useState(null);
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [platform, setPlatform] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        setIsLoading(true);
        const payload = await fetchPredictionMarkets({ platform, category, search });
        if (cancelled) return;
        setDashboard(payload);
        setError("");
        const hasSelected = payload.markets?.some((market) => market.id === selectedMarketId);
        if (!hasSelected) {
          setSelectedMarketId(payload.markets?.[0]?.id || "");
        }
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

    loadDashboard();
    const timer = window.setInterval(loadDashboard, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [platform, category, search, selectedMarketId]);

  const selectedMarket =
    dashboard?.markets?.find((market) => market.id === selectedMarketId) || dashboard?.markets?.[0] || null;

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Prediction Market Comp Monitor</p>
          <h1>Kalshi and Polymarket in one PM-style market depth view.</h1>
          <p className="lede">
            Surface price dislocations, changing liquidity, and where real size is sitting in the
            book without hopping tabs.
          </p>
        </div>

        <div className="hero-metrics">
          <div className="metric-tile">
            <span>Comparable markets</span>
            <strong>{dashboard?.summary?.comparableGroups ?? "--"}</strong>
          </div>
          <div className="metric-tile">
            <span>Total liquidity</span>
            <strong>{formatCurrency(dashboard?.summary?.totalLiquidityUsd)}</strong>
          </div>
          <div className="metric-tile">
            <span>24h flow</span>
            <strong>{formatCurrency(dashboard?.summary?.totalVolume24hUsd)}</strong>
          </div>
          <div className="metric-tile">
            <span>Alerts</span>
            <strong>{dashboard?.summary?.activeAlerts ?? 0}</strong>
          </div>
        </div>
      </section>

      <section className="controls">
        <label>
          <span>Platform</span>
          <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
            <option value="">All venues</option>
            <option value="kalshi">Kalshi</option>
            <option value="polymarket">Polymarket</option>
          </select>
        </label>

        <label>
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {(dashboard?.categories || []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Fed, election, NBA..."
          />
        </label>

        <div className="stamp">
          <span>Updated</span>
          <strong>
            {dashboard?.generatedAt ? new Date(dashboard.generatedAt).toLocaleTimeString() : "--"}
          </strong>
          <small>
            Kalshi {dashboard?.sourceStatus?.kalshi?.mode || "--"} / Polymarket{" "}
            {dashboard?.sourceStatus?.polymarket?.mode || "--"}
          </small>
        </div>
      </section>

      {error ? <section className="error-banner">{error}</section> : null}

      <section className="board-layout">
        <div className="left-rail">
          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Alert tape</p>
                <h2>Big moves and flow changes</h2>
              </div>
              <span className="pill">{dashboard?.alerts?.length ?? 0}</span>
            </div>

            <div className="alert-list">
              {(dashboard?.alerts || []).slice(0, 6).map((alert) => (
                <div key={`${alert.marketId}-${alert.label}`} className={`alert-card ${alert.intensity}`}>
                  <strong>{alert.label}</strong>
                  <span>
                    {alert.platform} · {alert.marketTitle}
                  </span>
                </div>
              ))}

              {!dashboard?.alerts?.length && !isLoading ? (
                <div className="empty-card">No major changes flagged yet for the current snapshot.</div>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Venue comp</p>
                <h2>Cross-venue candidates</h2>
              </div>
            </div>

            <div className="comparison-list">
              {(dashboard?.comparables || []).map((group) => (
                <div key={group.id} className="comparison-row">
                  <div>
                    <strong>{group.title}</strong>
                    <span>{group.category}</span>
                  </div>
                  <div className="comparison-metrics">
                    <span>Gap {group.priceGap == null ? "--" : formatDelta(group.priceGap)}</span>
                    <span>{formatCurrency(group.totalLiquidityUsd)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Watchlist</p>
                <h2>Scanable market list</h2>
              </div>
              <span className="pill">{dashboard?.markets?.length ?? 0}</span>
            </div>

            <div className="watchlist">
              {(dashboard?.markets || []).map((market) => (
                <button
                  key={market.id}
                  type="button"
                  className={selectedMarket?.id === market.id ? "watch-row active" : "watch-row"}
                  onClick={() => setSelectedMarketId(market.id)}
                >
                  <div>
                    <span className="venue-tag">{market.platform}</span>
                    <strong>{market.title}</strong>
                    <small>{market.subtitle}</small>
                  </div>
                  <div className="watch-row-metrics">
                    <span>{formatPercent(market.yesPrice)}</span>
                    <span className={signalTone(market.priceChange)}>
                      {formatDelta(market.priceChange)}
                    </span>
                    <span>{formatCurrency(market.liquidityUsd)}</span>
                  </div>
                </button>
              ))}

              {!dashboard?.markets?.length && !isLoading ? (
                <div className="empty-card">No markets matched the current filters.</div>
              ) : null}
            </div>
          </article>
        </div>

        <div className="detail-column">
          <article className="panel detail-hero">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Selected market</p>
                <h2>{selectedMarket?.title || "Pick a market"}</h2>
              </div>
              {selectedMarket?.url ? (
                <a className="link-button" href={selectedMarket.url} target="_blank" rel="noreferrer">
                  Open venue
                </a>
              ) : null}
            </div>

            {selectedMarket ? (
              <>
                <p className="detail-subtitle">
                  {selectedMarket.platform} · {selectedMarket.category} · {selectedMarket.subtitle}
                </p>

                <div className="signal-grid">
                  <div className="signal-card">
                    <span>YES price</span>
                    <strong>{formatPercent(selectedMarket.yesPrice)}</strong>
                    <small className={signalTone(selectedMarket.priceChange)}>
                      {formatDelta(selectedMarket.priceChange)} vs prior snapshot
                    </small>
                  </div>
                  <div className="signal-card">
                    <span>Liquidity</span>
                    <strong>{formatCurrency(selectedMarket.liquidityUsd)}</strong>
                    <small className={signalTone(selectedMarket.liquidityChangeUsd)}>
                      {selectedMarket.liquidityChangeUsd === 0
                        ? "No change yet"
                        : `${selectedMarket.liquidityChangeUsd > 0 ? "+" : "-"}${formatCurrency(
                            Math.abs(selectedMarket.liquidityChangeUsd)
                          )} since prior snapshot`}
                    </small>
                  </div>
                  <div className="signal-card">
                    <span>24h volume</span>
                    <strong>{formatCurrency(selectedMarket.volume24hUsd)}</strong>
                    <small>Open interest {formatCurrency(selectedMarket.openInterestUsd)}</small>
                  </div>
                  <div className="signal-card">
                    <span>Spread</span>
                    <strong>{selectedMarket.spread == null ? "--" : formatDelta(selectedMarket.spread)}</strong>
                    <small>
                      Bid {formatPercent(selectedMarket.topBid?.price)} / Ask{" "}
                      {formatPercent(selectedMarket.topAsk?.price)}
                    </small>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-card">Choose a market from the watchlist to inspect depth.</div>
            )}
          </article>

          <div className="detail-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Depth ladder</p>
                  <h2>YES side book</h2>
                </div>
              </div>

              <div className="depth-table">
                <div className="depth-head">
                  <span>Bid px</span>
                  <span>Bid size</span>
                  <span>Ask px</span>
                  <span>Ask size</span>
                </div>

                {Array.from({
                  length: Math.max(
                    selectedMarket?.yesBook?.bids?.length || 0,
                    selectedMarket?.yesBook?.asks?.length || 0
                  ),
                }).map((_, index) => {
                  const bid = selectedMarket?.yesBook?.bids?.[index];
                  const ask = selectedMarket?.yesBook?.asks?.[index];
                  return (
                    <div key={index} className="depth-row">
                      <span>{bid ? formatPercent(bid.price) : "--"}</span>
                      <span>{bid ? formatCurrency(bid.size) : "--"}</span>
                      <span>{ask ? formatPercent(ask.price) : "--"}</span>
                      <span>{ask ? formatCurrency(ask.size) : "--"}</span>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Depth pockets</p>
                  <h2>Liquidity near the midpoint</h2>
                </div>
              </div>

              <div className="pocket-list">
                {(selectedMarket?.focusDepth || []).map((level, index) => (
                  <div key={`${level.price}-${index}`} className="pocket-row">
                    <strong>{formatPercent(level.price)}</strong>
                    <span>{formatCurrency(level.size)} resting size</span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
