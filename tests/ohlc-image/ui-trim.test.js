/* UI-trim test — the two windows that were removed, and their leftovers.
 *
 * Checks that chart-dna-ui-trim.js
 *   - rips out the injected «کندل‌های بازسازی‌شده از همین تصویر» card,
 *   - hides the app's own «رسم چارت و سطوح تحلیل الگو» panel and nothing else,
 *   - sweeps the data our old autopilot wrote (dataset, pattern, reference
 *     price, options) without touching the user's own entries,
 *   - runs the sweep once, respects its switch, and the app's scripts no longer
 *     load the autopilot at all.
 *
 *   node tests/ohlc-image/ui-trim.test.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { JSDOM } = require('jsdom');

const here = __dirname;
const REPO = path.resolve(here, '..', '..');

const OVERLAY_TITLE = 'رسم چارت و سطوح تحلیل الگو';
const STATS_TITLE = 'کارت‌های آماری تحلیل الگو';

const PAGE = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<script src="chart-ohlc-engine.js"></script><script src="chart-ohlc-extractor.js"></script><script src="chart-dna-ui-trim.js"></script>
</head><body><div id="root"><div id="chart-dna-app" dir="rtl">
  <header><button id="btn-header-settings">تنظیمات</button><span>CHART DNA</span></header>
  <div id="image-cropper-card" class="border rounded-2xl p-3"><h2>محیط الگو</h2><canvas id="app-canvas"></canvas></div>
  <div data-panel="overlay" class="bg-slate-900/80 border rounded-2xl p-4">
    <div class="flex items-center justify-between"><svg></svg><span>${OVERLAY_TITLE}</span></div>
    <canvas id="overlay-canvas" width="400" height="220"></canvas>
    <button id="btn-support">حمایت (کف)</button><button id="btn-resistance">مقاومت (سقف)</button>
  </div>
  <div data-panel="stats" class="bg-slate-900/80 border rounded-2xl p-4">
    <span>${STATS_TITLE}</span><p>آماري برای نمایش وجود ندارد</p>
  </div>
  <div id="ohlc-auto-card" class="rounded-2xl p-4">کارتِ قدیمیِ افزونه</div>
</div></div></body></html>`;

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

/* the app's IndexedDB, only as much as the sweep touches */
function makeIdb(recs, log) {
  return {
    databases: () => Promise.resolve([{ name: 'ChartDNA_Storage', version: 1 }]),
    open() {
      const req = {
        result: {
          objectStoreNames: { contains: (n) => n === 'market_datasets' || n === 'metadata' },
          createObjectStore() { },
          transaction(store) {
            const tx = {
              objectStore: () => ({
                getAll() {
                  const r = { result: recs.slice(), onsuccess: null };
                  setTimeout(() => { if (r.onsuccess) r.onsuccess(); }, 0);
                  return r;
                },
                put(rec) { log.puts = (log.puts || []).concat(rec.id); return {}; },
                delete(id) { log.deleted.push(id); return {}; }
              }),
              oncomplete: null, onerror: null
            };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          },
          close() { log.closed = (log.closed || 0) + 1; }
        },
        onupgradeneeded: null, onsuccess: null, onerror: null
      };
      setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    }
  };
}

const SEED = {
  'chartdna_saved_patterns': JSON.stringify([
    { id: 'pat-user', name: 'Double top', category: 'reversal' },
    { id: 'img-882827-1t1fl8c', name: 'Image H1 (from image)' },
    { id: 'img-882827-1t1fl8c-crop', name: 'Image H1 (from image) · کادر برنامه' }
  ]),
  'chartdna_selected_dataset_ids': JSON.stringify(['img-882827-1t1fl8c', 'ds-user-1']),
  'chartdna_reference_price': '4453.83',
  'chartdna_ohlc_ref_price': '4453.83',
  'chartdna_ohlc_auto': '1',
  'chartdna_ohlc_autorun': '1',
  'chartdna_ohlc_pin': '1',
  'chartdna_ohlc_seen_image': '882827',
  'chartdna_ohlc_form': '{"symbol":"XAUUSD"}'
};
const DATASETS = [
  { id: 'ds-user-1', name: 'EURUSD 1h', candles: [1, 2, 3] },
  { id: 'img-882827-1t1fl8c', name: 'Image H1 (from image)', candles: [1, 2, 3] }
];

async function load(seed, recs, log) {
  return JSDOM.fromURL('http://127.0.0.1:' + server.address().port + '/index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(win) {
      win.indexedDB = makeIdb(recs, log);
      win.addEventListener('error', (e) => errors.push('page error: ' + e.message));
      for (const k in (seed || {})) win.localStorage.setItem(k, seed[k]);
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

  /* ---------------------------------------------- 1) the two windows go away */
  console.log('1) both windows are removed from the page');
  const log = { deleted: [] };
  const dom = await load(Object.assign({}, SEED), DATASETS, log);
  const win = dom.window, doc = win.document;
  await sleep(900);

  ok('the reconstructed-candle card is gone', !doc.getElementById('ohlc-auto-card'), doc.getElementById('ohlc-auto-card') ? 'still there' : 'removed');
  const overlay = doc.querySelector('[data-panel="overlay"]');
  const stats = doc.querySelector('[data-panel="stats"]');
  ok('the app\'s pattern overlay panel is hidden', overlay.style.display === 'none' && overlay.hasAttribute('hidden'),
    'display=' + overlay.style.display + ' hidden=' + overlay.hasAttribute('hidden'));
  ok('its canvas and level buttons are inside the node that got hidden',
    overlay.contains(doc.getElementById('overlay-canvas')) && overlay.querySelectorAll('button').length === 2,
    overlay.querySelectorAll('canvas').length + ' canvas, ' + overlay.querySelectorAll('button').length + ' buttons');
  ok('the neighbouring panel is untouched', stats.style.display !== 'none' && !stats.hasAttribute('hidden'), 'visible as before');
  ok('the app header is untouched', doc.getElementById('btn-header-settings').style.display !== 'none');
  ok('the manual extraction button stays (the user asked for it)', !!doc.getElementById('ohlc-open'),
    JSON.stringify((doc.getElementById('ohlc-open') || {}).textContent || ''));
  ok('nothing threw on the page', errors.length === 0, errors.join(' | ') || 'none');
  ok('the trim hook is published for tests', win.ChartDnaUiTrim && win.ChartDnaUiTrim.hidden() === 1, 'v' + (win.ChartDnaUiTrim || {}).version);

  /* a re-render that recreates the panel must be hidden again */
  const parent = overlay.parentElement;
  const clone = doc.createElement('div');
  clone.setAttribute('data-panel', 'overlay2');
  clone.className = 'bg-slate-900/80 border rounded-2xl p-4';
  clone.innerHTML = '<div><span>' + OVERLAY_TITLE + '</span></div><canvas></canvas>';
  parent.appendChild(clone);
  await sleep(700);
  await sleep(900);                                          /* the slow sweep, not only the mutation */
  const fresh = clone.querySelector('canvas').parentElement;
  ok('a panel the app renders later is hidden too', fresh.style.display === 'none' && win.ChartDnaUiTrim.hidden() === 2,
    'hidden=' + win.ChartDnaUiTrim.hidden());

  /* ------------------------------------------------- 2) the data it left behind */
  console.log('2) the leftovers are swept, the user data is not');
  const pats = JSON.parse(win.localStorage.getItem('chartdna_saved_patterns') || '[]');
  ok('our patterns are out of the library, the user\'s stays',
    pats.length === 1 && pats[0].id === 'pat-user', pats.map((p) => p.name).join(' | '));
  ok('our dataset is deleted from the app store', log.deleted.length === 1 && log.deleted[0] === 'img-882827-1t1fl8c',
    'deleted: ' + JSON.stringify(log.deleted));
  ok('the user dataset was not touched', log.deleted.indexOf('ds-user-1') < 0);
  ok('it is dropped from the selection too',
    win.localStorage.getItem('chartdna_selected_dataset_ids') === '["ds-user-1"]', win.localStorage.getItem('chartdna_selected_dataset_ids'));
  ok('the reference price we set is removed', win.localStorage.getItem('chartdna_reference_price') === null,
    JSON.stringify(win.localStorage.getItem('chartdna_reference_price')));
  const rest = [];
  for (let i = 0; i < win.localStorage.length; i++) { const k = win.localStorage.key(i); if (/^chartdna_ohlc_/.test(k)) rest.push(k); }
  ok('every chartdna_ohlc_* key is gone', rest.length === 0, rest.join(',') || 'none left');
  ok('the sweep stamps itself so it runs once', !!win.localStorage.getItem('chartdna_ui_trim_swept'), win.localStorage.getItem('chartdna_ui_trim_swept'));
  ok('the database was closed again', log.closed >= 1, log.closed + ' close()');

  /* ------------------------------------------- 3) already swept / switched off */
  console.log('3) it does not repeat or get in the way');
  const log2 = { deleted: [] };
  const seed2 = {
    'chartdna_ui_trim_swept': '2026-08-30T00:00:00.000Z',
    'chartdna_saved_patterns': JSON.stringify([{ id: 'img-x', name: 'Image H1 (from image)' }])
  };
  const dom2 = await load(seed2, DATASETS, log2);
  await sleep(700);
  const doc2 = dom2.window.document;
  ok('the sweep is skipped when it already ran', log2.deleted.length === 0, JSON.stringify(log2.deleted));
  ok('but the panels are still trimmed',
    !doc2.getElementById('ohlc-auto-card') && doc2.querySelector('[data-panel="overlay"]').style.display === 'none',
    'card gone, overlay hidden');

  const log3 = { deleted: [] };
  const dom3 = await load({ 'chartdna_ui_trim': '0' }, DATASETS, log3);
  await sleep(700);
  const doc3 = dom3.window.document;
  ok('one switch turns the whole script off',
    doc3.querySelector('[data-panel="overlay"]').style.display !== 'none' && !!doc3.getElementById('ohlc-auto-card') && log3.deleted.length === 0,
    'overlay visible, card kept, store untouched');

  /* ------------------------------------------------------ 4) the app does not load us */
  console.log('4) the autopilot is gone from the build');
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
  ok('no autopilot script, no autopilot file',
    !/chart-ohlc-autopilot/.test(html) && !/chart-ohlc-autopilot/.test(sw) && !fs.existsSync(path.join(REPO, 'chart-ohlc-autopilot.js')) &&
    !fs.existsSync(path.join(REPO, 'tests/ohlc-image/autopilot.test.js')), 'file and references removed');
  ok('the trim script is loaded deferred and precached',
    /<script src="chart-dna-ui-trim\.js\?v=(\d+)" defer>/.test(html) && /"chart-dna-ui-trim\.js\?v=\d+"/.test(sw),
    (html.match(/chart-[\w-]+\.js\?v=\d+/g) || []).join(' | '));
  const tags = (html.match(/chart-(?:ohlc|dna)-[\w-]+\.js\?v=(\d+)/g) || []).map((s) => s.slice(-2)).concat(
    (sw.match(/chart-(?:ohlc|dna)-[\w-]+\.js\?v=(\d+)/g) || []).map((s) => s.slice(-2)));
  ok('page and worker agree on one build tag', new Set(tags).size === 1 && tags.length === 6, 'v=' + tags.join(','));
  ok('the worker version says what was removed', /VERSION = "chartdna-v2\.10\.0-remove-ohlc-card-and-overlay"/.test(sw),
    (sw.match(/VERSION = "([^"]+)"/) || [])[1]);

  server.close();
  console.log('');
  if (fails) console.log('FAILED ' + fails + ' of ' + checks + ' checks');
  else console.log('all ' + checks + ' checks passed');
  /* the pages keep timers alive (the trim script re-checks for 20s), and jsdom
     throws if one fires during teardown: end the run instead of waiting for it */
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
