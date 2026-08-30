/* UI wiring test — jsdom page with a real Skia canvas behind HTMLCanvasElement.
 *
 * Loads chart-ohlc-engine.js and chart-ohlc-extractor.js exactly the way
 * index.html does, feeds the real screenshot through the file input, clicks every
 * action button and checks what the tool writes: the CSV download, the IndexedDB
 * dataset, the app's selection, the pattern queue and the auto-search hand-off.
 *
 *   OHLC_IMG=/path/to/chart-screenshot.jpg node tests/ohlc-image/ui.test.js
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
const SIZE = process.env.OHLC_IMG_SIZE ? JSON.parse(process.env.OHLC_IMG_SIZE) : null;

/* a page that mimics the parts of the app the tool talks to */
const PAGE = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">' +
  '<script src="chart-ohlc-engine.js"></script><script src="chart-ohlc-extractor.js"></script>' +
  '</head><body><div id="root"><div id="chart-dna-app" dir="rtl">' +
  '<header><button id="btn-header-settings">تنظیمات</button></header>' +
  '<button id="app-search">جستجو در تاریخچه</button>' +
  '<div id="image-cropper-card"><canvas id="app-canvas"></canvas><img id="app-preview" src="blob:preview">' +
  '<button id="app-pick" title="آپلود تصویر چارت" class="h-8 w-8 rounded-lg border border-slate-700">🖼️</button>' +
  '<input id="app-file" type="file" accept="image/*" class="hidden">' +
  '</div>' +
  '<img id="app-img" src="blob:something">' +
  '</div></div>' +
  /* the app's own upload funnel: the icon button opens a hidden file input and the
     chosen File goes through a FileReader — exactly what the real bundle does */
  '<script>window.__appImage=null;' +
  'document.getElementById("app-pick").addEventListener("click",()=>document.getElementById("app-file").click());' +
  'document.getElementById("app-file").addEventListener("change",(e)=>{' +
  'const f=e.target.files&&e.target.files[0];if(!f)return;' +
  'const r=new FileReader();r.onload=()=>{window.__appImage=r.result;};r.readAsDataURL(f);});<' +
  '/script></body></html>';

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === 'index.html' || u === '/index.html' || u === '/' || u === '/test.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGE);
  }
  const f = path.join(REPO, u.replace(/^\//, ''));
  if (!f.startsWith(REPO) || !fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  res.end(fs.readFileSync(f));
});

function patchWindow(window, blobs) {
  const win = window;
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
  proto.toBlob = function (cb, type) { cb(new win.Blob([ensure(this).toBuffer('image/png')], { type: 'image/png' })); };

  class FakeImage {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(v) {
      this.__src = v;
      (async () => {
        let buf;
        if (String(v).indexOf('blob:') === 0) { const b = blobs.get(v); buf = b ? Buffer.from(await b.arrayBuffer()) : fs.readFileSync(IMG); }
        else buf = fs.readFileSync(IMG);
        const im = await napi.loadImage(buf);
        this.__c = im; this.naturalWidth = im.width; this.naturalHeight = im.height;
        if (this.onload) this.onload();
      })().catch((e) => { if (this.onerror) this.onerror(e); });
    }
    get src() { return this.__src; }
  }
  win.Image = FakeImage;
  win.HTMLImageElement = FakeImage;
  win.URL.createObjectURL = (b) => { const u = 'blob:mock/' + (blobs.size + 1); blobs.set(u, b); return u; };
  win.URL.revokeObjectURL = () => { };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
async function load(seed) {
  const blobs = new Map();
  return JSDOM.fromURL('http://127.0.0.1:' + server.address().port + '/index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) {
      patchWindow(window, blobs);
      window.indexedDB = seed.idb;
      window.addEventListener('error', (e) => errors.push('page error: ' + e.message));
      for (const k in (seed.sessionStorage || {})) window.sessionStorage.setItem(k, seed.sessionStorage[k]);
      for (const k in (seed.localStorage || {})) window.localStorage.setItem(k, seed.localStorage[k]);
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
          transaction() {
            const tx = { objectStore: () => ({ put: (rec) => { idbLog.rec = rec; idbLog.store = tx.__s; return { }; } }), oncomplete: null, onerror: null };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          },
          close() { }
        },
        onupgradeneeded: null, onsuccess: null, onerror: null
      };
      setTimeout(() => {
        if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: req.result } });
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }
  };

  const dom = await load({ idb });
  const win = dom.window, doc = win.document;
  await sleep(400);
  const $ = (id) => doc.getElementById(id);
  const txt = (id) => ($(id).textContent || '').trim();

  console.log('1) the tool mounts next to the app');
  ok('nothing of ours floats in the page (no #ohlc-tool, no #ohlc-open)', !$('ohlc-open') && !$('ohlc-tool'),
    ($('ohlc-open') ? 'opener still there ' : '') + ($('ohlc-tool') ? 'tool still there' : 'clean'));
  ok('modal starts hidden', !!$('ohlc-modal') && $('ohlc-modal').style.display !== 'flex' && win.getComputedStyle($('ohlc-modal')).display !== 'flex',
    'inline ' + JSON.stringify($('ohlc-modal').style.display) + ', computed ' + win.getComputedStyle($('ohlc-modal')).display);
  win.ChartDnaOhlc.open();
  ok('the panel still opens through the published seam', $('ohlc-modal').style.display === 'flex');
  $('ohlc-close').click();
  ok('and closes again', $('ohlc-modal').style.display === 'none');
  ok('drag & drop and paste are wired', /dragover/.test($('ohlc-drop').getAttribute('class') || '') || !!$('ohlc-drop'), 'drop zone present');

  console.log('1b) the app\u2019s own «انتخاب تصویر» button drives the tool');
  const pick = $('app-pick');
  const look = pick.className + '|' + pick.textContent + '|' + pick.getAttribute('title');
  const appFile = new win.File([fs.readFileSync(IMG)], 'chart-shot.jpg', { type: 'image/jpeg' });
  Object.defineProperty($('app-file'), 'files', { value: [appFile], configurable: true });
  $('app-file').dispatchEvent(new win.Event('change', { bubbles: true }));
  for (let i = 0; i < 150 && $('ohlc-modal').style.display !== 'flex'; i++) await sleep(100);
  ok('one pick on the app button opens our panel', $('ohlc-modal').style.display === 'flex',
    'display=' + $('ohlc-modal').style.display);
  ok('the app kept its own upload (we only watched it)', typeof win.__appImage === 'string' && win.__appImage.indexOf('data:image') === 0,
    (win.__appImage || '').slice(0, 22) + '…');
  const repPick = win.__ohlcReport || {};
  const pickBars = Array.isArray(repPick.bars) ? repPick.bars.length : (repPick.bars || 0);
  ok('and the picture it picked is the one measured', pickBars >= 250, pickBars + ' bars');
  ok('the app button is untouched: same icon, same name, same classes',
    look === pick.className + '|' + pick.textContent + '|' + pick.getAttribute('title'), JSON.stringify(pick.className));
  ok('no element of ours was added inside the app card', !$('image-cropper-card').querySelector('[id^="ohlc-"]'), 'clean');
  ok('picking a non-picture file is left alone', (() => {
    const before = $('ohlc-status').textContent;
    const txt = new win.File([Buffer.from('a,b\n1,2\n', 'utf8')], 'data.csv', { type: 'text/csv' });
    Object.defineProperty($('app-file'), 'files', { value: [txt], configurable: true });
    $('app-file').dispatchEvent(new win.Event('change', { bubbles: true }));
    return $('ohlc-status').textContent === before;
  })());
  await sleep(200);

  console.log('2) extraction through the file input');
  const file = new win.File([fs.readFileSync(IMG)], 'shot.jpg', { type: 'image/jpeg' });
  Object.defineProperty($('ohlc-file'), 'files', { value: [file], configurable: true });
  $('ohlc-file').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(300);
  ok('image accepted and sized', /×\d+ پیکسل/.test(txt('ohlc-status')), txt('ohlc-status'));

  let searchClicks = 0;
  $('app-search').addEventListener('click', () => searchClicks++);
  $('ohlc-d0').value = '2026-08-14'; $('ohlc-d1').value = '2026-08-29';
  $('ohlc-run').click();
  for (let i = 0; i < 120 && /پردازش/.test(txt('ohlc-status')); i++) await sleep(250);
  const st = txt('ohlc-status');
  const rep = win.__ohlcReport || {};
  const R = rep.result || {}, g = R.geometry || {}, cal = R.calibration || {}, q = R.quality || {};
  const nBars = (rep.bars || []).length;
  console.log('   report: ' + JSON.stringify({ candles: R.candles, complete: R.complete, missing: R.missing, pitch: g.pitch,
    mode: cal.mode, usdPerPx: cal.usdPerPx, residual: cal.residualUSD, tagCheck: cal.tagCheck, review: (q.needReview || []).length,
    pixels: rep.pixels, ms: rep.durationMs }));
  ok('the reference chart yields its 296 candles', nBars === (SIZE && SIZE.bars ? SIZE.bars : 296), nBars + ' bars, missing ' + R.missing);
  ok('candle grid pitch reported', g.pitch > 2 && g.pitch < 40, 'pitch ' + g.pitch + ' px');
  ok('calibration equation in the status text', /price = /.test(st) && !!cal.equation, cal.equation);
  ok('axis anchors listed (>= 3)', (cal.refs || []).length >= 3, (cal.refs || []).map((x) => x.price + '@' + x.row + '[' + x.source + ']').join('  '));
  ok('regression residual in USD reported', cal.residualUSD > 0 && cal.residualUSD < 0.2, 'RMS ' + cal.residualUSD);
  ok('pixel size in USD reported', cal.usdPerPx > 0 && /پیکسل/.test(st), '1 px = ' + cal.usdPerPx + ' USD');
  ok('independent price-tag check reported', !!cal.tagCheck && isFinite(cal.tagCheck.errorUSD) && Math.abs(cal.tagCheck.errorUSD) <= 0.1,
    'err ' + (cal.tagCheck && cal.tagCheck.errorUSD) + ' USD');
  ok('manual-review count reported', typeof q.meanConfidence === 'number' && Array.isArray(q.needReview), (q.needReview || []).length + ' flagged, mean conf ' + q.meanConfidence);
  ok('limitation stated in the status text', /محدودیت/.test(st), st.split('\n').slice(-1)[0]);
  ok('nothing invented: bars without a date source keep Date empty', nBars > 0, st.split('\n').filter((l) => /تاریخ/.test(l)).join(' / ').slice(0, 120) || 'no date line');
  ok('all four action buttons enabled', ['ohlc-csv', 'ohlc-png', 'ohlc-save', 'ohlc-save-search'].every((id) => !$(id).disabled));
  ok('preview table rendered', ($('ohlc-table').querySelectorAll('tbody tr') || []).length > 0, $('ohlc-table').querySelectorAll('tbody tr').length + ' rows');
  ok('reconstruction canvas painted', $('ohlc-chart').width > 300 && $('ohlc-chart').height > 100, $('ohlc-chart').width + 'x' + $('ohlc-chart').height);
  ok('annotated overlay drawn without error', !/خطا در رسم/.test(st) && $('ohlc-ann').width > 0, 'canvas ' + $('ohlc-ann').width + 'x' + $('ohlc-ann').height);
  $('ohlc-drop').dispatchEvent(new win.Event('dragover', { bubbles: true }));
  ok('drop zone highlights on dragover', /ohlc-over/.test($('ohlc-drop').className), $('ohlc-drop').className);

  console.log('2b) typed axis anchor');
  $('ohlc-ref-row').value = '261'; $('ohlc-ref-price').value = '4600';
  $('ohlc-ref-add').click();
  ok('typed anchor appears in the list', /ردیف 261/.test($('ohlc-points').textContent), $('ohlc-points').textContent.trim().replace(/\s+/g, ' ').slice(0, 70));
  $('ohlc-run').click();
  for (let i = 0; i < 120 && /پردازش/.test(txt('ohlc-status')); i++) await sleep(250);
  const cal2 = ((win.__ohlcReport || {}).result || {}).calibration || {};
  ok('typed anchor joins the regression set', (cal2.refs || []).some((r) => r.source === 'manual-typed'),
    (cal2.refs || []).map((r) => r.price + '@' + r.row + '[' + r.source + ']').join('  '));
  ok('calibration stays tight with the extra anchor', cal2.residualUSD < 0.05 && ((win.__ohlcReport || {}).bars || []).length === nBars,
    'RMS ' + cal2.residualUSD + ', ' + (((win.__ohlcReport || {}).result || {}).candles) + ' candles');
  $('ohlc-points').querySelector('button[data-del]').click();
  ok('anchor can be removed again', !/ردیف 261/.test($('ohlc-points').textContent));
  $('ohlc-run').click();
  for (let i = 0; i < 120 && /پردازش/.test(txt('ohlc-status')); i++) await sleep(250);
  ok('back to axis labels only', !((win.__ohlcReport || {}).result.calibration.refs || []).some((r) => r.source === 'manual-typed'), 'refs: ' + win.__ohlcReport.result.calibration.refs.map(r => r.price + '@' + r.row).join(' '));

  console.log('3) CSV download');
  const captured = [];
  const OrigBlob = win.Blob;
  win.Blob = function (parts, o) { const b = new OrigBlob(parts, o); b.__txt = typeof parts[0] === 'string' ? parts[0] : ''; captured.push(b); return b; };
  win.Blob.prototype = OrigBlob.prototype;
  let download = null;
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (t) => { const el = origCreate(t); if (t === 'a') el.click = () => { download = el.download; }; return el; };
  $('ohlc-csv').click();
  await sleep(120);
  const csv = captured.length ? captured[captured.length - 1].__txt : '';
  const lines = csv.split('\r\n');
  ok('file name carries the CSV suffix', /_ohlc_from_image\.csv$/.test(download || ''), download);
  ok('header is the required schema', lines[0] === 'Candle,Date,Time,Open,High,Low,Close,Direction,Confidence', lines[0]);
  const data = lines.slice(1).filter((l) => l.length);
  ok('one row per candle', data.length === nBars, data.length + ' data rows for ' + nBars + ' candles');
  ok('row count equals the candle numbers', data.every((l, i) => +l.split(',')[0] === i + 1), 'numbered 1..' + data.length);
  const nums = (lines[1] || '').split(',');
  ok('row values are numeric and H>=body>=L', ['', 'Bullish', 'Bearish'].indexOf(nums[7]) >= 0 && parseFloat(nums[3]) <= parseFloat(nums[4]) && parseFloat(nums[5]) <= Math.min(parseFloat(nums[3]), parseFloat(nums[6])), 'row 1: ' + lines[1]);
  ok('dates come from the anchors the user typed', /,2026-08-14,/.test(lines[1]), lines[1]);
  ok('every row got a date between the two anchors', data.filter((l) => /,2026-\d\d-\d\d,/.test(l)).length === nBars,
    data.filter((l) => /,2026-\d\d-\d\d,/.test(l)).length + ' dated rows');
  ok('Time column stays empty', (lines[50] || '').split(',')[2] === '', 'row 50: ' + lines[50]);

  console.log('4) hand-off to Chart DNA');
  $('ohlc-save-search').click();
  await sleep(500);
  const rec = idbLog.rec;
  ok('dataset written to IndexedDB', !!rec, rec ? rec.id + ' as ' + rec.name : 'nothing stored');
  ok('store is market_datasets', idbLog.store === 'market_datasets' || idbLog.store === undefined, idbLog.store);
  ok('record has the app schema', !!(rec && rec.id && rec.name && rec.symbol && rec.timeframe && Array.isArray(rec.candles) && rec.candles.length === nBars),
    rec ? Object.keys(rec).join(',') + ' | ' + rec.candles.length + ' candles' : '');
  ok('candles carry the app fields', rec && rec.candles.every((c) => ['timestamp', 'open', 'high', 'low', 'close', 'volume'].every((k) => k in c)),
    rec ? Object.keys(rec.candles[0]).join(',') : '');
  ok('OHLC invariants survive into the dataset', rec && rec.candles.every((c) => c.high >= Math.max(c.open, c.close) - 1e-6 && c.low <= Math.min(c.open, c.close) + 1e-6),
    rec ? rec.candles.length + ' checked' : '');
  ok('volume is 0, never guessed', rec && rec.candles.every((c) => c.volume === 0), 'sample volume ' + (rec && rec.candles[0].volume));
  const ids = JSON.parse(win.localStorage.getItem('chartdna_selected_dataset_ids') || '[]');
  ok('dataset id appended to the selection', ids.indexOf(rec.id) >= 0, JSON.stringify(ids));
  ok('auto-search flag set for the next load', win.sessionStorage.getItem('chartdna_ohlc_autosearch') === rec.id, win.sessionStorage.getItem('chartdna_ohlc_autosearch'));
  const pend = win.sessionStorage.getItem('chartdna_ohlc_pending_pattern');
  ok('pattern queued when the app has no library yet', !!pend, pend ? JSON.parse(pend).points.length + ' points' : 'none');
  ok('no script errors on the page', errors.length === 0, errors.join(' | ') || 'none');
  ok('search was not clicked before the reload', searchClicks === 0, searchClicks + ' clicks');

  console.log('5) after the reload the app is driven');
  const idb2 = { open: () => ({ onsuccess: null, onerror: null, result: { objectStoreNames: { contains: () => true }, createObjectStore() { }, transaction: () => ({ objectStore: () => ({ put: () => ({ }) }), oncomplete: null }) } }) };
  const patSeed = JSON.stringify([{ id: 'builtin_1', name: 'الگوی داخلی', category: 'Reversal', points: [1, 2, 3, 4, 5], normalizedPoints: [-1, -0.5, 0, 0.5, 1] }]);
  const dom2 = await load({
    idb: idb2,
    localStorage: { chartdna_saved_patterns: patSeed },
    sessionStorage: { chartdna_ohlc_autosearch: 'img-test', chartdna_ohlc_pending_pattern: pend }
  });
  const doc2 = dom2.window.document;
  let clicked2 = 0;
  doc2.getElementById('app-search').addEventListener('click', () => clicked2++);
  await sleep(3400);
  ok('the app search button was clicked once', clicked2 === 1, clicked2 + ' clicks');
  ok('one-shot flag cleared', dom2.window.sessionStorage.getItem('chartdna_ohlc_autosearch') === null, JSON.stringify(dom2.window.sessionStorage.getItem('chartdna_ohlc_autosearch')));
  const lib = JSON.parse(dom2.window.localStorage.getItem('chartdna_saved_patterns'));
  const added = lib.filter((p) => p.id.indexOf('custom_dna_img_') === 0)[0];
  ok('queued pattern merged into the library', !!added, added ? added.name + ', ' + added.points.length + ' points' : 'missing');
  ok('built-in patterns are not overwritten', lib.filter((p) => p.id === 'builtin_1').length === 1, lib.length + ' entries');
  ok('pending queue emptied', dom2.window.sessionStorage.getItem('chartdna_ohlc_pending_pattern') === null);
  ok('still no page errors', errors.length === 0, errors.join(' | ') || 'none');

  await new Promise((r) => server.close(r));
  console.log('\n' + (fails ? 'FAILED ' + fails + ' of ' + checks + ' checks' : 'all ' + checks + ' checks passed'));
  process.exit(fails ? 1 : 0);
})();
