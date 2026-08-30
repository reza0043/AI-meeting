/* Chart DNA — UI trim
 * ---------------------------------------------------------------------------
 * Removes three windows from the app, together with everything that fed them:
 *
 *   1. «کندل‌های بازسازی‌شده از همین تصویر (OHLC از پیکسل)» — the card that
 *      chart-ohlc-autopilot.js used to inject under the app's image panel.  The
 *      autopilot file itself is gone; this script also rips out the card if a
 *      stale copy of that file is still in someone's cache, and sweeps the data
 *      it wrote (dataset, pattern, reference price, options).
 *   2. «رسم چارت و سطوح تحلیل الگو» / "Pattern Chart Overlay" — the app's own
 *      overlay panel (canvas, support & resistance lines, targets, price chip).
 *   3. «کارت‌های آماری تحلیل الگو» / "Pattern Stats & Targets" — the stat cards
 *      that hung under it (peaks, entry/target/stop levels).
 *   Panels 2 and 3 live in the minified bundle with no source in this repo, so
 *   they are hidden in place instead of being ripped out of React's tree: hiding
 *   is safe, removing a node React owns is not.
 *
 * Nothing here touches the manual extraction tool (the button at the top of the
 * page and its panel); that stays available.
 *
 * Switches (localStorage):  chartdna_ui_trim = '0'     -> this script does nothing
 *                           chartdna_ui_trim_swept      -> set by the data sweep
 */
(() => {
  const OFF = 'chartdna_ui_trim';
  const SWEPT = 'chartdna_ui_trim_swept';
  /* the app's own stable ids win; the titles only back them up for other builds */
  const IDS = ['pattern-overlay-canvas-card', 'pattern-stats-cards-card'];
  const TITLES = [
    'رسم چارت و سطوح تحلیل الگو', 'Pattern Chart Overlay',
    'کارت‌های آماری تحلیل الگو', 'Pattern Stats & Targets'
  ];
  const CARD = 'ohlc-auto-card';
  const OUR_KEYS = /^chartdna_ohlc_/;
  const OUR_NAME = /from image|کادر برنامه|از تصویر/i;

  const on = () => { try { return localStorage.getItem(OFF) !== '0'; } catch (e) { return true; } };
  const log = (...a) => { try { console.log('[chart-dna-ui-trim]', ...a); } catch (e) { } };

  /* ------------------------------------------------------------ the card we used to inject */
  function dropOwnCard() {
    let n = 0, el;
    while ((el = document.getElementById(CARD)) || document.querySelector('#' + CARD)) {
      if (el && el.parentElement) el.parentElement.removeChild(el); else break;
      if (++n > 4) break;                                   /* never loop on a stubborn node */
    }
    return n;
  }

  /* -------------------------------------------------- the app's own pattern panels */
  /* only the element whose OWN text is the title counts — every ancestor of the
     heading also "contains" that string, and matching them would hide the page */
  function ownText(el) {
    let t = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const c = el.childNodes[i];
      if (c.nodeType === 3) t += c.nodeValue;
    }
    return t.replace(/\s+/g, ' ').trim();
  }
  function isTitle(el) {
    const t = ownText(el);
    if (!t) return false;
    for (let i = 0; i < TITLES.length; i++) if (t === TITLES[i]) return true;
    return false;
  }
  /* never take the app itself, whatever the climb finds */
  function tooBig(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (el.id === 'chart-dna-app' || el.id === 'root') return true;
    try { return !!el.querySelector('#image-cropper-card') || !!el.querySelector('#btn-header-settings'); } catch (e) { return false; }
  }
  /* climb from a title to the card that owns it: the closest ancestor holding the
     panel's canvas, else the closest rounded card */
  function panelOf(title) {
    let node = title, canvasAbove = null, card = null;
    for (let i = 0; node && i < 8; i++) {
      node = node.parentElement;
      if (!node || node === document.body) break;
      if (!canvasAbove && node.querySelector && node.querySelector('canvas')) canvasAbove = node;
      if (!card && /rounded|border/.test(node.className || '')) card = node;
      if (canvasAbove && card) break;
    }
    return canvasAbove || card || (title.parentElement || null);
  }
  const panels = [];
  function stillHidden() {
    const keep = [];
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      if (p && p.isConnected && p.style && p.style.display === 'none') keep.push(p);
    }
    return keep;
  }
  function hide(el, why) {
    if (!el || el.__dnaTrimmed) return false;
    el.__dnaTrimmed = true;
    el.setAttribute('hidden', '');
    el.style.display = 'none';
    panels.push(el);
    log('hidden panel by ' + why + (el.id ? ': #' + el.id : ''));
    return true;
  }
  function hideById() {
    let n = 0;
    for (let i = 0; i < IDS.length; i++) {
      const el = document.getElementById(IDS[i]);
      if (el && hide(el, 'id')) n++;
    }
    return n;
  }
  let lastScan = 0;
  function hideByTitle() {
    lastScan = Date.now();
    const nodes = document.querySelectorAll('h1,h2,h3,h4,h5,span,div');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.__dnaTrimmed || !isTitle(el)) continue;
      el.__dnaTrimmed = true;
      const panel = panelOf(el);
      if (!panel || tooBig(panel)) { log('title found but no safe panel around it'); continue; }
      hide(panel, 'title');
    }
    return panels.length;
  }
  function hideOverlays(force) {
    if (!on()) return panels.length;
    /* if a panel we hid came back (React rebuilt it), forget it and look again */
    const kept = stillHidden();
    const lost = kept.length !== panels.length;
    panels.length = 0;
    for (let i = 0; i < kept.length; i++) panels.push(kept[i]);
    const found = hideById();                           /* ids: cheap, always worth a look */
    if (!force && !lost && !found && Date.now() - lastScan < 2000) return panels.length;
    return hideByTitle();
  }

  /* --------------------------------------------------------------- the data sweep */
  function dropOurPatterns() {
    let removed = 0;
    try {
      const raw = localStorage.getItem('chartdna_saved_patterns');
      if (!raw) return 0;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return 0;
      const keep = list.filter((p) => {
        const mine = p && ((typeof p.id === 'string' && p.id.indexOf('img-') === 0) || OUR_NAME.test(p.name || ''));
        if (mine) removed++;
        return !mine;
      });
      if (removed) localStorage.setItem('chartdna_saved_patterns', JSON.stringify(keep));
    } catch (e) { log('patterns not readable, left alone'); }
    try { sessionStorage.removeItem('chartdna_ohlc_pending_pattern'); } catch (e) { }
    return removed;
  }
  const DB = 'ChartDNA_Storage', VER = 1, STORE = 'market_datasets';
  function openDb() {
    return new Promise((done) => {
      if (!window.indexedDB) return done(null);
      /* never create the app's database: if it does not exist yet, there is
         nothing of ours in it either, and an upgrade here would leave an empty
         store list for the app to trip over */
      const skip = () => done(null);
      if (indexedDB.databases) {
        let listed = false;
        const t = setTimeout(skip, 1500);
        indexedDB.databases().then((list) => {
          if (listed) return; listed = true; clearTimeout(t);
          const hit = (list || []).filter((d) => d && d.name === DB)[0];
          if (!hit) return skip();
          open(hit.version == null ? undefined : hit.version);
        }, () => { if (!listed) { listed = true; clearTimeout(t); open(undefined); } });
        return;
      }
      open(undefined);

      function open(version) {
        let req;
        try { req = version == null ? indexedDB.open(DB) : indexedDB.open(DB, version); } catch (e) { return skip(); }
        req.onupgradeneeded = () => {                /* the app has not built it yet */
          try { if (req.transaction) req.transaction.abort(); } catch (e) { }
          skip();
        };
        req.onsuccess = () => done(req.result);
        req.onerror = () => skip();
        req.onblocked = () => skip();
      }
    });
  }
  function dropOurDatasets() {
    return openDb().then((db) => {
      if (!db) return { removed: 0, note: 'no indexedDB' };
      if (!db.objectStoreNames || !db.objectStoreNames.contains('market_datasets')) { try { db.close(); } catch (e) { } return { removed: 0, note: 'no store' }; }
      return new Promise((done) => {
        const out = { removed: 0, note: '' };
        let tx;
        try { tx = db.transaction('market_datasets', 'readwrite'); } catch (e) { return done(out); }
        const store = tx.objectStore('market_datasets');
        const all = store.getAll();
        all.onsuccess = () => {
          const list = all.result || [];
          const mine = list.filter((r) => r && ((typeof r.id === 'string' && r.id.indexOf('img-') === 0) || OUR_NAME.test(r.name || '')));
          mine.forEach((r) => { try { store.delete(r.id); out.removed++; } catch (e) { } });
          if (out.removed) {
            try {
              const sel = JSON.parse(localStorage.getItem('chartdna_selected_dataset_ids') || '[]');
              const cut = {};
              mine.forEach((r) => { cut[r.id] = 1; });
              const keep = sel.filter((id) => !cut[id]);
              if (keep.length !== sel.length) localStorage.setItem('chartdna_selected_dataset_ids', JSON.stringify(keep));
            } catch (e) { }
          }
        };
        tx.oncomplete = () => { try { db.close(); } catch (e) { } done(out); };
        tx.onerror = () => { try { db.close(); } catch (e) { } out.note = 'tx error'; done(out); };
      });
    });
  }
  function dropOurSettings() {
    let keys = 0;
    try {
      let ref = null, refSetByUs = null;
      try { ref = localStorage.getItem('chartdna_reference_price'); refSetByUs = localStorage.getItem('chartdna_ohlc_ref_price'); } catch (e) { }
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && OUR_KEYS.test(k) && k !== OFF && k !== SWEPT) doomed.push(k);
      }
      doomed.forEach((k) => { try { localStorage.removeItem(k); keys++; } catch (e) { } });
      /* the reference price we wrote for the reconstruction: only ours to delete
         when it is still the number we put there */
      if (refSetByUs && ref === refSetByUs) { try { localStorage.removeItem('chartdna_reference_price'); } catch (e) { } }
      try { sessionStorage.removeItem('chartdna_ohlc_dna_plan'); } catch (e) { }
    } catch (e) { }
    return keys;
  }
  function sweep(force) {
    try { if (!force && localStorage.getItem(SWEPT)) return Promise.resolve(null); } catch (e) { }
    const patterns = dropOurPatterns();
    const settings = dropOurSettings();
    return dropOurDatasets().then((ds) => {
      try { localStorage.setItem(SWEPT, new Date().toISOString()); } catch (e) { }
      const line = 'دادهٔ بازمانده: ' + ds.removed + ' دیتاست، ' + patterns + ' الگو، ' + settings + ' کلید پاک شد' + (ds.note ? ' (' + ds.note + ')' : '');
      log(line);
      return { datasets: ds.removed, patterns, settings, note: ds.note };
    });
  }

  /* ------------------------------------------------------------------- wiring */
  function run() {
    if (!on()) { log('switched off by ' + OFF); return; }
    dropOwnCard();
    hideOverlays(true);
    sweep();
    /* the app mounts after us and re-renders, so keep watching; our own writes
       are attribute/childList-free for the observer so this cannot loop */
    let queued = false;
    const again = () => {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || function (f) { return setTimeout(f, 32); })(() => { queued = false; dropOwnCard(); hideOverlays(); });
    };
    try {
      const mo = new MutationObserver(again);
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) { }
    /* the app mounts after us and may rebuild these panels later */
    const settle = setInterval(() => { dropOwnCard(); hideOverlays(true); }, 600);
    setTimeout(() => clearInterval(settle), 20000);
  }
  if (document.body) run(); else document.addEventListener('DOMContentLoaded', run);

  window.ChartDnaUiTrim = {
    version: 2,
    titles: TITLES.slice(),
    ids: IDS.slice(),
    hide: hideOverlays,
    dropCard: dropOwnCard,
    sweep: () => sweep(true),
    hidden: () => panels.length,
    off: () => { try { localStorage.setItem(OFF, '0'); } catch (e) { } }
  };
})();
