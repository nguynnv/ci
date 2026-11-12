CREATE TABLE IF NOT EXISTS guilds (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(64) NULL,
  description VARCHAR(500) NULL,
  invite_url VARCHAR(200) NULL,
  channels JSON NULL,
  selected_channels JSON NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  paused TINYINT(1) NOT NULL DEFAULT 0,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  blocked TINYINT(1) NOT NULL DEFAULT 0,
  admin_note VARCHAR(500) NULL,
  bot_present TINYINT(1) NOT NULL DEFAULT 1,
  consented_at DATETIME NULL,
  last_heartbeat DATETIME NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE guilds ADD COLUMN hidden TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE guilds ADD COLUMN blocked TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE guilds ADD COLUMN admin_note VARCHAR(500) NULL;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(80) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  type ENUM('message','join','leave') NOT NULL,
  ts DATETIME(3) NOT NULL,
  channel_key VARCHAR(20) NULL,
  actor_key CHAR(24) NOT NULL,
  target_key CHAR(24) NULL,
  is_reply TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  UNIQUE KEY uq_event (event_id),
  KEY ix_guild_ts (guild_id, ts),
  KEY ix_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS daily_metrics (
  guild_id VARCHAR(20) NOT NULL,
  day DATE NOT NULL,
  unique_active INT NOT NULL DEFAULT 0,
  messages INT NOT NULL DEFAULT 0,
  sessions INT NOT NULL DEFAULT 0,
  replies INT NOT NULL DEFAULT 0,
  joins INT NOT NULL DEFAULT 0,
  leaves INT NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS score_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  scoring_version VARCHAR(16) NOT NULL,
  snap_date DATE NOT NULL,
  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,
  activity DECIMAL(5,1) NULL,
  welcoming DECIMAL(5,1) NULL,
  overall DECIMAL(5,1) NULL,
  confidence DECIMAL(5,1) NOT NULL,
  percentile DECIMAL(5,1) NULL,
  ranking_status VARCHAR(16) NOT NULL,
  breakdown JSON NOT NULL,
  computed_at DATETIME NOT NULL,
  UNIQUE KEY uq_snap (guild_id, scoring_version, snap_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  guild_id VARCHAR(20) NULL,
  actor_id VARCHAR(20) NULL,
  action VARCHAR(32) NOT NULL,
  meta JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(40) PRIMARY KEY,
  v VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS appeals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  snapshot_id BIGINT NULL,
  message VARCHAR(1000) NOT NULL,
  status ENUM('open','resolved','rejected') NOT NULL DEFAULT 'open',
  admin_reply VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  KEY ix_status (status, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS score_adjustments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  delta DECIMAL(5,1) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  actor_id VARCHAR(20) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_adjustment_guild (guild_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
