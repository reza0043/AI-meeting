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
 *   4. The upload prompt in the middle of «محیط الگو» (#image-cropper-card): the
 *      icon box, its two lines of text and the click that opens the file dialog —
 *      gone together with the function, not only the pixels.
 *   5. Engine 2 — the bundle's own image→pattern extractor ("AI Vision"): its core
 *      is disabled inside assets/index-DOCOgEgh.js itself (see the engine-2 block
 *      below); this script re-hides the same controls (استخراج الگو از کادر،
 *      تراز مقیاس قیمت، تب «تشخیص و ثبت الگو از تصویر»، کارت «تعداد نقاط شباهت»)
 *      when a cached copy of the old bundle still builds them.
 *   Panels 2 to 4 live in the minified bundle with no source in this repo, so
 *   they are hidden in place instead of being ripped out of React's tree: hiding
 *   is safe, removing a node React owns is not.
 *
 * Nothing here touches the manual extraction tool (the button at the top of the
 * page and its panel); that stays available.
 *
 * Switches (localStorage):  chartdna_ui_trim = '0'     -> this script does nothing
 *                           chartdna_ui_trim_swept      -> set by the data sweep
 *                           chartdna_crop_upload = '0'  -> the crop card's upload prompt
 *                                                         and its file input come back
 *                           chartdna_engine2 = '1'      -> engine-2 controls are left alone
 *                                                         (only useful on an old cached bundle)
 *                           chartdna_refpts = '1'       -> the pts badge and the reference-price
 *                                                         control are left alone
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
  /* leftovers of old builds: the injected card, the floating opener, the four keys that
     were deleted with their function, and the controls of the three panels that are gone
     now — the dataset label, the price-axis calibration and the output box — and the two
     download keys that were taken off the card afterwards */
  const STALE = ['ohlc-auto-card', 'ohlc-tool', 'ohlc-open', 'ohlc-pick', 'ohlc-grab',
    'ohlc-save', 'ohlc-save-search', 'ohlc-opt-pattern', 'ohlc-opt-replace',
    'ohlc-csv', 'ohlc-png',
    'ohlc-symbol', 'ohlc-tf', 'ohlc-d0', 'ohlc-d1', 'ohlc-t0',
    'ohlc-ref-row', 'ohlc-ref-price', 'ohlc-ref-add', 'ohlc-ref-clear', 'ohlc-points'];
  const MAX_DROPS = 5;                    /* an old build re-adds what we take away: bounded */
  const drops = Object.create(null);
  const OUR_KEYS = /^chartdna_ohlc_/;
  const OUR_NAME = /from image|کادر برنامه|از تصویر/i;

  const on = () => { try { return localStorage.getItem(OFF) !== '0'; } catch (e) { return true; } };
  const log = (...a) => { try { console.log('[chart-dna-ui-trim]', ...a); } catch (e) { } };

  /* ------------------------------------------------------------ the card we used to inject */
  function dropOwnCard() {
    let n = 0;
    for (let i = 0; i < STALE.length; i++) {
      const id = STALE[i];
      if ((drops[id] || 0) >= MAX_DROPS) continue;          /* stop fighting a cached script */
      const el = document.getElementById(id);
      if (el && el.parentElement) {
        el.parentElement.removeChild(el);
        drops[id] = (drops[id] || 0) + 1;
        n++;                                                 /* the floating opener went with the pin */
      }
    }
    if (n) log('removed', n, 'leftover node(s)');
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

  /* --------------------------------------- the upload prompt in the middle of «محیط الگو»
   * The card's stage holds one of two things: the crop canvas (once an image is in) or
   * one clickable block — an icon box, «تصویر چارت را بکشید و اینجا رها کنید» and the
   * hint line under it. That block is the whole upload control of the card: its onClick
   * is `() => P.current.click()`, i.e. it opens the hidden file input of the card, and
   * that input's onChange is the only real importer (the app has no drop handler at all,
   * so the «drag & drop» wording never did anything).
   *
   * Removing the block and its function therefore means three things, all done here:
   * the block is hidden, every input[type=file] inside the card is disabled and its
   * click() neutered, and any click that still reaches the block is swallowed. The
   * canvas, the crop box, the card header and the price-scale control are untouched. */
  const CROP_CARD = 'image-cropper-card';
  const CROP_OFF = 'chartdna_crop_upload';
  /* the two wording keys the block uses, in every language the app ships, plus the
     English fallbacks written into the component itself */
  const CROP_TEXT = [
    'تصویر چارت را بکشید و اینجا رها کنید', 'کادر زرد رنگ را روی بخش مورد نظر از نمودار تنظیم کنید',
    'Drag & drop chart image here', 'Drop financial chart screenshot here or click to browse',
    'Adjust the bounding box over the chart pattern to extract its DNA',
    'Supports PNG, JPG, WebP', 'Drag (finger or mouse) to crop',
    'اسحب وأفلت صورة الشارت هنا', 'اضبط الإطار الأصفر فوق النمط',
    'Arrastra y suelta la imagen', 'Ajusta el marco sobre el patrón',
    'Glissez et déposez', 'Ajustez le cadre sur le motif',
    'Chart-Bild hierher ziehen', 'Rahmen über das Chartmuster',
    'Перетащите изображение графика', 'Настройте рамку поверх паттерна',
    '拖拽图表图片至此处', '调整黄色选框覆盖图表形态',
    'Grafik görselini buraya', 'sarı çerçeveyi desen',
    'チャート画像をここにドラッグ', '黄色の枠をチャートパターン'
  ];
  const cropOff = () => { try { return localStorage.getItem(CROP_OFF) === '0'; } catch (e) { return false; } };
  const cropCard = () => document.getElementById(CROP_CARD);
  const hasCanvas = (el) => { try { return !!(el && el.querySelector && el.querySelector('canvas')); } catch (e) { return false; } };
  function hasCropText(el) {
    const t = ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    for (let i = 0; i < CROP_TEXT.length; i++) if (t.indexOf(CROP_TEXT[i]) >= 0) return true;
    return false;
  }
  /* the stage is the flex-1 bordered box that swaps between canvas and prompt */
  function cropStage(card) {
    const kids = card.children || [];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i].className || '';
      if (/relative/.test(c) && /flex-1/.test(c)) return kids[i];
    }
    const cv = card.querySelector('canvas');
    if (cv && cv.parentElement && cv.parentElement.parentElement) return cv.parentElement.parentElement;
    return null;
  }
  function cropPrompts(card) {
    const out = [];
    const stage = cropStage(card);
    if (stage) {
      const kids = stage.children || [];
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        if (hasCanvas(el)) continue;                     /* the crop surface itself stays */
        if (/^H[1-6]$|^BUTTON$|^INPUT$/.test(el.tagName || '')) continue;
        out.push(el);                                    /* the empty-state block */
      }
    }
    if (!out.length) {                                   /* renamed markup: find it by words */
      const found = card.querySelectorAll('p, [class*="text-center"], [class*="cursor-pointer"]');
      for (let i = 0; i < found.length; i++) {
        let el = found[i];
        if (hasCanvas(el) || (!hasCropText(el) && !hasCropText(el.parentElement))) continue;
        for (let up = 0; up < 3; up++) {                  /* climb onto the block, never to the stage */
          const p = el.parentElement;
          if (!p || p === stage || p === card || hasCanvas(p) || !hasCropText(p)) break;
          el = p;
        }
        if (out.indexOf(el) < 0) out.push(el);
      }
    }
    return out;
  }
  const cropNodes = [];
  function hideCrop(el) {
    if (!el || el.__dnaTrimmed) return false;
    el.__dnaTrimmed = true;
    el.setAttribute('data-dna-crop', 'off');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('hidden', '');
    el.style.display = 'none';
    if (cropNodes.indexOf(el) < 0) cropNodes.push(el);   /* a rebuilt block is the same node */
    log('hidden the crop card’s upload block');
    return true;
  }
  function bringCropBack() {
    for (let i = 0; i < cropNodes.length; i++) {
      const el = cropNodes[i];
      if (!el || !el.isConnected) continue;
      el.style.display = ''; el.removeAttribute('hidden');
      el.removeAttribute('aria-hidden'); el.removeAttribute('data-dna-crop');
      delete el.__dnaTrimmed;
    }
    cropNodes.length = 0;
    const card = cropCard();
    if (!card) return 0;
    const ins = card.querySelectorAll('input[type=file]');
    for (let i = 0; i < ins.length; i++) {
      const inp = ins[i];
      inp.disabled = false;
      inp.removeAttribute('data-dna-off');
      if (inp.__dnaOrigClick) { inp.click = inp.__dnaOrigClick; delete inp.__dnaOrigClick; delete inp.__dnaNoClick; }
    }
    return ins.length;
  }
  function killCropUpload() {
    const card = cropCard();
    if (!card) return 0;
    for (let i = cropNodes.length - 1; i >= 0; i--) if (!cropNodes[i].isConnected) cropNodes.splice(i, 1);
    if (cropOff()) return -bringCropBack();
    let n = 0;
    const hits = cropPrompts(card);
    for (let i = 0; i < hits.length; i++) if (hideCrop(hits[i])) n++;
    const ins = card.querySelectorAll('input[type=file]');
    for (let i = 0; i < ins.length; i++) {
      const inp = ins[i];
      if (!inp.disabled) { inp.disabled = true; n++; }
      inp.setAttribute('data-dna-off', '1');
      if (!inp.__dnaNoClick) {
        inp.__dnaNoClick = true;
        try {
          inp.__dnaOrigClick = inp.click;
          inp.click = function () { log('the crop card’s file dialog is switched off'); };
        } catch (e) { }
      }
    }
    if (!card.__dnaCropWired) {
      card.__dnaCropWired = true;
      const block = (e) => {
        if (cropOff()) return;
        const t = e.target;
        const overDrop = /^(drop|dragover|dragenter)$/.test(e.type);
        const onPrompt = !!(t && t.closest && t.closest('[data-dna-crop]'));
        if (!overDrop && !onPrompt) return;
        if (t && t.closest && t.closest('canvas')) return;             /* drawing the crop box stays alive */
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      };
      ['click', 'dragover', 'dragenter', 'drop'].forEach((ev) => card.addEventListener(ev, block, true));
    }
    if (n) log('crop upload removed', n, 'node(s)');
    return n;
  }

  /* --------------------------------------------------- engine 2 (image → pattern) is out
   * The in-bundle "AI Vision" extractor — the curve-from-pixels routine behind
   * «استخراج الگو از کادر», the «تشخیص و ثبت الگو از تصویر» settings tab and the
   * price-scale OCR — is switched off at the root inside assets/index-DOCOgEgh.js
   * (rd() and zu() return early, the tab renders nothing, the deck keys carry
   * display:none, the app's own image picker returns before it opens). What follows
   * here is the belt to those braces: a *cached* copy of the old bundle still builds
   * that UI, so the same controls are hidden again from outside, by id and by wording.
   * The reference pattern of the matcher now comes from the pattern library alone —
   * i.e. from the OHLC vision engine's confirmed measurements (chart-ohlc-extractor.js)
   * and from the standard library. localStorage.chartdna_engine2 = '1' brings the
   * old controls back (for a build that still has them working). */
  const E2_OFF = 'chartdna_engine2';                     /* '1' -> leave engine-2 UI alone */
  const E2_IDS = ['btn-extract-pattern', 'btn-price-scale'];
  const E2_BTN_TEXT = [
    'تشخیص و ثبت الگو از تصویر',                          /* the settings tab key (fa fallback in every language) */
    'ثبت الگوی جدید از تصویر', '+ Extract New Pattern'   /* the shortcut in the data tab */
  ];
  const E2_CARD_TEXT = [
    'تعداد نقاط شباهت و تفکیک الگو', 'Pattern Similarity Points & Resolution'
  ];
  const e2On = () => { try { return localStorage.getItem(E2_OFF) !== '1'; } catch (e) { return true; } };
  const e2Nodes = [];
  function e2Hide(el, why) {
    if (!el || el.__dnaE2Off) return false;
    el.__dnaE2Off = true;
    el.setAttribute('data-dna-engine2', 'off');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('hidden', '');
    el.style.setProperty('display', 'none', 'important');
    if (el.tagName === 'BUTTON') el.disabled = true;
    if (e2Nodes.indexOf(el) < 0) e2Nodes.push(el);
    log('engine-2 control hidden by ' + why + (el.id ? ': #' + el.id : ''));
    return true;
  }
  function e2Back() {
    for (let i = 0; i < e2Nodes.length; i++) {
      const el = e2Nodes[i];
      if (!el || !el.isConnected) continue;
      el.style.removeProperty('display');
      el.removeAttribute('hidden'); el.removeAttribute('aria-hidden');
      el.removeAttribute('data-dna-engine2');
      if (el.tagName === 'BUTTON') el.disabled = false;
      delete el.__dnaE2Off;
    }
    const n = e2Nodes.length;
    e2Nodes.length = 0;
    return n;
  }
  function killEngine2() {
    if (!on()) return 0;
    if (!e2On()) return -e2Back();
    let n = 0;
    for (let i = 0; i < E2_IDS.length; i++) {            /* the two deck keys, by their stable ids */
      const el = document.getElementById(E2_IDS[i]);
      if (!el) continue;
      /* a re-render clears inline styles: hidden nodes are re-asserted, not only new ones */
      if (!el.__dnaE2Off) { if (e2Hide(el, 'id')) n++; }
      else if (el.style.display !== 'none') { el.style.setProperty('display', 'none', 'important'); el.disabled = true; n++; }
    }
    const btns = document.querySelectorAll('button');    /* the tab key and the shortcut, by wording */
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if (b.__dnaE2Off) continue;
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      for (let k = 0; k < E2_BTN_TEXT.length; k++) {
        if (t === E2_BTN_TEXT[k]) { if (e2Hide(b, 'wording')) n++; break; }
      }
    }
    const spans = document.querySelectorAll('span');     /* the resolution-points card, by its title */
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      const t = ownText(el);
      if (!t) continue;
      let hit = false;
      for (let k = 0; k < E2_CARD_TEXT.length; k++) if (t.indexOf(E2_CARD_TEXT[k]) === 0) { hit = true; break; }
      if (!hit) continue;
      let card = null;
      try { card = el.closest('[class*="border-violet"]'); } catch (e) { card = null; }
      if (!card) {                                       /* renamed classes: the nearest small card */
        let node = el;
        for (let up = 0; node && up < 6; up++) {
          node = node.parentElement;
          if (node && /rounded-xl/.test(node.className || '') && !tooBig(node)) { card = node; break; }
        }
      }
      if (card && !tooBig(card) && e2Hide(card, 'card title')) n++;
    }
    if (n) log('engine-2 leftovers hidden:', n);
    return n;
  }

  /* ------------------------------- v32: the pts badge and the reference price
   * Both belonged to engine 2. The «pts» badge (تعداد نقاط شباهت) sat on «محیط الگو»
   * and on «اطلاعات الگوی کشف شده»; the reference-price control (قیمت مرجع + تنظیم)
   * fed the removed pixel calibration. Their computation is cut at the root inside the
   * bundle (referencePrice:0, onUpdateReferencePrice:()=>{} — patches P9-P11); this
   * block hides what React still draws of them. localStorage.chartdna_refpts = '1'
   * leaves them alone / brings them back. */
  const RP_OFF = 'chartdna_refpts';
  const rpOn = () => { try { return localStorage.getItem(RP_OFF) !== '1'; } catch (e) { return true; } };
  const rpNodes = [];
  const RP_PTS = /^[\d\u06F0-\u06F9,\u066C'\u2019\s]*pts$/;
  const RP_TEXT = ['قیمت مرجع', 'Reference Price', 'Ref:'];
  function rpHide(el, why) {
    if (!el || el.__dnaRpOff) return false;
    el.__dnaRpOff = true;
    el.setAttribute('data-dna-refpts', 'off');
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('display', 'none', 'important');
    if (el.tagName === 'BUTTON') el.disabled = true;
    if (rpNodes.indexOf(el) < 0) rpNodes.push(el);
    log('ref-price/pts control hidden by ' + why + (el.id ? ': #' + el.id : ''));
    return true;
  }
  function rpBack() {
    for (let i = 0; i < rpNodes.length; i++) {
      const el = rpNodes[i];
      if (!el || !el.isConnected) continue;
      el.style.removeProperty('display');
      el.removeAttribute('aria-hidden'); el.removeAttribute('data-dna-refpts');
      if (el.tagName === 'BUTTON') el.disabled = false;
      delete el.__dnaRpOff;
    }
    const n = rpNodes.length;
    rpNodes.length = 0;
    return n;
  }
  function refWording(t) {
    for (let k = 0; k < RP_TEXT.length; k++) if (t.indexOf(RP_TEXT[k]) === 0) return true;
    return false;
  }
  function killRefPts() {
    if (!on()) return 0;
    if (!rpOn()) return -rpBack();
    let n = 0;
    const spans = document.querySelectorAll('span');
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      if (el.__dnaRpOff) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      /* the pts badge — its own span, wherever the app draws it with the cyan chip
         classes; inside «محیط الگو» wording alone is enough for older builds */
      if (RP_PTS.test(t) && (/bg-cyan-950/.test(el.className || '') || (el.closest && el.closest('#image-cropper-card')))) {
        if (rpHide(el, 'pts badge')) n++;
        continue;
      }
      /* the reference-price row: take its small wrapper when that is safe, else
         the labelling span and the value next to it */
      if (!refWording(ownText(el))) continue;
      let w = null;
      try { w = el.closest('div'); } catch (e) { w = null; }
      if (w && !tooBig(w) && (w.textContent || '').length < 120 && !w.querySelector('input[type="file"]')) {
        if (rpHide(w, 'ref-price row')) n++;
      } else {
        if (rpHide(el, 'ref-price label')) n++;
        const sib = el.nextElementSibling;
        if (sib && sib.tagName === 'SPAN' && (sib.textContent || '').length < 40 && rpHide(sib, 'ref-price value')) n++;
      }
    }
    /* the «تنظیم» / Edit keys carry the wording in their title */
    const acts = document.querySelectorAll('button[title], a[title], span[title]');
    for (let i = 0; i < acts.length; i++) {
      const el = acts[i];
      if (el.__dnaRpOff) continue;
      const ti = el.getAttribute('title') || '';
      if (!/قیمت مرجع|Reference Price/.test(ti)) continue;
      if ((el.textContent || '').trim().length <= 12 && rpHide(el, 'ref-price key')) n++;
    }
    /* re-assert what a re-render un-hid */
    for (let i = 0; i < rpNodes.length; i++) {
      const el = rpNodes[i];
      if (el && el.isConnected && el.style.display !== 'none') { el.style.setProperty('display', 'none', 'important'); n++; }
    }
    if (n) log('ref-price/pts leftovers hidden:', n);
    return n;
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
    killCropUpload();
    killEngine2();
    hideOverlays(true);
    killRefPts();
    sweep();
    /* the app mounts after us and re-renders, so keep watching; our own writes
       are attribute/childList-free for the observer so this cannot loop */
    let queued = false;
    const again = () => {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || function (f) { return setTimeout(f, 32); })(() => { queued = false; dropOwnCard(); killCropUpload(); killEngine2(); killRefPts(); hideOverlays(); });
    };
    try {
      const mo = new MutationObserver(again);
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) { }
    /* the app mounts after us and may rebuild these panels later */
    const settle = setInterval(() => { dropOwnCard(); killCropUpload(); killEngine2(); killRefPts(); hideOverlays(true); }, 600);
    setTimeout(() => clearInterval(settle), 20000);
  }
  if (document.body) run(); else document.addEventListener('DOMContentLoaded', run);

  window.ChartDnaUiTrim = {
    version: 7,
    titles: TITLES.slice(),
    ids: IDS.slice(),
    cropText: CROP_TEXT.slice(),
    hide: hideOverlays,
    dropCard: dropOwnCard,
    drops: () => drops,
    cropNodes: () => cropNodes.slice(),
    cropPass: () => killCropUpload(),
    cropOff: () => { try { localStorage.setItem(CROP_OFF, '0'); } catch (e) { } return bringCropBack(); },
    cropOn: () => { try { localStorage.removeItem(CROP_OFF); } catch (e) { } return killCropUpload(); },
    engine2Nodes: () => e2Nodes.slice(),
    engine2Pass: () => killEngine2(),
    engine2On: () => { try { localStorage.setItem(E2_OFF, '1'); } catch (e) { } return e2Back(); },
    engine2Off: () => { try { localStorage.removeItem(E2_OFF); } catch (e) { } return killEngine2(); },
    refptsNodes: () => rpNodes.slice(),
    refptsPass: () => killRefPts(),
    refptsOn: () => { try { localStorage.setItem(RP_OFF, '1'); } catch (e) { } return rpBack(); },
    refptsOff: () => { try { localStorage.removeItem(RP_OFF); } catch (e) { } return killRefPts(); },
    sweep: () => sweep(true),
    hidden: () => panels.length,
    off: () => { try { localStorage.setItem(OFF, '0'); } catch (e) { } }
  };
})();
