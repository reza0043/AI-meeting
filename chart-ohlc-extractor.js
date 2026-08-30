/* Chart DNA — «ورود تصویر» (UI layer)
 * Runs the pixel-measurement engine (chart-ohlc-engine.js) on a chart
 * screenshot, shows the reconstructed candlestick chart, and can register the
 * result as a Chart DNA dataset so the pattern / history search runs on it.
 * The window is named after what it is for: an image goes in, candles come out.
 * It is read-only by design: the extracted candles, the CSV and the annotated
 * picture stay on this page — nothing here writes into the app's dataset store,
 * its pattern library or its search.
 * It has no button of its own: the app's picture-icon key in the recorder-like play
 * strip (#btn-import-image, «ورود تصویر چارت») opens this environment instead of the
 * device storage, and the screenshot is chosen here. The key keeps its icon, name and
 * markup; only where it leads is different (see the deck block near the bottom).
 * Everything happens in the browser: no image and no number leaves the page.
 */
(() => {
  const STYLE = `
  #ohlc-modal{display:none;position:fixed;inset:0;background:#020617e6;backdrop-filter:blur(8px);z-index:2147483647;align-items:flex-start;justify-content:center;padding:14px;overflow:auto}
  #ohlc-card{width:min(1080px,97vw);background:#0b1220;color:#e5e7eb;border:1px solid #334155;border-radius:18px;padding:16px;box-shadow:0 25px 80px #000a;font-family:inherit}
  #ohlc-card h2{margin:0;font-size:19px}
  .ohlc-muted{color:#94a3b8;font-size:12.5px;line-height:1.7}
  .ohlc-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px}
  .ohlc-box{border:1px solid #243244;border-radius:12px;padding:11px;background:#0f172a}
  .ohlc-box h3{margin:0 0 8px;font-size:13px;color:#cbd5e1}
  .ohlc-box label{display:block;font-size:11.5px;color:#94a3b8;margin:7px 0 4px}
  .ohlc-box input,.ohlc-box select{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:9px;padding:8px;font-size:12.5px;font-family:inherit}
  /* the six keys sit in one row, exactly like #remote-control-deck: 36px tall, rounded,
     equal widths, icon only; the values below are the same numbers the app's utilities give
     (flex-1 / h-9 / rounded-lg / gap-1 / p-1.5), so the row looks the same with or without them */
  #ohlc-bar{margin:10px 0 2px;background:#0e1826f0;border-color:#1e293b;gap:4px;padding:6px}
  .ohlc-dk{box-sizing:border-box;flex:1 1 0;min-width:0;min-height:36px;border:1px solid #334155;border-radius:8px;
           background:#111d2ecc;color:#cbd5e1;cursor:pointer;display:flex;align-items:center;justify-content:center;
           transition:all .15s ease;font:inherit}
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
  .ohlc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .ohlc-actions button{border:0;border-radius:10px;padding:10px 13px;cursor:pointer;font-weight:700;font-family:inherit;font-size:12.5px}
  .ohlc-actions button:disabled{opacity:.45;cursor:not-allowed}
  .ohlc-secondary{background:#1e293b;color:#e2e8f0}
  .ohlc-refrow{display:grid;grid-template-columns:1fr 1fr auto auto;gap:6px;margin-top:8px}
  .ohlc-refrow input{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:9px;padding:8px;font:inherit}
  .ohlc-refrow button{white-space:nowrap;padding:8px 10px;font-size:12px}
  #ohlc-points input{background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:6px;font:inherit}
  #ohlc-points button{background:#1e293b;color:#e2e8f0;border:0;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer}
  /* the three views share one frame: same box, same ratio, same length of the series.
     the card rhythm (340px, 390px when there is room) is the one the app's own chart cards
     use, and object-fit keeps the picture whole — so the page reads as one grid, not two */
  #ohlc-chart,#ohlc-orig,#ohlc-ann{width:100%;height:auto;object-fit:contain;box-sizing:border-box;border:1px solid #334155;border-radius:10px;background:#0b1220;display:block;margin-top:8px}
  @media(min-width:820px){#ohlc-chart,#ohlc-orig,#ohlc-ann{min-height:340px;max-height:390px}}
  #ohlc-status{margin-top:10px;color:#a7f3d0;font-size:12.5px;white-space:pre-wrap;line-height:1.7}
  .ohlc-warn{color:#fbbf24}.ohlc-err{color:#fca5a5}
  .ohlc-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11.5px;font-variant-numeric:tabular-nums}
  .ohlc-table th,.ohlc-table td{padding:5px 6px;border-bottom:1px solid #1e293b;text-align:right}
  .ohlc-table th{color:#94a3b8;font-weight:600}
  .ohlc-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px;margin-top:8px}
  .ohlc-kv b{color:#94a3b8;font-weight:600}
  .ohlc-hidden{display:none!important}
  @media(max-width:820px){.ohlc-grid{grid-template-columns:1fr}}
  `;
  const T = {
    title: 'ورود تصویر',
    run: 'استخراج کندل‌ها', csv: 'دانلود CSV', png: 'دانلود تصویر حاشیه‌نویسی‌شده',
    confirm: 'تأیید و بازگشت به صفحهٔ برنامه',
    busy: 'در حال پردازش…', pickHint: 'تصویر اسکرین‌شات چارت را از حافظه انتخاب کنید',
    calibNote: 'برای کالیبراسیون دستی، روی خط‌های راهنمای محور قیمت در تصویر کلیک کنید و مقدارش را وارد کنید.'
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
    check: LUCIDE('circle-check', '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>')
  };
  const keyHtml = (attr, ico, text) => '<button class="ohlc-dk ' + DECK_KEY + '" ' + attr +
    ' title="' + text + '" aria-label="' + text + '">' + ico + '</button>';

  const modal = document.createElement('div');
  modal.id = 'ohlc-modal';
  modal.innerHTML = `
  <div id="ohlc-card" dir="rtl">
    <h2>${T.title}</h2>
    <div class="ohlc-grid" style="margin-top:12px">
      <div>
        <div class="ohlc-bar w-full border rounded-xl p-1.5 flex items-center justify-between gap-1 shadow-md backdrop-blur-md transition-colors" id="ohlc-bar">
          ${keyHtml('id="ohlc-drop" type="button"', ICO.img, DROP_HINT)}
          ${keyHtml('id="ohlc-run" type="button"', ICO.scan, T.run)}
          ${keyHtml('data-view="chart" type="button" aria-selected="true"', ICO.bars, 'کندل‌های بازسازی‌شده')}
          ${keyHtml('data-view="orig" type="button" aria-selected="false"', ICO.eye, 'تصویر اصلی')}
          ${keyHtml('data-view="ann" type="button" aria-selected="false"', ICO.cross, 'تصویر با مارک‌ها')}
          ${keyHtml('id="ohlc-confirm" type="button" disabled', ICO.check, T.confirm)}
        </div>
        <input id="ohlc-file" type="file" accept="image/*" class="ohlc-hidden">
        <canvas id="ohlc-chart"></canvas>
        <canvas id="ohlc-orig" class="ohlc-hidden"></canvas>
        <canvas id="ohlc-ann" class="ohlc-hidden"></canvas>
      </div>
      <div>
        <div class="ohlc-box">
          <h3>برچسب دیتاست</h3>
          <label>نماد (از خود تصویر، فقط برای نام‌گذاری)</label><input id="ohlc-symbol" placeholder="XAUUSD">
          <label>تایم‌فریم</label>
          <select id="ohlc-tf"><option>M1</option><option>M5</option><option>M15</option><option>M30</option><option selected>H1</option><option>H4</option><option>D1</option></select>
          <label>تاریخ اولین کندل (اختیاری — بدون آن Date خالی می‌ماند)</label><input id="ohlc-d0" type="date">
          <label>تاریخ آخرین کندل (اختیاری؛ اگر پر شود تقسیم‌بندی روزها از روی آن حساب می‌شود)</label><input id="ohlc-d1" type="date">
          <label>شروع ساعت اولین کندل (اختیاری، HH:MM — برای پر کردن Time)</label><input id="ohlc-t0" placeholder="00:00">
        </div>
        <div class="ohlc-box" style="margin-top:10px">
          <h3>کالیبراسیون محور قیمت</h3>
          <div class="ohlc-muted">${T.calibNote}</div>
          <div class="ohlc-refrow">
            <input id="ohlc-ref-row" type="number" step="0.1" placeholder="ردیف پیکسلی (y)">
            <input id="ohlc-ref-price" type="number" step="0.01" placeholder="قیمت آن ردیف">
            <button class="ohlc-secondary" id="ohlc-ref-add" type="button">افزودن مرجع</button>
            <button class="ohlc-secondary" id="ohlc-ref-clear" type="button">پاک‌کردن</button>
          </div>
          <div id="ohlc-points" class="ohlc-kv"></div>
        </div>
        <div class="ohlc-box" style="margin-top:10px">
          <h3>خروجی</h3>
          <div id="ohlc-status" class="ohlc-muted">هنوز تصویری انتخاب نشده.</div>
        </div>
      </div>
    </div>
    <div id="ohlc-table"></div>
    <div class="ohlc-actions">
      <button class="ohlc-secondary" id="ohlc-csv" disabled>${T.csv}</button>
      <button class="ohlc-secondary" id="ohlc-png" disabled>${T.png}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const $ = (id) => document.getElementById(id);   /* the open button lives outside the modal */
  const state = { img: null, result: null, templates: null, points: [], running: false, imgKey: null, confirmedKey: null };

  /* remember the label fields, the panel is closed between uploads */
  const FORM = 'chartdna_ohlc_form';
  (function restoreForm() {
    try {
      const f = JSON.parse(localStorage.getItem(FORM) || 'null');
      if (f) { ['ohlc-symbol', 'ohlc-tf', 'ohlc-d0', 'ohlc-d1', 'ohlc-t0'].forEach((k) => { if (f[k] != null && $(k)) $(k).value = f[k]; }); }
    } catch (e) { /* ignore */ }
  })();
  ['ohlc-symbol', 'ohlc-tf', 'ohlc-d0', 'ohlc-d1', 'ohlc-t0'].forEach((k) => {
    const el = $(k); if (!el) return;
    el.addEventListener('change', () => {
      try {
        const f = {};
        ['ohlc-symbol', 'ohlc-tf', 'ohlc-d0', 'ohlc-d1', 'ohlc-t0'].forEach((j) => { f[j] = $(j) ? $(j).value : ''; });
        localStorage.setItem(FORM, JSON.stringify(f));
      } catch (e) { /* ignore */ }
    });
  });

  /* ------------------------------------------------------------ open/close */
  const show = (v) => { modal.style.display = v ? 'flex' : 'none'; };

  /* the sixth key: «تأیید» — what was measured is accepted, the window closes and the
     user is back on the app's first page. Nothing is written into the app: the candles,
     the CSV and the marked picture stay here, exactly as before */
  function confirmFlow() {
    const has = !!(state.result && state.result.bars && state.result.bars.length);
    if (has) {
      state.confirmedKey = state.imgKey || null;
      try {
        const r = window.__ohlcReport;
        if (r) { r.confirmedAt = new Date().toISOString(); r.confirmedCandles = state.result.bars.length; }
      } catch (e) { /* our own note, never a write into the app */ }
      status('روند تأیید شد — ' + state.result.bars.length + ' کندل؛ پنجره بسته شد و به صفحهٔ برنامه برگشتید. ' +
        'با همان کلید «ورود تصویر چارت» می‌توانید ادامه دهید.');
    } else {
      status('چیزی استخراج نشده بود؛ پنجره بسته شد.');
    }
    show(false);
    return has;
  }
  $('ohlc-confirm').addEventListener('click', confirmFlow);
  modal.addEventListener('click', (e) => { if (e.target === modal) show(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false); });

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
      state.img = im;
      state.imgKey = sigOf(src);
      state.confirmedKey = null;
      $('ohlc-confirm').disabled = true;
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
    return box;
  }
  function drawOriginal() {
    const im = state.img;
    if (!im) return;
    paintInto($('ohlc-orig'), im);
    paintInto($('ohlc-chart'), null);      /* the same frame, empty until the run */
    paintInto($('ohlc-ann'), null);
    setView('orig');
  }

  /* --------------------------------------------------- manual axis anchors */
  /* object-fit:contain can leave a band around the picture: map the pointer onto the
     picture itself, and let a click on the band say so instead of inventing a row */
  function contentBox(cv, r) {
    if (!cv.width || !cv.height || !r.width || !r.height) return null;
    const k = Math.min(r.width / cv.width, r.height / cv.height);
    return { k, ox: (r.width - cv.width * k) / 2, oy: (r.height - cv.height * k) / 2 };
  }
  $('ohlc-orig').addEventListener('click', (e) => {
    const cv = $('ohlc-orig'), r = cv.getBoundingClientRect();
    const m = contentBox(cv, r);
    const sc = state.img ? state.img.naturalHeight / cv.height : 1;
    let by;
    if (!m) by = e.clientY - r.top;                                      /* no layout to map */
    else {
      const bx = (e.clientX - r.left - m.ox) / m.k;
      by = (e.clientY - r.top - m.oy) / m.k;
      if (bx < 0 || by < 0 || bx > cv.width || by > cv.height) {
        status('برای نقطهٔ مرجع روی خودِ تصویر کلیک کنید، نه روی حاشیهٔ کادر.', 'warn');
        return;
      }
    }
    const y = Math.round(by * sc);
    state.points.push({ row: y, price: '', source: 'manual-click' });
    renderPoints();
    status('نقطهٔ مرجع در ردیف ' + y + ' اضافه شد — قیمتش را وارد کنید.');
  });
  /* typing the row works when clicking is impractical (retina shots, no pointer) */
  $('ohlc-ref-add').addEventListener('click', () => {
    const row = parseFloat($('ohlc-ref-row').value), price = parseFloat($('ohlc-ref-price').value);
    if (!isFinite(row) || row <= 0) { status('شمارهٔ ردیف معتبر نیست.', 'err'); return; }
    state.points.push({ row: Math.round(row), price: isFinite(price) ? String(price) : '', source: 'manual-typed' });
    renderPoints();
    $('ohlc-ref-row').value = ''; $('ohlc-ref-price').value = '';
    status('مرجع دستی در ردیف ' + Math.round(row) + (isFinite(price) ? ' با قیمت ' + price : ' (بدون قیمت)') +
      ' ثبت شد. «استخراج کندل‌ها» را دوباره بزنید تا اعمال شود.');
  });
  $('ohlc-ref-clear').addEventListener('click', () => {
    state.points = []; renderPoints();
    status('همهٔ مراجع دستی پاک شد — استخراج بعدی فقط از برچسب‌های خود محور استفاده می‌کند.');
  });
  function renderPoints() {
    const box = $('ohlc-points');
    if (!state.points.length) { box.innerHTML = ''; return; }
    box.innerHTML = state.points.map((p, i) =>
      `<b>ردیف ${p.row}</b><span><input data-i="${i}" type="number" step="0.01" placeholder="قیمت این خط" value="${p.price}"><button data-del="${i}" type="button">حذف</button></span>`).join('');
    box.querySelectorAll('button[data-del]').forEach((b) => b.addEventListener('click', () => {
      state.points.splice(+b.dataset.del, 1); renderPoints();
      status('مرجع حذف شد — «استخراج کندل‌ها» را دوباره بزنید.');
    }));
    box.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', (e) => {
      state.points[+e.target.dataset.i].price = e.target.value;
    }));
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
    ['ohlc-csv', 'ohlc-png'].forEach((id) => { $(id).disabled = true; });
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
      const extra = state.points.filter((p) => p.price !== '' && +p.price > 0)
        .map((p) => ({ row: p.row / scale, price: +p.price, source: p.source || 'manual-click' }));
      const res = window.ChartDNACV.extract(cx.getImageData(0, 0, w, h), { templates: state.templates, extraRefs: extra });
      res.scale = scale;
      state.result = res;
      if (!res.ok) { state.running = false; status('خطا: ' + res.error, 'err'); return res; }
      applyDates(res);
      const ms = Math.round(performance.now() - t0);
      report(res, ms);
      try { drawResults(res); } catch (e) { console.warn('preview rendering failed:', e); }
      ['ohlc-csv', 'ohlc-png'].forEach((id) => { $(id).disabled = !(res.calibration && res.calibration.detected); });
      if (!(res.calibration && res.calibration.detected)) status(summaryText(res, ms) + '\nمحور قیمت خوانده نشد؛ مقادیر عددی ساخته نمی‌شوند. ردیف‌های مرجع را دستی اضافه کنید و دوباره استخراج کنید.', 'warn');
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
    $('ohlc-confirm').disabled = !(res.bars && res.bars.length);
    const rows = res.bars.slice(0, 14).concat(res.bars.length > 16 ? [{ candle: '…' }] : []).concat(res.bars.slice(-4));
    $('ohlc-table').innerHTML = '<table class="ohlc-table"><thead><tr><th>#</th><th>Date</th><th>O</th><th>H</th><th>L</th><th>C</th><th>Dir</th><th>Conf</th><th>note</th></tr></thead><tbody>' +
      rows.map((b) => b.candle === '…' ? '<tr><td colspan=9 style="text-align:center">…</td></tr>'
        : `<tr><td>${b.candle}</td><td>${b.date || ''}</td><td>${f(b.open)}</td><td>${f(b.high)}</td><td>${f(b.low)}</td><td>${f(b.close)}</td><td>${b.direction || ''}</td><td>${b.confidence == null ? '' : b.confidence}</td><td style="text-align:right;color:#94a3b8">${(b.notes || []).join('; ')}</td></tr>`).join('') +
      '</tbody></table>';
  }
  const f = (v) => v == null ? '—' : v.toFixed(2);

  /* ------------------------------------------------------------- dates ---- */
  /* Only from anchors the user supplies — never invented. */
  function applyDates(res) {
    const d0 = $('ohlc-d0').value, d1 = $('ohlc-d1').value, t0 = $('ohlc-t0').value;
    const ok = res.bars.filter((b) => b.status === 'ok');
    if (!ok.length) return;
    const tf = $('ohlc-tf').value, mins = ({ M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 })[tf] || 60;
    if (d0 && d1) {
      const a = Date.parse(d0 + 'T00:00:00Z'), b = Date.parse(d1 + 'T00:00:00Z');
      let days = 0, t = a;
      const list = [];
      while (t <= b && days < 400) { list.push(t); t += 86400000; days++; }
      const trading = list.filter((x) => { const d = new Date(x).getUTCDay(); return d !== 0 && d !== 6; });
      if (trading.length >= 1) {
        const perDay = (ok.length - 1) / Math.max(1, trading.length - 1);
        ok.forEach((bar, i) => {
          const di = Math.min(trading.length - 1, Math.round(i / perDay));
          bar.date = new Date(trading[di]).toISOString().slice(0, 10);
          bar.notes.push('date interpolated between the two dates you provided');
        });
        res.dateMode = 'two anchors';
      }
    } else if (d0) {
      const start = Date.parse(d0 + 'T00:00:00Z' + (t0 ? '' : ''));
      let t = Date.parse(d0 + 'T' + (/^\d\d:\d\d$/.test(t0) ? t0 : '00:00') + ':00Z');
      ok.forEach((bar, i) => {
        const d = new Date(t + i * mins * 60000);
        bar.date = d.toISOString().slice(0, 10);
        bar.time = d.toISOString().slice(11, 16);
        if (i === 0) bar.notes.push('clock-time assumption from the anchor you provided');
      });
      res.dateMode = 'start anchor + timeframe (' + mins + ' min)';
      void start;
    } else if (res.geometry.verticalGridlines && res.geometry.verticalGridlines.length >= 2) {
      res.dateMode = 'no date anchor (axis gridlines are available as anchors)';
    } else res.dateMode = 'no';
  }

  /* -------------------------------------------------------------- report -- */
  function summaryText(res, ms) {
    const g = res.geometry, c = res.calibration, q = res.quality;
    const lines = [];
    lines.push(`کندل‌ها: ${res.bars.length} (قابل اندازه‌گیری: ${res.bars.filter((b) => b.status === 'ok').length}، نامکمل: ${res.missing})  ·  زمان: ${ms} ms`);
    lines.push(`شبکهٔ کندل: فاصلهٔ ${g.pitch} پیکسل، مرکز کندل k = ${g.x0} + ${g.pitch}×k  ·  پنل ردیف ${g.paneTop}–${g.paneBot}  ·  داده x=${g.dataX0}–${g.dataX1}  ·  پیکربندی بدنه ${g.bodyWidthPx}px، پنجرهٔ اندازه‌گیری ±${g.bodyHalf}px`);
    if (c && c.detected) {
      lines.push(`محور قیمت: ${c.modelChoice} — ${c.equation}`);
      lines.push('مراجع: ' + c.refs.map((r) => `${r.price}@y${r.row}${r.repaired ? '*' : ''}[${r.source}]`).join('  ·  '));
      lines.push(`بازماندهٔ رگرسیون: RMS ${c.residualUSD} USD  ·  ۱ پیکسل ≈ ${q.usdPerPx} USD`);
      if (c.tagCheck) lines.push(`آزمون مستقل (برچسب قیمت): اندازه‌گیری‌شده ${c.tagCheck.measured} در برابر ${c.tagCheck.tagPrice} → خطا ${c.tagCheck.errorUSD} USD`);
      if (c.repairs && c.repairs.length) lines.push('ارزش‌های تراز شده با فاصلهٔ مرتبهٔ ۱۰: ' + c.repairs.length);
    } else lines.push('محور قیمت خوانده نشد → مقادیر Open/High/Low/Close خالی است.');
    lines.push(`کیفیت: میانگین اطمینان ${q.meanConfidence}، کمینه ${q.minConfidence}، نیازمند بازبینی ${q.needReview.length} کندل${q.needReview.length ? ' (#' + q.needReview.slice(0, 14).join(', #') + (q.needReview.length > 14 ? '…' : '') + ')' : ''}`);
    lines.push(`پیوستگی همسایه‌ها (close→open): میانه ${q.continuityMedianUSD}، ٪۹۰ ${q.continuityP90USD}، بیشینه ${q.continuityMaxUSD} USD — پرش‌های بزرگ معمولاً شکاف نشست معاملاتی یا انبوهی پیکسل‌اند.`);
    lines.push('محدودیت‌ها: دقت به گام ۱ پیکسل محدود است؛ حجم استخراج نمی‌شود؛ این بازسازی هندسی است، نه تحلیل تکنیکال.');
    if (res.dateMode) lines.push('تاریخ‌ها: ' + res.dateMode);
    return lines.join('\n');
  }
  function report(res, ms) {
    status(summaryText(res, ms));
    window.__ohlcReport = {
      when: new Date().toISOString(),
      source: { symbol: $('ohlc-symbol').value, timeframe: $('ohlc-tf').value },
      result: JSON.parse(JSON.stringify(res, (k, v) => (k === 'bars' ? undefined : v))),
      bars: JSON.parse(JSON.stringify(res.bars)),
      pixels: state.img ? { width: state.img.naturalWidth, height: state.img.naturalHeight } : null,
      durationMs: ms
    };
  }

  /* ------------------------------------------------------------ downloads */
  $('ohlc-csv').addEventListener('click', () => {
    const csv = window.ChartDNACV.toCSV(state.result);
    const sym = ($('ohlc-symbol').value || '').trim();
    dl(sym || 'chart', 'csv', csv);
  });
  $('ohlc-png').addEventListener('click', () => {
    if (state.img && state.result) {                 /* the view is capped, the file is not */
      try {
        const full = document.createElement('canvas');
        window.ChartDNACV.renderAnnotated(full, state.img, state.result);
        full.toBlob((b) => dlBlob('annotated', 'png', b), 'image/png');
        return;
      } catch (e) { console.warn(e); }
    }
    const cv = $('ohlc-ann');
    if (cv.width) cv.toBlob((b) => dlBlob('annotated', 'png', b), 'image/png');
  });
  function dl(name, ext, text) {
    dlBlob(name, ext, new Blob([text], { type: ext === 'csv' ? 'text/csv' : 'application/octet-stream' }));
  }
  function dlBlob(name, ext, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(name || 'ohlc').replace(/[^\w.-]+/g, '_')}_ohlc_from_image.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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
  function deckLabel() { const k = deckKey(); return k ? ((k.getAttribute('title') || k.textContent || '').trim() || DECK_ID) : ''; }
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
  document.addEventListener('click', (e) => {
    if (!takeoverOn() || !isDeckKey(e.target)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();   /* the storage dialog stays closed */
    show(true);
    status(T.pickHint + (deckLabel() ? ' — اینجا همان کاری است که کلید «' + deckLabel() + '» به آن می‌آید' : ''));
  }, true);
  /* a picture handed to us from anywhere else (a paste, a seam call) is still measured */
  async function onPickedImage(url) {
    if (!url || typeof url !== 'string' || url.indexOf('data:image') !== 0) return;
    await new Promise((done) => loadImage(url, done));
    await run(sigOf(url));
    show(true);
  }

  window.ChartDnaOhlc = {
    version: 13,
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
