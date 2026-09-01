/* UI wiring test — jsdom page with a real Skia canvas behind HTMLCanvasElement.
 *
 * Loads chart-ohlc-engine.js and chart-ohlc-extractor.js exactly the way
 * index.html does, feeds the real screenshot through the file input, clicks every
 * action button and checks what the tool writes — which is nothing: no download key,
 * no file, no IndexedDB dataset, no app selection, no pattern queue, no auto-search.
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
            const tx = { objectStore: (nm) => ({ put: (rec) => { idbLog.rec = rec; idbLog.store = nm; return { }; } }), oncomplete: null, onerror: null };
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
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Escape still closes it (there is no close key on the card any more)',
    $('ohlc-modal').style.display === 'none' && !$('ohlc-close'), 'display=' + $('ohlc-modal').style.display);
  win.ChartDnaOhlc.open();
  $('ohlc-modal').dispatchEvent(new win.Event('click', { bubbles: true }));
  ok('and so does a click on the backdrop beside the card', $('ohlc-modal').style.display === 'none',
    'display=' + $('ohlc-modal').style.display);
  win.ChartDnaOhlc.open();
  ok('drag & drop and paste are wired on the upload key', !!$('ohlc-drop') && !!$('ohlc-file'), 'icon key + its input');

  /* what the window is called, and what is not called any more */
  const h2 = $('ohlc-card').querySelector('h2');
  ok('the window is named «ورود تصویر»', h2.textContent === 'ورود تصویر', JSON.stringify(h2.textContent));
  ok('no explanation sits under the name', !$('ohlc-card').querySelector('h2 + .ohlc-muted') &&
    h2.nextElementSibling.className.indexOf('ohlc-muted') < 0,
    'next sibling is <' + h2.nextElementSibling.tagName + ' class="' + h2.nextElementSibling.className + '">');
  ok('the card is one column now: the row of keys and the picture, and nothing else',
    !!h2.nextElementSibling.querySelector('#ohlc-bar') && !$('ohlc-card').querySelector('.ohlc-grid') &&
    !$('ohlc-card').querySelector('.ohlc-box') && !$('ohlc-card').querySelector('#ohlc-table'),
    'children of the card: ' + Array.prototype.slice.call($('ohlc-card').children).map((e) => e.id || e.className).join(' · '));
  const cardCss = Array.prototype.slice.call(win.document.querySelectorAll('style')).map((e) => e.textContent).join('\n');
  ok('the table gets a card of its own under the window, with the very same width',
    !!$('ohlc-table-card') && $('ohlc-modal').children.length === 2 &&
    /#ohlc-card,#ohlc-table-card\{width:min\(1080px,97vw\)[^}]*border:1px solid #334155;border-radius:18px/.test(cardCss),
    'children of the modal: ' + Array.prototype.slice.call($('ohlc-modal').children).map((e) => e.id).join(' · '));
  ok('and the modal is a column, so the two cards sit one under the other',
    /#ohlc-modal\{[^}]*flex-direction:column;align-items:center/.test(cardCss) &&
    /#ohlc-table-card\{margin-top:12px\}/.test(cardCss), 'one column, one gap');
  ok('the table card is empty and out of the way until something was extracted',
    $('ohlc-table-card').classList.contains('ohlc-hidden') && !$('ohlc-table').innerHTML.trim(), 'hidden while empty');
  ok('it scrolls under a sticky head, so a long table keeps the page short',
    /#ohlc-table\{max-height:min\(46vh,420px\);overflow:auto/.test(cardCss) &&
    /\.ohlc-table thead th\{position:sticky;top:0/.test(cardCss), 'scroll box + sticky head');
  ok('and the old wording is nowhere in the panel',
    !$('ohlc-card').textContent.match(/بازسازی OHLC از اسکرین|computer vision|حافظهٔ مدل/), 'clean');
  const GONE = ['ohlc-pick', 'ohlc-grab', 'ohlc-save', 'ohlc-save-search', 'ohlc-opt-pattern', 'ohlc-opt-replace',
    'ohlc-close', 'ohlc-csv', 'ohlc-png'];
  const PANEL = ['ohlc-symbol', 'ohlc-tf', 'ohlc-d0', 'ohlc-d1', 'ohlc-t0', 'ohlc-ref-row', 'ohlc-ref-price',
    'ohlc-ref-add', 'ohlc-ref-clear', 'ohlc-points'];
  ok('the pick / grab / save keys are gone, and with them the label, calibration and output panels',
    GONE.concat(PANEL).every((id) => !$(id)), GONE.concat(PANEL).filter((id) => $(id)).join(',') || 'none of them in the DOM');
  ok('the two download keys are gone, their row with them; «بستن» stayed up as the sixth key',
    !!$('ohlc-run') && !$('ohlc-csv') && !$('ohlc-png') && !$('ohlc-actions') && !$('ohlc-close') &&
    !!$('ohlc-confirm'),
    'children of the card: ' + Array.prototype.slice.call($('ohlc-card').children).map((e) => e.id || e.className).join(' · '));
  ok('the image still enters through the upload key (or a paste)', !!$('ohlc-drop') && !!$('ohlc-file'),
    'icon key + its file input');
  ok('«تأیید» starts out disabled: there is nothing to confirm yet', $('ohlc-confirm').disabled === true,
    'disabled=' + $('ohlc-confirm').disabled);
  ok('the connection box is off the card', !/اتصال به موتور/.test($('ohlc-card').textContent), 'no such heading');
  ok('and nothing of ours can be called to write into the app',
    typeof win.ChartDnaOhlc.saveDataset === 'undefined' && typeof win.ChartDnaOhlc.reload === 'undefined',
    'saveDataset=' + typeof win.ChartDnaOhlc.saveDataset + ', reload=' + typeof win.ChartDnaOhlc.reload);

  /* ---- six keys in one row, in the app's own deck format ---- */
  const bar = $('ohlc-bar');
  const keys = Array.prototype.slice.call(bar.children);
  ok('six keys in one row: upload, run, the three views, and «تأیید»',
    keys.length === 6 && keys.map((b) => b.id || b.dataset.view).join(',') === 'ohlc-drop,ohlc-run,chart,orig,ann,ohlc-confirm',
    keys.map((b) => b.id || b.dataset.view).join(' · '));
  ok('the row wears the deck’s own container classes',
    /(^| )flex( |$)/.test(bar.className) && /items-center/.test(bar.className) && /justify-between/.test(bar.className) &&
    /rounded-xl/.test(bar.className) && /p-1\.5/.test(bar.className) && /gap-1/.test(bar.className),
    bar.className.replace('ohlc-bar ', '').slice(0, 96));
  const DECK_KEY = 'flex-1 h-9 rounded-lg flex items-center justify-center transition-all duration-150 border ' +
    'cursor-pointer active:scale-95 group relative';
  ok('every key carries the very class list the app’s deck keys use',
    keys.every((b) => b.className.replace('ohlc-dk ', '') === DECK_KEY),
    keys.length + ' keys · ' + (keys[0].className.replace('ohlc-dk ', '') === DECK_KEY ? 'identical to #btn-import-image' : keys[0].className));
  ok('icon only, no writing on the face of any of them',
    keys.every((b) => b.tagName === 'BUTTON' && b.firstElementChild && b.firstElementChild.tagName === 'svg' &&
      b.children.length === 1 && !Array.prototype.slice.call(b.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) &&
    !$('ohlc-card').querySelector('.ohlc-lbl'),
    'one svg each · no text node · no .ohlc-lbl anywhere');
  ok('the icons come from the same library as the app (lucide, stroke-based, 24×24)',
    keys.every((b) => {
      const svg = b.firstElementChild;
      return /(^| )lucide( |$)/.test(svg.getAttribute('class') || '') && svg.getAttribute('viewBox') === '0 0 24 24' &&
        svg.getAttribute('stroke') === 'currentColor' && svg.getAttribute('fill') === 'none' && svg.getAttribute('stroke-width') === '2';
    }),
    keys.map((b) => ((b.firstElementChild.getAttribute('class') || '').match(/lucide-[a-z0-9-]+/g) || ['?'])[0]).join(' · '));
  ok('and each icon is the one that means its own job',
    ['lucide-image', 'lucide-scan-line', 'lucide-chart-no-axes-column', 'lucide-eye', 'lucide-crosshair', 'lucide-circle-check']
      .every((n, i) => (keys[i].firstElementChild.getAttribute('class') || '').indexOf(n) >= 0),
    ['image', 'scan-line', 'chart-no-axes-column', 'eye', 'crosshair', 'circle-check'].join(' · '));
  const words = { 'ohlc-drop': /Ctrl\+V/, 'ohlc-run': /استخراج کندل/, chart: /بازسازی‌شده/, orig: /تصویر اصلی/, ann: /مارک‌ها/, 'ohlc-confirm': /تأیید/ };
  ok('nothing was thrown away: the sentence of every key is its tooltip and its name',
    Object.keys(words).every((k) => {
      const b = k.indexOf('ohlc-') === 0 ? $(k) : bar.querySelector('[data-view="' + k + '"]');
      const t = b.getAttribute('title') || '', a = b.getAttribute('aria-label') || '';
      return words[k].test(t) && words[k].test(a) && t.indexOf('<') < 0 && a.indexOf('class=') < 0;
    }), 'title + aria-label carry the words, and both parse clean');
  ok('the fit machinery of the labelled row is deleted, not hidden',
    !/\.ohlc-sq|ohlc-ic|line-clamp/.test(Array.prototype.slice.call(win.document.querySelectorAll('style')).map((e) => e.textContent).join('\n')),
    'no square-key CSS left in the page');
  ok('the row sits above the image of the chart',
    (bar.compareDocumentPosition($('ohlc-chart')) & win.Node.DOCUMENT_POSITION_FOLLOWING) !== 0, 'bar → canvas');
  ok('the old drop panel, the old tab strip and the row of downloads are gone',
    !$('ohlc-card').querySelector('.ohlc-tabs') && !$('ohlc-card').querySelector('.ohlc-actions') &&
    !$('ohlc-actions') && !/\.ohlc-actions|\.ohlc-secondary/.test(
      Array.prototype.slice.call(win.document.querySelectorAll('style')).map((e) => e.textContent).join('\n')),
    'no strip, no download row, no button skin left in the styles');
  const origKey = $('ohlc-card').querySelector('[data-view="orig"]');
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
  ok('and the window opens without that sentence about picking from memory',
    !/از حافظه انتخاب کنید|اینجا همان کاری است که کلید/.test($('ohlc-card').textContent + txt('ohlc-status')) &&
    !/pickHint|deckLabel/.test(fs.readFileSync('/home/user/repo/chart-ohlc-extractor.js', 'utf8')) &&
    /هنوز تصویری انتخاب نشده/.test(txt('ohlc-status')), txt('ohlc-status').split('\n')[0].slice(0, 60));
  ok('what the upload key says is its own tooltip, untouched',
    /رها کنید/.test($('ohlc-drop').getAttribute('title') || ''), ($('ohlc-drop').getAttribute('title') || '').slice(0, 46) + '…');
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
  $('ohlc-confirm').dispatchEvent(new win.Event('click', { bubbles: true }));   /* nothing extracted yet: it just closes */
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
  ok('the axis calibration is measured and stays in the report, not on the card',
    !!cal.equation && /محور قیمت/.test(st) && !/price = /.test(st), cal.equation || 'no equation');
  ok('axis anchors listed (>= 3)', (cal.refs || []).length >= 3, (cal.refs || []).map((x) => x.price + '@' + x.row + '[' + x.source + ']').join('  '));
  ok('regression residual in USD reported', cal.residualUSD > 0 && cal.residualUSD < 0.2, 'RMS ' + cal.residualUSD);
  ok('pixel size in USD reported', cal.usdPerPx > 0 && /پیکسل/.test(st), '1 px = ' + cal.usdPerPx + ' USD');
  ok('independent price-tag check reported', !!cal.tagCheck && isFinite(cal.tagCheck.errorUSD) && Math.abs(cal.tagCheck.errorUSD) <= 0.1,
    'err ' + (cal.tagCheck && cal.tagCheck.errorUSD) + ' USD');
  ok('manual-review count reported', typeof q.meanConfidence === 'number' && Array.isArray(q.needReview), (q.needReview || []).length + ' flagged, mean conf ' + q.meanConfidence);
  ok('limitation stated in the status text', /محدودیت/.test(st), st.split('\n').slice(-1)[0]);
  ok('nothing invented: with no date source at all, no bar gets a date',
    nBars > 0 && (rep.bars || []).every((b) => !b.date) && R.dateMode === undefined,
    'dated bars: ' + (rep.bars || []).filter((b) => b.date).length + ' · dateMode=' + R.dateMode);
  ok('and after a run there is still no download key to enable', !$('ohlc-csv') && !$('ohlc-png') && !$('ohlc-save'),
    'csv/png were deleted with their function · save was deleted before them');
  ok('preview table rendered', ($('ohlc-table').querySelectorAll('tbody tr') || []).length > 0, $('ohlc-table').querySelectorAll('tbody tr').length + ' rows');
  const th = Array.prototype.slice.call($('ohlc-table').querySelectorAll('thead th')).map((x) => x.textContent.trim());
  ok('the table has eight columns and no note column', th.length === 8 && th.indexOf('note') < 0, th.join(' · '));
  const dcell = $('ohlc-table').querySelector('tbody td.ohlc-dir');
  ok('the direction is one arrow, not the word',
    !!dcell && /^[\u2191\u2193\u00b7]$/.test((dcell.textContent || '').trim()) &&
    /Bullish|Bearish/.test((dcell.firstElementChild.getAttribute('title') || '')),
    (dcell.outerHTML || '').replace(/\s+/g, ' ').slice(0, 96));
  ok('the word is not thrown away: it is the name of the cell',
    th.indexOf('Dir') >= 0 && !!dcell.firstElementChild.getAttribute('aria-label'),
    'aria-label = ' + dcell.firstElementChild.getAttribute('aria-label'));
  ok('nothing of the notes is rendered in the table',
    !/pixel|assumption|interpolated|occluded|excluded|row \d/i.test($('ohlc-table').textContent),
    'they stay in window.__ohlcReport only');
  ok('the card under the window opens with the first result',
    !$('ohlc-table-card').classList.contains('ohlc-hidden'), 'shown now');
  if (process.env.OHLC_PREVIEW) {
    const cssTxt = Array.prototype.slice.call(win.document.querySelectorAll('style')).map((e) => e.textContent).join('\n')
      .replace(/#ohlc-modal\{[^}]*\}/, '#ohlc-modal{display:block;position:static;background:none;backdrop-filter:none;padding:14px}');
    fs.writeFileSync(process.env.OHLC_PREVIEW, '<!doctype html>\n' +
      '<html lang="fa" dir="rtl"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>پیش‌نمایش — جدول در پنجرهٔ خودش، با فلش و بدون note</title><style>' +
      'body{margin:0;background:#060913;color:#e5e7eb;font-family:ui-sans-serif,system-ui,sans-serif}' +
      'main{max-width:1120px;margin:0 auto;padding:16px 12px}.note{color:#94a3b8;font-size:12.5px;line-height:1.9}' +
      'code{color:#7dd3fc;font-size:11.5px}' + cssTxt + '</style></head><body><main>' +
      '<h1 style="font-size:17px;margin:0 0 10px">HTML واقعیِ همان کد، بعد از یک استخراج واقعی (۲۹۶ کندل)</h1>' +
      $('ohlc-modal').innerHTML +
      '<p class="note">دو کارت، یک عرض: پنجرهٔ «ورود تصویر» و زیرش پنجرهٔ جدول. ستون <code>note</code> از جدول رفت ' +
      '(یادداشت‌ها فقط در <code>window.__ohlcReport</code> می‌مانند) و جهت کندل یک فلش است: <code>↑</code> سبز، ' +
      '<code>↓</code> قرمز؛ کلمهٔ Bullish/Bearish در <code>title</code> و <code>aria-label</code> همان سلول مانده. ' +
      'قابِ تصویر در این پیش‌نمایش خالی است چون بوم (<code>canvas</code>) در HTML ذخیره نمی‌شود؛ در برنامه همان ' +
      'اسکرین‌شات و کندل‌های بازسازی‌شده داخلش رسم می‌شوند.</p></main></body></html>\n');
    console.log('   preview written to ' + process.env.OHLC_PREVIEW);
  }
  $('ohlc-file').dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(300);
  ok('and a new picture takes the stale table away with it',
    $('ohlc-table-card').classList.contains('ohlc-hidden') && !$('ohlc-table').innerHTML.trim(), 'hidden + empty again');
  $('ohlc-run').click();
  for (let i = 0; i < 120 && /پردازش/.test(txt('ohlc-status')); i++) await sleep(250);
  ok('the table comes back with the new result', !$('ohlc-table-card').classList.contains('ohlc-hidden') &&
    ($('ohlc-table').querySelectorAll('tbody tr') || []).length > 0,
    $('ohlc-table').querySelectorAll('tbody tr').length + ' rows after the second run');
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
    /#ohlc-chart,#ohlc-orig,#ohlc-ann\s*\{[^}]*width:100%;height:auto;object-fit:contain/.test(css) &&
    !/#ohlc-chart\s*\{[^}]*height:300px/.test(css), 'one rule · height:auto · contain, never stretched');
  const rhythm = css.match(/@media\(min-width:820px\)\{#ohlc-chart[^}]*\}/);
  ok('the frame takes the app’s own card height, so the cards line up',
    !!rhythm && /min-height:340px/.test(rhythm[0]) && /max-height:390px/.test(rhythm[0]),
    rhythm ? rhythm[0].replace(/[#{}]/g, ' ').replace(/\s+/g, ' ').trim() : 'no shared rhythm');
  const ourSrc = fs.readFileSync('/home/user/repo/chart-ohlc-extractor.js', 'utf8');
  /* the trend overlay sits over the app's crop card, so that card's id is read — its rect.
     What must stay true is the rest: we never style it, never hide it, never put a node
     inside it, and we keep our hands off the other three React-owned cards entirely. */
  const mentions = (ourSrc.replace(/'#btn-import-image'|DECK_ID[^\n]*|isDeckKey[\s\S]{0,400}/g, '')
    .match(/image-cropper-card|comparative-chart-card|pattern-overlay-canvas-card|chart-dna-app/g) || []);
  ok('and it is done on our own nodes: the crop card is measured, never restyled',
    mentions.length === 1 && mentions[0] === 'image-cropper-card' &&
    /cropCard = \(\) => document\.getElementById\('image-cropper-card'\)/.test(ourSrc) &&
    !/cropper-card'\)\s*\.style|cropCard\(\)\.(style|classList|appendChild|innerHTML|remove)/.test(ourSrc) &&
    !/#(image-cropper-card|comparative-chart-card|pattern-overlay-canvas-card)/.test(ourSrc),
    'mentions: ' + (mentions.join(', ') || 'none') + ' · one getElementById for its rect, no selector, no mutation');
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
  const isTrend = (r, g, b) => r > 240 && g > 195 && g < 235 && b < 110;   /* #facc15 / #fde047 */
  const onDark = (r, g, b) => Math.abs(r - 11) + Math.abs(g - 18) + Math.abs(b - 32) > 40 && !isTrend(r, g, b);
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
  /* #facc15 / #fde047 — the trend line and its two prices; the low-confidence tick is
     #f59e0b and the candles are cyan/red, so anything found here can only be the line */
  const chartD = $('ohlc-chart').getContext('2d').getImageData(0, 0, $('ohlc-chart').width, $('ohlc-chart').height).data;
  let yellow = 0;
  for (let i = 0; i < chartD.length; i += 4) {
    if (chartD[i] > 240 && chartD[i + 1] > 195 && chartD[i + 1] < 235 && chartD[i + 2] < 110) yellow++;
  }
  const nOk = res.bars.filter((b) => b.status === 'ok' && b.close != null).length;
  const tr0 = win.ChartDnaOhlc.trend();
  ok('the trend line is drawn over the reconstructed view too', yellow > 400,
     yellow + ' line pixels on a ' + $('ohlc-chart').width + '×' + $('ohlc-chart').height + ' frame');
  const ys = res.bars.filter((b) => b.status === 'ok' && b.close != null).map((b) => b.close);
  const N = ys.length, mx = (N - 1) / 2, my = ys.reduce((a, v) => a + v, 0) / N;
  let num = 0, den = 0;
  ys.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) * (i - mx); });
  const sl = num / den, ic = my - sl * mx;
  const sse = ys.reduce((a, v, i) => a + (v - (ic + sl * i)) ** 2, 0);
  const sst = ys.reduce((a, v) => a + (v - my) ** 2, 0);
  ok('it is a fit to the closes that were measured, and only to them',
    !!(tr0 && tr0.ok) && tr0.n === nOk && Math.abs(tr0.slope - sl) < 1e-5 &&
    Math.abs(tr0.intercept - ic) < 0.02 && Math.abs(tr0.r2 - (1 - sse / sst)) < 1e-3 &&
    tr0.values.length === nOk && tr0.closes.length === nOk && tr0.lo <= Math.min.apply(null, ys) + 1e-9 &&
    tr0.hi >= Math.max.apply(null, ys) - 1e-9,
    'slope ' + tr0.slope + ' vs ' + sl.toFixed(6) + ' · r² ' + tr0.r2 + ' vs ' + (1 - sse / sst).toFixed(4));
  ok('the direction it reports agrees with its own slope, and the window says so plainly',
    tr0.direction === (tr0.slope > 0 ? 'up' : tr0.slope < 0 ? 'down' : 'range') &&
    Math.abs(tr0.start - ic) <= 0.005 && Math.abs(tr0.end - (ic + sl * (N - 1))) <= 0.005 &&
    Math.abs(tr0.risePct - (tr0.end - tr0.start) / Math.abs(tr0.start) * 100) < 0.01,
    tr0.direction + ' · ' + tr0.start + '→' + tr0.end + ' (' + tr0.risePct + '٪)');
  ok('the line really is y = slope·k + intercept', nOk > 2 &&
     Math.abs(tr0.values[nOk - 1] - (tr0.intercept + tr0.slope * (nOk - 1))) < 0.02,
     'end ' + tr0.values[nOk - 1] + ' vs ' + (tr0.intercept + tr0.slope * (nOk - 1)).toFixed(4));
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

  console.log('2b) the label, calibration and output panels are gone, with their function');
  /* ourSrc — the text of the extractor — was read in section 1 */
  ok('not one control of those panels is in the DOM', PANEL.every((id) => !$(id)), PANEL.filter((id) => $(id)).join(',') || 'none');
  const cardTxt = $('ohlc-card').textContent;
  ok('their headings and their boxes are gone too',
    !/برچسب دیتاست|کالیبراسیون محور قیمت|خروجی/.test(cardTxt) && !$('ohlc-card').querySelector('.ohlc-box'),
    'no box, no heading on the card');
  ok('and the code behind them is deleted, not left idle',
    !/applyDates|state\.points|renderPoints|extraRefs|chartdna_ohlc_form|calibNote|contentBox|ohlc-box|ohlc-grid|ohlc-muted/.test(ourSrc),
    'no date path, anchors, form storage or box styling left in the file');
  ok('a click on the picture collects nothing any more',
    ($('ohlc-orig').dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: 300, clientY: 200 })), true) &&
    !$('ohlc-points') && /کندل‌ها:/.test(txt('ohlc-status')),
    txt('ohlc-status').split('\n')[0]);
  ok('one short line of feedback is all the card shows',
    txt('ohlc-status').split('\n').length <= 4, txt('ohlc-status').split('\n').length + ' lines');

  console.log('3) nothing is written to disk: the exports are gone, the numbers stay in memory');
  const captured = [];
  const OrigBlob = win.Blob;
  win.Blob = function (parts, o) { const b = new OrigBlob(parts, o); b.__txt = typeof parts[0] === 'string' ? parts[0] : ''; captured.push(b); return b; };
  win.Blob.prototype = OrigBlob.prototype;
  let download = null;
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (t) => { const el = origCreate(t); if (t === 'a') el.click = () => { download = el.download; }; return el; };
  ok('no export key is on either card', !$('ohlc-csv') && !$('ohlc-png') &&
    !$('ohlc-card').querySelector('.ohlc-actions') && !$('ohlc-table-card').querySelector('.ohlc-actions'),
    'card: ' + Array.prototype.slice.call($('ohlc-card').children).map((e) => e.id || e.className).join(' · ') +
    ' · table card: ' + Array.prototype.slice.call($('ohlc-table-card').children).map((e) => e.id).join(' · '));
  ok('and the whole path is deleted from the file, not left idle',
    !/dlBlob|function dl\(|a\.download|ohlc-csv|ohlc-png|T\.csv|T\.png|ohlc-secondary/.test(
      fs.readFileSync('/home/user/repo/chart-ohlc-extractor.js', 'utf8')),
    'no blob, no anchor, no listener, no skin for them');
  ok('the page wrote no file at all', captured.length === 0 && download === null,
    'blobs=' + captured.length + ' · download=' + download);
  const csv = win.ChartDnaOhlc.toCSV();
  const lines = String(csv || '').split('\r\n');
  ok('the numbers are still there, in the very same schema',
    lines[0] === 'Candle,Date,Time,Open,High,Low,Close,Direction,Confidence', lines[0]);
  const data = lines.slice(1).filter((l) => l.length);
  ok('one row per candle', data.length === nBars, data.length + ' rows for ' + nBars + ' candles');
  ok('row count equals the candle numbers', data.every((l, i) => +l.split(',')[0] === i + 1), 'numbered 1..' + data.length);
  const nums = (lines[1] || '').split(',');
  ok('row values are numeric and H>=body>=L', ['', 'Bullish', 'Bearish'].indexOf(nums[7]) >= 0 && parseFloat(nums[3]) <= parseFloat(nums[4]) && parseFloat(nums[5]) <= Math.min(parseFloat(nums[3]), parseFloat(nums[6])), 'row 1: ' + lines[1]);
  ok('Date stays empty — nothing was typed in and nothing is invented',
    data.every((l) => l.split(',')[1] === ''), 'row 1: ' + lines[1]);
  ok('Time column stays empty', (lines[50] || '').split(',')[2] === '', 'row 50: ' + lines[50]);

  console.log('3b) «تأیید» — the sixth key closes the window and stays read-only');
  /* the overlay is placed from the app's own rect and jsdom has no layout: give the
     crop stage one, so a real placement can be checked */
  const appCv = $('app-canvas');
  if (appCv) appCv.getBoundingClientRect = () => ({ left: 30, top: 50, width: 600, height: 300, right: 630, bottom: 350, x: 30, y: 50 });
  const ck = $('ohlc-confirm');
  ok('the confirm key is armed only once something was extracted', ck.disabled === false, 'disabled=' + ck.disabled);
  win.ChartDnaOhlc.open(); await sleep(20);
  ok('the window is open before the confirm', $('ohlc-modal').style.display === 'flex', 'display=' + $('ohlc-modal').style.display);
  ck.dispatchEvent(new win.Event('click', { bubbles: true }));
  await sleep(80);
  ok('one press closes the window — the user is back on the app’s first page',
    $('ohlc-modal').style.display === 'none', 'display=' + $('ohlc-modal').style.display);
  ok('and the flow is marked as confirmed, in our own report only',
    !!win.ChartDnaOhlc.confirmed() && !!win.__ohlcReport && typeof win.__ohlcReport.confirmedAt === 'string' &&
    win.__ohlcReport.confirmedCandles === nBars,
    'confirmed=' + win.ChartDnaOhlc.confirmed() + ' · at ' + (win.__ohlcReport || {}).confirmedAt + ' · ' + (win.__ohlcReport || {}).confirmedCandles + ' candles');
  ok('the picture and the numbers survive it: reopening shows the same result',
    (win.ChartDnaOhlc.open(), $('ohlc-modal').style.display === 'flex') && $('ohlc-chart').width > 0 &&
    win.ChartDnaOhlc.toCSV().trim().split('\r\n').length === nBars + 1,
    'canvas ' + $('ohlc-chart').width + '×' + $('ohlc-chart').height + ' · csv still ' + nBars + ' rows');
  ok('confirming opened the app\u2019s store once and pressed nothing itself',
    idbLog.opens === 1 && searchClicks === 0, 'IndexedDB opens=' + idbLog.opens + ', app search clicks=' + searchClicks);
  ok('the report now carries the line that was confirmed',
    !!(win.__ohlcReport.confirmedTrend && win.__ohlcReport.confirmedTrend.n === nOk) &&
    win.__ohlcReport.confirmedTrend.slope === tr0.slope && win.__ohlcReport.confirmedTrend.r2 === tr0.r2,
    JSON.stringify(win.__ohlcReport.confirmedTrend));
  ok('and the same numbers are in the run report', win.__ohlcReport.trend &&
    win.__ohlcReport.trend.n === nOk && win.__ohlcReport.trend.values.length === nOk,
    'trend for ' + nOk + ' closes');

  console.log('4) what «تأیید» hands to the engine — the dataset, the library, the selection');
  await sleep(300);
  const wr = await win.__ohlcWrite;
  ok('the hand-over finished without an error', !!(wr && !wr.error), JSON.stringify(wr));
  const rec = idbLog.rec || {};
  ok('one dataset in the app\u2019s own store, under the app\u2019s own key',
    idbLog.store === 'market_datasets' && rec.id === wr.id && /^pxrec-/.test(rec.id),
    'store=' + idbLog.store + ' · id=' + rec.id);
  ok('it is a market_datasets record with the app\u2019s fields',
    rec.name === wr.name && rec.symbol === 'IMAGE' && rec.timeframe === '1h' &&
    rec.source === 'pixel-reconstruction' && typeof rec.note === 'string' && rec.note.length > 20,
    rec.name + ' · ' + rec.source);
  ok('every candle carries the four prices, the confidence and the note that explains it',
    Array.isArray(rec.candles) && rec.candles.length === nOk && rec.candles.every((c) =>
      typeof c.open === 'number' && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) &&
      typeof c.confidence === 'number' && 'notes' in c && c.volume === 0 && !!c.timestamp),
    (rec.candles || []).length + ' candles · first: ' + JSON.stringify((rec.candles || [])[0]));
  ok('nothing was left out of what the picture yielded — the axis, the residuals, the tag check',
    !!(rec.origin && rec.origin.axis && rec.origin.axis.refs && rec.origin.axis.refs.length >= 2 &&
      rec.origin.axis.equation && typeof rec.origin.pixels.width === 'number' &&
      rec.origin.candles === nBars && rec.origin.incomplete === (nBars - nOk) &&
      typeof rec.origin.meanConfidence === 'number' && rec.origin.grid && rec.origin.grid.pitch > 0),
    JSON.stringify(rec.origin && { candles: rec.origin.candles, measured: rec.origin.measured, usdPerPx: rec.origin.usdPerPx, axis: rec.origin.axis.model }));
  ok('the trend line and its numbers ride along on the record',
    !!rec.trend && rec.trend.n === nOk && rec.trend.slope === tr0.slope && rec.trend.r2 === tr0.r2 &&
    rec.trend.start === tr0.start && rec.trend.end === tr0.end && rec.trend.model === tr0.model &&
    rec.trend.unit === 'price per candle', JSON.stringify(rec.trend));
  ok('the dataset was added to the app\u2019s selection, not written over it',
    JSON.parse(win.localStorage.getItem('chartdna_selected_dataset_ids') || '[]').join() === wr.id,
    win.localStorage.getItem('chartdna_selected_dataset_ids'));
  ok('two entries went to the pattern library, both searchable',
    wr.patterns.length === 2 && wr.patterns[0] === 'custom_dna_px_' + wr.id &&
    /_trend$/.test(wr.patterns[1]) && wr.patternStates.length === 2,
    wr.patterns.join(' + ') + ' → ' + wr.patternStates.join(','));
  const pend = JSON.parse(win.sessionStorage.getItem('chartdna_px_pending_pattern') || 'null');
  ok('this page had no library yet, so both entries wait for the next load instead of clobbering the seed',
    wr.waitingForLoad === true && Array.isArray(pend) && pend.length === 2 &&
    pend[0].id === wr.patterns[0] && pend[1].id === wr.patterns[1],
    'queued: ' + (Array.isArray(pend) ? pend.map((x) => x.id).join(' + ') : 'nothing'));
  const closes = (rec.candles || []).map((c) => c.close);
  ok('the first entry is exactly the closes the engine compares',
    pend[0].points.join() === closes.join() && pend[0].normalizedPoints.length === nOk &&
    pend[0].normalizedPoints.every((v) => v >= -1.0001 && v <= 1.0001) && pend[0].category === 'Pixel trend',
    pend[0].points.slice(0, 3).join(', ') + ' … ' + pend[0].points[pend[0].points.length - 1]);
  ok('the second is the line itself, and its note says plainly that a straight ramp is a weak query',
    pend[1].points.join() === tr0.values.join() && /راستای صاف/.test(pend[1].notes) &&
    /کمترین‌مربعات/.test(pend[1].notes) && pend[1].name === wr.name + ' · trend line',
    pend[1].name + ' · ' + String(pend[1].notes).slice(0, 64) + '…');
  ok('the names keep clear of the sweep that deletes the old image records',
    wr.patterns.every((p) => p.indexOf('img-') !== 0) &&
    !/from image|کادر برنامه|از تصویر/i.test(wr.name) && !/^img-/.test(wr.id),
    wr.id + ' · ' + wr.name);
  ok('no search was run for the user and no reload was forced', searchClicks === 0 &&
    !/location\.reload|__chartDnaReload/.test(fs.readFileSync('/home/user/repo/chart-ohlc-extractor.js', 'utf8')),
    'app search clicks=' + searchClicks);
  ok('the candle chart is painted over «محیط الگو» as a sibling that cannot be clicked', (function () {
    const ov = $('ohlc-trend-overlay');
    const app = $('app-canvas');
    if (!ov || !app) return false;
    const r = ov.getBoundingClientRect ? ov.style : null;
    return ov.parentNode === doc.body && ov.parentNode !== $('image-cropper-card') &&
      /pointer-events: none/.test(ov.getAttribute('style') || '') &&
      ov.width > 0 && ov.height > 0 && !!r && !!ov.getAttribute('title') && app.parentNode === $('image-cropper-card');
  })(), (function () { const o = $('ohlc-trend-overlay'); return o ? o.width + '×' + o.height + ' over ' + (o.style.left || '?') + ',' + (o.style.top || '?') : 'no overlay'; })());
  const ovd = $('ohlc-trend-overlay') && $('ohlc-trend-overlay').getContext('2d').getImageData(0, 0, $('ohlc-trend-overlay').width, $('ohlc-trend-overlay').height).data;
  let oy = 0, oteal = 0, ored = 0;
  if (ovd) for (let i = 0; i < ovd.length; i += 4) {
    if (ovd[i] > 240 && ovd[i + 1] > 195 && ovd[i + 1] < 235 && ovd[i + 2] < 110) oy++;
    if (ovd[i + 3] > 60 && ovd[i] < 90 && ovd[i + 1] > 120 && ovd[i + 2] > 110 && ovd[i + 2] < 200) oteal++;
    if (ovd[i + 3] > 60 && ovd[i] > 200 && ovd[i + 1] < 130 && ovd[i + 2] < 130) ored++;
  }
  ok('the overlay carries the measured candles themselves, and the line on top of them', oy > 300 && (oteal + ored) > 400,
    oy + ' line px · ' + oteal + ' bull px · ' + ored + ' bear px');
  ok('and the record of that chart is kept for the next load, outside every sweep pattern', (function () {
    let rec = null;
    try { rec = JSON.parse(win.localStorage.getItem('chartdna_px_overlay') || 'null'); } catch (e) { return false; }
    return !!rec && Array.isArray(rec.candles) && rec.candles.length === nOk &&
      rec.candles.every((c) => typeof c.c === 'number' && c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c)) &&
      !!rec.trend && rec.trend.n === nOk && rec.trend.slope === tr0.slope;
  })(), win.localStorage.getItem('chartdna_px_overlay') ? 'chartdna_px_overlay: ' + win.localStorage.getItem('chartdna_px_overlay').length + ' chars' : 'missing');
  ok('the overlay is ours to switch off again', win.ChartDnaOhlc.overlay(false) === false &&
    !$('ohlc-trend-overlay') && win.ChartDnaOhlc.overlay(true) === true && !!$('ohlc-trend-overlay'),
    'off then on');
  ok('the store is opened once in all of this — no reload loop on the app', idbLog.opens === 1, 'opens=' + idbLog.opens);
  ok('no script errors on the page', errors.length === 0, errors.join(' | ') || 'none');

  /* a page that loads with the app's own data present must not have it touched */
  const patSeed = JSON.stringify([{ id: 'builtin_1', name: 'الگوی داخلی', category: 'Reversal', points: [1, 2, 3, 4, 5] }]);
  const dom2 = await load({ idb, localStorage: { chartdna_saved_patterns: patSeed, chartdna_selected_dataset_ids: '["ds-user-1"]' } });
  await sleep(900);
  const ls2 = [];
  for (let i = 0; i < dom2.window.localStorage.length; i++) ls2.push(dom2.window.localStorage.key(i));
  ok('loading our window alone leaves the library and the selection exactly as they were',
    dom2.window.localStorage.getItem('chartdna_saved_patterns') === patSeed &&
    dom2.window.localStorage.getItem('chartdna_selected_dataset_ids') === '["ds-user-1"]' &&
    !dom2.window.sessionStorage.getItem('chartdna_px_pending_pattern'), ls2.join(','));
  /* same page, this time with a library already there: both entries are appended to it */
  const w2 = dom2.window, d2 = dom2.window.document;
  const app2 = d2.getElementById('app-canvas');
  if (app2) app2.getBoundingClientRect = () => ({ left: 8, top: 12, width: 520, height: 260, right: 528, bottom: 272, x: 8, y: 12 });
  w2.ChartDnaOhlc.open(); await sleep(30);
  const f2 = new w2.File([fs.readFileSync(IMG)], 'shot.jpg', { type: 'image/jpeg' });
  Object.defineProperty(d2.getElementById('ohlc-file'), 'files', { value: [f2], configurable: true });
  d2.getElementById('ohlc-file').dispatchEvent(new w2.Event('change', { bubbles: true }));
  await sleep(400);
  d2.getElementById('ohlc-run').click();
  for (let i = 0; i < 160 && /پردازش/.test(d2.getElementById('ohlc-status').textContent); i++) await sleep(250);
  const bars2 = ((w2.__ohlcReport || {}).bars || []).length;
  ok('the second page measured the same picture', bars2 >= 250, bars2 + ' bars');
  d2.getElementById('ohlc-confirm').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await sleep(300);
  const wr2 = w2.__ohlcWrite || {};
  const lib2 = JSON.parse(w2.localStorage.getItem('chartdna_saved_patterns') || '[]');
  ok('with a library present, both entries are written into it and the user\u2019s own stays first',
    !wr2.error && wr2.waitingForLoad === false && wr2.patternStates.join() === 'added,added' &&
    lib2.length === 3 && lib2[0].id === 'builtin_1' && lib2[1].id === wr2.patterns[0] && lib2[2].id === wr2.patterns[1],
    lib2.map((p) => p.id + '(' + (p.points || []).length + ')').join(' '));
  ok('the line entry is a straight ramp once normalised, which is why it carries the warning',
    lib2.length === 3 && (() => {
      const t = lib2[2], u = (t.points || []).slice(1).map((v, i) => v - t.points[i]);
      const flat = u.every((dv) => Math.abs(dv - u[0]) < 0.02);
      return flat && /راستای صاف/.test(t.notes) && Math.abs(t.normalizedPoints[0] + 1) < 0.01 && Math.abs(t.normalizedPoints[t.points.length - 1] - 1) < 0.01;
    })(), lib2.length === 3 ? lib2[2].name + ' · ' + lib2[2].category : '—');
  ok('the selection grows instead of being replaced',
    JSON.parse(w2.localStorage.getItem('chartdna_selected_dataset_ids') || '[]').join() === 'ds-user-1,' + wr2.id,
    w2.localStorage.getItem('chartdna_selected_dataset_ids'));
  ok('the overlay follows that page\u2019s crop window, at its rect', (() => {
    const o = d2.getElementById('ohlc-trend-overlay');
    return !!o && o.width === 520 && o.height === 260 && o.style.left === '8px' && o.style.top === '12px';
  })(), (function () { const o = d2.getElementById('ohlc-trend-overlay'); return o ? o.width + '×' + o.height + ' @' + o.style.left + ',' + o.style.top : 'no overlay'; })());
  /* React would persist its own copy of the library on any change, rolling our write back:
     the bounded re-append has to survive exactly that */
  w2.localStorage.setItem('chartdna_saved_patterns', patSeed);
  await sleep(2100);
  const lib3 = JSON.parse(w2.localStorage.getItem('chartdna_saved_patterns') || '[]');
  ok('a write-back from the app does not cost us our two entries',
    lib3.length === 3 && lib3.some((p) => p.id === wr2.patterns[0]) && lib3.some((p) => /_trend$/.test(p.id)) &&
    lib3[0].id === 'builtin_1', lib3.map((p) => p.id).join(' | '));
  ok('and that page was fed too: the store was opened once more, no more', idbLog.opens === 2, 'opens=' + idbLog.opens);
  ok('still no click on «جستجو» from us in either page', searchClicks === 0, searchClicks + ' clicks');
  try { dom2.window.close(); } catch (e) { }

  console.log('5) the extraction itself still works through what is left');
  const opensBefore = idbLog.opens;
  $('ohlc-run').click();
  for (let i = 0; i < 120 && /پردازش/.test(txt('ohlc-status')); i++) await sleep(250);
  ok('run still measures the picture', (Array.isArray((win.__ohlcReport || {}).bars) ? win.__ohlcReport.bars.length : 0) >= 250,
    ((win.__ohlcReport || {}).bars || []).length + ' bars');
  ok('but a run by itself writes nothing — only «تأیید» hands it over',
    idbLog.opens === opensBefore, 'opens ' + opensBefore + ' → ' + idbLog.opens);
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
