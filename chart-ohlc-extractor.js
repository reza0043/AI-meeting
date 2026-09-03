/* Chart DNA — «ورود تصویر» (UI layer)
 * Runs the pixel-measurement engine (chart-ohlc-engine.js) on a chart
 * screenshot and shows what was measured: the reconstructed candles and the table
 * of the numbers. The trend line and everything computed for it were removed in v28.
 * The window is named after what it is for: an image goes in, candles come out.
 * Nothing is downloaded and no picture leaves the page. «تأیید» hands the
 * measurement to the app's own engine — nothing is stored: only one temporary query
 * (the closes series) sits in the pattern library and each confirm replaces it — and
 * paints the reconstructed candlestick chart over «محیط الگو» at exactly the shape
 * and size of this window's picture (the card's stage is reshaped to the same wide
 * strip), keeping it in chartdna_px_overlay so it is back after a reload. The
 * search itself stays the
 * app's action: this window never presses «جستجو» for the user and never reloads.
 * The panel is a permanent part of the main page: it sits at the top of «محیط الگو»
 * in the sidebar, so there is no opener key any more (the old #btn-import-image key
 * in the deck strip is hidden). The screenshot is picked right here in the panel.
 * Everything happens in the browser: no image and no number leaves the page.
 */
(() => {
  /* v44: a second six-key row (numbered 1-6, same size/format as the row below) sits
     above the window's own key row, waiting for the assignments the owner will give
     each key later. The row is inert: the keys exist for wiring only, and carry their
     number on the face (a larger digit replaces the icon, since there is no glyph to
     show yet). Titles: «کلید ۱» … «کلید ۶» (persian labels so they read at a glance).
     Assignments later only need to attach listeners to #ohlc-fn-1 … #ohlc-fn-6. */
  const FUN_BAR = 1; /* row #1 (numbered), the original six-key row is #0 */
  const STYLE = `
  /* the import panel is no longer a full-screen overlay: it lives permanently at the top
     of «محیط الگو» (the sidebar's first card) and reads as one more card in the page. */
  #ohlc-modal{display:flex;position:static;width:100%;background:transparent;flex-direction:column;align-items:stretch;justify-content:flex-start;padding:0;overflow:visible;margin:0 0 12px;z-index:auto}
  /* the window is two cards now — the picture and, under it, the table — and they share
     one width, one frame and one rhythm, so the page reads as a single column */
  #ohlc-card,#ohlc-table-card{width:100%;background:#0b1220;color:#e5e7eb;border:1px solid #334155;border-radius:18px;padding:16px;box-sizing:border-box;box-shadow:0 12px 40px #000a;font-family:inherit}
  /* the deck key that used to open the overlay is retired: the panel is always on the page */
  #btn-import-image{display:none!important}
  /* v51 — the whole deck strip below «محیط الگو» is retired: its play/stop/trash
     duties moved up to کلیدهای ۴–۶ of the numbered row (the buttons stay in the DOM,
     hidden, so the app's own handlers and enabled/disabled states keep working and the
     fn keys forward real clicks to them — «همان کاربری و اتصالات»). */
  #remote-control-deck{display:none!important}
  #ohlc-table-card{margin-top:12px}
  #ohlc-card h2{margin:0;font-size:19px}
  /* the six keys sit in one row, exactly like #remote-control-deck: 36px tall, rounded,
     equal widths, icon only; the values below are the same numbers the app's utilities give
     (flex-1 / h-9 / rounded-lg / gap-1 / p-1.5), so the row looks the same with or without them */
  #ohlc-bar{margin:10px 0 2px;background:#0e1826f0;border-color:#1e293b;gap:4px;padding:6px}
  #ohlc-bar.row-0{margin:10px 0 2px}
  /* v44 — the numbered row above the window's own row: identical geometry (same
     classes, 36px keys, 4px gap, 6px padding -> same 360x50 box as the row below).
     It is visually a sibling card: slightly distinct background (#101b2d) and a muted
     border-top accent so it reads as a separate band for future tools. */
  #ohlc-fn-bar{box-sizing:border-box;background:#101b2df5;border-color:#26354e;gap:4px;padding:6px;margin:0 0 6px}
  .ohlc-dk{box-sizing:border-box;flex:1 1 0;min-width:0;min-height:36px;border:1px solid #334155;border-radius:8px;
           background:#111d2ecc;color:#cbd5e1;cursor:pointer;display:flex;align-items:center;justify-content:center;
           transition:all .15s ease;font:inherit}
  /* numbered keys: the digit is the face for now; same hover/active language as the
     icon keys below, so the two rows behave alike */
  .ohlc-dk.fn-key{font-size:16px;font-weight:700;line-height:1;letter-spacing:0;background:#101a2b}
  .ohlc-dk.fn-key:hover{border-color:#38bdf8;color:#bae6fd;background:#0c2038}
  .ohlc-dk.fn-key .fn-num{pointer-events:none}
  #ohlc-fn-bar .ohlc-dk[aria-disabled=true]{opacity:.55;cursor:default}
  /* keep the original row's bottom margin intact: the numbered row above has its own */
  #ohlc-card > div > .row-0{margin-bottom:2px}
  /* v45 — live TradingView price, opened by key ۱ of the numbered row
     (default open, collapsible; inline in the window + fullscreen mode) */
  #ohlc-tv{display:none;margin:10px 0 2px;background:#0e1826f0;border:1px solid #26354e;border-radius:14px;padding:8px;box-sizing:border-box}
  #ohlc-tv.open{display:block}
  #ohlc-tv-head{display:flex;align-items:center;gap:6px;margin-bottom:6px}
  #ohlc-tv-title{font-size:12px;font-weight:700;color:#cbd5e1;flex:1;display:flex;align-items:center;gap:6px}
  #ohlc-tv-title .dot{width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981}
  #ohlc-tv-mode{font-size:10.5px;font-weight:700;color:#7dd3fc;background:#0c2038;border:1px solid #334155;border-radius:999px;padding:2px 9px;white-space:nowrap;line-height:1.7}
  #ohlc-tv-head button{box-sizing:border-box;min-width:30px;height:26px;padding:0 8px;background:#111d2e;color:#94a3b8;border:1px solid #334155;border-radius:7px;cursor:pointer;font:inherit;font-size:12px;line-height:1;transition:all .15s ease}
  #ohlc-tv-head button:hover{border-color:#38bdf8;color:#e0f2fe;background:#0c2038}
  #ohlc-tv-stage{position:relative;height:300px;border:1px solid #1e293b;border-radius:10px;overflow:hidden;background:#0b1220}
  #ohlc-tv-chart{position:absolute;inset:0;transform-origin:center center;transition:transform .2s ease}
  /* v46 — «دوربین از فاصله»: the whole TV picture is scaled down inside the dark
     frame (like watching TV from a distance). Fullscreen mode always shows it at
     full size (buttons hidden there, transform lifted). */
  #ohlc-tv.full #ohlc-tv-chart{transform:none!important}
  #ohlc-tv.full #ohlc-tv-zout,#ohlc-tv.full #ohlc-tv-zin{display:none}
  #ohlc-tv.full{position:fixed;inset:10px;z-index:300;margin:0;display:flex;flex-direction:column;box-shadow:0 20px 70px #000c}
  #ohlc-tv.full #ohlc-tv-stage{flex:1 1 auto;height:auto;min-height:0}
  #ohlc-fn-1.on{border-color:#10b981;color:#a7f3d0;background:#0f2a20;box-shadow:0 0 0 1px #10b98166}
  @media(max-width:430px){#ohlc-tv-stage{height:230px}}
  .ohlc-dk:hover{border-color:#10b981;color:#a7f3d0;background:#0f2a20}
  .ohlc-dk:active{transform:scale(.95)}
  .ohlc-dk:disabled{opacity:.45;cursor:not-allowed}
  .ohlc-dk svg{width:16px;height:16px;transition:transform .15s ease}
  .ohlc-dk:hover svg{transform:scale(1.1)}
  .ohlc-dk[data-view][aria-selected=true]{background:#082f49;border-color:#22d3ee;color:#a5f3fc}
  #ohlc-drop{color:#94a3b8}
  #ohlc-drop.ohlc-over{border-color:#10b981;color:#a7f3d0;background:#04150f}
  #ohlc-confirm{color:#10b981}
  #ohlc-confirm:not(:disabled){background:#062b1e;border-color:#10b981}
  @media(max-width:430px){#ohlc-bar{gap:2px;padding:4px}.ohlc-dk{min-height:34px;border-radius:7px}}
  /* the three views share one frame: same box, same ratio, same length of the series.
     the card rhythm (340px, 390px when there is room) is the one the app's own chart cards
     use, and object-fit keeps the picture whole — so the page reads as one grid, not two */
  #ohlc-chart,#ohlc-orig,#ohlc-ann{width:100%;height:auto;object-fit:contain;box-sizing:border-box;border:1px solid #334155;border-radius:10px;background:#0b1220;display:block;margin-top:8px}
  @media(min-width:820px){#ohlc-chart,#ohlc-orig,#ohlc-ann{min-height:340px;max-height:390px}}
  #ohlc-status{margin-top:10px;color:#a7f3d0;font-size:12.5px;white-space:pre-wrap;line-height:1.7}
  .ohlc-warn{color:#fbbf24}.ohlc-err{color:#fca5a5}
  #ohlc-table{max-height:min(46vh,420px);overflow:auto;border:1px solid #1e293b;border-radius:10px;background:#0f172a55}
  .ohlc-table{width:100%;border-collapse:separate;border-spacing:0;font-size:11.5px;font-variant-numeric:tabular-nums}
  .ohlc-table th,.ohlc-table td{padding:5px 8px;border-bottom:1px solid #1e293b;text-align:right}
  .ohlc-table thead th{position:sticky;top:0;background:#0f1a2b;color:#94a3b8;font-weight:600;z-index:1}
  .ohlc-table .ohlc-dir{text-align:center;white-space:nowrap;font-size:13px;line-height:1}
  .ohlc-up{color:#34d399}.ohlc-down{color:#f87171}.ohlc-nd{color:#475569}
  .ohlc-hidden{display:none!important}
  /* candlestick inspection modal (#candle-chart-modal): on portrait phones the chart is
     shown at about half the modal's height by default, and the canvas is pinch-zoomable */
  @media(max-width:1023px){#candle-chart-viewport{max-height:40vh}}
  #candle-chart-viewport canvas{touch-action:none;transform-origin:center;will-change:transform}
  `;
  const T = {
    title: 'ورود تصویر',
    run: 'استخراج کندل‌ها',
    confirm: 'تأیید و نمایش در محیط الگو',
    busy: 'در حال پردازش…'
  };
  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);

  /* there is no opener of our own any more: the app's #btn-import-image key in
     #remote-control-deck («ورود تصویر چارت») leads here, so not one element is added to
     the app's page — see the deck block near the bottom of this file */

  /* the key row of this window copies the app's own deck row (#remote-control-deck):
     the same class list, the same icon library (lucide-react v0.475.0 — the exact node
     data of each glyph, so the row cannot drift from the app's look), and like that row
     it carries the icon alone: the words live in title / aria-label, not on the face */
  const DECK_KEY = 'flex-1 h-9 rounded-lg flex items-center justify-center transition-all duration-150 border cursor-pointer active:scale-95 group relative';
  const DROP_HINT = 'تصویر نمودار را اینجا رها کنید، یا کلیک کنید و فایل را انتخاب کنید (می‌توانید تصویر را با Ctrl+V هم بچسبانید)';
  const LUCIDE = (name, node) => '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"' +
    ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-' + name +
    ' w-4 h-4 group-hover:scale-110 transition-transform">' + node + '</svg>';
  const ICO = {
    img: LUCIDE('image', '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    scan: LUCIDE('scan-line', '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>'),
    bars: LUCIDE('chart-no-axes-column', '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>'),
    eye: LUCIDE('eye', '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
    cross: LUCIDE('crosshair', '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>'),
    check: LUCIDE('circle-check', '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
    /* v48 — duty icons for the numbered row, glyphs copied from the same lucide-react
       v0.475.0 set as the row below (verified against the installed package): کلید ۱ =
       live price (tv), کلید ۲ = display-model cycle (palette). */
    tv: LUCIDE('tv', '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>'),
    palette: LUCIDE('palette', '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>'),
    /* v51 — duty icons for کلیدهای ۴–۶, the deck keys moved up from below the
       «محیط الگو» window (glyphs copied from the same lucide-react v0.475.0 set —
       they are exactly the glyphs the app's own deck buttons render): ۴ = play
       («پلی و جستجو» = شروع تحلیل DNA الگو), ۵ = stop, ۶ = trash (سطل آشغال). */
    play: LUCIDE('play', '<polygon points="6 3 20 12 6 21 6 3"/>'),
    square: LUCIDE('square', '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>'),
    trash2: LUCIDE('trash-2', '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>')
  };
  const keyHtml = (attr, ico, text) => '<button class="ohlc-dk ' + DECK_KEY + '" ' + attr +
    ' title="' + text + '" aria-label="' + text + '">' + ico + '</button>';
  /* v44 — digits 1-6 in Persian (۱۲۳۴۵۶) for the numbered placeholder row */
  const faDigit = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
  /* v44 — the numbered key of the new top row: one digit on the face (span.fn-num),
     the title «کلید n» ready for the later assignment. When a duty is assigned and an
     icon is passed (v48: keys ۱ and ۲), the icon becomes the face instead of the digit —
     the glyph is copied from the same lucide-react v0.475.0 set the row below uses. */
  const fnKeyHtml = (n, ico) => '<button id="ohlc-fn-' + n + '" type="button" class="ohlc-dk fn-key ' + DECK_KEY +
    '" data-fn="' + n + '" title="کلید ' + faDigit(n) + '" aria-label="کلید ' + faDigit(n) + '">' +
    (ico || '<span class="fn-num">' + faDigit(n) + '</span>') + '</button>';

  const modal = document.createElement('div');
  modal.id = 'ohlc-modal';
  modal.innerHTML = `
  <div id="ohlc-card" dir="rtl">
    <h2>${T.title}</h2>
    <div style="margin-top:12px">
      <!-- v44 — the numbered six-key row: placeholder band above the window's own row -->
      <div class="ohlc-bar w-full border rounded-xl p-1.5 flex items-center justify-between gap-1 shadow-md backdrop-blur-md transition-colors" id="ohlc-fn-bar">
        ${fnKeyHtml(1, ICO.tv)}
        ${fnKeyHtml(2, ICO.palette)}
        ${fnKeyHtml(3)}
        ${fnKeyHtml(4, ICO.play)}
        ${fnKeyHtml(5, ICO.square)}
        ${fnKeyHtml(6, ICO.trash2)}
      </div>
      <div class="ohlc-bar w-full border rounded-xl p-1.5 flex items-center justify-between gap-1 shadow-md backdrop-blur-md transition-colors row-0" id="ohlc-bar">
        ${keyHtml('id="ohlc-drop" type="button"', ICO.img, DROP_HINT)}
        ${keyHtml('id="ohlc-run" type="button"', ICO.scan, T.run)}
        ${keyHtml('data-view="chart" type="button" aria-selected="true"', ICO.bars, 'کندل‌های بازسازی‌شده')}
        ${keyHtml('data-view="orig" type="button" aria-selected="false"', ICO.eye, 'تصویر اصلی')}
        ${keyHtml('data-view="ann" type="button" aria-selected="false"', ICO.cross, 'تصویر با مارک‌ها')}
        ${keyHtml('id="ohlc-confirm" type="button"', ICO.check, T.confirm)}
      </div>
      <!-- v45 — live TradingView price (کلید ۱). The TradingView Advanced Chart widget
           carries the full feature set: symbol search, timeframes, indicators, drawing
           tools — nothing of ours is added on top of it (no quick chips by request). -->
      <section id="ohlc-tv" dir="rtl" aria-label="قیمت زنده تریدینگ ویو">
        <div id="ohlc-tv-head">
          <span id="ohlc-tv-title"><span class="dot"></span>قیمت زنده · TradingView</span>
          <span id="ohlc-tv-mode" title="سبک نمایش فعلی — کلید ۲ آن را عوض می‌کند"></span>
          <button id="ohlc-tv-zout" type="button" title="کوچک‌کردن تصویر (دورتر)" aria-label="کوچک‌کردن تصویر">−</button>
          <button id="ohlc-tv-zin" type="button" title="بزرگ‌کردن تصویر (نزدیک‌تر)" aria-label="بزرگ‌کردن تصویر">+</button>
          <button id="ohlc-tv-expand" type="button" title="بزرگ‌نمایی تمام‌صفحه" aria-label="بزرگ‌نمایی تمام‌صفحه">⛶</button>
          <button id="ohlc-tv-close" type="button" title="بستن قیمت زنده (کلید ۱)" aria-label="بستن قیمت زنده">✕</button>
        </div>
        <div id="ohlc-tv-stage"><div id="ohlc-tv-chart"></div></div>
      </section>
      <input id="ohlc-file" type="file" accept="image/*" class="ohlc-hidden">
      <canvas id="ohlc-chart"></canvas>
      <canvas id="ohlc-orig" class="ohlc-hidden"></canvas>
      <canvas id="ohlc-ann" class="ohlc-hidden"></canvas>
    </div>
    <div id="ohlc-status">هنوز تصویری انتخاب نشده.</div>
  </div>
  <div id="ohlc-table-card" class="ohlc-hidden"><div id="ohlc-table"></div></div>`;
  document.body.appendChild(modal);   /* anchored into the sidebar below */

  /* the import panel is now a permanent part of the main page, sitting at the top of
     «محیط الگو» (the sidebar's first card) instead of a separate overlay. React owns
     that sidebar and may rebuild it, so a cheap watcher keeps the panel anchored at
     the top of the environment whenever it (re)appears. The old deck key
     (#btn-import-image) is retired and hidden. */
  function mountPanel() {
    const modalEl = document.getElementById('ohlc-modal');
    const sidebar = document.getElementById('sidebar-controls');
    if (!modalEl || !sidebar) return false;
    if (modalEl.parentNode !== sidebar) sidebar.insertBefore(modalEl, sidebar.firstChild);
    const key = document.getElementById('btn-import-image');
    if (key) key.style.display = 'none';
    return true;
  }
  (function bootPanel() {
    const boot = setInterval(() => { mountPanel(); }, 400);
    setTimeout(() => clearInterval(boot), 180000);
  })();

  const $ = (id) => document.getElementById(id);   /* the open button lives outside the modal */
  const state = { img: null, result: null, templates: null, running: false, imgKey: null, confirmedKey: null, write: null, ovData: null, shapedStage: null, shapedCard: null, shapedCompare: null, ovRaf: null, ovRafKey: null };

  /* ------------------------------------------------------------ open/close */
  /* the panel is always on the page; show() is kept as a no-op so nothing breaks. */
  const show = (v) => { modal.style.display = 'flex'; };

  /* the sixth key: «تأیید» — always armed. With a measurement it hands the candles to
     the engine on the way out; with nothing in the window (no picture, no numbers) it
     simply closes and the user is back on the app's first page, empty-handed and fine. */
  /* -------------------------------------------- handing the measurement to the engine
   * «تأیید» closes the window, and on the way out it gives the app what was measured:
   * exactly one thing, and only temporarily: the closes the engine compares, as a single
   * query entry in the pattern library. No dataset is written, nothing shows up under
   * «مدیریت داده‌ها», and engine 1 can never search inside an uploaded picture — the
   * picture is the question, not the ground. Every confirm replaces the previous query.
   * One honest limit: the app seeds those lists when it mounts, so a record written now
   * shows up on the page's next load (the pending pattern waits in sessionStorage until
   * then). We never press «جستجو» ourselves.
   * The names stay clear of ui-trim's sweep on purpose: the sweep removes the old
   * 'img-…' / «از تصویر» leftovers, not what the user confirms today.
   * localStorage.chartdna_ohlc_write = '0' puts the window back to read-only. */
  const WRITE_OFF = 'chartdna_ohlc_write';
  const writeOn = () => { try { return localStorage.getItem(WRITE_OFF) !== '0'; } catch (e) { return true; } };
  const DB = 'ChartDNA_Storage', VER = 1, STORE = 'market_datasets', SEL = 'chartdna_selected_dataset_ids';
  const PAT = 'chartdna_saved_patterns', PAT_PENDING = 'chartdna_px_pending_pattern';
  const norm = (pts) => {
    const lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    return hi === lo ? pts.map(() => 0) : pts.map((v) => 2 * ((v - lo) / (hi - lo)) - 1);
  };
  function openDb() {
    return new Promise((res, rej) => {
      const o = indexedDB.open(DB, VER);
      o.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('metadata')) db.createObjectStore('metadata', { keyPath: 'key' });
      };
      o.onsuccess = () => res(o.result);
      o.onerror = () => rej(o.error || new Error('IndexedDB failed'));
    });
  }
  /* the app seeds its library from built-ins on first mount and persists it afterwards,
     so a key that is not there yet belongs to a page that has not mounted: writing it now
     would be clobbered. Both records wait in sessionStorage as a queue instead — one slot
     per entry, so a pair of patterns survives the wait — and are appended on the next load. */
  function queuePattern(rec) {
    let list = [];
    try {
      const raw = sessionStorage.getItem(PAT_PENDING);
      if (raw) list = JSON.parse(raw) || [];
    } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [list];
    list = list.filter((p) => p && p.id !== rec.id);
    list.push(rec);
    try { sessionStorage.setItem(PAT_PENDING, JSON.stringify(list)); } catch (e) { }
    return list.length;
  }
  /* the app's library is the user's: only our own entries are ever replaced or bounded */
  function appendPattern(rec) {
    let raw = null;
    try { raw = localStorage.getItem(PAT); } catch (e) { return 'no-storage'; }
    if (!raw) { queuePattern(rec); return 'queued-for-next-load'; }
    let list;
    try { list = JSON.parse(raw); } catch (e) { return 'unreadable'; }
    if (!Array.isArray(list)) return 'unreadable';
    let replaced = false;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.id !== rec.id) continue;
      if ((p.points || []).join() === (rec.points || []).join()) return 'already-there';
      list[i] = rec; replaced = true;
    }
    if (!replaced) list.push(rec);
    const mine = list.map((p, i) => (p && String(p.id).indexOf('custom_dna_px_') === 0 ? i : -1)).filter((i) => i >= 0);
    if (mine.length > 24) mine.slice(0, mine.length - 24).reverse().forEach((i) => list.splice(i, 1));
    try { localStorage.setItem(PAT, JSON.stringify(list)); } catch (e) { return 'quota'; }
    return replaced ? 'replaced' : 'added';
  }
  /* v28: the trend-line entries this window used to write (…_trend) are dead weight now —
     one bounded sweep takes them out of the library and out of the waiting queue; the
     closes entries and everything of the user's own stay untouched */
  (function dropTrendPatterns() {
    const FLAG = 'chartdna_px_trend_swept';
    try { if (localStorage.getItem(FLAG)) return; } catch (e) { return; }
    try {
      const raw = localStorage.getItem(PAT);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const keep = list.filter((p) => !(p && typeof p.id === 'string' && /^custom_dna_px_.*_trend$/.test(p.id)));
          if (keep.length !== list.length) localStorage.setItem(PAT, JSON.stringify(keep));
        }
      }
    } catch (e) { /* unreadable: nothing is deleted */ }
    try {
      const qraw = sessionStorage.getItem(PAT_PENDING);
      if (qraw) {
        let q = JSON.parse(qraw);
        if (!Array.isArray(q)) q = [q];
        const keep = q.filter((p) => !(p && typeof p.id === 'string' && /_trend$/.test(p.id)));
        if (keep.length !== q.length) sessionStorage.setItem(PAT_PENDING, JSON.stringify(keep));
      }
    } catch (e) { }
    try { localStorage.setItem(FLAG, new Date().toISOString()); } catch (e) { }
  })();
  (function flushPendingPatterns() {
    let raw = null;
    try { raw = sessionStorage.getItem(PAT_PENDING); if (raw) sessionStorage.removeItem(PAT_PENDING); } catch (e) { }
    if (!raw) return;
    let list = [];
    try { list = JSON.parse(raw); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [list];
    list.forEach((rec) => {
      /* appendPattern itself re-queues whatever the library cannot take yet */
      const res = appendPattern(rec);
      if (res !== 'queued-for-next-load') console.info('[ohlc] pending pattern:', res);
    });
  })();
  /* React keeps its own copy of the library and writes it back on every change, which can
     roll our write over before the page is reloaded. Three bounded looks put our records
     back into storage — they never reach into the app's state or its list. */
  function guardPatterns(recs, tries) {
    if (!recs.length) return;
    setTimeout(() => {
      let list = null;
      try { list = JSON.parse(localStorage.getItem(PAT) || '[]'); } catch (e) { return; }
      if (!Array.isArray(list)) return;
      const missing = recs.filter((r) => !list.some((p) => p && p.id === r.id));
      if (!missing.length) return;
      missing.forEach((r) => appendPattern(r));
      if (tries > 1) guardPatterns(recs, tries - 1);
    }, 900);
  }
  /* v35: the app must never search inside uploaded pictures — the image datasets this
     window used to write (pxrec-*, symbol IMAGE) are removed from the store once, and
     the search selection is cleaned of them. chartdna_px_datasets_swept marks it done. */
  (function dropImageDatasets() {
    const FLAG = 'chartdna_px_datasets_swept';
    try { if (localStorage.getItem(FLAG)) return; } catch (e) { return; }
    const done = () => { try { localStorage.setItem(FLAG, new Date().toISOString()); } catch (e) { } };
    try {
      const sel = JSON.parse(localStorage.getItem(SEL) || '[]');
      if (Array.isArray(sel)) {
        const keep = sel.filter((id) => !/^pxrec-/.test(String(id)) && !/^img-/.test(String(id)));
        if (keep.length !== sel.length) localStorage.setItem(SEL, JSON.stringify(keep));
      }
    } catch (e) { }
    openDb().then((db) => {
      let req = null;
      try { req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); } catch (e) { try { db.close(); } catch (e2) { } done(); return; }
      req.onsuccess = () => {
        try {
          const gone = (req.result || []).filter((d) => d && (/^pxrec-/.test(String(d.id)) || d.symbol === 'IMAGE'));
          if (!gone.length) { db.close(); done(); return; }
          const tx = db.transaction(STORE, 'readwrite');
          gone.forEach((d) => tx.objectStore(STORE).delete(d.id));
          tx.oncomplete = () => { console.info('[ohlc] image datasets removed from the store:', gone.map((d) => d.id).join(', ')); db.close(); done(); };
          tx.onerror = () => { db.close(); done(); };
        } catch (e) { try { db.close(); } catch (e2) { } done(); }
      };
      req.onerror = () => { db.close(); done(); };
    }).catch(done);
  })();
  /* every confirm replaces the previous image query: the library never collects them */
  function dropPxPatterns() {
    try {
      const raw = localStorage.getItem(PAT);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const keep = list.filter((p) => !(p && typeof p.id === 'string' && /^custom_dna_px_/.test(p.id)));
          if (keep.length !== list.length) localStorage.setItem(PAT, JSON.stringify(keep));
        }
      }
    } catch (e) { }
    try {
      const qraw = sessionStorage.getItem(PAT_PENDING);
      if (qraw) {
        let q = JSON.parse(qraw);
        if (!Array.isArray(q)) q = [q];
        const keep = q.filter((p) => !(p && typeof p.id === 'string' && /^custom_dna_px_/.test(p.id)));
        if (keep.length !== q.length) sessionStorage.setItem(PAT_PENDING, JSON.stringify(keep));
      }
    } catch (e) { }
  }
  /* v52 — engine-1 hand-off value of one measured candle level. When the price axis
     was read, the engine's own open/high/low/close are handed over. When it was not
     (in practice: TradingView widget shots), the same per-bar pixel rows map 1:1 onto
     a price: price falls as the pixel row grows, exactly like a real axis, so the
     series keeps the true shape and direction of the candles and engine 1 can still
     search by shape. Nothing absolute is invented — the record names which case it is. */
  function barPrice(b, key) {
    const v = b[key];
    if (v != null) return v;
    const pxMap = { o: 'openPx', h: 'rowHigh', l: 'rowLow', c: 'closePx' };
    const px = b[pxMap[key]];
    return px == null ? null : -px;
  }
  async function writeExtracted() {
    const res = state.result;
    if (!writeOn()) return { error: 'switched off by ' + WRITE_OFF };
    if (!res || !res.ok) return { error: 'nothing was extracted' };
    const okBars = res.bars.filter((b) => b.status === 'ok');
    if (!okBars.length) return { error: 'no measurable candles to hand over' };
    try {
      const id = 'pxrec-' + Date.now().toString(36);
      const q = res.quality || {}, cal = res.calibration || {};
      const priced = !!cal.detected && okBars.some((b) => b.close != null);
      const closes = okBars.map((b) => barPrice(b, 'c'));
      if (closes.some((v) => v == null)) return { error: 'incomplete candle rows — nothing handed over' };
      const name = (priced ? 'Pixel reconstruction · ' : 'Pixel shape (نسبی) · ') + okBars.length + ' candles';
      const stamp = new Date().toISOString();
      /* nothing is written into «مدیریت داده‌ها» and no picture is stored anywhere:
         the measurement lives only as ONE temporary query in the pattern library —
         engine 1 uses it as the question, never as ground to search in — and the next
         confirm replaces it */
      dropPxPatterns();
      const pCloses = {
        id: 'custom_dna_px_' + id, name, category: priced ? 'Pixel closes' : 'Pixel shape', createdAt: Date.now(),
        points: closes, normalizedPoints: norm(closes),
        notes: 'الگوی موقتِ جستجو از تصویر — ' + okBars.length + ' بسته‌شونده (میانگین اطمینان ' +
          (q.meanConfidence == null ? '—' : q.meanConfidence) + '). ' +
          (priced
            ? 'محور قیمت خوانده شد (' + (cal.modelChoice || '') + ') — جستجو با بستن‌های واقعی.'
            : 'محور قیمت خوانده نشد — بستن‌ها نسبیِ پیکسلی‌اند (فقط شکل کندل‌ها، بدون قیمت واقعی)؛ جستجو شکلی است.') +
          ' دیتاستی ذخیره نشده و با تأیید بعدی جایگزین می‌شود. منبع: ' + stamp
      };
      const s1 = appendPattern(pCloses);
      if (s1 !== 'queued-for-next-load') guardPatterns([pCloses], 3);
      const out = {
        id, name, candles: okBars.length, dataset: 'not-stored', priced,
        patterns: [pCloses.id], patternStates: [s1],
        waitingForLoad: s1 === 'queued-for-next-load', at: stamp
      };
      window.__ohlcWrite = out;
      state.lastWrite = out;
      status('به موتور داده شد: یک الگوی موقت با ' + okBars.length + ' بسته‌شونده در «کتابخانهٔ الگو» (جایگزین الگوی تصویریِ قبلی)' +
        (priced ? ' — با قیمت‌های خوانده‌شده از محور.' : ' — محور قیمت خوانده نشد، بستن‌ها نسبی/پیکسلی‌اند و جستجو با «پلی» شکلی است.') +
        (out.waitingForLoad ? ' کتابخانه هنوز ساخته نشده؛ در بارگذاری بعد ظاهر می‌شود' : '') +
        '. هیچ دیتاستی در «مدیریت داده‌ها» ذخیره نشد و تصویر هم جایی نگه داشته نمی‌شود. ' +
        'جستجو با کلید پلی (کلید ۴) انجام می‌شود؛ خودکار جستجو نمی‌کنیم.', 'warn');
      console.info('[ohlc] handed to the engine:', out);
      return out;
    } catch (err) {
      const out = { error: (err && err.message) || String(err) };
      window.__ohlcWrite = out; state.lastWrite = out;
      status('داده‌ها به موتور نرسید: ' + out.error, 'err');
      return out;
    }
  }

  /* --------------------------------------- the candle chart inside «محیط الگو» window
   * The app owns that card and repaints it, so nothing is put inside it: the chart lives
   * on a canvas of ours that sits exactly over the card, ignores the pointer and follows
   * the card as it moves. The candles the vision engine measured out of the pixels are
   * drawn as a candlestick chart (wick + body, the engine's own two colours) — no trend
   * line since v28 — and the record is kept in localStorage (chartdna_px_overlay —
   * outside every sweep pattern) so the chart is back on the card after a reload,
   * without touching React. localStorage.chartdna_trend_overlay = '0' drops it. */
  const OV = 'ohlc-trend-overlay', OV_OFF = 'chartdna_trend_overlay', OV_STORE = 'chartdna_px_overlay', OV_FRAME = 'chartdna_px_frame';
  const ovOn = () => { try { return localStorage.getItem(OV_OFF) !== '0'; } catch (e) { return true; } };
  const cropCard = () => document.getElementById('image-cropper-card');
  /* what the chart is drawn from: the measured candles + the fitted line, nothing else.
   * `frame` is the exact on-screen size of the picture inside the «ورود تصویر» window at
   * the moment of «تأیید» (object-fit contain inside the view canvas): the chart over
   * «محیط الگو» is drawn at that size — smaller if the card is smaller, never bigger. */
  function viewFrame() {
    const box = frameBox();
    const ids = ['ohlc-chart', 'ohlc-orig', 'ohlc-ann'];
    for (let i = 0; i < ids.length; i++) {
      const cv = $(ids[i]);
      if (!cv) continue;
      const r = cv.getBoundingClientRect();
      if (r && r.width > 40 && r.height > 30) {
        const k = Math.min(r.width / box.w, r.height / box.h);
        return { w: Math.max(1, Math.round(box.w * k)), h: Math.max(1, Math.round(box.h * k)) };
      }
    }
    return { w: box.w, h: box.h };
  }
  function overlayRecord() {
    const res = state.result;
    if (!res || !res.ok) return null;
    const bars = res.bars.filter((b) => b.status === 'ok');
    if (!bars.length) return null;
    const priced = !!(res.calibration && res.calibration.detected);
    const candles = bars.map((b) => {
      const o = barPrice(b, 'o'), h = barPrice(b, 'h'), l = barPrice(b, 'l'), c = barPrice(b, 'c');
      if (o == null || h == null || l == null || c == null) return null;
      return { o, h, l, c, up: b.direction === 'Bullish' };
    }).filter(Boolean);
    if (!candles.length) return null;
    return { at: new Date().toISOString(), frame: viewFrame(), candles, mode: priced ? 'ohlc' : 'shape' };
  }
  function keepOverlayRecord(rec) {
    state.ovData = rec || null;
    try {
      if (rec) {
        localStorage.setItem(OV_STORE, JSON.stringify(rec));
        /* the window's frame is kept on its own and survives a cleared chart: the card
           must hold the «ورود تصویر» shape from the moment the app opens */
        if (rec.frame && rec.frame.w > 40 && rec.frame.h > 30) localStorage.setItem(OV_FRAME, JSON.stringify(rec.frame));
      }
      else localStorage.removeItem(OV_STORE);
    } catch (e) { /* quota: the chart still lives for this session */ }
  }
  function storedFrame() {
    if (state.ovData && state.ovData.frame && state.ovData.frame.w > 40) return state.ovData.frame;
    try {
      const fr = JSON.parse(localStorage.getItem(OV_FRAME) || 'null');
      return fr && fr.w > 40 && fr.h > 30 ? fr : null;
    } catch (e) { return null; }
  }
  (function cleanStartOverlay() {
    /* Every open of the app starts a fresh «محیط الگو»: the last session's candle
       chart and reshaped windows are dropped, so the environment looks exactly as on a
       first launch. The chart a user confirms in this session is drawn live and lives
       only in memory — it is never carried over to the next page load. */
    state.ovData = null;
    try {
      localStorage.removeItem(OV_STORE);
      localStorage.removeItem(OV_FRAME);
    } catch (e) { /* storage unavailable: the session still starts clean */ }
  })();
  function removeOverlay() {
    const cv = document.getElementById(OV);
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
    if (state.ovRaf) { try { cancelAnimationFrame(state.ovRaf); } catch (e) { } state.ovRaf = null; state.ovRafKey = null; }
    if (!ovOn()) unshapeStage();   /* the kill switch restores the card; a cleared chart keeps its shape */
    if (state.ovWatch) { try { clearInterval(state.ovWatch); } catch (e) { } state.ovWatch = null; }
  }
  /* «محیط الگو» must carry the same shape as the «ورود تصویر» window — a wide strip, not
   * a square. The card's inner stage is React's, so no node is touched: only its height
   * gets an inline value matching the frame's aspect at the card's width, and the value
   * is remembered so switching the overlay off puts the stage back as the app made it. */
  function cropStageBox() {
    const card = cropCard();
    if (!card) return null;
    const kids = card.children || [];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i].className || '';
      if (/relative/.test(c) && /flex-1/.test(c)) return kids[i];
    }
    const cv = card.querySelector('canvas');
    if (cv && cv.parentElement && cv.parentElement.parentElement && card.contains(cv.parentElement.parentElement) &&
      cv.parentElement.parentElement !== card) return cv.parentElement.parentElement;
    return null;
  }
  function shapeStage(fr) {
    const stage = cropStageBox();
    if (!stage || !fr || !(fr.w > 40) || !(fr.h > 30)) return null;
    const w = Math.round(stage.getBoundingClientRect().width);
    if (!(w > 60)) return null;
    const want = Math.round(Math.min(w, fr.w) * fr.h / fr.w);
    if (!stage.__dnaShaped) {
      stage.__dnaShaped = { height: stage.style.height, minHeight: stage.style.minHeight, maxHeight: stage.style.maxHeight, flex: stage.style.flex };
      state.shapedStage = stage;
    }
    if (stage.style.height !== want + 'px') {
      /* the stage is a flex-1 item: without pinning flex, the card's own height keeps
         deciding — so the stage is frozen at the frame's aspect and stops growing */
      stage.style.flex = '0 0 auto';
      stage.style.height = want + 'px';
      stage.style.minHeight = '0';
      stage.style.maxHeight = want + 'px';
    }
    /* the card itself carries fixed Tailwind heights (min-h-[300px] h-[330px] …): with
       the stage frozen, the card is let go to hug its content, so no empty band is
       left under the chart — inline style beats the classes, and both are restored */
    const card = cropCard();
    if (card && card !== stage) {
      if (!card.__dnaShaped) card.__dnaShaped = { height: card.style.height, minHeight: card.style.minHeight };
      if (card.style.height !== 'auto') { card.style.height = 'auto'; card.style.minHeight = '0'; }
      state.shapedCard = card;
    }
    return want;
  }
  function unshapeStage() {
    let did = false;
    const stage = state.shapedStage || cropStageBox();
    if (stage && stage.__dnaShaped) {
      stage.style.height = stage.__dnaShaped.height;
      stage.style.minHeight = stage.__dnaShaped.minHeight;
      stage.style.maxHeight = stage.__dnaShaped.maxHeight;
      stage.style.flex = stage.__dnaShaped.flex;
      delete stage.__dnaShaped;
      state.shapedStage = null;
      did = true;
    }
    const card = state.shapedCard || cropCard();
    if (card && card.__dnaShaped) {
      card.style.height = card.__dnaShaped.height;
      card.style.minHeight = card.__dnaShaped.minHeight;
      delete card.__dnaShaped;
      state.shapedCard = null;
      did = true;
    }
    if (unshapeCompare()) did = true;
    return did;
  }
  /* «اطلاعات الگوی کشف شده» (#comparative-chart-card) must carry the same shape as
     «محیط الگو» — a wide strip, not a square. It is React-owned like the crop card, so
     only its inline height is set to the frame's aspect at the card's width and restored
     on the way out; the app's own canvas inside it already re-fits via its ResizeObserver. */
  function shapeCompare(fr) {
    if (!fr || !(fr.w > 40) || !(fr.h > 30)) return null;
    const card = document.getElementById('comparative-chart-card');
    if (!card) return null;
    const w = Math.round(card.getBoundingClientRect().width);
    if (!(w > 60)) return null;
    const want = Math.round(Math.min(w, fr.w) * fr.h / fr.w);
    if (want < 60) return null;      /* never crush the card into nothing */
    if (!card.__dnaShapedC) card.__dnaShapedC = { height: card.style.height, minHeight: card.style.minHeight };
    if (card.style.height !== want + 'px') { card.style.height = want + 'px'; card.style.minHeight = '0'; }
    state.shapedCompare = card;
    return want;
  }
  function unshapeCompare() {
    const card = state.shapedCompare || document.getElementById('comparative-chart-card');
    if (card && card.__dnaShapedC) {
      card.style.height = card.__dnaShapedC.height;
      card.style.minHeight = card.__dnaShapedC.minHeight;
      delete card.__dnaShapedC;
      state.shapedCompare = null;
      return true;
    }
    return false;
  }
  function paintOverlay() {
    const cv = document.getElementById(OV);
    if (!cv) return false;
    if (!ovOn()) { removeOverlay(); return false; }
    const card = cropCard(), dat = state.ovData;
    if (dat && dat.frame) { shapeStage(dat.frame); shapeCompare(dat.frame); }  /* all windows take the picture's shape first */
    /* the first box that really has a size on screen decides where the chart sits: a
       hidden canvas measures 0×0 and must not silence the chart (the v29 blank card —
       the crop canvas is display:none while no picture is loaded) */
    let r = null;
    if (card) {
      const cand = [];
      const cvs = card.querySelectorAll('canvas');
      for (let i = 0; i < cvs.length; i++) if (cvs[i].id !== OV) cand.push(cvs[i]);
      const sb = cropStageBox();
      if (sb) cand.push(sb);
      cand.push(card);
      for (let i = 0; i < cand.length; i++) {
        const q = cand[i].getBoundingClientRect();
        if (q && q.width > 60 && q.height > 40) { r = q; break; }
      }
    }
    if (!r || !dat || !dat.candles || !dat.candles.length) { cv.style.display = 'none'; return false; }
    /* the window's picture size is the ceiling: the chart takes exactly that frame,
       shrinks with the card when the card is smaller, and never grows past it */
    const stW = Math.round(r.width), stH = Math.round(r.height);
    const fr = dat.frame && dat.frame.w > 40 && dat.frame.h > 30 ? dat.frame : { w: stW, h: stH };
    const k = Math.min(1, stW / fr.w, stH / fr.h);
    const w = Math.max(1, Math.round(fr.w * k)), h = Math.max(1, Math.round(fr.h * k));
    cv.style.display = 'block';
    cv.style.left = Math.round(r.left + (stW - w) / 2) + 'px';
    cv.style.top = Math.round(r.top + (stH - h) / 2) + 'px';
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    if (!ctx) return false;
    ctx.clearRect(0, 0, w, h);
    const cs = dat.candles, n = cs.length;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { if (cs[i].l < lo) lo = cs[i].l; if (cs[i].h > hi) hi = cs[i].h; }
    const padV = (hi - lo) * 0.06 + 1e-9; lo -= padV; hi += padV;
    const pad = 10, span = (hi - lo) || 1;
    const X = (i) => pad + (n > 1 ? (i * (w - pad * 2)) / (n - 1) : (w - pad * 2) / 2);
    const Y = (v) => h - pad - ((v - lo) / span) * (h - pad * 2);
    /* a faint pane so the candles read on whatever the card shows behind them */
    ctx.fillStyle = 'rgba(2,6,23,.35)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(30,41,59,.9)'; ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'right';
    for (let gy = 0; gy <= 4; gy++) {                    /* gridlines with their prices */
      const pv = lo + ((hi - lo) * gy) / 4, yy = Y(pv);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(100,116,139,.9)';
      ctx.fillText(pv.toFixed(2), w - 4, yy - 3);
    }
    const step = (w - pad * 2) / Math.max(1, n - 1);     /* the candles themselves */
    const bw = Math.max(1, Math.min(9, step * 0.68));
    for (let i = 0; i < n; i++) {
      const b = cs[i], x = X(i);
      ctx.strokeStyle = ctx.fillStyle = b.up ? '#26a69a' : '#ef5350';
      ctx.lineWidth = Math.max(1, bw * 0.18);
      ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
      const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c));
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
    }
    const label = 'بازسازی کندلی از تصویر · ' + n + ' کندل';
    ctx.font = '12px ui-sans-serif,system-ui,sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(2,6,23,.78)';
    ctx.fillRect(6, 6, Math.min(w - 12, tw + 14), 20);
    ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'left';
    ctx.fillText(label, 13, 20);
    return true;
  }
  function mountOverlay() {
    if (!ovOn()) { removeOverlay(); return false; }
    const dat = state.ovData;
    if (!dat || !dat.candles || !dat.candles.length) return false;
    let cv = document.getElementById(OV);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = OV;
      cv.setAttribute('aria-hidden', 'true');
      cv.setAttribute('title', 'کندل‌هایی که از پیکسل‌های همین تصویر اندازه‌گیری و به موتور داده شد');
      cv.style.cssText = 'position:fixed;pointer-events:none;z-index:45;box-sizing:border-box;display:none';
      (document.body || document.documentElement).appendChild(cv);
      const again = () => { try { paintOverlay(); } catch (e) { } };
      /* scroll on the window and on every inner container (the pattern card lives inside
         #sidebar-controls, an overflow-y-auto aside, so window scroll alone can miss it). */
      window.addEventListener('scroll', again, true);
      document.addEventListener('scroll', again, true);
      window.addEventListener('resize', again);
      try { new ResizeObserver(again).observe(cropCard() || document.body); } catch (e) { }
      /* Mobile is the real problem: during momentum / elastic scrolling a fixed canvas is
         left in place because scroll events fire late or not at all. A cheap animation-frame
         loop re-syncs the chart to the card on every frame — it only repaints when the card's
         on-screen box has actually moved, so steady pages cost nothing. */
      state.ovRaf = (function loop() {
        state.ovRaf = requestAnimationFrame(loop);
        const card = cropCard();
        if (!card) return;
        const r = card.getBoundingClientRect();
        const key = Math.round(r.left) + 'x' + Math.round(r.top) + 'x' + Math.round(r.width) + 'x' + Math.round(r.height);
        if (key !== state.ovRafKey) { state.ovRafKey = key; again(); }
      })();
      /* the app re-renders that card; a light watch is a backstop and cannot fight it */
      state.ovWatch = setInterval(again, 300);
      setTimeout(() => { if (state.ovWatch) { clearInterval(state.ovWatch); state.ovWatch = null; } }, 60000);
    }
    return paintOverlay();
  }
  function setOverlay(v) {
    try { localStorage.setItem(OV_OFF, v ? '1' : '0'); } catch (e) { }
    if (v) mountOverlay(); else removeOverlay();
    return !!document.getElementById(OV);
  }
  /* v55 — arm the app's own play key the moment a searchable pattern exists, without
     waiting for chart-dna-methods' poll. Directly reads the overlay record (no cache)
     and enables the original button the way armPlay does, then mirrors to کلید ۴. */
  function pxPlayArmNow() {
    const o = $('btn-start-analysis'), k = $('ohlc-fn-4');
    if (!o || !k) return;
    let has = false;
    try {
      const raw = localStorage.getItem(OV_STORE);
      if (raw) { const rec = JSON.parse(raw); has = !!(rec && rec.candles && rec.candles.length >= 6); }
    } catch (e) { }
    const st = $('btn-stop-analysis');
    const analyzing = !!(st && !st.disabled);
    if (has && !analyzing && o.disabled) {
      o.disabled = false; o.style.opacity = '1'; o.style.cursor = 'pointer';
    }
    k.setAttribute('aria-disabled', String(!!o.disabled));
  }
  /* v52 — «سطل آشغال» also wipes the «ورود تصویر» window itself: the loaded
     picture, the measured result, the tables and every temporary record this window
     wrote are dropped, so the whole page looks exactly like a fresh launch. */
  function resetInputPanel() {
    state.img = null; state.result = null; state.imgKey = null; state.autoHanded = false;
    state.confirmedKey = null; state.lastWrite = null; state.write = null;
    try { window.__ohlcReport = null; window.__ohlcWrite = null; } catch (e) { }
    ['ohlc-chart', 'ohlc-orig', 'ohlc-ann'].forEach((id) => {
      const cv = $(id);
      if (!cv) return;
      try { const ctx = cv.getContext('2d'); if (ctx) ctx.clearRect(0, 0, cv.width || 0, cv.height || 0); } catch (e) { }
    });
    const ann = $('ohlc-ann'), orig = $('ohlc-orig');
    if (ann) ann.classList.add('ohlc-hidden');
    if (orig) orig.classList.add('ohlc-hidden');           /* boot look: only the empty chart frame */
    const tb = $('ohlc-table'); if (tb) tb.innerHTML = '';
    const tc = $('ohlc-table-card'); if (tc) tc.classList.add('ohlc-hidden');
    const fi = $('ohlc-file'); if (fi) { try { fi.value = ''; } catch (e) { } }
    dropPxPatterns();                                      /* and the px query records, stored or pending */
    status('هنوز تصویری انتخاب نشده.');
  }
  /* the app's «سطل آشغال» key (#btn-clear-all, «پاکسازی محیط») resets its own React
     state; this runs alongside it and fully wipes our side too: it removes the candle
     overlay, clears the stored overlay/frame, drops the px pattern records, returns
     every reshaped window to its normal size and empties this window back to its
     fresh-launch look — the whole page is clean and ready to start over. */
  function fullReset() {
    removeOverlay();            /* drops the canvas and stops the rAF / scroll watchers */
    keepOverlayRecord(null);    /* state.ovData = null and the stored overlay is removed */
    try { localStorage.removeItem(OV_FRAME); } catch (e) { }
    state.ovData = null;
    unshapeStage();             /* the environment + comparative cards go back to normal */
    resetInputPanel();          /* and the «ورود تصویر» window back to its fresh state */
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('#btn-clear-all');
    if (!b) return;
    fullReset();
  }, true);

  function confirmFlow() {
    const has = !!(state.result && state.result.bars && state.result.bars.length);
    if (has) {
      state.confirmedKey = state.imgKey || null;
      try {
        const r = window.__ohlcReport;
        if (r) {
          r.confirmedAt = new Date().toISOString();
          r.confirmedCandles = state.result.bars.length;
        }
      } catch (e) { /* our own note */ }
      if (!state.autoHanded) {             /* v54: a successful run already handed the query over */
        state.write = writeExtracted();    /* the engine gets its temporary query; never blocks the close */
        keepOverlayRecord(overlayRecord());/* the measured candles, kept for the card and the next load */
      }
      mountOverlay();                      /* and the candle chart is drawn over «محیط الگو» right away */
      status('تأیید شد — ' + state.result.bars.length + ' کندل به موتور داده شد؛ ' +
        'چارت کندلیِ همین اندازه‌گیری، هم‌قاب با همین تصویر، در «محیط الگو» زیر همین پنل نشسته است. ' +
        'با همین پنل می‌توانید تصویر بعدی را وارد کنید.');
    } else {
      status('چیزی برای تحویل نبود؛ یک تصویر نمودار را بارگذاری و «استخراج کندل‌ها» را بزنید.');
    }
    return has;
  }
  $('ohlc-confirm').addEventListener('click', confirmFlow);

  /* ------------------------------------------------------------ image input */
  const drop = $('ohlc-drop');
  drop.addEventListener('click', () => $('ohlc-file').click());
  $('ohlc-file').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('ohlc-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('ohlc-over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
    else if (e.dataTransfer.getData('text/html')) grabHtmlImage(e.dataTransfer.getData('text/html'));
  });
  document.addEventListener('paste', (e) => {
    const it = e.clipboardData && e.clipboardData.items;
    if (!it) return;
    for (let i = 0; i < it.length; i++) if (it[i].type.indexOf('image') === 0) { loadFile(it[i].getAsFile()); show(true); break; }
  });
  function loadFile(file) {
    if (!file || !/^image\//.test(file.type || 'image')) { status('فایل انتخاب‌شده تصویر نیست.', 'err'); return; }
    const url = URL.createObjectURL(file);
    loadImage(url, () => status(`تصویر بارگذاری شد: ${state.img.naturalWidth}×${state.img.naturalHeight} پیکسل.`));
  }
  function grabHtmlImage(html) {
    const m = /src="([^"]+)"/.exec(html);
    if (m) loadImage(m[1], () => status('تصویر از کلیپ‌بورد گرفته شد.'));
  }
  /* cheap identity of an image source (data: URLs can be megabytes long) */
  function sigOf(src) {
    const t = String(src || '');
    if (!t.length) return '';
    const sample = t.length > 4096 ? t.slice(0, 2048) + t.slice(-2048) : t;
    let h = 2166136261;
    for (let i = 0; i < sample.length; i++) { h ^= sample.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return t.length + '-' + h.toString(36);
  }
  function loadImage(src, done) {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      state.img = im; state.autoHanded = false;
      state.imgKey = sigOf(src);
      state.confirmedKey = null;
      $('ohlc-table').innerHTML = '';
      $('ohlc-table-card').classList.add('ohlc-hidden');
      try { URL.revokeObjectURL(src); } catch (e) { /* not a blob url */ }
      drawOriginal();
      done && done();
    };
    im.onerror = () => status('بارگذاری تصویر ناموفق بود (ممکن است blob منقضی شده باشد؛ تصویر را دوباره انتخاب کنید).', 'err');
    im.src = src;
  }
  /* one box for all three views: the picture itself, capped at 1400 px on the long side
     (so a phone is not asked to keep three full-resolution buffers), and every view takes
     exactly that box — the same length and the same height, nothing stretched on its own */
  function frameBox() {
    const im = state.img;
    const iw = (im && (im.naturalWidth || im.width)) || 300, ih = (im && (im.naturalHeight || im.height)) || 150;
    const s = Math.min(1, 1400 / Math.max(iw, ih, 1));
    return { w: Math.max(1, Math.round(iw * s)), h: Math.max(1, Math.round(ih * s)) };
  }
  function paintInto(cv, src) {
    const box = frameBox();
    cv.width = box.w; cv.height = box.h;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, box.w, box.h);
    if (src) ctx.drawImage(src, 0, 0, box.w, box.h);
    /* the line belongs to the picture, so it is drawn in the picture's own frame —
       on all three views, so a comparison between them stays a fair one */
    return box;
  }
  /* the fitted line, mapped back through the same two readings the candles came from:
     bar index -> x through the bar grid, price -> row through the axis that was read */
  function drawOriginal() {
    const im = state.img;
    if (!im) return;
    paintInto($('ohlc-orig'), im);
    paintInto($('ohlc-chart'), null);      /* the same frame, empty until the run */
    paintInto($('ohlc-ann'), null);
    setView('orig');
  }

  /* --------------------------------------------------------------- run it */
  $('ohlc-run').addEventListener('click', run);
  function status(msg, kind) {
    const el = $('ohlc-status');
    el.className = kind === 'err' ? 'ohlc-err' : kind === 'warn' ? 'ohlc-warn' : '';
    el.textContent = msg;
  }
  function makeCtx(size) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    return { canvas: cv, ctx: cv.getContext('2d', { willReadFrequently: true }) };
  }
  async function run(forced) {
    if (!window.ChartDNACV) { status('موتور استخراج (chart-ohlc-engine.js) بارگذاری نشده است.', 'err'); return null; }
    if (!state.img) { status('اول یک تصویر نمودار انتخاب کنید.', 'warn'); return null; }
    if (state.running) return null;
    state.running = true;
    status(T.busy);
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (!state.templates) state.templates = window.ChartDNACVTemplateCache || (window.ChartDNACVTemplateCache = window.ChartDNACV.canvasTemplates(makeCtx));
      const im = state.img;
      const cap = 3200, scale = Math.max(1, im.naturalWidth, im.naturalHeight) > cap ? cap / Math.max(im.naturalWidth, im.naturalHeight) : 1;
      const w = Math.max(80, Math.round(im.naturalWidth * scale)), h = Math.max(60, Math.round(im.naturalHeight * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(im, 0, 0, w, h);
      const t0 = performance.now();
      const res = window.ChartDNACV.extract(cx.getImageData(0, 0, w, h), { templates: state.templates });
      res.scale = scale;
      state.result = res;
      if (!res.ok) { state.running = false; status('خطا: ' + res.error, 'err'); return res; }
      const ms = Math.round(performance.now() - t0);
      report(res, ms);
      try { drawResults(res); } catch (e) { console.warn('preview rendering failed:', e); }
      /* v54 — a successful extraction arms the play key IMMEDIATELY: the measured
         candles (real prices when the axis was read, honest relative pixel closes
         otherwise — v52) are handed to the engine-1 query spot right away, so
         «پلی» works straight after «استخراج کندل‌ها», exactly like the app's own
         extract→pattern→search flow. No need to press «تأیید» first. */
      try {
        if (writeOn() && res.bars && res.bars.some((b) => b.status === 'ok')) {
          await writeExtracted();
          keepOverlayRecord(overlayRecord());
          state.autoHanded = true;                    /* «تأیید» afterwards won't hand over twice */
          pxPlayArmNow();                             /* enable the play key at once */
        }
      } catch (e) { console.warn('[ohlc] auto arm failed:', e); }
      if (!(res.calibration && res.calibration.detected)) status(summaryText(res, ms) +
        '\nحالا کلید ۴ (پلی) را بزنید تا موتور ۱ با همین کندل‌ها در دیتاست‌های انتخابی جستجو کند.', 'warn');
      state.lastImage = forced || state.imgKey || null;
      return res;
    } catch (err) {
      console.error(err);
      status('خطای غیرمنتظره: ' + (err && err.message ? err.message : err), 'err');
      return null;
    } finally { state.running = false; }
  }
  function setView(v) {
    const chart = $('ohlc-chart'), orig = $('ohlc-orig'), ann = $('ohlc-ann');
    chart.classList.toggle('ohlc-hidden', v !== 'chart');
    orig.classList.toggle('ohlc-hidden', v !== 'orig');
    ann.classList.toggle('ohlc-hidden', v !== 'ann');
    modal.querySelectorAll('.ohlc-dk[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    if (v === 'orig') orig.style.display = 'block';
  }
  modal.querySelectorAll('.ohlc-dk[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  function drawResults(res) {
    /* both are measured at the full picture, then placed in the one shared frame */
    const a = document.createElement('canvas');
    try { window.ChartDNACV.renderReconstructed(a, state.img, res); paintInto($('ohlc-chart'), a); } catch (e) { console.warn('reconstructed view failed:', e); }
    const b = document.createElement('canvas');
    try { window.ChartDNACV.renderAnnotated(b, state.img, res); paintInto($('ohlc-ann'), b); } catch (e) { console.warn(e); }
    setView('chart');
    const rows = res.bars.slice(0, 14).concat(res.bars.length > 16 ? [{ candle: '…' }] : []).concat(res.bars.slice(-4));
    $('ohlc-table').innerHTML = '<table class="ohlc-table"><thead><tr><th>#</th><th>Date</th><th>O</th><th>H</th><th>L</th><th>C</th><th class="ohlc-dir">Dir</th><th>Conf</th></tr></thead><tbody>' +
      rows.map((b) => b.candle === '…' ? '<tr><td colspan=8 class="ohlc-dir">…</td></tr>'
        : `<tr><td>${b.candle}</td><td>${b.date || ''}</td><td>${f(b.open)}</td><td>${f(b.high)}</td><td>${f(b.low)}</td><td>${f(b.close)}</td><td class="ohlc-dir">${dirMark(b.direction)}</td><td>${b.confidence == null ? '' : b.confidence}</td></tr>`).join('') +
      '</tbody></table>';
    $('ohlc-table-card').classList.remove('ohlc-hidden');
  }
  const f = (v) => v == null ? '—' : v.toFixed(2);
  /* the direction is one glyph, not a word: an arrow up or down; the word stays where it
     does not crowd the row — in the tooltip and in the accessible name of the cell */
  const dirMark = (d) => d === 'Bullish' ? `<span class="ohlc-up" title="Bullish" aria-label="Bullish">\u2191</span>`
    : d === 'Bearish' ? `<span class="ohlc-down" title="Bearish" aria-label="Bearish">\u2193</span>`
    : `<span class="ohlc-nd" title="جهت از پیکسل‌ها خوانده نشد" aria-label="جهت خوانده نشد">\u00b7</span>`;

  /* -------------------------------------------------------------- report -- */
  function summaryText(res, ms) {
    const c = res.calibration, q = res.quality;
    const okN = res.bars.filter((b) => b.status === 'ok').length;
    const bits = [`کندل‌ها: ${res.bars.length} (قابل اندازه‌گیری ${okN}، نامکمل ${res.missing}) · ${ms} ms`];
    if (c && c.detected) bits.push(`محور قیمت: ${c.modelChoice} · ۱ پیکسل ≈ ${q.usdPerPx} USD`);
    else bits.push('محور قیمت خوانده نشد → Open/High/Low/Close خالی می‌ماند.');
    if (q.needReview.length) bits.push(`بازبینی: ${q.needReview.length} کندل`);
    bits.push('محدودیت: دقت به گام ۱ پیکسل؛ حجم استخراج نمی‌شود؛ بازسازی هندسی است، نه تحلیل؛ ساعتِ تک‌تک کندل‌ها خوانده نمی‌شود.');
    return bits.join('\n');
  }
  function report(res, ms) {
    status(summaryText(res, ms));
    window.__ohlcReport = {
      when: new Date().toISOString(),
      result: JSON.parse(JSON.stringify(res, (k, v) => (k === 'bars' ? undefined : v))),
      bars: JSON.parse(JSON.stringify(res.bars)),
      pixels: state.img ? { width: state.img.naturalWidth, height: state.img.naturalHeight } : null,
      durationMs: ms
    };
  }

  /* ------------------------------------------------- the deck's import key leads here
   * The recorder-like strip in the app's sidebar (#remote-control-deck inside
   * #sidebar-controls) carries «ورود تصویر چارت» — #btn-import-image, a picture icon and
   * nothing else. Pressing it used to leave the page and open the device's storage for a
   * file. It now comes to the OHLC reconstruction environment instead, and the screenshot
   * is picked here, in the panel.
   *
   * The app builds its <input type="file"> inside the click handler (a detached node,
   * never in the DOM), so there is nothing to unbind: the way to keep the storage dialog
   * shut is to stop that handler from running at all. A capture-phase listener on document
   * swallows the click before React's delegated listener on the app root ever sees it.
   * The key itself is not restyled, renamed, wrapped or given extra markup.
   * localStorage.chartdna_deck_takeover = '0' gives the key back to the app. */
  const DECK_ID = 'btn-import-image';
  const DECK_TITLE = /ورود تصویر|آپلود تصویر|Import Chart Image|Upload.{0,12}[Ii]mage/;
  function deckKey() {
    const byId = document.getElementById(DECK_ID);
    if (byId) return byId;
    const deck = document.getElementById('remote-control-deck');
    const list = deck ? deck.querySelectorAll('button') : [];
    for (let i = 0; i < list.length; i++) {
      if (DECK_TITLE.test((list[i].getAttribute('title') || '') + ' ' + (list[i].textContent || ''))) return list[i];
    }
    return null;
  }
  function takeoverOn() {
    try { return localStorage.getItem('chartdna_deck_takeover') !== '0'; } catch (e) { return true; }
  }
  function isDeckKey(node) {
    if (!node || !node.closest) return null;
    const b = node.closest('#' + DECK_ID) || node.closest('#remote-control-deck button');
    if (!b) return null;
    if (b.id === DECK_ID) return b;
    return DECK_TITLE.test((b.getAttribute('title') || '') + ' ' + (b.textContent || '')) ? b : null;
  }
  /* the deck key that used to open this overlay is retired — the panel is always on the
     page now, so there is nothing to redirect and the key is hidden by CSS. */

  /* ------------------------------------- pinch-zoom on the candlestick inspection chart
   * The «مشاهده» page (#candle-chart-modal) draws the matched candles on a canvas that
   * fills its viewport. On a phone you zoom a chart with two fingers, so a pinch gesture
   * scales that canvas (both axes) live via a CSS transform. The gesture is read at the
   * document level so it works no matter when React mounts the modal; it only acts on the
   * candle modal's canvas. transform-origin tracks the midpoint of the pinch, so the zoom
   * is centred under your fingers. Scale is clamped and resets when the modal is reopened. */
  (function setupCandlePinchZoom() {
    const inViewport = (t) => t && t.tagName === 'CANVAS' && t.closest && t.closest('#candle-chart-viewport') != null;
    let pinch = null;   /* { cvs, d0, cx, cy, s0 } */
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) { pinch = null; return; }
      const cvs = inViewport(e.target) ? e.target : null;
      if (!cvs) return;
      const a = e.touches[0], b = e.touches[1];
      pinch = {
        cvs,
        d0: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
        cx: (a.clientX + b.clientX) / 2,
        cy: (a.clientY + b.clientY) / 2,
        s0: parseFloat(cvs.dataset.zoom || '1')
      };
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const a = e.touches[0], b = e.touches[1];
      const d = Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
      let s = pinch.s0 * (d / pinch.d0);
      s = Math.min(6, Math.max(0.5, s));          /* never squash it flat, never blow it up */
      pinch.cvs.style.transformOrigin = pinch.cx + 'px ' + pinch.cy + 'px';
      pinch.cvs.style.transform = 'scale(' + s + ')';
      pinch.cvs.dataset.zoom = String(s);
    }, { passive: false });
    const end = () => { pinch = null; };
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
  })();

  /* a picture handed to us from anywhere else (a paste, a seam call) is still measured */
  async function onPickedImage(url) {
    if (!url || typeof url !== 'string' || url.indexOf('data:image') !== 0) return;
    await new Promise((done) => loadImage(url, done));
    await run(sigOf(url));
    show(true);
  }

  /* =====================================================================
   * v45 — live TradingView price inside «ورود تصویر», opened by key ۱
   * ---------------------------------------------------------------------
   * The Advanced Chart widget (s3.tradingview.com/tv.js, no key, free with
   * the TradingView attribution) brings symbol search, timeframes,
   * indicators and drawing tools — everything TradingView has. State:
   *   .open on #ohlc-tv    -> live section visible (toggled by کلید ۱)
   *   .full on #ohlc-tv    -> whole section becomes a fixed fullscreen
   *                           overlay (same DOM node, no iframe moves)
   * Persisted in localStorage 'chartdna_tv_open' ('0' closes at boot).
   * The widget is created lazily, only once, and only when it is visible.
   * ===================================================================== */
  const TV_KEY = 'chartdna_tv_open';
  /* v46 — the chart opens zoomed-out: a long visible range makes the candles small,
     so the window reads like watching the market on a TV from a distance. Range
     presets of TradingView: '1D' '5D' '1M' '3M' '6M' '12M' '60M' 'ALL'. Override the
     default any time: localStorage chartdna_tv_range.
     v50 — default timeframe is 1 hour (interval '60'), and TradingView re-picks the
     interval to fit the requested range (probed live: 12M→daily, 6M→2h, 3M→1h,
     1M→30m, no range→1h), so the default range is '3M': the only wide preset that
     keeps the 1-hour default. A manual chartdna_tv_range override is the user's own
     choice and may change the timeframe again. */
  const TV_CFG = {
    symbol: 'OANDA:XAUUSD',
    interval: '60',
    range: (function () {
      try { var r = localStorage.getItem('chartdna_tv_range'); if (r) return r; } catch (e) { }
      return '3M';
    })()
  };
  /* v46 — «عکس از فاصله»: the whole TradingView picture is drawn smaller inside the
     dark stage (a TV seen from the sofa). Scale 1 = fills the frame; less = farther.
     Default 0.78; ± keys in the head adjust it; persisted 'chartdna_tv_scale'.
     Fullscreen ignores the scale (CSS lifts the transform there). */
  const TV_SCALE_KEY = 'chartdna_tv_scale';
  const tvScaleDefault = () => {
    try {
      var v = parseFloat(localStorage.getItem(TV_SCALE_KEY));
      if (isFinite(v)) return Math.min(1, Math.max(0.5, v));
    } catch (e) { }
    return 0.78;
  };
  let tvScale = tvScaleDefault();
  const tvApplyScale = (s) => {
    tvScale = Math.min(1, Math.max(0.5, s));
    try { localStorage.setItem(TV_SCALE_KEY, String(tvScale)); } catch (e) { }
    if (tvChartEl) tvChartEl.style.transform = tvScale >= 1 ? '' : 'scale(' + tvScale + ')';
    return tvScale;
  };
  let tvTried = false;
  const tvSection = $('ohlc-tv'), tvChartEl = $('ohlc-tv-chart'),
        tvExpand = $('ohlc-tv-expand'), tvClose = $('ohlc-tv-close'),
        tvZin = $('ohlc-tv-zin'), tvZout = $('ohlc-tv-zout'),
        tvFnKey = $('ohlc-fn-1'), tvFn2 = $('ohlc-fn-2'), tvModeEl = $('ohlc-tv-mode');
  /* v47 — several display models for the live view, cycled by کلید ۲.
     TradingView widget style codes probed live: 1 = candles, 4 = thin line/bars.
     The light models hide every toolbar (watch-only, no clutter); the full model
     restores the whole TradingView toolbox. Persisted 'chartdna_tv_mode'. */
  const TV_MODE_KEY = 'chartdna_tv_mode';
  const TV_MODES = [
    { id: 'candle-lite', fa: 'کندل ساده', tip: 'چارت کندلی تمیز بدون نوار ابزار', style: '1', lite: 1 },
    { id: 'line-lite', fa: 'خط سبک', tip: 'نمای خطیِ سبک و مینیمال', style: '4', lite: 1 },
    { id: 'full', fa: 'نمای کامل TV', tip: 'تمام نوار ابزار و امکانات تریدینگ ویو', style: '1', lite: 0 }
  ];
  let tvModeCur = (function () {
    try {
      var s = localStorage.getItem(TV_MODE_KEY);
      if (s) for (var i = 0; i < TV_MODES.length; i++) if (TV_MODES[i].id === s) return i;
    } catch (e) { }
    return 0;   /* default: the lightest watch model */
  })();
  const tvMode = () => TV_MODES[tvModeCur] || TV_MODES[0];
  const tvModeUI = () => {
    const m = tvMode();
    if (tvModeEl) tvModeEl.textContent = m.fa;
    if (tvFn2) {
      tvFn2.title = 'کلید ۲ — تغییر سبک نمایش (فعلی: ' + m.fa + ' · ' + (tvModeCur + 1) + ' از ' + TV_MODES.length + ')';
      tvFn2.setAttribute('aria-label', tvFn2.title);
    }
  };
  const tvIsOpen = () => { try { return localStorage.getItem(TV_KEY) !== '0'; } catch (e) { return true; } };
  const tvKick = () => { try { window.dispatchEvent(new Event('resize')); } catch (e) { } };
  function tvCreate() {
    if (!window.TradingView) return false;
    /* the chart of the current mode: an existing iframe means it is already up */
    if (tvChartEl.querySelector('iframe')) return true;
    const m = tvMode();
    try {
      new TradingView.widget({
        container_id: 'ohlc-tv-chart',
        autosize: true,
        symbol: TV_CFG.symbol, interval: TV_CFG.interval, range: TV_CFG.range,
        timezone: 'Asia/Tehran', theme: 'dark', locale: 'en',
        style: m.style,
        toolbar_bg: '#0e1826', backgroundColor: '#0b1220',
        enable_publishing: false,
        allow_symbol_change: !m.lite,
        hide_top_toolbar: !!m.lite, hide_side_toolbar: !!m.lite,
        withdateranges: !m.lite, save_image: !m.lite,
        details: false, hotlist: false, calendar: false, studies: [],
        show_popup_button: !m.lite, popup_width: 1100, popup_height: 700
      });
      return true;
    } catch (err) {
      status('خطا در ساخت چارت زنده: ' + ((err && err.message) || err), 'err');
      return false;
    }
  }
  function tvEnsure() {
    if (tvChartEl && tvChartEl.querySelector('iframe')) return;
    if (window.TradingView) { tvCreate(); return; }
    if (tvTried) return;                       /* one attempt; error already shown */
    tvTried = true;
    const prevStatus = $('ohlc-status') ? $('ohlc-status').textContent : '';
    status('در حال بارگذاری چارت زندهٔ تریدینگ ویو…');
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/tv.js';
    s.async = true;
    s.onload = () => {
      if (tvCreate()) {
        /* success: restore whatever the panel said before loading (or a short note) */
        try {
          const el = $('ohlc-status');
          if (el && (el.textContent || '').indexOf('در حال بارگذاری چارت زنده') === 0) {
            el.textContent = prevStatus || 'چارت زنده آماده است.';
          }
        } catch (e) { }
      } else {
        status('ساخت چارت زنده ناموفق بود — صفحه را دوباره باز کنید.', 'warn');
      }
    };
    s.onerror = () => {
      status('بارگذاری چارت زنده ناموفق بود — اتصال اینترنت را بررسی کنید.', 'err');
    };
    document.head.appendChild(s);
  }
  function tvSetOpen(open) {
    try { localStorage.setItem(TV_KEY, open ? '1' : '0'); } catch (e) { }
    tvSection.classList.toggle('open', !!open);
    if (tvFnKey) tvFnKey.classList.toggle('on', !!open);
    if (open) {
      tvEnsure();
      setTimeout(tvKick, 120);   /* the iframe was display:none -> let it relayout */
      setTimeout(tvKick, 700);
    }
    return !!open;
  }
  /* v47 — کلید ۲: cycle the live-view display models (light candles -> light line ->
     full TradingView -> …). The widget iframe is rebuilt with the model's options. */
  function tvCycleMode() {
    if (tvSection && !tvSection.classList.contains('open')) tvSetOpen(true);
    tvModeCur = (tvModeCur + 1) % TV_MODES.length;
    try { localStorage.setItem(TV_MODE_KEY, TV_MODES[tvModeCur].id); } catch (e) { }
    const old = tvChartEl && tvChartEl.querySelector('iframe');
    if (old) old.remove();               /* rebuild for the new model */
    tvModeUI();
    status('سبک نمایش چارت زنده: ' + tvMode().fa + ' · ' + (tvModeCur + 1) + ' از ' + TV_MODES.length);
    tvEnsure();
    setTimeout(tvKick, 150); setTimeout(tvKick, 700);
    return tvMode();
  }
  if (tvSection && tvFnKey) {
    tvFnKey.title = 'قیمت زنده — کلید ۱ (باز/بسته)';
    tvFnKey.setAttribute('aria-label', 'قیمت زنده — کلید ۱ (باز/بسته)');
    tvFnKey.addEventListener('click', () => tvSetOpen(!tvSection.classList.contains('open')));
    if (tvFn2) {
      tvModeUI();
      tvFn2.addEventListener('click', tvCycleMode);
    }
    tvClose.addEventListener('click', () => { tvSetOpen(false); if (tvSection.classList.contains('full')) tvSection.classList.remove('full'); });
    if (tvZin) tvZin.addEventListener('click', () => tvApplyScale(tvScale + 0.1));
    if (tvZout) tvZout.addEventListener('click', () => tvApplyScale(tvScale - 0.1));
    tvExpand.addEventListener('click', () => {
      const full = tvSection.classList.toggle('full');
      tvExpand.textContent = full ? '🗗' : '⛶';
      tvExpand.title = full ? 'بازگشت به اندازهٔ قاب پنجره' : 'بزرگ‌نمایی تمام‌صفحه';
      if (!full) tvApplyScale(tvScale);   /* back in the frame: restore the TV distance */
      setTimeout(tvKick, 60); setTimeout(tvKick, 400);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && tvSection.classList.contains('full')) {
        tvSection.classList.remove('full');
        tvExpand.textContent = '⛶';
        tvApplyScale(tvScale);
        setTimeout(tvKick, 60);
      }
    });
    if (tvIsOpen()) { tvSection.classList.add('open'); tvFnKey.classList.add('on'); tvApplyScale(tvScale); tvEnsure(); }
  }

  /* =====================================================================
   * v51 — کلیدهای ۴–۶ take over the deck's play/search · stop · trash
   * ---------------------------------------------------------------------
   * The app's control strip under the «محیط الگو» window
   * (#remote-control-deck) is hidden by CSS (above) and its three actions
   * move up to the numbered row with the SAME behaviour and connections:
   *   ۴ = پلی و جستجو → #btn-start-analysis («شروع تحلیل DNA الگو»)
   *   ۵ = استاپ       → #btn-stop-analysis («توقف تحلیل»)
   *   ۶ = سطل آشغال   → #btn-clear-all («پاکسازی محیط و داده‌ها»)
   * The originals stay alive in the DOM, invisible, so pressing a fn key
   * forwards a REAL click to them: React's own handler runs, chart-dna-
   * methods keeps arming the play button, and our capture hook on
   * #btn-clear-all (fullReset) fires exactly as before. Enabled/disabled
   * states are mirrored onto the fn keys via aria-disabled.
   * ===================================================================== */
  (function wireDeckDuties() {
    var items = [
      { fn: 'ohlc-fn-4', orig: 'btn-start-analysis', num: '۴', fa: 'پلی و جستجو', note: 'شروع تحلیل DNA الگو (مثل دکمهٔ پخش زیر پنجرهٔ محیط الگو)' },
      { fn: 'ohlc-fn-5', orig: 'btn-stop-analysis', num: '۵', fa: 'استاپ', note: 'توقف تحلیل (مثل دکمهٔ استاپ زیر پنجرهٔ محیط الگو)' },
      { fn: 'ohlc-fn-6', orig: 'btn-clear-all', num: '۶', fa: 'سطل آشغال', note: 'پاکسازی محیط و داده‌ها (مثل دکمهٔ سطل زیر پنجرهٔ محیط الگو)' }
    ];
    function syncOne(it) {
      var k = $(it.fn), o = $(it.orig);
      if (!k) return;
      if (!o) { k.setAttribute('aria-disabled', 'true'); return; }
      if (it.orig === 'btn-start-analysis') pxPlayArmNow();  /* keep play armed while a query exists */
      var dis = !!o.disabled;
      var cur = k.getAttribute('aria-disabled');
      if (cur !== String(dis)) k.setAttribute('aria-disabled', String(dis));
      var t = 'کلید ' + it.num + ' — ' + it.fa + ': ' + it.note;
      if (dis) t += ' (فعلاً غیرفعال)';
      if (k.title !== t) { k.title = t; k.setAttribute('aria-label', t); }
    }
    /* v53 — run the app's own handler DIRECTLY instead of forwarding a click event.
       Probed live: with this companion script on the page, React no longer dispatches
       (delegated) click events to these deck buttons (the DOM node still carries its
       __reactProps$…onClick, and calling that function runs the whole engine-1 flow
       with its progress bar — verified: hook fires, «پیشرفت اسکن» reaches 100).
       So the fn key invokes the very handler React bound to the original button —
       the same code path, same gating checks inside, nothing reimplemented. */
    function fire(o) {
      if (!o) return false;
      var pk = null;
      try { for (var k in o) if (k.indexOf('__reactProps') === 0) { pk = k; break; } } catch (e) { }
      if (pk && o[pk] && typeof o[pk].onClick === 'function') {
        try { o[pk].onClick({}); return true; } catch (e) { console.warn('[ohlc] handler error:', e); }
      }
      try { o.click(); return true; } catch (e) { return false; }   /* fallback: plain click */
    }
    items.forEach(function (it) {
      var k = $(it.fn);
      if (!k) return;
      var t0 = 'کلید ' + it.num + ' — ' + it.fa + ': ' + it.note;
      k.title = t0; k.setAttribute('aria-label', t0);
      k.addEventListener('click', function () {
        var o = $(it.orig);
        if (!o || o.disabled) {            /* same rule as the original key — but say why */
          if (it.orig === 'btn-start-analysis') {
            status('کلید ۴ (پلی) فعلاً غیرفعال است — تصویری بارگذاری و «استخراج کندل‌ها» را بزنید تا الگویی برای جستجو آماده شود.', 'warn');
          }
          return;
        }
        fire(o);                            /* the app's own handler runs (direct) */
        if (it.orig === 'btn-clear-all') fullReset();   /* our side of the wipe runs too */
        syncOne(it);
      });
    });
    var t0 = Date.now();
    var w = setInterval(function () {
      items.forEach(syncOne);
      if (Date.now() - t0 > 600000) clearInterval(w);   /* 10 min is plenty for the mount watcher */
    }, 900);
  })();

  window.ChartDnaOhlc = {
    version: 20,
    write: () => state.write,
    frame: () => storedFrame(),
    lastWrite: () => state.lastWrite || null,
    overlay: (v) => setOverlay(v !== false),
    overlayData: () => state.ovData || null,
    clearOverlay: () => { removeOverlay(); keepOverlayRecord(null); return !document.getElementById(OV); },
    engine: () => window.ChartDNACV,
    busy: () => !!state.running,
    image: () => state.img,
    imageKey: () => state.imgKey,
    result: () => state.result,
    report: () => window.__ohlcReport || null,
    sigOf,
    useImage: (src) => new Promise((done) => { loadImage(src, () => done(state.img)); }),
    run: (key) => run(key),
    toCSV: () => window.ChartDNACV.toCSV(state.result),
    open: () => show(true),
    close: () => show(false),
    confirm: confirmFlow,
    confirmed: () => state.confirmedKey,
    onPickedImage: (url) => onPickedImage(url),
    deckKey: deckKey,
    deckTakeover: () => takeoverOn()
  };

})();
