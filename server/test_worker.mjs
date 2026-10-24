/**
 * 排行榜后端测试：用 Node 自带的 SQLite（node:sqlite）冒充 D1，
 * 把 worker.js 真实地跑一遍——校验、限流、同名取最高、排名顺序。
 *
 *   node server/test_worker.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/* ---------- 把 worker.js 以 ESM 方式加载 ---------- */
const src = readFileSync(here('./worker.js'), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const worker = mod.default;

/* ---------- 极简 D1 适配器 ---------- */
function makeD1(db) {
  return {
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
}

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(here('./schema.sql'), 'utf8'));
const env = { DB: makeD1(db) };

/* ---------- 断言 ---------- */
const out = [];
const ok = (name, cond, extra) => out.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
let ipSeq = 0;
const ip = () => '10.0.0.' + (++ipSeq);

async function call(method, path, body, ipHeader) {
  const headers = { 'cf-connecting-ip': ipHeader || ip() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await worker.fetch(new Request('https://lb.test' + path, {
    method,
    headers,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  }), env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { status: res.status, data, headers: res.headers };
}

/* ---------- 1. 提交与取最高 ---------- */
let r = await call('POST', '/score', { name: '  吴琨  ', score: 500 });
ok('首次提交成功', r.status === 200 && r.data.ok === true, r.status + ' ' + JSON.stringify(r.data && r.data.error));
ok('返回排名 / 最高分', r.data.rank === 1 && r.data.best === 500 && r.data.improved === true,
  'rank=' + (r.data && r.data.rank) + ' best=' + (r.data && r.data.best));
ok('用户名被 trim 后入库', r.data.rows[0].name === '吴琨', JSON.stringify(r.data.rows[0]));

r = await call('POST', '/score', { name: '吴琨', score: 200 });
ok('低分不覆盖', r.data.ok === true && r.data.improved === false && r.data.best === 500,
  JSON.stringify(r.data));

r = await call('POST', '/score', { name: '吴琨', score: 900 });
ok('高分覆盖', r.data.improved === true && r.data.best === 900 && r.data.rank === 1, JSON.stringify(r.data));

const rowsOf = (d) => (d.rows || []).map((x) => x.name + ':' + x.score).join(' ');

r = await call('POST', '/score', { name: '甲', score: 700 });
ok('第二名排到第二', r.data.rank === 2, 'rank=' + r.data.rank + ' ' + rowsOf(r.data));
ok('榜单降序', rowsOf(r.data) === '吴琨:900 甲:700', rowsOf(r.data));

r = await call('POST', '/score', { name: '乙', score: 700 });
ok('同分后来者排后面', r.data.rank === 3, 'rank=' + r.data.rank + ' ' + rowsOf(r.data));

/* ---------- 2. 校验 ---------- */
r = await call('POST', '/score', { name: '   ', score: 10 });
ok('空用户名被拒', r.status === 400 && r.data.error === 'bad_name', JSON.stringify(r.data));

r = await call('POST', '/score', { name: 'x', score: -1 });
ok('负分被拒', r.status === 400 && r.data.error === 'bad_score', JSON.stringify(r.data));

r = await call('POST', '/score', { name: 'x', score: 1.5 });
ok('小数被拒', r.status === 400 && r.data.error === 'bad_score', JSON.stringify(r.data));

r = await call('POST', '/score', { name: 'x', score: 500001 });
ok('超上限被拒', r.status === 400 && r.data.error === 'bad_score', JSON.stringify(r.data));

r = await call('POST', '/score', '{not json');
ok('坏 JSON 被拒', r.status === 400 && r.data.error === 'bad_json', JSON.stringify(r.data));

r = await call('POST', '/score', { name: '一二三四五六七八九十十一十二十三', score: 10 });
ok('超长用户名截到 12 字', r.data.ok === true && r.data.name === '一二三四五六七八九十十一',
  JSON.stringify(r.data.name));

/* ---------- 3. 限流 ---------- */
const floodIp = ip();
let limited = 0;
for (let i = 0; i < 8; i++) {
  const q = await call('POST', '/score', { name: '刷子' + i, score: i }, floodIp);
  if (q.status === 429) limited++;
}
ok('同一 IP 刷 8 次会被限流', limited >= 2, limited + ' blocked');

/* ---------- 4. 读榜 / CORS / 404 ---------- */
r = await call('GET', '/top?limit=2');
ok('limit 生效', r.status === 200 && r.data.rows.length === 2, JSON.stringify(rowsOf(r.data)));
ok('读榜带名次', r.data.rows[0].rank === 1 && r.data.rows[1].rank === 2);

r = await call('GET', '/top?limit=999');
ok('limit 超范围被夹住', r.status === 200 && r.data.rows.length <= 50);

r = await call('GET', '/health');
ok('健康检查', r.status === 200 && r.data.ok === true);

r = await call('GET', '/nope');
ok('未知路径 404', r.status === 404 && r.data.error === 'not_found');

const pre = await worker.fetch(new Request('https://lb.test/score', { method: 'OPTIONS' }), env);
ok('预检返回 CORS', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*');

const badDb = await worker.fetch(new Request('https://lb.test/top'), {});
ok('没绑定数据库时报 500', badDb.status === 500);

/* ---------- 5. 访问统计 ---------- */
const hitIp = ip();
r = await call('GET', '/hit?p=index', undefined, hitIp);
ok('首次访问计数', r.status === 200 && r.data.counted === true, JSON.stringify(r.data));

r = await call('GET', '/hit?p=index', undefined, hitIp);
ok('4 秒内重复访问不计数', r.status === 200 && r.data.counted === false, JSON.stringify(r.data));

r = await call('GET', '/hit?p=index', undefined, ip());
ok('换 IP 算新的 UV', r.data.counted === true, JSON.stringify(r.data));

const st = await call('GET', '/stats?p=index&days=3');
ok('统计返回今天的 PV/UV', st.status === 200 && st.data.today.pv === 2 && st.data.today.uv === 2,
  JSON.stringify(st.data.today));
ok('统计返回按天序列', Array.isArray(st.data.days) && st.data.days.length === 3 && st.data.days[2].pv === 2,
  JSON.stringify(st.data.days));

r = await call('GET', '/hit?p=%3Cscript%3E', undefined, ip());
ok('非法页面名回落到 index', r.status === 200 && r.data.page === 'index', JSON.stringify(r.data));

const st2 = await call('GET', '/stats?p=index&days=90');
ok('days 上限被夹住', st2.status === 200 && st2.data.days.length === 90, 'len=' + st2.data.days.length);

/* ---------- 汇总 ---------- */
console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log('\n' + (failed ? 'FAILED ' + failed : 'ALL PASS') + ' (' + out.length + ' checks)');
process.exit(failed ? 1 : 0);
