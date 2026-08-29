/* Chart DNA — autopilot
 * ---------------------------------------------------------------------------
 * Watches the app's own image upload (the pattern workspace) and, for every
 * picture the user drops there, runs the pixel-based OHLC reconstruction from
 * chart-ohlc-engine.js. The rebuilt candles are then
 *   1. drawn as a new candlestick chart inside the app (a card inserted right
 *      below the app's own chart/crop panel, with the per-candle marks and the
 *      key levels measured from the picture),
 *   2. registered as a dataset in the app's IndexedDB store and selected,
 *   3. handed to the app's DNA engine as the reference pattern, which starts a
 *      search over the user's market history.
 * Nothing about the market is fetched or guessed: every number comes from the
 * pixels of the uploaded image.
 */
(() => {
  const CFG_AUTO = 'chartdna_ohlc_auto';       // extract when the app gets an image
  const CFG_RUN = 'chartdna_ohlc_autorun';     // also feed the DNA search (reloads once)
  const CFG_PIN = 'chartdna_ohlc_pin';         // 0 = the opener floats in the bottom corner
  const SEEN = 'chartdna_ohlc_seen_image';     // signature already processed
  const REFPRICE = 'chartdna_reference_price';  // the app's own "market reference price"
  const REFWRITTEN = 'chartdna_ohlc_ref_price'; // …only rewritten if the user did not set it
  const PLAN = 'chartdna_ohlc_dna_plan';       // click sequence pending after reload
  const CARD_ID = 'ohlc-auto-card';
  const TAB_LABEL = 'تشخیص و ثبت الگو از تصویر';
  const ACT_TITLES = ['جستجوی فوری این الگو در تمام نمادها', 'انتخاب به عنوان مرجع'];

  const api = () => window.ChartDnaOhlc;
  const datasetId = (sig) => 'img-' + sig;          /* re-uploading the same picture updates, never duplicates */
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const set = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const sget = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const sset = (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const autoOn = () => get(CFG_AUTO, '1') !== '0';
  const runOn = () => get(CFG_RUN, '1') !== '0';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el && (el.textContent || '')).replace(/\s+/g, ' ').trim();
  const isMine = (el) => !!(el.closest && (el.closest('#' + CARD_ID) || el.closest('#ohlc-modal') || el.closest('#ohlc-tool')));

  const log = (...a) => { try { console.info.apply(console, ['[chart-ohlc-autopilot]'].concat(a)); } catch (e) { } };

  /* ------------------------------------------------------- what to watch */
  /* The app turns every upload/paste/drop into a data: URL through a
     FileReader before it touches it, so that is the one place where every
     entry point (file dialog, drag & drop, clipboard) converges. */
  let lastSeen = null, current = null, canvasProbe = 0;
  const tried = Object.create(null);   /* do not hammer a picture that keeps failing */
  const listeners = [];
  function onImageSource(fn) { listeners.push(fn); }
  (function hookFileReader() {
    const proto = window.FileReader && window.FileReader.prototype;
    if (!proto || proto.__ohlcHooked) return;
    proto.__ohlcHooked = true;
    const readAsDataURL = proto.readAsDataURL;
    proto.readAsDataURL = function (blob) {
      if (this.__ohlcWatched !== true) {
        this.__ohlcWatched = true;
        this.addEventListener('load', () => {
          try {
            const r = this.result;
            if (typeof r === 'string' && r.indexOf('data:image') === 0) listeners.forEach((fn) => fn(r));
          } catch (e) { /* revoked reader */ }
        });
      }
      return readAsDataURL.apply(this, arguments);
    };
  })();

  /* also watch Image.src: the app (and anything else on the page) feeds every
     picture through `new Image()`, so this catches uploads even if the reader
     path ever changes. */
  (function hookImageSrc() {
    const proto = window.HTMLImageElement && window.HTMLImageElement.prototype;
    if (!proto || proto.__ohlcSrcHooked) return;
    const desc = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!desc || !desc.set) return;
    proto.__ohlcSrcHooked = true;
    Object.defineProperty(proto, 'src', {
      configurable: true, enumerable: desc.enumerable,
      get: desc.get,
      set: function (v) {
        try {
          const t = String(v);
          if (t.indexOf('data:image') === 0 || t.indexOf('blob:') === 0) listeners.forEach((fn) => fn(t));
        } catch (e) { /* ignore */ }
        return desc.set.call(this, v);
      }
    });
  })();

  let timer = null, pending = null;
  onImageSource((url) => {
    if (url === current) return;                      /* our own loadImage() round-trip */
    if ((tried[signature(url)] || 0) > 1) return;
    lastSeen = { url, at: Date.now(), size: 0 };
    if (!autoOn()) {
      log('image seen, but auto extraction is switched off');
      ensureCard(null, null);
      statusLine('تصویر برنامه دیده شد (' + Math.round(url.length / 1024) + ' کیلوبایت) — «استخراج خودکار» خاموش است؛ با دکمهٔ روبه‌ریز استخراج کنید.');
      return;
    }
    pending = url;
    clearTimeout(timer);
    timer = setTimeout(() => { const u = pending; pending = null; handle(u); }, 500);
  });

  function findAppImage() {
    const ok = (u) => typeof u === 'string' && (u.indexOf('data:image') === 0 || u.indexOf('blob:') === 0);
    if (lastSeen && ok(lastSeen.url)) return lastSeen.url;
    let best = null, area = 0;
    document.querySelectorAll('img').forEach((im) => {
      if (isMine(im) || !ok(im.currentSrc || im.src)) return;
      const a = (im.naturalWidth || im.width) * (im.naturalHeight || im.height);
      if (a > area) { area = a; best = im.currentSrc || im.src; }
    });
    if (best) return best;
    /* last resort: the picture the app already painted into its own canvas —
       expensive, so only every ~12s and only while nothing has been measured */
    const A = api();
    const host = document.getElementById('image-cropper-card') || document.getElementById('chart-dna-app');
    if (host && (!A || !A.result()) && Date.now() - canvasProbe > 12000) {
      canvasProbe = Date.now();
      host.querySelectorAll('canvas').forEach((c) => {
      if (isMine(c) || !c.width || c.width < 120) return;
        try { const u = c.toDataURL('image/jpeg', 0.94); if (u.length > 2000 && u.length > area) { area = u.length; best = u; } } catch (e) { /* tainted canvas */ }
      });
    }
    return best;
  }
  async function manualExtract() {
    const A = api();
    if (!A) return;
    const url = findAppImage();
    if (!url) { statusLine('تصویری در پنل برنامه پیدا نشد — اول در «محیط الگو» تصویر را انتخاب کنید.'); return; }
    /* a tap is an order: run it even if the picture was already seen or retried */
    set(SEEN, '');
    current = null;
    tried[signature(url)] = 0;
    await handle(url, true);
  }
  function setNote(text) { try { const A = api(); if (A && A.note) A.note(text); } catch (e) { } }
  function statusLine(msg, kind) {
    const el = document.getElementById('ohlc-auto-status');
    if (el) { el.textContent = msg; el.style.color = kind === 'warn' ? '#fbbf24' : ''; }
  }
  function signature(url) { return api() ? api().sigOf(url) : String(url).length; }

  async function handle(url, forced) {
    const A = api();
    if (!A || !A.engine() || current === url) return;
    const sig = signature(url);
    if (!forced && get(SEEN) === sig) { log('this image was already processed'); return; }
    if ((tried[sig] || 0) > 1) return;
    tried[sig] = (tried[sig] || 0) + 1;
    current = url;
    set(SEEN, sig);                                  // claim it before any reload
    while (A.busy()) await sleep(200);
    ensureCard('در حال بارگذاری تصویر…', null);
    try {
      await A.useImage(url);
      ensureCard('در حال اندازه‌گیری پیکسل‌ها…', null);
      setNote('…');
      const res = await A.run(sig);
      if (!res || !res.ok) { current = null; setNote(''); ensureCard('استخراج انجام نشد: ' + ((res && res.error) || 'خطای نامشخص'), null); return; }
      if (!(res.calibration && res.calibration.detected)) {
        current = null;
        ensureCard('کندل‌ها پیدا شدند (' + res.candles + ') اما محور قیمت خوانده نشد؛ برای عدد دادن، در پنل استخراج چند ردیف مرجع وارد کنید.', null);
        return;
      }
      drawCard(res);
      setNote((res.candles || res.bars.length) + ' کندل');
      const saved = await A.saveDataset(false, { silent: true, pattern: true, id: datasetId(sig) });
      if (saved && saved.error) { current = null; ensureCard('ثبت دیتاست ناموفق: ' + saved.error, res); return; }
      cardStatus(res, saved);
      syncReferencePrice(res);
      current = null;
      cropWatch();                                     /* follow the app's crop box */
      if (runOn() && res.bars.length >= 8) {
        sset(PLAN, JSON.stringify({ sig, name: saved.name, id: saved.id, when: Date.now() }));
        note('برای اینکه همین داده به‌عنوان الگوی مرجع در جستجوی DNA اجرا شود، صفحه یک‌بار بازخوانی می‌شود…');
        await sleep(1200);
        (typeof window.__chartDnaReload === 'function' ? window.__chartDnaReload : window.location.reload.bind(window.location))();
      }
    } catch (e) {
      current = null;
      log('extraction failed', e);
      ensureCard('خطای غیرمنتظره در استخراج: ' + (e && e.message ? e.message : e), null);
    }
  }

  /* ------------------------------------------------------------- the card */
  let card = null;
  function ensureCard(msg, res) {
    if (!document.getElementById(CARD_ID)) { card = null; buildCard(); }
    if (!card) card = document.getElementById(CARD_ID);
    if (!card) return null;
    if (msg !== null && msg !== undefined) setStatus(msg);
    if (res) { card.__result = res; }
    syncOptions();
    return card;
  }
  function buildCard() {
    const host = anchor();
    if (!host) { log('no app panel to attach to yet'); return; }
    const el = document.createElement('div');
    el.id = CARD_ID;
    el.dir = 'rtl';
    el.className = 'bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-md';
    el.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <h4 class="text-xs font-bold text-white">کندل‌های بازسازی‌شده از همین تصویر (OHLC از پیکسل)</h4>
        <span id="ohlc-auto-badge" class="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/50 text-[9px] font-mono text-cyan-300 font-bold">—</span>
      </div>
      <div id="ohlc-auto-status" class="text-[11px] text-slate-400 leading-5 whitespace-pre-wrap">در انتظار تصویر…</div>
      <canvas id="ohlc-auto-chart" style="width:100%;max-height:280px;display:block"></canvas>
      <canvas id="ohlc-auto-ann" style="width:100%;display:none"></canvas>
      <div class="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/60">
        <button data-act="now" class="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500 rounded-lg font-bold cursor-pointer">استخراج از تصویر برنامه</button>
        <button data-act="ann" class="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg cursor-pointer">مارک‌ها روی تصویر</button>
        <button data-act="csv" class="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg cursor-pointer">دانلود CSV</button>
        <button data-act="save" class="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg cursor-pointer">ثبت دیتاست</button>
        <button data-act="search" class="px-2.5 py-1 text-[11px] font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 border border-cyan-400 rounded-lg font-bold cursor-pointer">اجرای جستجوی DNA روی این داده</button>
        <button data-act="panel" class="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg cursor-pointer">پنل استخراج (تاریخ، کالیبراسیون دستی)</button>
        <label class="flex items-center gap-1 text-[10px] text-slate-400"><input type="checkbox" data-opt="auto" style="width:auto"> استخراج خودکار</label>
        <label class="flex items-center gap-1 text-[10px] text-slate-400"><input type="checkbox" data-opt="run" style="width:auto"> خودکار به جستجو بده</label>
        <label class="flex items-center gap-1 text-[10px] text-slate-400"><input type="checkbox" data-opt="pin" style="width:auto"> دکمهٔ استخراج بالای صفحه چسبان</label>
      </div>`;
    host.insertAdjacentElement('afterend', el);
    card = el;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act],[data-opt]');
      if (!b) return;
      if (b.dataset.opt) {
        const on = b.checked;
        set(b.dataset.opt === 'auto' ? CFG_AUTO : b.dataset.opt === 'run' ? CFG_RUN : CFG_PIN, on ? '1' : '0');
        if (b.dataset.opt === 'pin' && api() && api().pin) api().pin(on);   /* move the opener now */
        syncOptions(); return;
      }
      act(b.dataset.act);
    });
    log('card attached to', host.id || String(host.className).split(' ')[0]);
    verifyPlacement();
  }
  /* the app's own card is height-clipped; if we landed inside something clipped,
     move to the end of the main column instead */
  function verifyPlacement() {
    if (!card) return;
    let r;
    try { r = card.getBoundingClientRect(); } catch (e) { return; }
    if (!r || (r.width === 0 && r.height === 0 && !card.parentElement)) return;
    if (r.height > 8 || r.width > 80) return;
    if (typeof r.height === 'number' && r.height === 0 && typeof window !== 'undefined' && window.getComputedStyle) {
      const ph = window.getComputedStyle(card.parentElement || document.body).overflow;
      if (!/hidden|clip/.test(ph || '')) return;                  /* not clipped: fine (jsdom reports 0) */
    }
    const app = document.getElementById('chart-dna-app');
    const grid = app && (app.querySelector('.grid') || app.querySelector('[class*="grid-cols"]'));
    const col = grid && grid.children && grid.children[0];
    if (col && col !== card.parentElement) { col.appendChild(card); log('relocated the card into the main column'); }
  }
  function anchor() {
    const cropper = document.getElementById('image-cropper-card');
    if (cropper && cropper.parentElement) return cropper;
    /* fall back to the panel that paints the app's biggest canvas */
    let best = null, area = 0;
    document.querySelectorAll('canvas').forEach((c) => {
      if (isMine(c)) return;
      const a = (c.width || 0) * (c.height || 0);
      if (a > area) { area = a; best = c; }
    });
    let node = best;
    for (let i = 0; node && i < 5; i++) {
      node = node.parentElement;
      if (node && node.parentElement && node.parentElement.id !== 'root' && /rounded|p-4|p-3/.test(node.className || '')) return node;
    }
    return node || null;
  }
  function setStatus(msg) { const el = document.getElementById('ohlc-auto-status'); if (el) el.textContent = msg; }
  function stateLine() {
    const A = api();
    if (A && A.result()) return null;
    const seen = lastSeen ? 'تصویر برنامه دیده شد' : 'تصویری در پنل برنامه نیست';
    return seen + ' · استخراج خودکار ' + (autoOn() ? 'روشن' : 'خاموش') + (A && A.busy() ? ' · در حال پردازش…' : '');
  }
  /* keep the measured numbers on screen and add progress lines below them */
  function note(msg) {
    const el = document.getElementById('ohlc-auto-status');
    if (!el) return;
    const lines = (el.textContent || '').split('\n').filter((l) => l && l.indexOf(msg) < 0);
    lines.push(msg);
    el.textContent = lines.slice(-8).join('\n');
  }
  function syncOptions() {
    if (!card) return;
    const a = card.querySelector('[data-opt="auto"]'), r = card.querySelector('[data-opt="run"]'), k = card.querySelector('[data-opt="pin"]');
    if (a) a.checked = autoOn();
    if (r) r.checked = runOn();
    if (k) k.checked = get(CFG_PIN) !== '0';
  }
  function keyLevels(res) {
    let hi = -Infinity, lo = Infinity;
    res.bars.forEach((b) => { if (b.high > hi) hi = b.high; if (b.low < lo) lo = b.low; });
    const last = res.bars[res.bars.length - 1];
    return { hi, lo, last };
  }
  function drawCard(res) {
    if (!ensureCard(null, res)) return;
    const c = document.getElementById('ohlc-auto-chart');
    c.width = Math.min(1200, Math.max(560, res.bars.length * 4));
    c.height = 280;
    window.ChartDNACV.renderChart(c, res.bars, { title: res.bars.length + ' کندل — بازسازی از تصویر آپلودی' });
    const badge = document.getElementById('ohlc-auto-badge');
    if (badge) badge.textContent = res.bars.length + ' کندل';
  }
  function cardStatus(res, saved, inCrop) {
    const q = res.quality || {}, cal = res.calibration || {}, k = keyLevels(res);
    setStatus([
      'بازهٔ قیمت در تصویر: ' + k.hi.toFixed(2) + ' تا ' + k.lo.toFixed(2) + '  ·  آخرین بسته‌شدن: ' + ((k.last && k.last.close) != null ? k.last.close.toFixed(2) : '—'),
      'کالیبراسیون: ' + (cal.equation || '') + '  ·  ۱ پیکسل ≈ ' + (cal.usdPerPx || 0).toFixed(3) + ' (دقت خروجی به همین گام محدود است)',
      'کیفیت: میانگین اطمینان ' + q.meanConfidence + '، ' + (q.needReview || []).length + ' کندل برای بازبینی دستی علامت خورده',
      (inCrop ? 'کادر زرد برنامه: ' + inCrop + ' کندل از ' + res.bars.length + ' به‌عنوان الگوی جستجو استفاده می‌شود (دیتاست همچنان کل تصویر است)' : ''),
      saved && saved.id ? 'دیتاست «' + saved.name + '» ثبت و انتخاب شد · الگو: ' + ({ 'added': 'به کتابخانه اضافه شد', 'already-there': 'موجود بود', 'queued-for-next-load': 'در صف بارگذاری بعد' }[saved.pattern] || saved.pattern) : ''
    ].filter(Boolean).join('\n'));
  }
  /* The app draws its yellow selection box on the cropper canvas at the image's
     own resolution, so the rectangle can be read back and used to decide which
     candles the search should look for — without re-running the vision pass. */
  function cropBox() {
    const host = document.getElementById('image-cropper-card');
    const A = api(), res = A && A.result();
    if (!host || !res) return null;
    let best = null;
    host.querySelectorAll('canvas').forEach((c) => {
      let ctx;
      try { ctx = c.getContext('2d', { willReadFrequently: true }); } catch (e) { return; }
      if (!ctx || !c.width || !c.height) return;
      let d;
      try { d = ctx.getImageData(0, 0, c.width, c.height).data; } catch (e) { return; }
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (r > 190 && g > 130 && g < 228 && b < 95) {
          const x = p % c.width, y = (p / c.width) | 0;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; n++;
        }
      }
      if (n < 120 || x1 - x0 < 24 || y1 - y0 < 12) return;
      const area = (x1 - x0) * (y1 - y0);
      if (!best || area > best.area) best = { x0, x1, y0, y1, n, area, cw: c.width };
    });
    if (!best) return null;
    const im = A.image(), k = im && im.naturalWidth && best.cw ? im.naturalWidth / best.cw : 1;
    return { x0: best.x0 * k, x1: best.x1 * k };
  }

  let lastCrop = null, cropTimer = null;
  async function applyCrop(force) {
    const A = api(), res = A && A.result();
    if (!res || !res.ok || !(res.calibration && res.calibration.detected)) return;
    const box = cropBox();
    const key = box ? Math.round(box.x0) + ':' + Math.round(box.x1) : '';
    if (key === lastCrop && !force) return;
    lastCrop = key;
    const scale = res.scale || 1;
    const inside = box ? res.bars.filter((b) => { const nx = b.x / scale; return nx >= box.x0 - 2 && nx <= box.x1 + 2; }) : res.bars;
    const closes = inside.filter((b) => b.close != null).map((b) => b.close);
    const useCrop = !!box && closes.length >= 8 && closes.length < res.bars.length;
    const saved = await A.saveDataset(false, {
      silent: true, pattern: true, id: datasetId(get(SEEN)),
      nameSuffix: useCrop ? ' · کادر برنامه' : '',
      patternPoints: useCrop ? closes : null
    });
    if (saved && saved.id) {
      const badge = document.getElementById('ohlc-auto-badge');
      if (badge) badge.textContent = res.bars.length + ' کندل' + (useCrop ? ' · ' + closes.length + ' در کادر' : '');
      cardStatus(res, saved, useCrop ? closes.length : null);
    }
  }
  function cropWatch() {
    clearInterval(cropTimer);
    cropTimer = setInterval(() => { if (autoOn()) applyCrop(false); verifyPlacement(); }, 1500);
  }

  /* The app turns its reference price into dollar targets for the matched
     patterns; the last close we measured from the picture is the honest value
     for that field — set it unless the user has typed something themselves. */
  function syncReferencePrice(res) {
    const last = res.bars[res.bars.length - 1];
    const v = last && last.close;
    if (v == null) return;
    const cur = get(REFPRICE), ours = get(REFWRITTEN);
    if (cur && cur !== ours) { log('keeping the user reference price', cur); return; }
    const s2 = String(Math.round(v * 100) / 100);
    set(REFPRICE, s2); set(REFWRITTEN, s2);
    note('قیمت مرجع برنامه روی آخرین بسته‌شدنِ اندازه‌گیری‌شده (' + s2 + ') گذاشته شد' + (runOn() ? ' تا هدف‌های دلاری از همین تصویر حساب شوند' : ' — با بازخوانی صفحه اعمال می‌شود'));
  }

  async function act(which) {
    const A = api(), res = A && A.result();
    if (which === 'panel') { A && A.open(); return; }
    if (which === 'now') { await manualExtract(); return; }
    if (!res) { note('تصویری استخراج نشده بود؛ حالا خودش استخراج را امتحان می‌کند…'); await manualExtract(); return; }
    if (which === 'ann') {
      const c = document.getElementById('ohlc-auto-ann');
      const shown = c.style.display !== 'none';
      c.style.display = shown ? 'none' : 'block';
      if (!shown) { try { window.ChartDNACV.renderAnnotated(c, A.image(), res); } catch (e) { c.style.display = 'none'; setStatus('رندر تصویر مارک‌خورده ناموفق بود: ' + e.message); } }
      return;
    }
    if (which === 'csv') {
      const blob = new Blob([A.toCSV()], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chart_ohlc_from_image.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return;
    }
    if (which === 'save') { const s = await A.saveDataset(false, { silent: false }); if (s && s.id) cardStatus(res, s); return; }
    if (which === 'search') {
      const s = await A.saveDataset(false, { silent: true, pattern: true });
      if (!s || s.error) return;
      sset(PLAN, JSON.stringify({ sig: get(SEEN), name: s.name, id: s.id, when: Date.now() }));
      note('جستجوی DNA با همین کندل‌ها اجرا می‌شود…');
      await sleep(300);
      if (!(await runPlan(false))) {
        note('کتابخانهٔ برنامه هنوز این الگو را نشان نمی‌دهد؛ صفحه بازخوانی می‌شود و جستجو خودکار اجرا خواهد شد…');
        await sleep(500);
        (typeof window.__chartDnaReload === 'function' ? window.__chartDnaReload : window.location.reload.bind(window.location))();
      }
    }
  }

  /* ----------------------------------------- feeding the app's DNA search */
  /* The reference pattern lives only in React state, and the single supported
     way to set it from the UI is the pattern library. So after the reload (when
     the app has loaded our pattern from localStorage) we drive that path:
     open settings -> the "pattern from image" tab -> the card of our pattern ->
     the button that applies it as reference AND starts the search. */
  const waitFor = async (find, ms) => {
    const end = Date.now() + (ms || 6000);
    while (Date.now() < end) {
      const el = find();
      if (el) return el;
      await sleep(120);
    }
    return null;
  };
  const appButtons = () => Array.prototype.filter.call(document.querySelectorAll('button'), (b) => !isMine(b) && !b.disabled);
  const byLabel = (want) => appButtons().filter((b) => text(b) === want)[0] || appButtons().filter((b) => text(b).indexOf(want) >= 0)[0];

  function patternAction(name) {
    const all = Array.prototype.filter.call(document.querySelectorAll('h5, .text-xs.font-bold'), (h) => !isMine(h) && text(h));
    /* our patterns are named "<symbol> <tf> (from image)[ · کادر برنامه]" and are
       appended last, so match exactly first, then by our naming, then take the newest */
    let heads = all.filter((h) => name && text(h) === name);
    if (!heads.length) heads = all.filter((h) => /\(from image\)/.test(text(h)));
    heads = heads.slice(-1);
    for (let i = heads.length - 1; i >= 0; i--) {
      let box = heads[i];
      for (let d = 0; d < 6 && box.parentElement; d++) {
        box = box.parentElement;
        const btns = box.querySelectorAll ? box.querySelectorAll('button') : [];
        for (let j = 0; j < btns.length; j++) {
          const t = (btns[j].getAttribute('title') || '') + '|' + text(btns[j]);
          if (ACT_TITLES.some((x) => t.indexOf(x) >= 0)) return btns[j];
        }
      }
    }
    return null;
  }

  async function runPlan(alreadyOpen) {
    const raw = sget(PLAN);
    if (!raw && !alreadyOpen) return false;
    let plan = {};
    try { plan = JSON.parse(raw || '{}'); } catch (e) { plan = {}; }
    if (plan.tries > 3 || (plan.when && Date.now() - plan.when > 15 * 60 * 1000)) { sset(PLAN, null); log('giving up on the hand-off'); return false; }
    /* the plan survives a failed attempt: the app only shows patterns it read at
       mount time, so a retry after the next load is what makes this self-healing */
    if (raw) sset(PLAN, JSON.stringify({ sig: plan.sig, name: plan.name, id: plan.id, when: plan.when || Date.now(), tries: (plan.tries || 0) + 1 }));
    const done = () => { sset(PLAN, null); };
    const A = api();
    if (!A) { sset(PLAN, raw); return false; }
    if (!alreadyOpen) {
      const open = await waitFor(() => document.getElementById('btn-header-settings') || byLabel('تنظیمات'), 12000);
      if (!open) { log('settings button never appeared'); return false; }
      open.click();
    }
    const tab = await waitFor(() => byLabel(TAB_LABEL), 4000);
    if (tab) tab.click();
    const action = await waitFor(() => patternAction(plan.name), 5000);
    if (!action) { note('الگوی استخراج‌شده در کتابخانه دیده نشد؛ از «' + TAB_LABEL + '» دستی «انتخاب به عنوان مرجع» را بزنید.'); log('pattern card not found for', plan.name); return false; }
    action.click();
    done();
    log('applied as reference and started the DNA search for', plan.name);
    note('✓ جستجوی DNA روی ' + ((api().result() || {}).bars || []).length + ' کندلِ استخراج‌شده از تصویر اجرا شد');
    if (card) { const b = card.querySelector('[data-act="search"]'); if (b) b.textContent = 'جستجو دوباره'; }
    return true;
  }

  /* ------------------------------------------------------------- startup */
  async function boot() {
    while (!api()) await sleep(100);
    ensureCard(null, null);                                   // show the card as soon as a panel exists
    const root = document.getElementById('root') || document.body;
    let stamp = 0;
    new MutationObserver(() => {
      const now = Date.now();
      if (now - stamp < 400) return;
      stamp = now;
      if (!document.getElementById(CARD_ID)) { card = null; ensureCard(null, null); }
    }).observe(root, { childList: true, subtree: true });
    await sleep(600);
    if (!document.getElementById(CARD_ID)) ensureCard(null, null);
    const st = stateLine();
    if (st && !card.__done) setStatus(st);
    setInterval(() => {
      const l = stateLine();
      const el = document.getElementById('ohlc-auto-status');
      if (l && el && !A_busy() && (Date.now() - (lastSeen ? lastSeen.at : 0) > 4000)) el.textContent = l;
    }, 2500);
    await runPlan(false);
    function A_busy() { const A = api(); return !!(A && A.busy()); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);

  window.ChartDnaOhlcAuto = {
    version: 1,
    config: { auto: CFG_AUTO, run: CFG_RUN },
    enable: () => set(CFG_AUTO, '1'),
    disable: () => set(CFG_AUTO, '0'),
    extract: handle,
    runPlan
  };
})();
