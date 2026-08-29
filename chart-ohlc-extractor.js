/* Chart DNA — image → OHLC tool (UI layer)
 * Runs the pixel-measurement engine (chart-ohlc-engine.js) on a chart
 * screenshot, shows the reconstructed candlestick chart, and can register the
 * result as a Chart DNA dataset so the pattern / history search runs on it.
 * Everything happens in the browser: no image and no number leaves the page.
 */
(() => {
  const STYLE = `
  #ohlc-tool{position:fixed;right:18px;bottom:82px;z-index:2147483647;font-family:Vazirmatn,Inter,system-ui,sans-serif}
  #ohlc-open{background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;padding:11px 14px;box-shadow:0 8px 30px #0008;cursor:pointer;font-weight:700;font-family:inherit}
  #ohlc-modal{display:none;position:fixed;inset:0;background:#020617e6;backdrop-filter:blur(8px);z-index:2147483647;align-items:flex-start;justify-content:center;padding:14px;overflow:auto}
  #ohlc-card{width:min(1080px,97vw);background:#0b1220;color:#e5e7eb;border:1px solid #334155;border-radius:18px;padding:16px;box-shadow:0 25px 80px #000a;font-family:inherit}
  #ohlc-card h2{margin:0 0 6px;font-size:19px}
  .ohlc-muted{color:#94a3b8;font-size:12.5px;line-height:1.7}
  .ohlc-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px}
  .ohlc-box{border:1px solid #243244;border-radius:12px;padding:11px;background:#0f172a}
  .ohlc-box h3{margin:0 0 8px;font-size:13px;color:#cbd5e1}
  .ohlc-box label{display:block;font-size:11.5px;color:#94a3b8;margin:7px 0 4px}
  .ohlc-box input,.ohlc-box select{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:9px;padding:8px;font-size:12.5px;font-family:inherit}
  .ohlc-drop{border:1.5px dashed #334155;border-radius:12px;padding:16px;text-align:center;color:#94a3b8;font-size:13px;cursor:pointer}
  .ohlc-drop.ohlc-over{border-color:#10b981;color:#a7f3d0}
  .ohlc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .ohlc-actions button{border:0;border-radius:10px;padding:10px 13px;cursor:pointer;font-weight:700;font-family:inherit;font-size:12.5px}
  .ohlc-actions button:disabled{opacity:.45;cursor:not-allowed}
  .ohlc-primary{background:#10b981;color:#04130e}.ohlc-secondary{background:#1e293b;color:#e2e8f0}.ohlc-danger{background:#7f1d1d;color:#fecaca}
  .ohlc-refrow{display:grid;grid-template-columns:1fr 1fr auto auto;gap:6px;margin-top:8px}
  .ohlc-refrow input{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:9px;padding:8px;font:inherit}
  .ohlc-refrow button{white-space:nowrap;padding:8px 10px;font-size:12px}
  #ohlc-points input{background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:6px;font:inherit}
  #ohlc-points button{background:#1e293b;color:#e2e8f0;border:0;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer}
  #ohlc-orig,#ohlc-ann{max-width:100%;border-radius:10px;border:1px solid #334155;display:block;margin-top:8px}
  #ohlc-chart{width:100%;height:300px;border:1px solid #243244;border-radius:10px;background:#0b1220;display:block;margin-top:8px}
  #ohlc-status{margin-top:10px;color:#a7f3d0;font-size:12.5px;white-space:pre-wrap;line-height:1.7}
  .ohlc-warn{color:#fbbf24}.ohlc-err{color:#fca5a5}
  .ohlc-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11.5px;font-variant-numeric:tabular-nums}
  .ohlc-table th,.ohlc-table td{padding:5px 6px;border-bottom:1px solid #1e293b;text-align:right}
  .ohlc-table th{color:#94a3b8;font-weight:600}
  .ohlc-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px;margin-top:8px}
  .ohlc-kv b{color:#94a3b8;font-weight:600}
  .ohlc-tabs{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
  .ohlc-tabs button{background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:9px;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit}
  .ohlc-tabs button[aria-selected=true]{background:#10b981;color:#04130e;border-color:#10b981;font-weight:700}
  .ohlc-hidden{display:none!important}
  @media(max-width:820px){.ohlc-grid{grid-template-columns:1fr}#ohlc-tool{right:10px;bottom:74px}}
  #ohlc-tool.ohlc-pinned{right:auto;bottom:auto}
  #ohlc-tool.ohlc-pinned #ohlc-open{display:flex;align-items:center;gap:7px;min-height:40px;padding:8px 13px;border-radius:999px;background:#020617eb;border:1px solid #10b981;color:#a7f3d0;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);box-shadow:0 6px 22px #000b;font-size:12.5px;line-height:1.2}
  #ohlc-tool.ohlc-pinned #ohlc-open b{color:#34d399;font-weight:800;font-variant-numeric:tabular-nums}
  #ohlc-tool.ohlc-pinned #ohlc-open:active{transform:scale(.97)}
  #ohlc-tool.ohlc-pinned #ohlc-open[disabled]{opacity:.7}
  `;
  const T = {
    open: '📈 استخراج OHLC از تصویر',
    title: 'بازسازی OHLC از اسکرین‌shot نمودار',
    sub: 'اندازه‌گیری روی پیکسل‌ها (computer vision). هیچ قیمتی از اینترنت یا حافظهٔ مدل نمی‌آید؛ هر چیزی که در تصویر نباشد خالی می‌ماند.',
    run: 'استخراج کندل‌ها', csv: 'دانلود CSV', png: 'دانلود تصویر حاشیه‌نویسی‌شده',
    save: 'ثبت به‌عنوان دیتاست Chart DNA', saveSearch: 'ثبت و اجرای جستجو', close: 'بستن',
    busy: 'در حال پردازش…', grab: 'استفاده از تصویری که در برنامه آپلود کرده‌اید',
    calibNote: 'برای کالیبراسیون دستی، روی خط‌های راهنمای محور قیمت در تصویر کلیک کنید و مقدارش را وارد کنید.'
  };
  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);

  const rootEl = document.createElement('div');
  rootEl.id = 'ohlc-tool';
  rootEl.innerHTML = `<button id="ohlc-open" title="استخراج OHLC از اسکرین‌شات نمودار">${T.open}</button>`;
  document.body.appendChild(rootEl);

  const modal = document.createElement('div');
  modal.id = 'ohlc-modal';
  modal.innerHTML = `
  <div id="ohlc-card" dir="rtl">
    <h2>${T.title}</h2>
    <div class="ohlc-muted">${T.sub}</div>
    <div class="ohlc-grid" style="margin-top:12px">
      <div>
        <div class="ohlc-drop" id="ohlc-drop">تصویر نمودار را اینجا رها کنید، یا کلیک کنید و فایل را انتخاب کنید (می‌توانید تصویر را با Ctrl+V هم بچسبانید)
          <input id="ohlc-file" type="file" accept="image/*" class="ohlc-hidden">
        </div>
        <div class="ohlc-actions" style="margin-top:8px">
          <button class="ohlc-secondary" id="ohlc-grab">${T.grab}</button>
          <button class="ohlc-primary" id="ohlc-run">${T.run}</button>
        </div>
        <canvas id="ohlc-orig" class="ohlc-hidden"></canvas>
        <canvas id="ohlc-ann" class="ohlc-hidden"></canvas>
        <div class="ohlc-tabs">
          <button data-view="chart" aria-selected="true">کندل‌های بازسازی‌شده</button>
          <button data-view="orig">تصویر اصلی</button>
          <button data-view="ann">تصویر با مارک‌ها</button>
        </div>
        <canvas id="ohlc-chart" width="1000" height="300"></canvas>
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
          <h3>اتصال به موتور Chart DNA</h3>
          <label style="display:flex;gap:7px;align-items:center;margin:2px 0"><input type="checkbox" id="ohlc-opt-pattern" checked style="width:auto"><span>الگوی بازسازی‌شده (سری قیمت بسته‌شدن) به کتابخانهٔ الگوها اضافه شود تا جستجوی DNA روی آن کار کند</span></label>
          <label style="display:flex;gap:7px;align-items:center;margin:2px 0"><input type="checkbox" id="ohlc-opt-replace" style="width:auto"><span>فقط این دیتاست انتخاب شود (اگر تیک نزند، به انتخاب‌های فعلی اضافه می‌شود)</span></label>
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
      <button class="ohlc-primary" id="ohlc-save" disabled>${T.save}</button>
      <button class="ohlc-primary" id="ohlc-save-search" disabled>${T.saveSearch}</button>
      <button class="ohlc-danger" id="ohlc-close">${T.close}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const $ = (id) => document.getElementById(id);   /* the open button lives outside the modal */
  const state = { img: null, result: null, templates: null, points: [], datasetId: null, running: false, imgKey: null };

  /* remember the label fields: the autopilot reloads the page once per image */
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
  const show = (v) => { modal.style.display = v ? 'flex' : 'none'; if (rootEl) rootEl.style.visibility = v ? 'hidden' : ''; };
  $('ohlc-open').addEventListener('click', () => show(true));
  rootEl.addEventListener('click', (e) => { if (e.target === rootEl) show(false); });
  $('ohlc-close').addEventListener('click', () => show(false));
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
      try { URL.revokeObjectURL(src); } catch (e) { /* not a blob url */ }
      drawOriginal();
      done && done();
    };
    im.onerror = () => status('بارگذاری تصویر ناموفق بود (ممکن است blob منقضی شده باشد؛ تصویر را دوباره انتخاب کنید).', 'err');
    im.src = src;
  }
  function drawOriginal() {
    const cv = $('ohlc-orig'), im = state.img;
    if (!im) return;
    const s = Math.min(1, 1400 / Math.max(im.naturalWidth, 1));
    cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
    cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
    setView('orig');
  }
  $('ohlc-grab').addEventListener('click', () => {
    const imgs = Array.prototype.slice.call(document.querySelectorAll('img'))
      .filter((i) => /^(blob:|data:)/.test(i.currentSrc || i.src) && i.naturalWidth > 260);
    if (!imgs.length) { status('تصویری که داخل برنامه آپلود کرده‌اید پیدا نشد؛ فایل را همین‌جا انتخاب کنید.', 'warn'); return; }
    imgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
    state.img = imgs[0];
    drawOriginal();
    status('تصویر از پنل برنامه برداشته شد: ' + imgs[0].naturalWidth + '×' + imgs[0].naturalHeight + ' پیکسل.');
  });

  /* --------------------------------------------------- manual axis anchors */
  $('ohlc-orig').addEventListener('click', (e) => {
    const cv = $('ohlc-orig'), r = cv.getBoundingClientRect();
    const sc = state.img ? state.img.naturalHeight / cv.height : 1;
    const y = Math.round((e.clientY - r.top) * sc);
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
    ['ohlc-csv', 'ohlc-png', 'ohlc-save', 'ohlc-save-search'].forEach((id) => { $(id).disabled = true; });
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
      ['ohlc-csv', 'ohlc-png', 'ohlc-save', 'ohlc-save-search'].forEach((id) => { $(id).disabled = !(res.calibration && res.calibration.detected); });
      if (!(res.calibration && res.calibration.detected)) status(summaryText(res, ms) + '\nمحور قیمت خوانده نشد؛ مقادیر عددی ساخته نمی‌شوند. برای ثبت دیتاست، ردیف‌های مرجع را دستی کلیک کنید و دوباره استخراج کنید.', 'warn');
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
    modal.querySelectorAll('.ohlc-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    if (v === 'orig') orig.style.display = 'block';
  }
  modal.querySelectorAll('.ohlc-tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  function drawResults(res) {
    const chart = $('ohlc-chart');
    chart.width = Math.min(1400, Math.max(600, res.bars.length * 4));
    chart.height = 300;
    window.ChartDNACV.renderChart(chart, res.bars, { title: res.bars.length + ' candle — reconstructed from pixels' });
    const cv = document.createElement('canvas');
    try { window.ChartDNACV.renderAnnotated(cv, state.img, res); $('ohlc-ann').width = cv.width; $('ohlc-ann').height = cv.height; $('ohlc-ann').getContext('2d').drawImage(cv, 0, 0); } catch (e) { console.warn(e); }
    setView('chart');
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

  /* ------------------------------------------------- register in Chart DNA */
  const DB = 'ChartDNA_Storage', VER = 1, STORE = 'market_datasets', SEL = 'chartdna_selected_dataset_ids';
  const PAT = 'chartdna_saved_patterns', PAT_PENDING = 'chartdna_ohlc_pending_pattern';
  const norm = (pts) => { const lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts); return hi === lo ? pts.map(() => 0) : pts.map((v) => 2 * ((v - lo) / (hi - lo)) - 1); };
  /* The app seeds its pattern library from built-ins on first mount and then
     persists it in localStorage. Writing before that would clobber the seed,
     so when the key is not there yet the pattern waits for the next load. */
  function appendPattern(rec) {
    let raw = null;
    try { raw = localStorage.getItem(PAT); } catch (e) { return 'no-storage'; }
    if (!raw) { try { sessionStorage.setItem(PAT_PENDING, JSON.stringify(rec)); } catch (e) { } return 'queued-for-next-load'; }
    let list;
    try { list = JSON.parse(raw); } catch (e) { return 'unreadable'; }
    if (!Array.isArray(list)) return 'unreadable';
    let replaced = false;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.id !== rec.id) continue;
      if ((p.points || []).join() === (rec.points || []).join()) return 'already-there';
      list[i] = rec; replaced = true;              /* only ever touch our own entries */
    }
    if (!replaced) list.push(rec);
    /* keep our own auto-extracted entries bounded: the app's library is the user's */
    const mine = list.map((p, i) => (p && String(p.id).indexOf('custom_dna_img_') === 0 ? i : -1)).filter((i) => i >= 0);
    if (mine.length > 24) mine.slice(0, mine.length - 24).reverse().forEach((i) => list.splice(i, 1));
    try { localStorage.setItem(PAT, JSON.stringify(list)); } catch (e) { return 'quota'; }
    try { sessionStorage.removeItem(PAT_PENDING); } catch (e) { }
    return replaced ? 'replaced' : 'added';
  }
  (function flushPendingPattern() {
    let pend = null;
    try { pend = sessionStorage.getItem(PAT_PENDING); if (pend) sessionStorage.removeItem(PAT_PENDING); } catch (e) { }
    if (!pend) return;
    try {
      const rec = JSON.parse(pend);
      const res = appendPattern(rec);
      if (res === 'queued-for-next-load') { sessionStorage.setItem(PAT_PENDING, pend); }
      else if (window.__ohlcLog) window.__ohlcLog('pending pattern: ' + res);
    } catch (e) { }
  })();
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
  async function saveDataset(andSearch, opts) {
    opts = opts || {};
    const quiet = !!opts.silent;
    const say = (m, k) => { if (!quiet) status(m, k); else console.info('[ohlc]', m); };
    const res = state.result;
    if (!res || !res.calibration || !res.calibration.detected) { say('اول محور قیمت را بخوانید (یا دستی کالیبره کنید)؛ بدون مقادیر عددی دیتاستی ساخته نمی‌شود.', 'warn'); return { error: 'no-calibration' }; }
    const wantPattern = opts.pattern === undefined ? $('ohlc-opt-pattern').checked : !!opts.pattern;
    const replaceSel = opts.replace === undefined ? $('ohlc-opt-replace').checked : !!opts.replace;
    const name = ($('ohlc-symbol').value || 'Image') + ' ' + $('ohlc-tf').value + ' (from image)' + (opts.nameSuffix || '');
    const id = opts.id || ('img-' + Date.now().toString(36));
    const ds = window.ChartDNACV.toDataset(res, {
      id, name, symbol: ($('ohlc-symbol').value || 'IMAGE').toUpperCase(), timeframe: $('ohlc-tf').value,
      note: 'بازسازی از تصویر (' + res.quality.meanConfidence + ' میانگین اطمینان، ' + res.bars.length + ' کندل) — ' + (res.calibration.modelChoice || '')
    });
    try {
      const db = await openDb();
      await new Promise((r2, j2) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(ds);
        tx.oncomplete = r2; tx.onerror = () => j2(tx.error);
      });
      db.close();
      let sel = [id];
      if (!replaceSel) {
        try {
          const cur = JSON.parse(localStorage.getItem(SEL) || '[]');
          if (Array.isArray(cur) && cur.length) sel = cur.indexOf(id) < 0 ? cur.concat([id]) : cur;
        } catch (e) { }
      }
      try { localStorage.setItem(SEL, JSON.stringify(sel)); } catch (e) { console.warn(e); }
      let patMsg = '';
      if (wantPattern) {
        const closes = (opts.patternPoints && opts.patternPoints.length >= 5) ? opts.patternPoints.slice() : ds.candles.map((c) => c.close);
        if (closes.length >= 5) {
          const pat = {
            id: 'custom_dna_img_' + id, name: name, category: 'Image extraction',
            createdAt: new Date().toISOString().slice(0, 10),
            points: closes, normalizedPoints: norm(closes),
            notes: 'سری بسته‌شوندهٔ استخراج‌شده از تصویر (' + ds.candles.length + ' کندل، میانگین اطمینان ' + res.quality.meanConfidence + ') — ' + (res.calibration.modelChoice || '')
          };
          const r = appendPattern(pat);
          var patState = r;
          patMsg = '\nالگو در کتابخانهٔ DNA: ' + ({ 'added': 'اضافه شد ✓', 'already-there': 'از قبل موجود بود', 'replaced': 'به‌روزرسانی شد', 'queued-for-next-load': 'در صف (بعد از بارگذاری بعدی اضافه می‌شود)', 'quota': 'ذخیره نشد (حافظهٔ مرورگر پر است)', 'unreadable': 'خوانده نشد', 'no-storage': 'غیرقابل دسترس' }[r] || r);
        }
      }
      if (andSearch) { try { sessionStorage.setItem('chartdna_ohlc_autosearch', id); } catch (e) { } }
      state.datasetId = id;
      say('دیتاست «' + name + '» ذخیره شد و ' + (replaceSel ? 'تنها دیتاست انتخاب‌شده است' : 'به دیتاست‌های انتخاب‌شده اضافه شد') + patMsg + (andSearch ? '\nصفحه بارگذاری مجدد می‌شود و جستجو اجرا خواهد شد…' : ''), 'ok');
      if (andSearch && opts.reload !== false) setTimeout(reloadPage, 350);
      return { id, name, pattern: patState || 'skipped', dataset: ds };
    } catch (err) {
      say('ذخیره در پایگاه محلی برنامه ناموفق بود: ' + (err && err.message ? err.message : err), 'err');
      return { error: String(err && err.message || err) };
    }
  }
  /* a seam the tests can drive; browsers get the plain reload */
  function reloadPage() { (typeof window.__chartDnaReload === 'function' ? window.__chartDnaReload : location.reload.bind(location))(); }

  /* ------------------------------------------------- the opener, pinned to the top
   * On a phone the image card is usually below the fold, so instead of a button in a
   * far corner the opener is parked on the top-right corner of the picture itself and
   * clamped to the viewport: it reads as part of the image and still follows the
   * screen while the column scrolls.  chartdna_ohlc_pin === '0' gives the old corner. */
  const PIN = 'chartdna_ohlc_pin';
  let pinRaf = 0, lastPin = '';
  function pinWanted() { let v = null; try { v = localStorage.getItem(PIN); } catch (e) { } return v !== '0'; }
  /* where the pinned opener belongs: the right edge of the app column, in the
     band under the app's own top bar, so it never covers the logo or the
     settings button and still reads as part of that bar. */
  function pinAnchor() {
    const de = document.documentElement || {};
    const vw = window.innerWidth || de.clientWidth || 1024;
    const vh = window.innerHeight || de.clientHeight || 768;
    const app = document.getElementById('chart-dna-app');
    const ar = app ? app.getBoundingClientRect() : null;
    const right = (ar && ar.width > 0) ? Math.min(ar.right, vw) : vw;
    const bar = document.getElementById('btn-header-settings') || document.getElementById('btn-header-install');
    const br = bar ? bar.getBoundingClientRect() : null;
    const below = br && br.height > 0 ? br.bottom : 4;
    return { vw: vw, vh: vh, right: right, below: below };
  }
  function keyOf(a) { return a ? [Math.round(a.right), Math.round(a.below), a.vw, a.vh].join(',') : ''; }
  function placePin() {
    if (!rootEl || !rootEl.parentElement) return;
    if (!pinWanted()) { rootEl.className = ''; rootEl.style.top = ''; rootEl.style.left = ''; lastPin = ''; return; }
    const a = pinAnchor();
    const w = rootEl.offsetWidth || 200, h = rootEl.offsetHeight || 42, inset = 12;
    const top = Math.round(Math.max(12, Math.min(a.below + 8, a.vh - h - 8)));
    const left = Math.round(Math.max(8, Math.min(a.right - w - inset, a.vw - w - 8)));
    rootEl.style.top = top + 'px';
    rootEl.style.left = left + 'px';
    rootEl.className = 'ohlc-pinned';
    lastPin = keyOf(a);
  }
  function schedulePin() {
    if (pinRaf) return;
    const go = () => { pinRaf = 0; placePin(); };
    pinRaf = window.requestAnimationFrame ? window.requestAnimationFrame(go) : setTimeout(go, 16);
  }
  function setPin(on) { try { localStorage.setItem(PIN, on ? '1' : '0'); } catch (e) { } placePin(); }
  function setOpenNote(text) {
    const btn = $('ohlc-open');
    if (!btn) return;
    const safe = String(text == null ? '' : text).replace(/[<>&]/g, '');
    btn.innerHTML = T.open + (safe ? ' <b>' + safe + '</b>' : '');
    btn.title = safe ? T.open + ' — ' + safe : T.open;
    schedulePin();
  }
  (function watchPin() {
    ['scroll', 'resize', 'orientationchange'].forEach((ev) => {
      try { window.addEventListener(ev, schedulePin, { passive: true, capture: true }); } catch (e) { }
    });
    /* React can move or resize the top bar without firing anything we can hear */
    setInterval(() => {
      const k = pinWanted() ? keyOf(pinAnchor()) : '';
      if (k !== lastPin || rootEl.className.indexOf('ohlc-pinned') < 0) placePin();
    }, 400);
    placePin();
  })();

  window.ChartDnaOhlc = {
    version: 4,
    engine: () => window.ChartDNACV,
    busy: () => !!state.running,
    image: () => state.img,
    imageKey: () => state.imgKey,
    result: () => state.result,
    report: () => window.__ohlcReport || null,
    sigOf,
    useImage: (src) => new Promise((done) => { loadImage(src, () => done(state.img)); }),
    run: (key) => run(key),
    saveDataset: (andSearch, opts) => saveDataset(andSearch, opts),
    toCSV: () => window.ChartDNACV.toCSV(state.result),
    reload: reloadPage,
    open: () => show(true),
    pin: setPin,
    pinned: pinWanted,
    note: setOpenNote
  };

  $('ohlc-save').addEventListener('click', () => saveDataset(false));
  $('ohlc-save-search').addEventListener('click', () => saveDataset(true));

  /* after a reload requested by "save + search": select the dataset view and
     click the app's own search button once it exists */
  (function autoSearch() {
    let want = null;
    try { want = sessionStorage.getItem('chartdna_ohlc_autosearch'); if (want) sessionStorage.removeItem('chartdna_ohlc_autosearch'); } catch (e) { }
    if (!want) return;
    let tries = 0;
    const tick = () => {
      tries++;
      const btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      const root = document.getElementById('root') || document.body;
      const appReady = root && root.children.length > 0;
      const hit = appReady ? btns.filter((b) => {
        const t = (b.textContent || '').trim();
        if (!/جستجو/.test(t) || /جستجو و فیلتر/.test(t) || t.length > 26) return false;
        if (b.closest && b.closest('#ohlc-modal')) return false;      // never our own button
        return !b.disabled && b.isConnected !== false;
      }) : [];
      if (hit.length) { hit[0].click(); status2('جستجوی الگو روی دیتاست استخراج‌شده اجرا شد (' + want + ').'); return; }
      if (tries < 120) setTimeout(tick, 500);
    };
    const wait = () => (document.body ? tick() : setTimeout(wait, 300));
    setTimeout(wait, 1800);
    function status2(msg) {
      const b = document.getElementById('ohlc-status');
      if (b) { show(true); b.textContent = msg + '\n(دیتاست ' + want + ' به‌عنوان تنها دیتاست انتخاب‌شده بارگذاری شد.)'; }
    }
  })();

  /* small nicety: keep the tool out of the way of the app's own controls */
  new MutationObserver(() => {
    if (document.body && !document.getElementById('ohlc-tool')) document.body.appendChild(rootEl);
  }).observe(document.documentElement, { childList: true });
})();
