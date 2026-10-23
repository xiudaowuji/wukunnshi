/**
 * 合成吴琨石 · 排行榜后端
 * Cloudflare Worker + D1（SQLite）。只有两个公开接口：
 *
 *   GET  /top?limit=20   -> { ok, count, rows:[{rank,name,score,ts}] }
 *   POST /score          -> { ok, rank, best, improved, rows:[...] }
 *        body: { "name": "吴琨", "score": 1234 }
 *
 * 规则：同名只保留最高分（低分不覆盖），同分时先达到的人排前面。
 * 说明：分数由客户端计算，这里只能做范围校验；真正的防作弊需要服务端跑游戏。
 */

const MAX_NAME = 12;
const MAX_SCORE = 100000;
const TOP_DEFAULT = 20;
const TOP_MAX = 50;
const MAX_BODY = 2048;

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 6;                 // 每 IP 每分钟最多 6 次提交
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAY_MAX = 150;                // 每 IP 每天最多 150 次提交

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }, CORS)
  });
}
const fail = (code, status = 400) => json({ ok: false, error: code }, status);

/* ---------- 校验（与前端 lbNormalizeName 保持一致） ---------- */
export function normalizeName(v) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  const cps = Array.from(s);
  if (cps.length > MAX_NAME) s = cps.slice(0, MAX_NAME).join('').trim();
  return s;
}

export function validScore(n) {
  return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n && n >= 0 && n <= MAX_SCORE;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------- 限流：IP 只落哈希，不存明文 ---------- */
async function clientKey(request, env) {
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || '0.0.0.0';
  const salt = env.RATE_SALT || 'wukunnshi-lb';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip));
  return Array.from(new Uint8Array(buf)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function tooManySubmits(env, key, now) {
  const minute = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM submit_log WHERE ip = ? AND ts > ?'
  ).bind(key, now - RATE_WINDOW_MS).first();
  if (minute && minute.c >= RATE_MAX) return true;

  const day = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM submit_log WHERE ip = ? AND ts > ?'
  ).bind(key, now - DAY_WINDOW_MS).first();
  if (day && day.c >= DAY_MAX) return true;

  await env.DB.prepare('INSERT INTO submit_log (ip, ts) VALUES (?, ?)').bind(key, now).run();

  // 偶尔清理一次老日志（1/20 概率），避免表无限增长
  if (Math.random() < 0.05) {
    await env.DB.prepare('DELETE FROM submit_log WHERE ts < ?').bind(now - 7 * DAY_WINDOW_MS).run();
  }
  return false;
}

/* ---------- 查询 ---------- */
async function topRows(env, limit) {
  const { results } = await env.DB.prepare(
    'SELECT name, score, updated_at FROM scores ORDER BY score DESC, updated_at ASC LIMIT ?'
  ).bind(limit).all();
  return (results || []).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    score: r.score,
    ts: r.updated_at
  }));
}

async function rankOf(env, score, name) {
  const mine = await env.DB.prepare(
    'SELECT updated_at FROM scores WHERE name = ?'
  ).bind(name).first();
  if (!mine) return 0;
  const ahead = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM scores WHERE score > ? OR (score = ? AND updated_at < ?)'
  ).bind(score, score, mine.updated_at).first();
  return (ahead ? ahead.c : 0) + 1;
}

/* ---------- 接口 ---------- */
async function handleTop(url, env) {
  const raw = parseInt(url.searchParams.get('limit') || '', 10);
  const limit = clamp(Number.isFinite(raw) ? raw : TOP_DEFAULT, 1, TOP_MAX);
  const rows = await topRows(env, limit);
  return json({ ok: true, count: rows.length, rows });
}

/* ---------- 访问统计 ---------- */
// 同一 IP 同一页面，4 秒内只算一次，防止刷新/连点把 PV 刷爆
const HIT_WINDOW_MS = 4000;
const DAY_OFFSET_MS = 8 * 60 * 60 * 1000;   // 按北京时间分天

function dayOf(ts) {
  return new Date(ts + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

// 页面名只允许字母数字下划线短横线，别的一律当 index
function parsePage(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^[a-z0-9_-]{1,24}$/.test(s) ? s : 'index';
}

async function handleHit(url, request, env) {
  const page = parsePage(url.searchParams.get('p'));
  const now = Date.now();
  const day = dayOf(now);
  const key = await clientKey(request, env);

  const res = await env.DB.prepare(
    'INSERT INTO hits (page, day, ip, n, ts) VALUES (?, ?, ?, 1, ?) ' +
    'ON CONFLICT(page, day, ip) DO UPDATE SET n = n + 1, ts = excluded.ts ' +
    'WHERE excluded.ts - hits.ts >= ?'
  ).bind(page, day, key, now, HIT_WINDOW_MS).run();

  const counted = !!(res && res.meta && res.meta.changes > 0);
  return json({ ok: true, page, counted });
}

async function handleStats(url, env) {
  const page = parsePage(url.searchParams.get('p'));
  const days = clamp(parseInt(url.searchParams.get('days') || '14', 10) || 14, 1, 90);
  const now = Date.now();
  const today = dayOf(now);
  const since = dayOf(now - (days - 1) * 24 * 60 * 60 * 1000);

  const total = await env.DB.prepare(
    'SELECT IFNULL(SUM(n), 0) AS pv, COUNT(DISTINCT ip) AS uv FROM hits WHERE page = ?'
  ).bind(page).first();

  const todayRow = await env.DB.prepare(
    'SELECT IFNULL(SUM(n), 0) AS pv, COUNT(DISTINCT ip) AS uv FROM hits WHERE page = ? AND day = ?'
  ).bind(page, today).first();

  const { results } = await env.DB.prepare(
    'SELECT day, SUM(n) AS pv, COUNT(DISTINCT ip) AS uv FROM hits WHERE page = ? AND day >= ? GROUP BY day ORDER BY day'
  ).bind(page, since).all();

  const byDay = {};
  (results || []).forEach(function (r) { byDay[r.day] = r; });
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOf(now - i * 24 * 60 * 60 * 1000);
    const r = byDay[d];
    series.push({ day: d, pv: r ? r.pv : 0, uv: r ? r.uv : 0 });
  }

  return json({
    ok: true,
    page,
    today: { pv: (todayRow && todayRow.pv) || 0, uv: (todayRow && todayRow.uv) || 0 },
    total: { pv: (total && total.pv) || 0, uv: (total && total.uv) || 0 },
    days: series
  });
}

async function handleSubmit(request, env) {
  let raw;
  try { raw = await request.text(); } catch (e) { return fail('bad_body'); }
  if (raw.length > MAX_BODY) return fail('body_too_large', 413);

  let body;
  try { body = JSON.parse(raw); } catch (e) { return fail('bad_json'); }
  if (!body || typeof body !== 'object') return fail('bad_json');

  const name = normalizeName(body.name);
  if (!name) return fail('bad_name');
  const points = body.score;
  if (!validScore(points)) return fail('bad_score');

  const wall = Date.now();
  const key = await clientKey(request, env);
  if (await tooManySubmits(env, key, wall)) return fail('rate_limited', 429);

  // 一次查询拿到「上一条记录的分数」和「表里最大的时间戳」；
  // updated_at 取 max(当前时间, 最大+1)，保证严格单调——
  // 否则同一毫秒内的两次提交会撞在一起，同分排序就不稳定了。
  const meta = await env.DB.prepare(
    'SELECT (SELECT IFNULL(MAX(updated_at), 0) FROM scores) AS max_ts, ' +
    '(SELECT score FROM scores WHERE name = ?) AS prev_score'
  ).bind(name).first();
  const previous = (meta && meta.prev_score != null) ? meta.prev_score : -1;
  const now = Math.max(wall, ((meta && meta.max_ts) || 0) + 1);

  let improved = false;
  if (points > previous) {
    await env.DB.prepare(
      'INSERT INTO scores (name, score, created_at, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(name) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at'
    ).bind(name, points, now, now).run();
    improved = true;
  }

  const best = improved ? points : previous;
  const rank = await rankOf(env, best, name);
  const rows = await topRows(env, TOP_DEFAULT);
  return json({ ok: true, name, rank, best, improved, rows });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (!env || !env.DB) return fail('db_unavailable', 500);

    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ ok: true, service: 'wukunnshi-leaderboard', ts: Date.now() });
      }
      if (url.pathname === '/top' && request.method === 'GET') {
        return await handleTop(url, env);
      }
      if (url.pathname === '/score' && request.method === 'POST') {
        return await handleSubmit(request, env);
      }
      if (url.pathname === '/hit' && (request.method === 'GET' || request.method === 'POST')) {
        return await handleHit(url, request, env);
      }
      if (url.pathname === '/stats' && request.method === 'GET') {
        return await handleStats(url, env);
      }
      return fail('not_found', 404);
    } catch (e) {
      return fail('server_error', 500);
    }
  }
};
