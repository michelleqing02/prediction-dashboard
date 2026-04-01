CREATE OR REPLACE TABLE sandbox.shared.codex_wcbb_match_performance_2026_event_agg
USING DELTA AS
WITH filtered AS (
  SELECT
    CONCAT(CAST(CAST(leg_event_start_ts AS DATE) AS STRING), '::', COALESCE(NULLIF(leg_event_name_reporting, ''), 'Unspecified Event')) AS event_key,
    '2025-2026' AS season_label,
    COALESCE(NULLIF(leg_competition_name_reporting, ''), 'Unspecified Competition') AS competition_name,
    CAST(leg_event_start_ts AS DATE) AS event_date,
    COALESCE(NULLIF(leg_event_name_reporting, ''), 'Unspecified Event') AS event_name,
    COALESCE(NULLIF(leg_market_name_reporting, ''), 'Unspecified Market') AS market_name,
    COALESCE(NULLIF(leg_selection_name_openbet, ''), selection_identity_signature, 'Unknown Selection') AS selection_name,
    CAST(bet_id AS STRING) AS bet_id,
    CAST(fanduel_user_id AS STRING) AS user_id,
    CAST(bet_stake_factor AS DOUBLE) AS stake_factor,
    CASE
      WHEN CAST(bet_stake_factor AS DOUBLE) < 1 THEN 'Limited (<1x)'
      WHEN CAST(bet_stake_factor AS DOUBLE) > 1 THEN 'Elevated (>1x)'
      WHEN CAST(bet_stake_factor AS DOUBLE) = 1 THEN 'Standard (1x)'
      ELSE 'Unknown'
    END AS stake_factor_band,
    CASE WHEN COALESCE(is_event_in_play, FALSE) THEN 'Live' ELSE 'Prematch' END AS live_bucket,
    CASE
      WHEN LOWER(COALESCE(leg_selection_name_openbet, '')) LIKE 'over%' THEN 'Over'
      WHEN LOWER(COALESCE(leg_selection_name_openbet, '')) LIKE 'under%' THEN 'Under'
      ELSE 'Other'
    END AS selection_side,
    CASE
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%moneyline%' THEN 'Moneyline'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%spread%' THEN 'Spread'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%total%' THEN 'Total'
      ELSE 'Other'
    END AS market_type_group,
    CAST(bet_placed_ts AS DATE) AS bet_date,
    CAST(leg_gross_stake_amount AS DOUBLE) AS handle,
    CAST(leg_gross_gaming_revenue_amount AS DOUBLE) AS gross_gaming_revenue
  FROM core_views.sportsbook.bet_legs
  WHERE CAST(bet_placed_ts AS DATE) >= DATE '2026-02-01'
    AND LOWER(COALESCE(leg_competition_name_reporting, '')) = 'wncaab matches'
    AND COALESCE(is_customer_account, FALSE) = TRUE
),
per_bet_selection AS (
  SELECT
    event_key,
    season_label,
    competition_name,
    event_date,
    event_name,
    market_name,
    selection_name,
    bet_id,
    MAX(user_id) AS user_id,
    MAX(live_bucket) AS live_bucket,
    MAX(stake_factor) AS stake_factor,
    MAX(stake_factor_band) AS stake_factor_band,
    MAX(selection_side) AS selection_side,
    MAX(market_type_group) AS market_type_group,
    MIN(bet_date) AS first_bet_date,
    MAX(bet_date) AS last_bet_date,
    ROUND(SUM(handle), 2) AS handle,
    ROUND(SUM(gross_gaming_revenue), 2) AS gross_gaming_revenue
  FROM filtered
  GROUP BY
    event_key,
    season_label,
    competition_name,
    event_date,
    event_name,
    market_name,
    selection_name,
    bet_id
)
SELECT
  event_key,
  season_label,
  competition_name,
  event_date,
  event_name,
  live_bucket,
  stake_factor,
  stake_factor_band,
  COUNT(*) AS ticket_count,
  APPROX_COUNT_DISTINCT(user_id) AS bettor_count,
  ROUND(SUM(handle), 2) AS handle,
  ROUND(SUM(gross_gaming_revenue), 2) AS gross_gaming_revenue,
  CASE WHEN SUM(handle) = 0 THEN NULL ELSE ROUND(SUM(gross_gaming_revenue) / SUM(handle), 6) END AS margin,
  ROUND(SUM(CASE WHEN selection_side = 'Over' THEN handle ELSE 0 END), 2) AS over_handle,
  ROUND(SUM(CASE WHEN selection_side = 'Over' THEN gross_gaming_revenue ELSE 0 END), 2) AS over_ggr,
  CASE
    WHEN SUM(CASE WHEN selection_side = 'Over' THEN handle ELSE 0 END) = 0 THEN NULL
    ELSE ROUND(
      SUM(CASE WHEN selection_side = 'Over' THEN gross_gaming_revenue ELSE 0 END)
      / SUM(CASE WHEN selection_side = 'Over' THEN handle ELSE 0 END),
      6
    )
  END AS over_margin,
  ROUND(SUM(CASE WHEN selection_side = 'Under' THEN handle ELSE 0 END), 2) AS under_handle,
  ROUND(SUM(CASE WHEN selection_side = 'Under' THEN gross_gaming_revenue ELSE 0 END), 2) AS under_ggr,
  CASE
    WHEN SUM(CASE WHEN selection_side = 'Under' THEN handle ELSE 0 END) = 0 THEN NULL
    ELSE ROUND(
      SUM(CASE WHEN selection_side = 'Under' THEN gross_gaming_revenue ELSE 0 END)
      / SUM(CASE WHEN selection_side = 'Under' THEN handle ELSE 0 END),
      6
    )
  END AS under_margin,
  ROUND(SUM(CASE WHEN market_type_group = 'Moneyline' THEN handle ELSE 0 END), 2) AS moneyline_handle,
  ROUND(SUM(CASE WHEN market_type_group = 'Spread' THEN handle ELSE 0 END), 2) AS spread_handle,
  ROUND(SUM(CASE WHEN market_type_group = 'Total' THEN handle ELSE 0 END), 2) AS total_handle,
  ROUND(SUM(CASE WHEN market_type_group = 'Other' THEN handle ELSE 0 END), 2) AS other_handle,
  MIN(first_bet_date) AS first_bet_date,
  MAX(last_bet_date) AS last_bet_date,
  CURRENT_TIMESTAMP() AS aggregated_at
FROM per_bet_selection
GROUP BY
  event_key,
  season_label,
  competition_name,
  event_date,
  event_name,
  live_bucket,
  stake_factor,
  stake_factor_band
HAVING SUM(handle) > 0
;

CREATE OR REPLACE TABLE sandbox.shared.codex_wcbb_match_performance_2026_market_agg
USING DELTA AS
WITH filtered AS (
  SELECT
    CONCAT(CAST(CAST(leg_event_start_ts AS DATE) AS STRING), '::', COALESCE(NULLIF(leg_event_name_reporting, ''), 'Unspecified Event')) AS event_key,
    CONCAT(
      CAST(CAST(leg_event_start_ts AS DATE) AS STRING),
      '::',
      COALESCE(NULLIF(leg_event_name_reporting, ''), 'Unspecified Event'),
      '::',
      COALESCE(NULLIF(leg_market_name_reporting, ''), 'Unspecified Market')
    ) AS market_key,
    '2025-2026' AS season_label,
    COALESCE(NULLIF(leg_competition_name_reporting, ''), 'Unspecified Competition') AS competition_name,
    CAST(leg_event_start_ts AS DATE) AS event_date,
    COALESCE(NULLIF(leg_event_name_reporting, ''), 'Unspecified Event') AS event_name,
    COALESCE(NULLIF(leg_market_name_reporting, ''), 'Unspecified Market') AS market_name,
    COALESCE(NULLIF(leg_selection_name_openbet, ''), selection_identity_signature, 'Unknown Selection') AS selection_name,
    CAST(bet_id AS STRING) AS bet_id,
    CAST(fanduel_user_id AS STRING) AS user_id,
    CAST(bet_stake_factor AS DOUBLE) AS stake_factor,
    CASE
      WHEN CAST(bet_stake_factor AS DOUBLE) < 1 THEN 'Limited (<1x)'
      WHEN CAST(bet_stake_factor AS DOUBLE) > 1 THEN 'Elevated (>1x)'
      WHEN CAST(bet_stake_factor AS DOUBLE) = 1 THEN 'Standard (1x)'
      ELSE 'Unknown'
    END AS stake_factor_band,
    CASE WHEN COALESCE(is_event_in_play, FALSE) THEN 'Live' ELSE 'Prematch' END AS live_bucket,
    CASE
      WHEN LOWER(COALESCE(leg_selection_name_openbet, '')) LIKE 'over%' THEN 'Over'
      WHEN LOWER(COALESCE(leg_selection_name_openbet, '')) LIKE 'under%' THEN 'Under'
      ELSE 'Other'
    END AS selection_side,
    CASE
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%moneyline%' THEN 'Moneyline'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%spread%' THEN 'Spread'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%team total%' THEN 'Team Total'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%total%' THEN 'Total'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%quarter%' THEN 'Quarter'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%half%' THEN 'Half'
      ELSE 'Other'
    END AS market_type_group,
    CASE
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%1st half%' THEN '1st Half'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%2nd half%' THEN '2nd Half'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%quarter%' THEN 'Quarter'
      ELSE 'Full Game'
    END AS period_group,
    CAST(bet_placed_ts AS DATE) AS bet_date,
    CAST(leg_gross_stake_amount AS DOUBLE) AS handle,
    CAST(leg_gross_gaming_revenue_amount AS DOUBLE) AS gross_gaming_revenue
  FROM core_views.sportsbook.bet_legs
  WHERE CAST(bet_placed_ts AS DATE) >= DATE '2026-02-01'
    AND LOWER(COALESCE(leg_competition_name_reporting, '')) = 'wncaab matches'
    AND COALESCE(is_customer_account, FALSE) = TRUE
),
per_bet_selection AS (
  SELECT
    event_key,
    market_key,
    season_label,
    competition_name,
    event_date,
    event_name,
    market_name,
    selection_name,
    bet_id,
    MAX(user_id) AS user_id,
    MAX(live_bucket) AS live_bucket,
    MAX(stake_factor) AS stake_factor,
    MAX(stake_factor_band) AS stake_factor_band,
    MAX(selection_side) AS selection_side,
    MAX(market_type_group) AS market_type_group,
    MAX(period_group) AS period_group,
    MIN(bet_date) AS first_bet_date,
    MAX(bet_date) AS last_bet_date,
    ROUND(SUM(handle), 2) AS handle,
    ROUND(SUM(gross_gaming_revenue), 2) AS gross_gaming_revenue
  FROM filtered
  GROUP BY
    event_key,
    market_key,
    season_label,
    competition_name,
    event_date,
    event_name,
    market_name,
    selection_name,
    bet_id
)
SELECT
  event_key,
  market_key,
  season_label,
  competition_name,
  event_date,
  event_name,
  market_name,
  market_type_group,
  period_group,
  live_bucket,
  stake_factor,
  stake_factor_band,
  COUNT(*) AS ticket_count,
  APPROX_COUNT_DISTINCT(user_id) AS bettor_count,
  ROUND(SUM(handle), 2) AS handle,
  ROUND(SUM(gross_gaming_revenue), 2) AS gross_gaming_revenue,
  CASE WHEN SUM(handle) = 0 THEN NULL ELSE ROUND(SUM(gross_gaming_revenue) / SUM(handle), 6) END AS margin,
  ROUND(SUM(CASE WHEN selection_side = 'Over' THEN handle ELSE 0 END), 2) AS over_handle,
  ROUND(SUM(CASE WHEN selection_side = 'Over' THEN gross_gaming_revenue ELSE 0 END), 2) AS over_ggr,
  CASE
    WHEN SUM(CASE WHEN selection_side = 'Over' THEN handle ELSE 0 END) = 0 THEN NULL
    ELSE ROUND(
      SUM(CASE WHEN selection_side = 'Over' THEN gross_gaming_revenue ELSE 0 END)
      / SUM(CASE WHEN selection_side = 'Over' THEN handle ELSE 0 END),
      6
    )
  END AS over_margin,
  ROUND(SUM(CASE WHEN selection_side = 'Under' THEN handle ELSE 0 END), 2) AS under_handle,
  ROUND(SUM(CASE WHEN selection_side = 'Under' THEN gross_gaming_revenue ELSE 0 END), 2) AS under_ggr,
  CASE
    WHEN SUM(CASE WHEN selection_side = 'Under' THEN handle ELSE 0 END) = 0 THEN NULL
    ELSE ROUND(
      SUM(CASE WHEN selection_side = 'Under' THEN gross_gaming_revenue ELSE 0 END)
      / SUM(CASE WHEN selection_side = 'Under' THEN handle ELSE 0 END),
      6
    )
  END AS under_margin,
  MIN(first_bet_date) AS first_bet_date,
  MAX(last_bet_date) AS last_bet_date,
  CURRENT_TIMESTAMP() AS aggregated_at
FROM per_bet_selection
GROUP BY
  event_key,
  market_key,
  season_label,
  competition_name,
  event_date,
  event_name,
  market_name,
  market_type_group,
  period_group,
  live_bucket,
  stake_factor,
  stake_factor_band
HAVING SUM(handle) > 0
;

CREATE OR REPLACE TABLE sandbox.shared.codex_wcbb_match_performance_2026_selection_agg
USING DELTA AS
WITH filtered AS (
  SELECT
    CONCAT(CAST(CAST(leg_event_start_ts AS DATE) AS STRING), '::', COALESCE(NULLIF(leg_event_name_reporting, ''), 'Unspecified Event')) AS event_key,
    CONCAT(
      CAST(CAST(leg_event_start_ts AS DATE) AS STRING),
      '::',
      COALESCE(NULLIF(leg_event_name_reporting, ''), 'Unspecified Event'),
      '::',
      COALESCE(NULLIF(leg_market_name_reporting, ''), 'Unspecified Market')
    ) AS market_key,
    '2025-2026' AS season_label,
    COALESCE(NULLIF(leg_competition_name_reporting, ''), 'Unspecified Competition') AS competition_name,
    CAST(leg_event_start_ts AS DATE) AS event_date,
    COALESCE(NULLIF(leg_event_name_reporting, ''), 'Unspecified Event') AS event_name,
    COALESCE(NULLIF(leg_market_name_reporting, ''), 'Unspecified Market') AS market_name,
    COALESCE(NULLIF(leg_selection_name_openbet, ''), selection_identity_signature, 'Unknown Selection') AS selection_name,
    CAST(bet_id AS STRING) AS bet_id,
    CAST(fanduel_user_id AS STRING) AS user_id,
    CAST(bet_stake_factor AS DOUBLE) AS stake_factor,
    CASE
      WHEN CAST(bet_stake_factor AS DOUBLE) < 1 THEN 'Limited (<1x)'
      WHEN CAST(bet_stake_factor AS DOUBLE) > 1 THEN 'Elevated (>1x)'
      WHEN CAST(bet_stake_factor AS DOUBLE) = 1 THEN 'Standard (1x)'
      ELSE 'Unknown'
    END AS stake_factor_band,
    CASE WHEN COALESCE(is_event_in_play, FALSE) THEN 'Live' ELSE 'Prematch' END AS live_bucket,
    CASE
      WHEN LOWER(COALESCE(leg_selection_name_openbet, '')) LIKE 'over%' THEN 'Over'
      WHEN LOWER(COALESCE(leg_selection_name_openbet, '')) LIKE 'under%' THEN 'Under'
      ELSE 'Other'
    END AS selection_side,
    CASE
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%moneyline%' THEN 'Moneyline'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%spread%' THEN 'Spread'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%team total%' THEN 'Team Total'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%total%' THEN 'Total'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%quarter%' THEN 'Quarter'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%half%' THEN 'Half'
      ELSE 'Other'
    END AS market_type_group,
    CASE
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%1st half%' THEN '1st Half'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%2nd half%' THEN '2nd Half'
      WHEN LOWER(COALESCE(leg_market_name_reporting, '')) LIKE '%quarter%' THEN 'Quarter'
      ELSE 'Full Game'
    END AS period_group,
    CAST(bet_placed_ts AS DATE) AS bet_date,
    CAST(leg_gross_stake_amount AS DOUBLE) AS handle,
    CAST(leg_gross_gaming_revenue_amount AS DOUBLE) AS gross_gaming_revenue
  FROM core_views.sportsbook.bet_legs
  WHERE CAST(bet_placed_ts AS DATE) >= DATE '2026-02-01'
    AND LOWER(COALESCE(leg_competition_name_reporting, '')) = 'wncaab matches'
    AND COALESCE(is_customer_account, FALSE) = TRUE
),
per_bet_selection AS (
  SELECT
    event_key,
    market_key,
    season_label,
    competition_name,
    event_date,
    event_name,
    market_name,
    selection_name,
    bet_id,
    MAX(user_id) AS user_id,
    MAX(live_bucket) AS live_bucket,
    MAX(stake_factor) AS stake_factor,
    MAX(stake_factor_band) AS stake_factor_band,
    MAX(selection_side) AS selection_side,
    MAX(market_type_group) AS market_type_group,
    MAX(period_group) AS period_group,
    MIN(bet_date) AS first_bet_date,
    MAX(bet_date) AS last_bet_date,
    ROUND(SUM(handle), 2) AS handle,
    ROUND(SUM(gross_gaming_revenue), 2) AS gross_gaming_revenue
  FROM filtered
  GROUP BY
    event_key,
    market_key,
    season_label,
    competition_name,
    event_date,
    event_name,
    market_name,
    selection_name,
    bet_id
)
SELECT
  event_key,
  market_key,
  season_label,
  competition_name,
  event_date,
  event_name,
  market_name,
  market_type_group,
  period_group,
  selection_name,
  selection_side,
  live_bucket,
  stake_factor,
  stake_factor_band,
  COUNT(*) AS ticket_count,
  APPROX_COUNT_DISTINCT(user_id) AS bettor_count,
  ROUND(SUM(handle), 2) AS handle,
  ROUND(SUM(gross_gaming_revenue), 2) AS gross_gaming_revenue,
  CASE WHEN SUM(handle) = 0 THEN NULL ELSE ROUND(SUM(gross_gaming_revenue) / SUM(handle), 6) END AS margin,
  MIN(first_bet_date) AS first_bet_date,
  MAX(last_bet_date) AS last_bet_date,
  CURRENT_TIMESTAMP() AS aggregated_at
FROM per_bet_selection
GROUP BY
  event_key,
  market_key,
  season_label,
  competition_name,
  event_date,
  event_name,
  market_name,
  market_type_group,
  period_group,
  selection_name,
  selection_side,
  live_bucket,
  stake_factor,
  stake_factor_band
HAVING SUM(handle) > 0
;
