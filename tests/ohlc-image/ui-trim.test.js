/* UI-trim test — the two windows that were removed, and their leftovers.
 *
 * Checks that chart-dna-ui-trim.js
 *   - rips out the injected «کندل‌های بازسازی‌شده از همین تصویر» card,
 *   - hides the app's own «رسم چارت و سطوح تحلیل الگو» panel and nothing else,
 *   - sweeps the data our old autopilot wrote (dataset, pattern, reference
 *     price, options) without touching the user's own entries,
 *   - and deletes the upload block in the middle of «محیط الگو» together with
 *     the file input it opens, leaving the crop canvas and the card header alone.
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
  <div id="image-cropper-card" class="border rounded-2xl p-3 flex flex-col gap-2.5 overflow-hidden">
    <div id="crop-head" class="flex flex-wrap items-center justify-between gap-1.5">
      <div class="flex items-center gap-1.5"><svg></svg><h2 class="text-xs font-bold">محیط الگو</h2><span>296 pts</span></div>
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-slate-400">قیمت مرجع:</span><span>تعیین نشده</span>
        <button id="btn-ref" title="تنظیم دستی قیمت مرجع برای تمام تحلیل‌ها">تنظیم</button>
        <input id="crop-file" type="file" accept="image/*" class="hidden">
      </div>
    </div>
    <div id="crop-stage" class="relative flex-1 border rounded-xl overflow-hidden flex items-center justify-center min-h-0">
      <div id="crop-empty" class="flex flex-col items-center justify-center gap-2 text-center p-4 cursor-pointer transition-colors w-full h-full">
        <div class="w-11 h-11 rounded-2xl border flex items-center justify-center"><svg></svg></div>
        <div>
          <p class="text-xs font-semibold">تصویر چارت را بکشید و اینجا رها کنید</p>
          <p class="text-[11px] mt-0.5">کادر زرد رنگ را روی بخش مورد نظر از نمودار تنظیم کنید</p>
        </div>
      </div>
      <div id="crop-view" class="w-full h-full flex items-center justify-center p-2 overflow-auto" style="display:none">
        <canvas id="app-canvas" width="400" height="200"></canvas>
      </div>
    </div>
    <div id="crop-status" class="text-xs font-mono px-3 py-1.5 border rounded-lg flex items-center gap-2"><span class="w-2 h-2 rounded-full animate-pulse"></span><span>آماده</span></div>
  </div>
  <div data-panel="overlay" id="pattern-overlay-canvas-card" class="bg-slate-900/80 border rounded-2xl p-4">
    <div class="flex items-center justify-between"><svg></svg><span>${OVERLAY_TITLE}</span></div>
    <canvas id="overlay-canvas" width="400" height="220"></canvas>
    <button id="btn-support">حمایت (کف)</button><button id="btn-resistance">مقاومت (سقف)</button>
  </div>
  <div data-panel="stats" id="pattern-stats-cards-card" class="bg-slate-900/80 border rounded-2xl p-2.5">
    <div class="flex items-center justify-between"><svg></svg><span>${STATS_TITLE}</span></div>
    <p>آماري برای نمایش وجود ندارد</p><div class="rounded-lg">H: 4454.93</div>
  </div>
  <div data-panel="trend" class="bg-slate-900/80 border rounded-2xl p-4">
    <span>خلاصه روند</span><p>صعودی</p>
  </div>
  <div id="ohlc-auto-card" class="rounded-2xl p-4">کارتِ قدیمیِ افزونه</div>
  <div id="ohlc-tool" class="ohlc-pinned" style="top:60px;left:796px"><button id="ohlc-open">📈 استخراج OHLC از تصویر</button></div>
</div></div>
<script>
/* the card's own behaviour, exactly as the bundle wires it: the centred block is the
   upload control (its click opens the hidden file input), the canvas takes the crop box */
window.__browse = 0; window.__inputClicks = 0; window.__drops = 0; window.__canvasClicks = 0;
var empty = document.getElementById('crop-empty'), inp = document.getElementById('crop-file');
empty.addEventListener('click', function () { window.__browse++; inp.click(); });
inp.addEventListener('click', function () { window.__inputClicks++; });
document.getElementById('crop-stage').addEventListener('drop', function (e) { window.__drops++; e.preventDefault(); });
document.getElementById('app-canvas').addEventListener('click', function () { window.__canvasClicks++; });
</script>
</body></html>`;

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
  console.log('1) the three windows are removed from the page');
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
  ok('the stats/targets card is hidden too, by its own id',
    stats.style.display === 'none' && stats.hasAttribute('hidden'), 'display=' + stats.style.display);
  ok('a panel nobody asked about is untouched',
    doc.querySelector('[data-panel="trend"]').style.display !== 'none' && !doc.querySelector('[data-panel="trend"]').hasAttribute('hidden'),
    'خلاصه روند visible as before');
  ok('the app header is untouched', doc.getElementById('btn-header-settings').style.display !== 'none');
  ok('the app root is never hidden', doc.getElementById('chart-dna-app').style.display !== 'none', 'chart-dna-app visible');
  ok('the old floating opener is gone too, not just hidden',
    !doc.getElementById('ohlc-tool') && !doc.getElementById('ohlc-open'),
    doc.getElementById('ohlc-tool') ? 'still in the DOM' : 'removed');
  ok('nothing threw on the page', errors.length === 0, errors.join(' | ') || 'none');
  ok('the trim hook is published for tests', win.ChartDnaUiTrim && win.ChartDnaUiTrim.hidden() === 2 && win.ChartDnaUiTrim.ids.length === 2,
    'v' + (win.ChartDnaUiTrim || {}).version + ' hiding ' + (win.ChartDnaUiTrim || {}).hidden());

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
  /* an old cached build would put its card back; we take it again, but only so often */
  const stale2 = doc.createElement('div');
  stale2.id = 'ohlc-auto-card';
  doc.getElementById('chart-dna-app').appendChild(stale2);
  /* the four panel keys that were deleted from the tool: a cached build still
     puts them in the modal, so the sweep takes them out of the page as well */
  ['ohlc-pick', 'ohlc-grab', 'ohlc-save', 'ohlc-save-search', 'ohlc-opt-pattern'].forEach((id) => {
    const b = doc.createElement('button');
    b.id = id; b.textContent = 'دکمهٔ قدیمی';
    doc.getElementById('chart-dna-app').appendChild(b);
  });
  await sleep(900);
  ok('a leftover card that comes back is removed again, with a bound on the fight',
    !doc.getElementById('ohlc-auto-card') && (win.ChartDnaUiTrim.drops()['ohlc-auto-card'] || 0) >= 2,
    'drops=' + JSON.stringify(win.ChartDnaUiTrim.drops()));
  ok('the deleted panel keys are swept out of a stale build too',
    ['ohlc-pick', 'ohlc-grab', 'ohlc-save', 'ohlc-save-search', 'ohlc-opt-pattern'].every((id) => !doc.getElementById(id)) &&
    ['ohlc-pick', 'ohlc-grab', 'ohlc-save', 'ohlc-save-search'].every((id) => (win.ChartDnaUiTrim.drops()[id] || 0) >= 1),
    'drops=' + JSON.stringify(win.ChartDnaUiTrim.drops()));

  ok('a panel the app renders later is hidden too (no id, matched by title)',
    fresh.style.display === 'none' && win.ChartDnaUiTrim.hidden() === 3, 'hidden=' + win.ChartDnaUiTrim.hidden());

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
    !doc2.getElementById('ohlc-auto-card') && doc2.querySelector('[data-panel="overlay"]').style.display === 'none' &&
    doc2.querySelector('[data-panel="stats"]').style.display === 'none', 'card gone, both panels hidden');

  const log3 = { deleted: [] };
  const dom3 = await load({ 'chartdna_ui_trim': '0' }, DATASETS, log3);
  await sleep(700);
  const doc3 = dom3.window.document;
  ok('one switch turns the whole script off',
    doc3.querySelector('[data-panel="overlay"]').style.display !== 'none' && doc3.querySelector('[data-panel="stats"]').style.display !== 'none' &&
    !!doc3.getElementById('ohlc-auto-card') && log3.deleted.length === 0,
    'panels visible, card kept, store untouched');

  /* --------------------------------- 3b) the upload prompt in the middle of «محیط الگو» */
  console.log('3b) the upload key and the centred texts of «محیط الگو» are gone, with their function');
  const empty = doc.getElementById('crop-empty');
  const inp = doc.getElementById('crop-file');
  const ps = empty.querySelectorAll('p');
  ok('the block in the centre is hidden', empty.style.display === 'none' && empty.hasAttribute('hidden'),
    'display=' + empty.style.display + ', hidden=' + empty.hasAttribute('hidden'));
  ok('so both of its sentences are off the screen',
    empty.contains(ps[0]) && empty.contains(ps[1]) && win.getComputedStyle(empty).display === 'none' &&
    /بکشید/.test(ps[0].textContent) && /کادر زرد/.test(ps[1].textContent),
    Array.prototype.map.call(ps, (x) => x.textContent).join(' / ').slice(0, 60));
  ok('and its icon box went with them', empty.querySelector('svg') && empty.querySelector('div').style.display !== 'flex',
    'icon still inside the hidden block');
  ok('the crop surface is left alone', doc.getElementById('crop-view').style.display === 'none' &&
    !doc.getElementById('crop-view').hasAttribute('hidden') && doc.getElementById('app-canvas').style.display !== 'none',
    'canvas kept, its wrapper untouched');
  ok('the card header, the reference-price control and the status strip are untouched',
    doc.getElementById('crop-head').style.display !== 'none' && doc.getElementById('btn-ref').style.display !== 'none' &&
    doc.getElementById('crop-status').style.display !== 'none' && doc.getElementById('crop-stage').style.display !== 'none',
    'head, btn-ref, status, stage visible');
  ok('the card itself is still there', doc.getElementById('image-cropper-card').style.display !== 'none');
  ok('the file input of the card is disabled', inp.disabled === true && inp.getAttribute('data-dna-off') === '1',
    'disabled=' + inp.disabled);
  empty.dispatchEvent(new win.Event('click', { bubbles: true }));
  await sleep(120);
  ok('pressing that block opens nothing — the app handler never sees it',
    win.__browse === 0 && win.__inputClicks === 0, 'browse=' + win.__browse + ', input clicks=' + win.__inputClicks);
  inp.click();
  await sleep(40);
  ok('even a direct click() on the input is a no-op', win.__inputClicks === 0, 'input clicks=' + win.__inputClicks);
  doc.getElementById('crop-stage').dispatchEvent(new win.Event('drop', { bubbles: true }));
  await sleep(40);
  ok('a file dropped where the prompt was is ignored', win.__drops === 0, 'drops=' + win.__drops);
  doc.getElementById('app-canvas').dispatchEvent(new win.Event('drop', { bubbles: true }));
  doc.getElementById('app-canvas').dispatchEvent(new win.Event('click', { bubbles: true }));
  await sleep(40);
  ok('but we swallow nothing over the crop surface itself', win.__drops === 1 && win.__canvasClicks === 1,
    'drops=' + win.__drops + ', canvas clicks=' + win.__canvasClicks);
  ok('and the tool reports what it took', win.ChartDnaUiTrim.cropNodes().indexOf(empty) >= 0,
    'cropNodes=' + win.ChartDnaUiTrim.cropNodes().length);

  /* the app re-renders the card: the block comes back, we hide it again */
  empty.removeAttribute('hidden'); empty.removeAttribute('aria-hidden'); empty.removeAttribute('data-dna-crop');
  empty.style.display = ''; delete empty.__dnaTrimmed;
  await sleep(900);                                          /* the periodic pass, not only the observer */
  ok('a rebuilt prompt is hidden again, no fight over it',
    empty.style.display === 'none' && empty.hasAttribute('data-dna-crop') && win.ChartDnaUiTrim.cropNodes().length === 1,
    'display=' + empty.style.display + ', cropNodes=' + win.ChartDnaUiTrim.cropNodes().length);

  /* the switch gives the whole thing back */
  win.ChartDnaUiTrim.cropOff();
  await sleep(700);
  const inp2 = doc.getElementById('crop-file');
  ok('with chartdna_crop_upload=0 the prompt and the input work again',
    empty.style.display === '' && !empty.hasAttribute('hidden') && inp2.disabled === false,
    'display=' + JSON.stringify(empty.style.display) + ', disabled=' + inp2.disabled);
  inp2.click();
  ok('and its file dialog is the app’s own again', win.__inputClicks === 1, 'input clicks=' + win.__inputClicks);
  ok('a drop is the app’s business again', (doc.getElementById('crop-stage').dispatchEvent(new win.Event('drop', { bubbles: true })), win.__drops === 2),
    'drops=' + win.__drops);
  win.ChartDnaUiTrim.cropOn();
  await sleep(200);
  ok('and one call takes it back off', empty.style.display === 'none' && doc.getElementById('crop-file').disabled === true,
    'display=' + empty.style.display + ', disabled=' + doc.getElementById('crop-file').disabled);

  /* a page that switches this script off must not lose the card's prompt either */
  const log4 = { deleted: [] };
  const dom4 = await load({ 'chartdna_ui_trim': '0' }, DATASETS, log4);
  await sleep(600);
  ok('with the whole trim off, the crop card is exactly as the app built it',
    dom4.window.document.getElementById('crop-empty').style.display !== 'none' &&
    dom4.window.document.getElementById('crop-file').disabled === false,
    'display=' + JSON.stringify(dom4.window.document.getElementById('crop-empty').style.display));
  try { dom4.window.close(); } catch (e) { }

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
  const ver = (sw.match(/VERSION = "([^"]+)"/) || [])[1] || '';
  ok('the worker version is a named build that moves with the tag',
    /^chartdna-v\d+\.\d+\.\d+-[a-z0-9-]+$/.test(ver) && ver.indexOf('-') > 0, ver);

  server.close();
  console.log('');
  if (fails) console.log('FAILED ' + fails + ' of ' + checks + ' checks');
  else console.log('all ' + checks + ' checks passed');
  /* the pages keep timers alive (the trim script re-checks for 20s), and jsdom
     throws if one fires during teardown: end the run instead of waiting for it */
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
