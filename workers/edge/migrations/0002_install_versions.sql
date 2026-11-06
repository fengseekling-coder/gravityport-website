CREATE TABLE IF NOT EXISTS install_versions (
  install_id    TEXT    NOT NULL,
  version       TEXT    NOT NULL,
  first_seen_at INTEGER,          -- 这个安装第一次报这个版本的时间（epoch ms）；NULL = 记录开始前就在用，时间不明
  from_version  TEXT,             -- 报这个版本之前 installs 里记着的版本；新安装为 NULL
  PRIMARY KEY (install_id, version)
);
CREATE INDEX IF NOT EXISTS install_versions_version ON install_versions (version);
-- 回填：现有每个安装的当前版本，时间不明
INSERT OR IGNORE INTO install_versions (install_id, version, first_seen_at, from_version)
  SELECT install_id, version, NULL, NULL FROM installs;
