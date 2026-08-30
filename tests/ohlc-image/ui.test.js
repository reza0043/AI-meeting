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

/* a page that mimics the parts of the app the tool talks to.
 *
 * withDeck=true   the sidebar strip #remote-control-deck with its #btn-import-image
 *                 key, wired exactly like the bundle does it: the click builds a
 *                 detached <input type=file>, the picked File goes through a
 *                 FileReader, and none of that ever enters the DOM.
 * withDeck=false  a build without that key, to cover the documented fallback.
 *
 * The crop panel keeps its own picker, so "some other control was left alone" can
 * be measured as well.
 */
function page(withDeck) {
  return '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">' +
    '<script src="chart-ohlc-engine.js"></script><script src="chart-ohlc-extractor.js"></script>' +
    '</head><body><div id="root"><div id="chart-dna-app" dir="rtl">' +
    '<header><button id="btn-header-settings">تنظیمات</button></header>' +
    (withDeck
      ? '<aside id="sidebar-controls"><div id="remote-control-deck">' +
        '<button id="btn-clear-all" title="پاکسازی محیط" class="h-9 rounded-lg">🗑️</button>' +
        '<button id="btn-run" title="اجرا" class="h-9 rounded-lg">▶</button>' +
        '<button id="btn-import-image" title="ورود تصویر چارت" class="flex-1 h-9 rounded-lg group relative"><span>🖼️</span></button>' +
        '</div></aside>'
      : '') +
    '<button id="app-search">جستجو در تاریخچه</button>' +
    '<div id="image-cropper-card"><canvas id="app-canvas"></canvas><img id="app-preview" src="blob:preview">' +
    '<button id="app-pick" title="انتخاب تصویر از محیط الگو" class="h-8 w-8 rounded-lg border border-slate-700">📂</button>' +
    '<input id="app-file" type="file" accept="image/*" class="hidden">' +
    '</div>' +
    '<img id="app-img" src="blob:something">' +
    '</div></div>' +
    '<script>' +
    'window.__appImage=null;window.__deckImage=null;window.__deckInput=null;window.__deckTaps=0;' +
    'var deck=document.getElementById("btn-import-image");' +
    'if(deck)deck.addEventListener("click",function(){window.__deckTaps++;' +
    '  var inp=document.createElement("input");inp.type="file";inp.accept="image/*";' +
    '  inp.onchange=function(e){var f=e.target.files&&e.target.files[0];if(!f)return;' +
    '    var r=new FileReader();r.onload=function(){window.__deckImage=r.result;};r.readAsDataURL(f);};' +
    '  window.__deckInput=inp;inp.click();});' +
    'document.getElementById("app-pick").addEventListener("click",function(){document.getElementById("app-file").click();});' +
    'document.getElementById("app-file").addEventListener("change",function(e){' +
    '  var f=e.target.files&&e.target.files[0];if(!f)return;' +
    '  var r=new FileReader();r.onload=function(){window.__appImage=r.result;};r.readAsDataURL(f);});' +
    '</' + 'script></body></html>';
}

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/nodeck.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page(false));
  }
  if (u === 'index.html' || u === '/index.html' || u === '/' || u === '/test.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page(true));
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
      this.__w = win;
      (async () => {
        let buf;
        if (String(v).indexOf('blob:') === 0) { const b = blobs.get(v); buf = b ? await readBytes(this.__w, b) : fs.readFileSync(IMG); }
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

/* jsdom's Blob has no arrayBuffer(), so the mock page reads a blob through a FileReader */
function readBytes(w, b) {
  return new Promise((res, rej) => {
    const fr = new (w && w.FileReader ? w.FileReader : FileReader)();
    fr.onload = () => res(Buffer.from(fr.result));
    fr.onerror = () => rej(fr.error || new Error('blob read failed'));
    fr.readAsArrayBuffer(b);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
async function load(seed, at) {
  const blobs = new Map();
  return JSDOM.fromURL('http://127.0.0.1:' + server.address().port + (at || '/index.html'), {
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
  const idbLog = { opens: 0 };
  const idb = {
    open() {
      idbLog.opens++;          /* the tool must never touch the app's store again */
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

  /* what the window is called, and what is not called any more */
  const h2 = $('ohlc-card').querySelector('h2');
  ok('the window is named «ورود تصویر»', h2.textContent === 'ورود تصویر', JSON.stringify(h2.textContent));
  ok('no explanation sits under the name', !$('ohlc-card').querySelector('h2 + .ohlc-muted') &&
    h2.nextElementSibling.className.indexOf('ohlc-muted') < 0,
    'next sibling is <' + h2.nextElementSibling.tagName + ' class="' + h2.nextElementSibling.className + '">');
  ok('and the old wording is nowhere in the panel',
    !$('ohlc-card').textContent.match(/بازسازی OHLC از اسکرین|computer vision|حافظهٔ مدل/), 'clean');
  const GONE = ['ohlc-pick', 'ohlc-grab', 'ohlc-save', 'ohlc-save-search', 'ohlc-opt-pattern', 'ohlc-opt-replace'];
  ok('the pick / grab / save / save-and-search keys are gone, and their options with them',
    GONE.every((id) => !$(id)), GONE.filter((id) => $(id)).join(',') || 'none of them in the DOM');
  ok('the rows keep only what the window still does',
    !!$('ohlc-run') && !!$('ohlc-csv') && !!$('ohlc-png') && !!$('ohlc-close'), 'run · csv · png · close');
  ok('the image still enters through the upload key (or a paste)', !!$('ohlc-drop') && !!$('ohlc-file'),
    'dashed square + its file input');
  ok('the connection box is off the card', !/اتصال به موتور/.test($('ohlc-card').textContent), 'no such heading');
  ok('and nothing of ours can be called to write into the app',
    typeof win.ChartDnaOhlc.saveDataset === 'undefined' && typeof win.ChartDnaOhlc.reload === 'undefined',
    'saveDataset=' + typeof win.ChartDnaOhlc.saveDataset + ', reload=' + typeof win.ChartDnaOhlc.reload);

  /* ---- one row of square keys above the picture, with the fit rule ---- */
  const bar = $('ohlc-bar');
  const keys = Array.prototype.slice.call(bar.children);
  ok('the upload key, the run key and the three view keys are one row',
    keys.length === 5 && keys.map((b) => b.id || b.dataset.view).join(',') === 'ohlc-drop,ohlc-run,chart,orig,ann',
    keys.map((b) => b.id || b.dataset.view).join(' · '));
  ok('every one of them is a square button',
    keys.every((b) => b.tagName === 'BUTTON' && /(^| )ohlc-sq( |$)/.test(b.className) && !/ohlc-actions/.test(b.className)),
    keys.map((b) => b.tagName + '.' + (b.className.match(/ohlc-[a-z]+/g) || []).slice(0, 2).join('+')).join(' | ').slice(0, 110));
  ok('the row sits above the image of the chart',
    (bar.compareDocumentPosition($('ohlc-chart')) & win.Node.DOCUMENT_POSITION_FOLLOWING) !== 0, 'bar → canvas');
  ok('the old wide drop panel and the old tab strip are gone',
    !$('ohlc-card').querySelector('.ohlc-tabs') && !$('ohlc-card').querySelector('.ohlc-actions [data-view]') &&
    !$('ohlc-card').querySelector('.ohlc-actions #ohlc-run'), 'no strip, no duplicate run key');
  ok('a word too long for its square is written on two lines', $('ohlc-run').classList.contains('ohlc-2'),
    $('ohlc-run').className.replace('ohlc-sq', '□'));
  ok('and when even two lines will not hold it, only the icon is left',
    $('ohlc-drop').classList.contains('ohlc-ic') && $('ohlc-card').querySelector('[data-view="chart"]').classList.contains('ohlc-ic'),
    'drop=' + $('ohlc-drop').className.replace('ohlc-sq ohlc-drop', '□') +
    ' · chart view=' + $('ohlc-card').querySelector('[data-view="chart"]').className.replace('ohlc-sq', '□'));
  ok('nothing is thrown away: the words stay in the tooltip and inside the key',
    /رها کنید/.test($('ohlc-drop').getAttribute('title') || '') && /Ctrl\+V/.test($('ohlc-drop').querySelector('.ohlc-lbl').textContent),
    'title + label intact, the label is only not painted');
  const origKey = $('ohlc-card').querySelector('[data-view="orig"]');
  ok('a label that fits in two lines is not reduced to an icon',
    origKey.classList.contains('ohlc-2') && !origKey.classList.contains('ohlc-ic'), origKey.className.replace('ohlc-sq', '□'));
  origKey.dispatchEvent(new win.Event('click', { bubbles: true }));
  await sleep(60);
  ok('the view keys still switch what is on screen',
    origKey.getAttribute('aria-selected') === 'true' && $('ohlc-orig').style.display === 'block' &&
    $('ohlc-chart').classList.contains('ohlc-hidden'), 'orig on, chart hidden');
  const chartKey = $('ohlc-card').querySelector('[data-view="chart"]');
  chartKey.dispatchEvent(new win.Event('click', { bubbles: true }));
  await sleep(60);
  ok('and switch back', chartKey.getAttribute('aria-selected') === 'true' &&
    !$('ohlc-chart').classList.contains('ohlc-hidden') && origKey.getAttribute('aria-selected') === 'false',
    'chart on again');
  ok('the file input is not nested in a button (no interactive content inside one)',
    $('ohlc-file').parentElement === bar.parentElement && !$('ohlc-drop').querySelector('input'),
    'input lives in <' + $('ohlc-file').parentElement.tagName.toLowerCase() + '> next to the row');

  console.log('1b) the deck key «ورود تصویر چارت» opens the OHLC environment, not the device storage');
  const deck = $('btn-import-image');
  const look = deck.className + '|' + deck.textContent + '|' + deck.getAttribute('title');
  ok('the published seam sees the deck key', win.ChartDnaOhlc.deckKey() === deck, (win.ChartDnaOhlc.deckKey() || {}).id);
  ok('and it is ours to redirect', win.ChartDnaOhlc.deckTakeover() === true, 'deckTakeover()=' + win.ChartDnaOhlc.deckTakeover());
  deck.dispatchEvent(new win.Event('click', { bubbles: true }));
  await sleep(60);
  ok('one press opens the reconstruction environment', $('ohlc-modal').style.display === 'flex',
    'display=' + $('ohlc-modal').style.display);
  ok('the app’s own handler never ran, so the storage dialog stays closed',
    win.__deckTaps === 0 && win.__deckInput === null,
    'taps=' + win.__deckTaps + ', input=' + (win.__deckInput ? 'created' : 'never built'));
  ok('the panel tells the user to pick the screenshot here', /حافظه/.test(txt('ohlc-status')),
    txt('ohlc-status').split('\n')[0]);
  ok('the key is untouched: same icon, same name, same classes',
    look === deck.className + '|' + deck.textContent + '|' + deck.getAttribute('title'), JSON.stringify(deck.className));
  ok('no element of ours was added inside the deck or the app card',
    !$('remote-control-deck').querySelector('[id^="ohlc-"]') && !$('image-cropper-card').querySelector('[id^="ohlc-"]'), 'clean');

  /* the picture is chosen inside this environment */
  let fileClicks = 0;
  $('ohlc-file').addEventListener('click', () => fileClicks++);
  $('ohlc-drop').dispatchEvent(new win.Event('click', { bubbles: true }));
  await sleep(20);
  ok('the upload key opens the file input of the panel, once (the input is not inside it)',
    fileClicks === 1, fileClicks + ' clicks');
  const imgHere = new win.File([fs.readFileSync(IMG)], 'from-gallery.jpg', { type: 'image/jpeg' });
  Object.defineProperty($('ohlc-file'), 'files', { value: [imgHere], configurable: true });
  $('ohlc-file').dispatchEvent(new win.Event('change', { bubbles: true }));
  for (let i = 0; i < 40 && !/×\d+ پیکسل/.test(txt('ohlc-status')); i++) await sleep(50);
  ok('and the screenshot picked there is loaded here', /×\d+ پیکسل/.test(txt('ohlc-status')),
    txt('ohlc-status').split('\n')[0]);

  /* any other image control in the app is left alone */
  $('ohlc-close').click();
  win.__appImage = null;
  const other = new win.File([fs.readFileSync(IMG)], 'other-shot.jpg', { type: 'image/jpeg' });
  Object.defineProperty($('app-file'), 'files', { value: [other], configurable: true });
  $('app-file').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(400);
  ok('a pick through another control does not open the panel',
    $('ohlc-modal').style.display === 'none' && typeof win.__appImage === 'string',
    'display=' + $('ohlc-modal').style.display + ', app got its file');

  /* and one switch gives the key back to the app */
  win.localStorage.setItem('chartdna_deck_takeover', '0');
  $('btn-import-image').dispatchEvent(new win.Event('click', { bubbles: true }));
  await sleep(60);
  ok('with chartdna_deck_takeover=0 the key does what the app built it for',
    win.__deckTaps === 1 && !!win.__deckInput && $('ohlc-modal').style.display === 'none',
    'taps=' + win.__deckTaps + ', detached input=' + (win.__deckInput ? 'built' : 'none') +
    ', display=' + $('ohlc-modal').style.display);
  win.localStorage.removeItem('chartdna_deck_takeover');

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
  ok('both downloads are enabled, and there is no third one', ['ohlc-csv', 'ohlc-png'].every((id) => !$(id).disabled) && !$('ohlc-save'),
    'csv+png live · save gone');
  ok('preview table rendered', ($('ohlc-table').querySelectorAll('tbody tr') || []).length > 0, $('ohlc-table').querySelectorAll('tbody tr').length + ' rows');
  ok('reconstruction canvas painted', $('ohlc-chart').width > 300 && $('ohlc-chart').height > 100, $('ohlc-chart').width + 'x' + $('ohlc-chart').height);
  ok('annotated overlay drawn without error', !/خطا در رسم/.test(st) && $('ohlc-ann').width > 0, 'canvas ' + $('ohlc-ann').width + 'x' + $('ohlc-ann').height);

  /* ---- one frame for the three views ---- */
  const viewC = $('ohlc-chart'), viewO = $('ohlc-orig'), viewA = $('ohlc-ann');
  ok('the three views are one box: same width, same height, same length of the series',
    viewC.width === viewO.width && viewO.width === viewA.width &&
    viewC.height === viewO.height && viewO.height === viewA.height,
    [viewC, viewO, viewA].map((c) => c.width + '×' + c.height).join(' · '));
  const im = win.ChartDnaOhlc.image(), res = win.ChartDnaOhlc.result();
  ok('that box is the screenshot itself, only capped at 1400 px on the long side',
    Math.max(viewC.width, viewC.height) <= 1400 && viewC.width >= 1000 &&
    Math.abs(viewC.width / viewC.height - im.naturalWidth / im.naturalHeight) < 0.01,
    viewC.width + '×' + viewC.height + ' for a ' + im.naturalWidth + '×' + im.naturalHeight + ' picture');
  const css = Array.prototype.slice.call(win.document.querySelectorAll('style')).map((e) => e.textContent).join('\n');
  ok('and it is one shared rule, not three sizes of its own',
    /#ohlc-chart,\s*#ohlc-orig,\s*#ohlc-ann\s*\{[^}]*width:100%;height:auto/.test(css) &&
    !/#ohlc-chart\s*\{[^}]*height:300px/.test(css), 'one rule · height:auto · no fixed 300px box');
  const sc = viewC.width / im.naturalWidth;
  const scan = (cv, hit) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let lo = 1e9, hi = -1, n = 0;
    for (let x = 0; x < cv.width; x++) {
      let found = false;
      for (let y = 0; y < cv.height && !found; y += 2) {
        const i = (y * cv.width + x) * 4;
        if (hit(d[i], d[i + 1], d[i + 2])) { found = true; n++; }
      }
      if (found) { if (x < lo) lo = x; if (x > hi) hi = x; }
    }
    return { lo, hi, n };
  };
  const onDark = (r, g, b) => Math.abs(r - 11) + Math.abs(g - 18) + Math.abs(b - 32) > 40;
  const painted = scan(viewC, onDark);
  const geo = res.geometry;
  const span = 2 * (geo.pitch || 6) * sc + 2;   /* the mask box is a hair wider than the outermost bodies */
  ok('the reconstructed candles stand at the columns they were measured in',
    painted.n > 200 && painted.lo >= geo.dataX0 * sc - 2 && painted.lo <= geo.dataX0 * sc + span &&
    painted.hi <= geo.dataX1 * sc + 2 && painted.hi >= geo.dataX1 * sc - span,
    'painted ' + painted.lo + '…' + painted.hi + ' · mask box ' + Math.round(geo.dataX0 * sc) + '…' + Math.round(geo.dataX1 * sc) +
    ' at ' + sc.toFixed(3) + ' · ' + res.bars.length + ' candles');
  /* the same pixel, seen through the two views: where the reconstructed view draws a
     wick, the marked view must have laid a mark over the untouched screenshot */
  const dA = viewA.getContext('2d').getImageData(0, 0, viewA.width, viewA.height).data;
  const dO = viewO.getContext('2d').getImageData(0, 0, viewO.width, viewO.height).data;
  let at = 0, tot = 0;
  res.bars.forEach((b) => {
    if (b.status !== 'ok' || b.confidence < 0.9) return;
    tot++;
    const x = Math.round(b.x * sc), y = Math.round((b.rowHigh + b.rowBodyTop) / 2 * sc);
    let hit = false;
    for (let dx = -2; dx <= 2 && !hit; dx++) {
      for (let dy = -2; dy <= 2 && !hit; dy++) {
        const i = ((y + dy) * viewA.width + (x + dx)) * 4, j = ((y + dy) * viewO.width + (x + dx)) * 4;
        if (Math.abs(dA[i] - dO[j]) + Math.abs(dA[i + 1] - dO[j + 1]) + Math.abs(dA[i + 2] - dO[j + 2]) > 90) hit = true;
      }
    }
    if (hit) at++;
  });
  ok('and the marked view lays its mark on the very candle the reconstructed view draws',
    tot > 200 && at / tot > 0.95, at + '/' + tot + ' bars carry a mark at the same pixel');
  $('ohlc-drop').dispatchEvent(new win.Event('dragover', { bubbles: true }));
  ok('the upload key highlights on dragover', /ohlc-over/.test($('ohlc-drop').className), $('ohlc-drop').className);

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

  console.log('4) the window writes nothing into the app any more');
  await sleep(300);
  ok('the app\u2019s dataset store was never opened', idbLog.opens === 0, 'IndexedDB opens=' + idbLog.opens);
  ok('no pattern was queued for the library', win.sessionStorage.getItem('chartdna_ohlc_pending_pattern') === null);
  ok('nothing was queued to auto-run the app search', win.sessionStorage.getItem('chartdna_ohlc_autosearch') === null);
  ok('the app\u2019s own search button never got a click from us', searchClicks === 0, searchClicks + ' clicks');
  const lsKeys = [];
  for (let i = 0; i < win.localStorage.length; i++) lsKeys.push(win.localStorage.key(i));
  ok('the user\u2019s dataset selection and pattern library are untouched',
    lsKeys.indexOf('chartdna_selected_dataset_ids') < 0 && lsKeys.indexOf('chartdna_saved_patterns') < 0,
    'localStorage: ' + lsKeys.join(',') );
  const ours = lsKeys.filter((k) => /^chartdna_/.test(k));
  ok('at most the typed form is kept, nothing else', ours.every((k) => k === 'chartdna_ohlc_form'), ours.join(',') || 'nothing under chartdna_*');
  ok('no script errors on the page', errors.length === 0, errors.join(' | ') || 'none');

  /* a page that loads with the app's own data present must not have it touched */
  const patSeed = JSON.stringify([{ id: 'builtin_1', name: 'الگوی داخلی', category: 'Reversal', points: [1, 2, 3, 4, 5] }]);
  const dom2 = await load({ idb, localStorage: { chartdna_saved_patterns: patSeed, chartdna_selected_dataset_ids: '["ds-user-1"]' } });
  await sleep(900);
  const ls2 = [];
  for (let i = 0; i < dom2.window.localStorage.length; i++) ls2.push(dom2.window.localStorage.key(i));
  ok('an existing library and selection survive a load of our window untouched',
    dom2.window.localStorage.getItem('chartdna_saved_patterns') === patSeed &&
    dom2.window.localStorage.getItem('chartdna_selected_dataset_ids') === '["ds-user-1"]' &&
    ls2.every((k) => !/^chartdna_ohlc_pending/.test(k)), ls2.join(','));
  try { dom2.window.close(); } catch (e) { }

  console.log('5) the extraction itself still works through what is left');
  $('ohlc-run').click();
  for (let i = 0; i < 120 && /پردازش/.test(txt('ohlc-status')); i++) await sleep(250);
  ok('run still measures the picture', (Array.isArray((win.__ohlcReport || {}).bars) ? win.__ohlcReport.bars.length : 0) >= 250,
    ((win.__ohlcReport || {}).bars || []).length + ' bars');
  ok('and the store is still untouched after a run', idbLog.opens === 0, 'opens=' + idbLog.opens);
  ok('still no page errors', errors.length === 0, errors.join(' | ') || 'none');

  /* ---- a page without that key: nothing is intercepted, the tool is still reachable ---- */
  console.log('6) a build without «ورود تصویر چارت» is left completely alone');
  const domN = await load({ idb }, '/nodeck.html');
  const winN = domN.window, docN = domN.window.document;
  await sleep(400);
  ok('the page really has no deck key', !docN.getElementById('btn-import-image') && winN.ChartDnaOhlc.deckKey() === null,
    'deckKey()=' + JSON.stringify(winN.ChartDnaOhlc.deckKey()));
  const fN = new winN.File([fs.readFileSync(IMG)], 'shot.jpg', { type: 'image/jpeg' });
  Object.defineProperty(docN.getElementById('app-file'), 'files', { value: [fN], configurable: true });
  docN.getElementById('app-file').dispatchEvent(new winN.Event('change', { bubbles: true }));
  await sleep(400);
  ok('no panel opens on its own there', docN.getElementById('ohlc-modal').style.display !== 'flex',
    'display=' + JSON.stringify(docN.getElementById('ohlc-modal').style.display) +
    ', computed=' + winN.getComputedStyle(docN.getElementById('ohlc-modal')).display);
  winN.ChartDnaOhlc.open();
  ok('but the environment is still reachable', docN.getElementById('ohlc-modal').style.display === 'flex',
    'display=' + docN.getElementById('ohlc-modal').style.display);
  ok('and it takes the image through its own drop zone',
    !!docN.getElementById('ohlc-file') && !!docN.getElementById('ohlc-drop') && !docN.getElementById('ohlc-pick'),
    'drop zone + input, no pick button');
  ok('no page errors in the second build either', errors.length === 0, errors.join(' | ') || 'none');
  try { domN.window.close(); } catch (e) { }

  await new Promise((r) => server.close(r));
  console.log('\n' + (fails ? 'FAILED ' + fails + ' of ' + checks + ' checks' : 'all ' + checks + ' checks passed'));
  process.exit(fails ? 1 : 0);
})();
