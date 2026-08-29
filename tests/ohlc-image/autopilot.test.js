/* Autopilot test — a mock of the app's pattern workspace in jsdom.
 *
 * The mock reproduces the two contracts the autopilot relies on:
 *   - uploads go through FileReader.readAsDataURL into a data: URL,
 *   - the reference pattern is set from the pattern library inside the settings
 *     modal (#btn-header-settings -> tab "تشخیص و ثبت الگو از تصویر" -> the card
 *     of the pattern -> the button titled "جستجوی فوری این الگو در تمام نمادها").
 * It then checks that a single upload rebuilds the candles, injects the chart
 * card, registers the dataset and ends up driving a DNA search with it.
 *
 *   OHLC_IMG=/path/to/chart-screenshot.jpg node tests/ohlc-image/autopilot.test.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { JSDOM } = require('jsdom');
const napi = require('@napi-rs/canvas');

const here = __dirname;
const REPO = path.resolve(here, '..', '..');
const IMG = process.env.OHLC_IMG;
if (!IMG || !fs.existsSync(IMG)) { console.error('set OHLC_IMG to a chart screenshot (no such file: ' + IMG + ')'); process.exit(2); }
const EXPECT_BARS = 296;

/* a page that behaves like the app around the image workspace */
const PAGE = `<!doctype html><html lang="fa"><head><meta charset="utf-8">
<script src="chart-ohlc-engine.js"></script><script src="chart-ohlc-extractor.js"></script><script src="chart-ohlc-autopilot.js"></script>
</head><body>
<div id="root"><div id="chart-dna-app">
  <div id="image-cropper-card">
    <h2>محیط الگو</h2>
    <input id="app-file" type="file" accept="image/*">
    <canvas id="app-canvas" width="400" height="200"></canvas>
    <button id="btn-header-settings">تنظیمات</button>
  </div>
</div></div>
<script>
  /* --- the app's own upload path (FileReader -> state) --- */
  window.__uploaded = null;
  document.getElementById('app-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { window.__uploaded = r.result; };
    r.readAsDataURL(f);
  });
  /* --- a minimal settings modal with the pattern library tab --- */
  window.__clicks = { settings: 0, tab: 0, search: 0 };
  window.__dnaRun = null;
  const modal = document.createElement('div');
  modal.id = 'settings-modal';
  modal.style.display = 'none';
  document.body.appendChild(modal);
  modal.innerHTML = '<button id="tab-pat">تشخیص و ثبت الگو از تصویر</button><div id="cards"></div>';
  document.getElementById('btn-header-settings').addEventListener('click', () => {
    window.__clicks.settings++; modal.style.display = 'block'; renderCards();
  });
  document.getElementById('tab-pat').addEventListener('click', () => { window.__clicks.tab++; renderCards(); });
  const ac = document.getElementById('app-canvas'); ac.width = 400; ac.height = 200;
  function renderCards() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('chartdna_saved_patterns') || '[]'); } catch (e) { }
    document.getElementById('cards').innerHTML = list.map((p) =>
      '<div class="card" data-id="' + p.id + '"><h5>' + p.name + '</h5>' +
      '<button title="جستجوی فوری این الگو در تمام نمادها">فوری</button>' +
      '<button>انتخاب به عنوان مرجع</button></div>').join('');
    document.querySelectorAll('#cards .card').forEach((card) => {
      const p = list.filter((x) => x.id === card.dataset.id)[0];
      card.querySelector('button[title]').addEventListener('click', () => {
        window.__clicks.search++;
        window.__dnaRun = { name: p.name, points: (p.normalizedPoints || p.points || []).length, id: p.id };
        modal.style.display = 'none';
      });
    });
  }
<\/script></body></html>`;

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html' || u === '/test.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGE);
  }
  const f = path.join(REPO, u.replace(/^\//, ''));
  if (!f.startsWith(REPO) || !fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  res.end(fs.readFileSync(f));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

function patchWindow(win, blobs) {
  const ensure = (el) => { if (!el.__c) el.__c = napi.createCanvas(el.__w || 300, el.__h || 150); return el.__c; };
  const proto = win.HTMLCanvasElement.prototype;
  Object.defineProperty(proto, 'width', { get() { return this.__w || 300; }, set(v) { this.__w = v; this.__c = napi.createCanvas(v, this.__h || 150); } });
  Object.defineProperty(proto, 'height', { get() { return this.__h || 150; }, set(v) { this.__h = v; this.__c = napi.createCanvas(this.__w || 300, v); } });
  proto.getContext = function (kind) {
    if (kind !== '2d') return null;
    const ctx = ensure(this).getContext('2d');
    if (!ctx.__patched) {
      ctx.__patched = true;
      const d = ctx.drawImage.bind(ctx);
      ctx.drawImage = (src, ...a) => d(src && src.__c ? src.__c : (src && src.__canvas) || src, ...a);
      ctx.canvas = this;
    }
    return ctx;
  };
  proto.toBlob = function (cb) { cb(new win.Blob([ensure(this).toBuffer('image/png')], { type: 'image/png' })); };
  class FakeImage {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(v) {
      this.__src = v;
      (async () => {
        let buf;
        if (String(v).indexOf('blob:') === 0) { const b = blobs.get(v); buf = b ? Buffer.from(await b.arrayBuffer()) : fs.readFileSync(IMG); }
        else if (String(v).indexOf('data:') === 0) buf = Buffer.from(String(v).split(',')[1] || '', 'base64');
        else buf = fs.readFileSync(IMG);
        const im = await napi.loadImage(buf);
        this.__c = im; this.naturalWidth = im.width; this.naturalHeight = im.height;
        if (this.onload) this.onload();
      })().catch((e) => { if (this.onerror) this.onerror(e); });
    }
    get src() { return this.__src; }
  }
  win.Image = FakeImage;   /* leave HTMLImageElement alone: the autopilot hooks its src setter */
  win.URL.createObjectURL = (b) => { const u = 'blob:mock/' + (blobs.size + 1); blobs.set(u, b); return u; };
  win.URL.revokeObjectURL = () => { };
  let reloads = 0;
  win.__chartDnaReload = () => { reloads++; win.__reloads = () => reloads; };
}

async function load(seed, blobs) {
  return JSDOM.fromURL('http://127.0.0.1:' + server.address().port + '/index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(win) {
      patchWindow(win, blobs);
      win.indexedDB = seed.idb;
      win.addEventListener('error', (e) => errors.push('page error: ' + e.message));
      for (const k in (seed.sessionStorage || {})) win.sessionStorage.setItem(k, seed.sessionStorage[k]);
      for (const k in (seed.localStorage || {})) win.localStorage.setItem(k, seed.localStorage[k]);
    }
  });
}

let fails = 0, checks = 0;
const ok = (name, cond, info) => {
  checks++;
  if (cond) console.log('  ok   ' + name + (info ? '   [' + info + ']' : ''));
  else { fails++; console.log('  FAIL ' + name + (info ? '   [' + info + ']' : '')); }
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const idbLog = {};
  const idb = {
    open() {
      const req = {
        result: {
          objectStoreNames: { contains: () => true }, createObjectStore() { },
          transaction(store) {
            const tx = { __store: store, objectStore: () => ({ put: (rec) => { idbLog.rec = rec; idbLog.store = tx.__store; (idbLog.puts = idbLog.puts || []).push(rec.id); return { }; } }), oncomplete: null, onerror: null };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          },
          close() { }
        },
        onupgradeneeded: null, onsuccess: null, onerror: null
      };
      setTimeout(() => { if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: req.result } }); if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    }
  };

  /* ---------------- page 0: build hygiene (a stale tag = a stale phone) ------ */
  console.log('0) the app page and the service worker agree');
  const appHtml = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const swJs = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
  const pageTags = [...appHtml.matchAll(/chart-ohlc-[\w-]+\.js\?v=(\d+)/g)].map((m) => m[1]);
  const swTags = [...swJs.matchAll(/chart-ohlc-[\w-]+\.js\?v=(\d+)/g)].map((m) => m[1]);
  const tags = [...appHtml.matchAll(/<script src="(chart-ohlc-[\w-]+\.js\?v=\d+)" defer>/g)].map((m) => m[1]);
  ok('the app page loads all three scripts, deferred after the bundle',
    pageTags.length === 3 && tags.length === 3 &&
    appHtml.indexOf('assets/index-') < appHtml.indexOf('chart-ohlc-engine.js'),
    tags.join(' | ') || 'no defer-tagged script found');
  ok('page and worker agree on one build tag',
    swTags.length === 3 && new Set(pageTags.concat(swTags)).size === 1,
    'html v=' + pageTags.join(',') + ' / sw v=' + swTags.join(','));
  ok('the worker version changes whenever the files do', /VERSION = "chartdna-v2\.[0-9.]+[a-z0-9.-]*"/.test(swJs),
    (swJs.match(/VERSION = "([^"]+)"/) || [])[1]);

  /* ---------------- page 1: upload the picture, watch the pipeline --------- */
  const blobs = new Map();
  const dom = await load({ idb }, blobs);
  const win = dom.window, doc = win.document;
  await sleep(500);
  console.log('1) the autopilot joins the app UI');
  ok('a card was injected next to the app workspace', !!doc.getElementById('ohlc-auto-card'),
    doc.getElementById('ohlc-auto-card') ? doc.getElementById('ohlc-auto-card').previousElementSibling ? 'in the app column' : 'at the end' : 'missing');
  ok('card sits right after the app image card',
    !!doc.getElementById('ohlc-auto-card') && doc.getElementById('image-cropper-card').nextElementSibling === doc.getElementById('ohlc-auto-card'));
  ok('it waits for an image', /در انتظار تصویر/.test(doc.getElementById('ohlc-auto-status').textContent));
  ok('auto options are on by default',
    doc.querySelector('#ohlc-auto-card [data-opt="auto"]').checked && doc.querySelector('#ohlc-auto-card [data-opt="run"]').checked);

  console.log('2) one upload drives everything');
  const file = new win.File([fs.readFileSync(IMG)], 'shot.jpg', { type: 'image/jpeg' });
  Object.defineProperty(doc.getElementById('app-file'), 'files', { value: [file], configurable: true });
  doc.getElementById('app-file').dispatchEvent(new win.Event('change', { bubbles: true }));
  for (let i = 0; i < 160 && !(win.__reloads && win.__reloads() > 0); i++) await sleep(200);
  const status = doc.getElementById('ohlc-auto-status').textContent;
  console.log('   card says:\n' + status.split('\n').map((l) => '     ' + l).join('\n'));
  ok('the app received the file itself (we did not steal it)', typeof win.__uploaded === 'string' && win.__uploaded.indexOf('data:image') === 0, (win.__uploaded || '').slice(0, 24) + '…');
  ok('extraction finished without a page error', errors.length === 0, errors.join(' | ') || 'none');
  ok('candles drawn into the app card', doc.getElementById('ohlc-auto-badge').textContent.trim() === EXPECT_BARS + ' کندل', doc.getElementById('ohlc-auto-badge').textContent);
  const cx = doc.getElementById('ohlc-auto-chart').getContext('2d');
  const px = cx.getImageData(0, 0, doc.getElementById('ohlc-auto-chart').width, doc.getElementById('ohlc-auto-chart').height).data;
  let painted = 0;
  for (let i = 0; i < px.length / 4; i++) if (px[i * 4 + 1] > 100 || px[i * 4] > 150) painted++;
  ok('the injected chart canvas is painted', painted > 1500, painted + ' px');
  ok('price levels and calibration are reported', /بازهٔ قیمت[\s\S]*کالیبراسیون/.test(status) && /۱ پیکسل|1 پیکسل/.test(status));
  ok('review count is reported', /برای بازبینی/.test(status), status.split('\n')[2]);

  ok('the app reference price now comes from the picture', parseFloat(win.localStorage.getItem('chartdna_reference_price')) > 4000, win.localStorage.getItem('chartdna_reference_price'));
  const rec = idbLog.rec;
  ok('dataset registered in the app store', !!rec && rec.candles.length === EXPECT_BARS, rec ? rec.store || 'market_datasets' : 'none');
  ok('dataset selected for searches', (JSON.parse(win.localStorage.getItem('chartdna_selected_dataset_ids') || '[]')).indexOf(rec.id) >= 0, win.localStorage.getItem('chartdna_selected_dataset_ids'));
  ok('image marked as processed', !!win.localStorage.getItem('chartdna_ohlc_seen_image'), win.localStorage.getItem('chartdna_ohlc_seen_image'));
  const plan = JSON.parse(win.sessionStorage.getItem('chartdna_ohlc_dna_plan') || 'null');
  ok('a DNA hand-off is scheduled', !!plan && plan.name === rec.name, JSON.stringify(plan));
  ok('page reload was requested exactly once', win.__reloads() === 1, win.__reloads() + ' reloads');

  /* ---------------- page 2: after the reload the search runs -------------- */
  console.log('3) after the reload the app searches with these candles');
  const pendingPattern = win.sessionStorage.getItem('chartdna_ohlc_pending_pattern');
  /* a real app has written its pattern library to localStorage during mount */
  const seed = {
    chartdna_ohlc_seen_image: win.localStorage.getItem('chartdna_ohlc_seen_image'),
    chartdna_saved_patterns: JSON.stringify([{ id: 'builtin_1', name: 'الگوی داخلی', category: 'Reversal', points: [1, 2, 3, 4, 5], normalizedPoints: [-1, -0.5, 0, 0.5, 1] }])
  };
  const dom2 = await load({
    idb: { open: () => ({ onsuccess: null, onerror: null, result: { objectStoreNames: { contains: () => true }, createObjectStore() { }, transaction: () => ({ objectStore: () => ({ put: () => ({ }) }), oncomplete: null }) } }) },
    localStorage: seed,
    sessionStorage: plan ? { chartdna_ohlc_dna_plan: JSON.stringify(plan), chartdna_ohlc_pending_pattern: pendingPattern } : {}
  }, new Map());
  const win2 = dom2.window, doc2 = win2.document;
  for (let i = 0; i < 120 && !win2.__dnaRun; i++) await sleep(150);
  const lib2 = JSON.parse(win2.localStorage.getItem('chartdna_saved_patterns') || '[]');
  ok('the pattern reached the app library (built-ins kept)', lib2.length === 2 && !!lib2.filter((p) => p.id === 'builtin_1')[0] && /Image/.test(lib2[1].name), lib2.map((p) => p.id).join(','));
  ok('the settings panel was opened', win2.__clicks.settings === 1, win2.__clicks.settings + ' clicks');
  ok('the pattern-from-image tab was chosen', win2.__clicks.tab === 1, win2.__clicks.tab + ' clicks');
  ok('the app started a search with our series', !!win2.__dnaRun, JSON.stringify(win2.__dnaRun));
  ok('the searched pattern is the reconstructed one', !!win2.__dnaRun && win2.__dnaRun.name === rec.name && win2.__dnaRun.points === EXPECT_BARS, win2.__dnaRun ? win2.__dnaRun.points + ' points' : '');
  ok('the hand-off plan is consumed', win2.sessionStorage.getItem('chartdna_ohlc_dna_plan') === null);
  ok('the card reports the successful hand-off', /اجرا شد/.test(doc2.getElementById('ohlc-auto-status').textContent), doc2.getElementById('ohlc-auto-status').textContent.split('\n').pop());
  ok('the same image is not re-extracted after the reload', !/اندازه‌گیری/.test(doc2.getElementById('ohlc-auto-status').textContent), 'no second pass');
  ok('no page errors during the hand-off', errors.filter((e) => /page error/.test(e)).length === 0, errors.join(' | ') || 'none');

  /* --------- page 3: the yellow crop box decides what the search looks for -- */
  console.log('4) the app crop box narrows the pattern (auto-run switched off)');
  const idb3 = { puts: [] };
  const rec3 = {};
  const idb3mock = {
    open() {
      const req = {
        result: {
          objectStoreNames: { contains: () => true }, createObjectStore() { },
          transaction(store) {
            const tx = { __store: store, objectStore: () => ({ put: (rec) => { rec3.rec = rec; (idb3.puts = idb3.puts || []).push(rec.id); return { }; } }), oncomplete: null, onerror: null };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          },
          close() { }
        },
        onupgradeneeded: null, onsuccess: null, onerror: null
      };
      setTimeout(() => { if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: req.result } }); if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    }
  };
  const dom3 = await load({ idb: idb3mock, localStorage: { chartdna_ohlc_autorun: '0', chartdna_reference_price: '1234.5' } }, new Map());
  const win3 = dom3.window, doc3 = win3.document;
  await sleep(400);
  const file3 = new win3.File([fs.readFileSync(IMG)], 'shot.jpg', { type: 'image/jpeg' });
  Object.defineProperty(doc3.getElementById('app-file'), 'files', { value: [file3], configurable: true });
  doc3.getElementById('app-file').dispatchEvent(new win3.Event('change', { bubbles: true }));
  for (let i = 0; i < 160 && !/کندل$/.test(doc3.getElementById('ohlc-auto-badge').textContent.trim()); i++) await sleep(200);
  ok('extracted without the reload (auto-run off)', doc3.getElementById('ohlc-auto-badge').textContent.trim() === EXPECT_BARS + ' کندل', doc3.getElementById('ohlc-auto-badge').textContent);
  const res3 = win3.ChartDnaOhlc.result();
  const cw = doc3.getElementById('app-canvas').width;
  const k = win3.ChartDnaOhlc.image().naturalWidth / cw;                     /* image px per canvas px */
  const bx = Math.round(94 * 400 / cw), bw = Math.round(95 * 400 / cw);       /* draw the box at this size */
  /* draw the app's selection box: canvas x 94..189 -> image x ~637..1281 */
  const g3 = doc3.getElementById('app-canvas').getContext('2d');
  g3.setLineDash([6, 3]); g3.lineWidth = 2.5; g3.strokeStyle = '#eab308';
  g3.strokeRect(bx, 20, bw, 120);
  const scale = res3 && res3.scale ? res3.scale : 1;
  const wantCount = res3.bars.filter((b) => { const nx = b.x / scale; return nx >= bx * k - 2 && nx <= (bx + bw) * k + 2; }).length;
  for (let i = 0; i < 60 && !/در کادر/.test(doc3.getElementById('ohlc-auto-badge').textContent); i++) await sleep(200);
  ok('the yellow box is read back from the app canvas', /در کادر/.test(doc3.getElementById('ohlc-auto-badge').textContent), doc3.getElementById('ohlc-auto-badge').textContent);
  const cropped = +((doc3.getElementById('ohlc-auto-badge').textContent.match(/(\d+) در کادر/) || [])[1] || 0);
  /* the box is read back from its painted outline, so a candle or three at the
     edge can fall either side of it — the point is that it narrowed by ~2/3 */
  ok('pattern uses only the candles inside the crop', cropped > 20 && cropped < EXPECT_BARS && Math.abs(cropped - wantCount) <= 3,
     cropped + ' candles (geometric expectation ' + wantCount + ', box was ' + Math.round((bw) * k) + ' px of ' + win3.ChartDnaOhlc.image().naturalWidth + ')');
  const pend3 = JSON.parse(win3.sessionStorage.getItem('chartdna_ohlc_pending_pattern') || 'null');
  ok('the queued pattern carries exactly those points', !!pend3 && Math.abs(pend3.points.length - cropped) <= 2, pend3 ? pend3.points.length + ' points' : 'nothing queued');
  ok('the dataset still holds the whole picture', !!rec3.rec && rec3.rec.candles.length === EXPECT_BARS, rec3.rec ? rec3.rec.candles.length + ' candles' : 'none');
  ok('the dataset is updated in place, not duplicated', (idb3.puts || []).length >= 2 && new Set(idb3.puts).size === 1, idb3.puts.join(','));
  const st3 = doc3.getElementById('ohlc-auto-status').textContent;
  ok('the card explains what the crop changed', /کادر زرد/.test(st3), st3.split('\n').filter((l) => /کادر/.test(l))[0]);
  /* clearing the box must widen the pattern again */
  g3.clearRect(0, 0, 400, 200);
  for (let i = 0; i < 40 && /در کادر/.test(doc3.getElementById('ohlc-auto-badge').textContent); i++) await sleep(200);
  ok('removing the crop restores the full pattern', !/در کادر/.test(doc3.getElementById('ohlc-auto-badge').textContent), doc3.getElementById('ohlc-auto-badge').textContent);
  /* the manual button still works when the library has nothing to click */
  doc3.querySelector('#ohlc-auto-card [data-act="search"]').click();
  for (let i = 0; i < 120 && !(win3.__reloads && win3.__reloads() > 0); i++) await sleep(200);
  const plan3 = JSON.parse(win3.sessionStorage.getItem('chartdna_ohlc_dna_plan') || 'null');
  ok('the failed attempt opened the app settings itself', win3.__clicks.settings === 1, 'settings clicks ' + win3.__clicks.settings);
  ok('the hand-off survives for the next load and reloads once', win3.__reloads() === 1 && !!plan3 && plan3.tries === 1, JSON.stringify(plan3));
  ok('a reference price typed by the user is never overwritten', win3.localStorage.getItem('chartdna_reference_price') === '1234.5', win3.localStorage.getItem('chartdna_reference_price'));
  ok('still no page errors anywhere', errors.length === 0, errors.join(' | ') || 'none');

  /* --------- page 4: auto extraction OFF -> the manual button must save the day -- */
  console.log('5) auto extraction off: the card must still be usable by hand');
  const rec4 = {};
  const idb4 = {
    open() {
      const req = {
        result: {
          objectStoreNames: { contains: () => true }, createObjectStore() { },
          transaction() {
            const tx = { objectStore: () => ({ put: (rec) => { rec4.rec = rec; return { }; } }), oncomplete: null, onerror: null };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          },
          close() { }
        },
        onupgradeneeded: null, onsuccess: null, onerror: null
      };
      setTimeout(() => { if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: req.result } }); if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    }
  };
  const dom4 = await load({ idb: idb4, localStorage: { chartdna_ohlc_auto: '0' } }, new Map());
  const win4 = dom4.window, doc4 = win4.document;
  await sleep(400);
  const f4 = new win4.File([fs.readFileSync(IMG)], 'shot.jpg', { type: 'image/jpeg' });
  Object.defineProperty(doc4.getElementById('app-file'), 'files', { value: [f4], configurable: true });
  doc4.getElementById('app-file').dispatchEvent(new win4.Event('change', { bubbles: true }));
  await sleep(1500);
  const st4 = doc4.getElementById('ohlc-auto-status').textContent;
  ok('it says the image was seen but auto extraction is off', /دیده شد/.test(st4) && /خاموش/.test(st4), st4.replace(/\n/g, ' | '));
  ok('nothing was registered while auto is off', !rec4.rec, rec4.rec ? 'a dataset appeared' : 'store untouched');
  ok('the card offers a manual extract button', !!doc4.querySelector('#ohlc-auto-card [data-act="now"]'), doc4.querySelector('#ohlc-auto-card [data-act="now"]') ? 'present' : 'missing');
  doc4.querySelector('#ohlc-auto-card [data-act="now"]').click();
  for (let i = 0; i < 200 && !/کندل$/.test(doc4.getElementById('ohlc-auto-badge').textContent.trim()); i++) await sleep(200);
  for (let i = 0; i < 60 && !rec4.rec; i++) await sleep(200);   /* the save finishes a moment after the drawing */
  ok('one tap extracts the app picture anyway', doc4.getElementById('ohlc-auto-badge').textContent.trim() === EXPECT_BARS + ' کندل', doc4.getElementById('ohlc-auto-badge').textContent);
  ok('and registers the dataset from that tap', !!rec4.rec && rec4.rec.candles.length === EXPECT_BARS, rec4.rec ? rec4.rec.candles.length + ' candles' : 'nothing stored');
  ok('no page errors on the manual path', errors.length === 0, errors.join(' | ') || 'none');

  /* --------- page 5: a picture that arrives through Image(), not FileReader ---- */
  console.log('6) an image fed through Image.src (no FileReader) is caught too');
  const dom5 = await load({ idb: { open: () => ({ onsuccess: null, onerror: null, result: { objectStoreNames: { contains: () => true }, createObjectStore() { }, transaction: () => ({ objectStore: () => ({ put: () => ({ }) }), oncomplete: null }) } }) } }, new Map());
  const win5 = dom5.window, doc5 = win5.document;
  await sleep(300);
  win5.__b64 = fs.readFileSync(IMG).toString('base64');
  win5.eval("(function(){var i=document.createElement('img');i.id='synthetic';i.src='data:image/jpeg;base64,'+window.__b64;document.getElementById('image-cropper-card').appendChild(i);})()");
  for (let i = 0; i < 160 && !/کندل$/.test(doc5.getElementById('ohlc-auto-badge').textContent.trim()); i++) await sleep(200);
  ok('the Image.src hook picked it up', doc5.getElementById('ohlc-auto-badge').textContent.trim() === EXPECT_BARS + ' کندل', doc5.getElementById('ohlc-auto-badge').textContent);

  await new Promise((r) => server.close(r));
  console.log('\n' + (fails ? 'FAILED ' + fails + ' of ' + checks + ' checks' : 'all ' + checks + ' checks passed'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
