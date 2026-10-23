// Headless logic test: runs the real game script inside a stubbed DOM so the
// built-in ?selftest suite executes exactly as it would in a browser.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILT = ['index.html', '合成吴琨石.html'].find(f => fs.existsSync(path.join(ROOT, f)));
if (!BUILT) throw new Error('built html not found: run build/build.py first');
// WK_HTML 可以指向另一份构建产物，用来验证「删掉某个修复后测试会不会红」
const target = process.env.WK_HTML || path.join(ROOT, BUILT);
const html = fs.readFileSync(target, 'utf8');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length !== 2) throw new Error('expected 2 inline scripts, got ' + scripts.length);

/* ---------- tiny DOM stub ---------- */
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    id: '', className: '', textContent: '', _html: '',
    style: { setProperty(k, v) { this[k] = v; }, removeProperty() {} },
    children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { const has = this._s.has(c); const want = f === undefined ? !has : !!f; want ? this._s.add(c) : this._s.delete(c); return want; },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 620, right: 400, bottom: 620 }; },
    setPointerCapture() {}, releasePointerCapture() {},
    getContext() { return ctx2d; },
    focus() {}, blur() {},
    offsetWidth: 100, width: 400, height: 620
  };
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() { return this._html; },
    set(v) { this._html = v; this.children.length = 0; }
  });
  return el;
}

const gradient = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => gradient;
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return canvasEl;
    if (typeof k === 'string') return () => {};
    return undefined;
  },
  set() { return true; }
});

const canvasEl = makeEl('canvas');
const stageEl = makeEl('div');
const els = {};
const IDS = ['board', 'stage', 'overlay', 'toast', 'score', 'best', 'nextImg', 'nextName', 'nextTip',
  'ovChain', 'sideChain', 'ovTitle', 'ovSub', 'ovStats', 'ovBtn', 'ovClose', 'btnSound', 'btnRestart',
  'btnChain', 'hint', 'report'];
IDS.forEach(id => { els[id] = makeEl('div'); els[id].id = id; });
els.board = canvasEl; canvasEl.id = 'board';
els.stage = stageEl;

const body = makeEl('body');
let report = null;
Object.defineProperty(body, 'innerHTML', {
  configurable: true,
  get() { return this._html; },
  set(v) { this._html = v; report = v; }
});

const document = {
  readyState: 'complete',
  title: '',
  body,
  head: makeEl('head'),
  documentElement: makeEl('html'),
  getElementById(id) { return els[id] || (els[id] = makeEl('div')); },
  createElement(tag) { return makeEl(tag); },
  createTextNode(t) { return { textContent: t }; },
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; }
};

let rafCb = null;
const windowObj = {
  document,
  location: { search: '?selftest', href: 'file:///test.html' },
  navigator: { userAgent: 'node' },
  devicePixelRatio: 2,
  innerWidth: 1280, innerHeight: 800,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame(cb) { rafCb = cb; return 1; },
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  ResizeObserver: undefined,
  AudioContext: undefined,
  Image: function () { this.complete = true; this.width = 240; this.height = 240; this.src = ''; },
  URLSearchParams,
  console,
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, isNaN, parseInt, parseFloat,
  Function
};
windowObj.window = windowObj;
windowObj.self = windowObj;
windowObj.globalThis = windowObj;

const context = vm.createContext(windowObj);
try {
  vm.runInContext(scripts[0], context, { filename: 'matter.min.js' });
  vm.runInContext(scripts[1], context, { filename: 'game.js' });
} catch (e) {
  console.error('SCRIPT ERROR:', e && e.stack || e);
  process.exit(2);
}

if (!report) { console.error('selftest did not run'); process.exit(3); }
console.log(report);
const bad = /\bFAIL\b/.test(report);
console.log('\ntitle:', document.title);
process.exit(bad ? 1 : 0);
