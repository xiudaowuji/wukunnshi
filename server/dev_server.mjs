/**
 * 本地跑一遍真实的 worker.js —— 用 Node 自带的 SQLite（node:sqlite）冒充 D1。
 * 不需要 Cloudflare 账号、不需要联网，用来联调前端或验证接口。
 *
 *   node server/dev_server.mjs [端口]
 *
 * 前端指向它：index.html?sub=6666&lbapi=http://127.0.0.1:8787
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const src = readFileSync(here('./worker.js'), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(here('./schema.sql'), 'utf8'));

/* 极简 D1 适配器：只实现 worker 用到的三个方法 */
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind(...a) { args = a; return stmt; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { return { success: true, meta: db.prepare(sql).run(...args) }; }
    };
    return stmt;
  },
  async exec(sql) { db.exec(sql); }
};

const port = Number(process.argv[2] || 8787);

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  // 本地没有真实 IP：带上 X-Forwarded-For 就能模拟不同玩家（方便测限流）
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0';
  const headers = Object.assign({}, req.headers, { 'cf-connecting-ip': clientIp });
  const request = new Request('http://127.0.0.1:' + port + req.url, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
  });

  const out = await worker.fetch(request, { DB });
  const buf = Buffer.from(await out.arrayBuffer());
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(buf);
}).listen(port, '127.0.0.1', () => {
  console.log('leaderboard dev server: http://127.0.0.1:' + port);
  console.log('打开游戏时加参数： index.html?sub=6666&lbapi=http://127.0.0.1:' + port);
});
