-- 把分数上限从 100000 放宽到 500000
-- SQLite 不能修改已有的 CHECK 约束，只能重建表（保留原数据）
-- 执行：npx wrangler d1 execute wukunnshi-lb --remote --file=server/migrate_score_cap.sql

CREATE TABLE IF NOT EXISTS scores_new (
  name       TEXT    PRIMARY KEY,
  score      INTEGER NOT NULL CHECK (score >= 0 AND score <= 500000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR REPLACE INTO scores_new (name, score, created_at, updated_at)
  SELECT name, score, created_at, updated_at FROM scores;

DROP TABLE scores;

ALTER TABLE scores_new RENAME TO scores;

CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (score DESC, updated_at ASC);
