-- 合成吴琨石 · 排行榜表结构（Cloudflare D1 / SQLite）
-- 部署：npx wrangler d1 execute wukunnshi-lb --remote --file=server/schema.sql

CREATE TABLE IF NOT EXISTS scores (
  name       TEXT    PRIMARY KEY,
  score      INTEGER NOT NULL CHECK (score >= 0 AND score <= 100000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 榜单查询：分数降序，同分时先达到的人在前
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (score DESC, updated_at ASC);

-- 限流日志：只存 IP 的哈希，7 天自动清理
CREATE TABLE IF NOT EXISTS submit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT    NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submit_log ON submit_log (ip, ts);
