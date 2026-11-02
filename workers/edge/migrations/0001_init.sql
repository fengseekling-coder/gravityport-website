-- gp-stats schema (task 279-A3a). No IP addresses, user agents or full URLs
-- are ever stored.

-- One row per known installation. Timestamps are epoch milliseconds.
CREATE TABLE IF NOT EXISTS installs (
  install_id   TEXT    PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  platform      TEXT    NOT NULL DEFAULT 'unknown',
  arch          TEXT    NOT NULL DEFAULT 'unknown',
  version       TEXT    NOT NULL DEFAULT 'unknown',
  first_launch  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS installs_last_seen_at ON installs (last_seen_at);

-- One row per installation seen on one analytics day (America/Los_Angeles).
-- first_launch marks the day the installation reported a first_launch event.
-- Rows older than 32 days are removed by the daily maintenance job.
CREATE TABLE IF NOT EXISTS daily_active (
  day          TEXT    NOT NULL,
  install_id   TEXT    NOT NULL,
  first_launch INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, install_id)
);

-- Generic per-day counters. (day, kind, key) -> count.
--
-- The "kind" names used by the Worker and the Pages middleware:
--   download_file         successful download GET/Range per file name
--   download_ref          successful download per ?ref= channel ("direct" when absent)
--   download_all          import only: a per-day download request total (the old
--                         usage state kept daily totals without a file breakdown)
--   page_path             site page views per normalized path (edge middleware)
--   page_referrer         page views per referrer site (internal/direct/hostname)
--   page_country          page views per CF-IPCountry value
--   page_device           page views per device class (desktop/mobile/tablet)
--   page_all              import only: a per-day page view total
--   home_page_all         import only: a per-day home page view total
--   bot_page              page requests classified as crawler per path; these are
--                         NOT counted as page views anywhere
--   install_total         folded/imported cumulative number of known installations
--   install_platform      folded/imported cumulative installations per platform
--   install_first_launch  folded/imported cumulative first-launch reports
--   legacy_download_file  import only: legacy cumulative download requests per file (day 'pre-edge')
--   legacy_download_ref   import only: legacy cumulative downloads per ref channel (day 'pre-edge')
--   legacy_page_path      import only: legacy cumulative page views per normalized path (day 'pre-edge')
--   legacy_home_page      import only: legacy cumulative home page views (day 'pre-edge', key 'all')
--   import                import marker rows (usage_state marker, and legacy_coverage_start / legacy_coverage_end)
--
-- The fixed day value "pre-edge" holds imported all-time totals that cannot be
-- split by day. It intentionally sorts after real dates so date-shaped rows win
-- MIN(day) queries used for the page-view switchover note.
CREATE TABLE IF NOT EXISTS counters (
  day   TEXT    NOT NULL,
  kind  TEXT    NOT NULL,
  key   TEXT    NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key)
);
CREATE INDEX IF NOT EXISTS counters_kind ON counters (kind);
