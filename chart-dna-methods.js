/* Chart DNA — search methods as user-ticked checkboxes (v36)
 * - Replaces the old weight sliders («وزن‌دهی فرمول» tab, hidden in bundle P22).
 * - The bundle (P21) routes every Engine-1 search through window.__dnaHook(matcher),
 *   which wraps the matcher statics ONCE before the first search runs.
 * - Ticks persist in localStorage 'chartdna_search_methods'.
 * - Kill switch: localStorage 'chartdna_methods' = '0'  -> hook returns the matcher untouched
 *   and the checkbox card is not injected (original behaviour, incl. config weights).
 */
(function () {
  'use strict';

  var OFF_KEY = 'chartdna_methods';
  var TICKS_KEY = 'chartdna_search_methods';
  var OV_STORE = 'chartdna_px_overlay';

  function enabled() {
    try { return localStorage.getItem(OFF_KEY) !== '0'; } catch (e) { return true; }
  }

  var DEFAULTS = {
    pearson: true, dtw: true, slope: true, extrema: true,
    ohlc4: false, anatomy: false, multiscale: false, fastscan: false
  };

  function getTicks() {
    var t = {};
    for (var k in DEFAULTS) t[k] = DEFAULTS[k];
    try {
      var raw = localStorage.getItem(TICKS_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var k2 in DEFAULTS) if (typeof saved[k2] === 'boolean') t[k2] = saved[k2];
      }
    } catch (e) {}
    return t;
  }

  function setTick(key, val) {
    if (!(key in DEFAULTS)) return;
    var t = getTicks();
    t[key] = !!val;
    try { localStorage.setItem(TICKS_KEY, JSON.stringify(t)); } catch (e) {}
  }

  /* ---------- math helpers ---------- */

  function resample(arr, n) {
    if (!arr || !arr.length) return [];
    if (arr.length === n) return arr.slice();
    var out = [], step = (arr.length - 1) / Math.max(1, n - 1);
    for (var i = 0; i < n; i++) {
      var pos = i * step, lo = Math.floor(pos), hi = Math.min(arr.length - 1, lo + 1), f = pos - lo;
      out.push(arr[lo] * (1 - f) + arr[hi] * f);
    }
    return out;
  }

  function pearson(a, b) {
    var n = Math.min(a.length, b.length);
    if (n < 2) return 0;
    var sa = 0, sb = 0;
    for (var i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
    var ma = sa / n, mb = sb / n, num = 0, da = 0, db = 0;
    for (var j = 0; j < n; j++) {
      var xa = a[j] - ma, xb = b[j] - mb;
      num += xa * xb; da += xa * xa; db += xb * xb;
    }
    var den = Math.sqrt(da * db);
    return den === 0 ? 0 : num / den;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- weights mapping (methods 1..4) ---------- */

  function mapWeights(ticks, orig) {
    var keys = { pearson: 'pearson', dtw: 'dtw', slope: 'slope', extrema: 'structural' };
    var active = [];
    for (var k in keys) if (ticks[k]) active.push(keys[k]);
    var w = { pearson: 0, dtw: 0, slope: 0, structural: 0 };
    if (!active.length) { w.pearson = 1; return w; } // fallback: pearson-only base screen
    var share = 1 / active.length;
    for (var i = 0; i < active.length; i++) w[active[i]] = share;
    return w;
  }

  function cfgWithWeights(x, ticks) {
    var c = {};
    for (var k in x) c[k] = x[k];
    c.weights = mapWeights(ticks, x && x.weights);
    return c;
  }

  /* ---------- image-query OHLC (methods 5 & 6) ---------- */

  var queryCache = { at: 0, candles: null };
  function refreshQuery() {
    var c = null;
    try {
      var raw = localStorage.getItem(OV_STORE); // {at,frame,candles:[{o,h,l,c,up}]}
      if (raw) {
        var rec = JSON.parse(raw);
        if (rec && rec.candles && rec.candles.length) c = rec.candles;
      }
    } catch (e) {}
    queryCache = { at: Date.now(), candles: c };
    return c;
  }

  function ch(candles, o, alt) {
    var out = [];
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      var v = c[o]; if (v == null) v = c[alt];
      out.push(Number(v) || 0);
    }
    return out;
  }

  function scoreOhlc4(q, w) {
    var pairs = [['o', 'open'], ['h', 'high'], ['l', 'low'], ['c', 'close']];
    var s = 0;
    for (var i = 0; i < 4; i++) {
      var qa = ch(q, pairs[i][0], pairs[i][1]);
      var wa = resample(ch(w, pairs[i][1], pairs[i][0]), q.length);
      s += Math.max(0, pearson(qa, wa));
    }
    return s / 4; // 0..1
  }

  function anatomyVec(c, oK, hK, lK, cK) {
    var o = Number(c[oK]) || 0, h = Number(c[hK]) || 0, l = Number(c[lK]) || 0, cl = Number(c[cK]) || 0;
    var range = h - l;
    if (!(range > 0)) return [0, 0, 0];
    return [
      (cl - o) / range,                    // signed body  -1..1
      (h - Math.max(o, cl)) / range,       // upper shadow  0..1
      (Math.min(o, cl) - l) / range        // lower shadow  0..1
    ];
  }

  function scoreAnatomy(q, w) {
    var n = Math.min(q.length, w.length);
    if (!n) return 0;
    // compare candle-by-candle on the overlapping resampled index
    var diff = 0;
    for (var i = 0; i < n; i++) {
      var qi = Math.floor(i * q.length / n), wi = Math.floor(i * w.length / n);
      var a = anatomyVec(q[qi], 'o', 'h', 'l', 'c');
      var b = anatomyVec(w[wi], 'open', 'high', 'low', 'close');
      diff += (Math.abs(a[0] - b[0]) / 2 + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
    }
    return clamp(1 - diff / n, 0, 1);
  }

  function refineResults(results, dataset, ticks, threshold) {
    var q = queryCache.candles;
    if (!q || !q.length || !dataset || !dataset.candles) return results; // no image query -> silently skip
    var out = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var idx = r.rawMatchIndices || { start: r.startIndex, end: r.endIndex };
      var w = dataset.candles.slice(idx.start, idx.end + 1);
      if (w.length >= 3) {
        var parts = [], s5, s6;
        if (ticks.ohlc4) { s5 = scoreOhlc4(q, w); parts.push(s5); }
        if (ticks.anatomy) { s6 = scoreAnatomy(q, w); parts.push(s6); }
        if (parts.length) {
          var extra = 0;
          for (var j = 0; j < parts.length; j++) extra += parts[j];
          extra /= parts.length;
          r.similarity = clamp(r.similarity * 0.5 + extra * 50, 0, 100);
          r.refined = { ohlc4: s5, anatomy: s6 };
        }
      }
      if (r.similarity >= (threshold || 0)) out.push(r);
    }
    out.sort(function (a, b) { return b.similarity - a.similarity; });
    return out;
  }

  /* ---------- overlap dedupe (multiscale merge) ---------- */

  function overlapRatio(a, b) {
    var s = Math.max(a.start, b.start), e = Math.min(a.end, b.end);
    if (e <= s) return 0;
    return (e - s) / Math.max(1, Math.min(a.end - a.start, b.end - b.start));
  }

  function dedupe(results) {
    results.sort(function (a, b) { return b.similarity - a.similarity; });
    var kept = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var ri = r.rawMatchIndices || { start: r.startIndex, end: r.endIndex };
      var dup = false;
      for (var j = 0; j < kept.length; j++) {
        var k = kept[j];
        if (k.datasetId !== r.datasetId) continue;
        var ki = k.rawMatchIndices || { start: k.startIndex, end: k.endIndex };
        if (overlapRatio(ri, ki) > 0.5) { dup = true; break; }
      }
      if (!dup) kept.push(r);
    }
    return kept;
  }

  /* ---------- two-stage fast screen (method 8) ---------- */

  var FAST_MIN = 3000, FAST_STEP = 4;

  function fastFind(orig, self, d, o, x, p, N) {
    var D = o && o.candles;
    if (!D || D.length < FAST_MIN) return orig.call(self, d, o, x, p, N);
    var S = x.patternLength || 30;
    var coarse = [];
    for (var i = 0; i < D.length; i += FAST_STEP) coarse.push(Number(D[i].close) || 0);
    var Sc = Math.max(5, Math.round(S / FAST_STEP));
    var ref = resample(d, Sc);
    var cands = [];
    for (var w = 0; w + Sc <= coarse.length; w++) {
      var r = pearson(ref, coarse.slice(w, w + Sc));
      if (r > 0.5) cands.push({ i: w, r: r });
      if (N && N()) return [];
    }
    if (!cands.length) return [];
    // expand + merge candidate regions to full resolution
    var pad = S, fut = x.futureCandles || 0, ranges = [];
    cands.sort(function (a, b) { return a.i - b.i; });
    for (var c = 0; c < cands.length; c++) {
      var a0 = Math.max(0, cands[c].i * FAST_STEP - pad);
      var b0 = Math.min(D.length, cands[c].i * FAST_STEP + S * 2 + fut + pad);
      if (ranges.length && a0 <= ranges[ranges.length - 1].b) {
        ranges[ranges.length - 1].b = Math.max(ranges[ranges.length - 1].b, b0);
      } else ranges.push({ a: a0, b: b0 });
    }
    var all = [];
    for (var g = 0; g < ranges.length; g++) {
      if (N && N()) break;
      var a = ranges[g].a, b = ranges[g].b;
      var sub = {};
      for (var k in o) sub[k] = o[k];
      sub.candles = D.slice(a, b);
      var res = orig.call(self, d, sub, x, function () {}, N) || [];
      for (var m = 0; m < res.length; m++) {
        var rr = res[m];
        rr.startIndex += a; rr.endIndex += a;
        if (rr.rawMatchIndices) { rr.rawMatchIndices.start += a; rr.rawMatchIndices.end += a; }
        all.push(rr);
      }
      if (p) try { p(Math.round(((g + 1) / ranges.length) * 100), 'fast-scan'); } catch (e) {}
    }
    return dedupe(all);
  }

  /* ---------- matcher wrapping ---------- */

  function wrapMatcher(M) {
    if (!M || M.__dnaMethodsWrapped) return M;
    var ORIG = M.findMatchesInDataset;
    var ORIGC = M.findMatchesInCustomPatterns;
    if (typeof ORIG !== 'function') return M;
    M.__dnaMethodsWrapped = true;
    M.__dnaOrigFind = ORIG;

    M.findMatchesInDataset = function (d, o, x, p, N) {
      var self = this || M;
      if (!enabled()) return ORIG.call(self, d, o, x, p, N);
      var ticks = getTicks();
      refreshQuery(); // sync read of the confirmed image query (methods 5/6)
      var cfg = cfgWithWeights(x || {}, ticks);
      var scales = ticks.multiscale ? [0.75, 1, 1.3] : [1];
      var all = [];
      for (var s = 0; s < scales.length; s++) {
        var c2 = {};
        for (var k in cfg) c2[k] = cfg[k];
        c2.patternLength = Math.max(10, Math.round((cfg.patternLength || 30) * scales[s]));
        var res = ticks.fastscan
          ? fastFind(ORIG, self, d, o, c2, p, N)
          : (ORIG.call(self, d, o, c2, p, N) || []);
        for (var i = 0; i < res.length; i++) all.push(res[i]);
        if (N && N()) break;
      }
      if (scales.length > 1) all = dedupe(all);
      if (ticks.ohlc4 || ticks.anatomy) all = refineResults(all, o, ticks, cfg.threshold);
      all.sort(function (a, b) { return b.similarity - a.similarity; });
      for (var r = 0; r < all.length; r++) all[r].rank = r + 1;
      return all;
    };

    if (typeof ORIGC === 'function') {
      M.__dnaOrigFindCustom = ORIGC;
      M.findMatchesInCustomPatterns = function (q, list, cfg) {
        var self = this || M;
        if (!enabled()) return ORIGC.call(self, q, list, cfg);
        return ORIGC.call(self, q, list, cfgWithWeights(cfg || {}, getTicks()));
      };
    }
    return M;
  }

  window.__dnaHook = function (M) {
    if (!enabled()) return M;
    return wrapMatcher(M);
  };

  /* ---------- v37: green play runs Engine-1 on the confirmed image pattern ---------- */

  var PLAY_OFF = 'chartdna_pxplay'; // kill switch: '0' -> original play behaviour
  function playOn() {
    try { return localStorage.getItem(PLAY_OFF) !== '0'; } catch (e) { return true; }
  }

  // closes of the confirmed Engine-3 pattern (chartdna_px_overlay) — the play button's
  // fallback reference (bundle P23) and its render-time presence check (bundle P24)
  var pxCache = { at: 0, val: null };
  window.__pxQuery = function () {
    if (!playOn()) return null;
    var now = Date.now();
    if (now - pxCache.at < 800) return pxCache.val;
    var v = null;
    try {
      var raw = localStorage.getItem(OV_STORE);
      if (raw) {
        var rec = JSON.parse(raw);
        if (rec && rec.candles && rec.candles.length > 5) {
          v = [];
          for (var i = 0; i < rec.candles.length; i++) {
            var c = rec.candles[i];
            var x = Number(c.c != null ? c.c : c.close);
            if (isFinite(x)) v.push(x);
          }
          if (v.length < 6) v = null;
        }
      }
    } catch (e) {}
    pxCache = { at: now, val: v };
    return v;
  };

  function analyzing() {
    var st = document.getElementById('btn-stop-analysis');
    return !!(st && !st.disabled);
  }

  // React only recomputes hasPattern on its next render; until then we un-disable the
  // play button ourselves so the confirmed image pattern is immediately searchable
  function armPlay() {
    if (!playOn()) return;
    var b = document.getElementById('btn-start-analysis');
    if (!b || analyzing()) return;
    if (b.disabled && window.__pxQuery()) {
      b.disabled = false;
      b.style.opacity = '1';
      b.style.cursor = 'pointer';
      b.setAttribute('data-dna-pxplay', 'armed');
    }
  }

  /* ---------- settings-panel checkbox card ---------- */

  var CARD_ID = 'dna-methods-card';

  var ITEMS = [
    ['pearson',   'همبستگی پیرسون',              'هم‌شکلی کلی مسیر قیمت با الگو'],
    ['dtw',       'تطبیق کشسان زمانی (DTW)',      'یافتن شباهت حتی با کش‌آمدن یا فشرده‌شدن الگو'],
    ['slope',     'بردار شیب',                    'مقایسهٔ جهت و تندی حرکت در طول الگو'],
    ['extrema',   'قله‌ها و دره‌های ساختاری',      'تطبیق اسکلت الگو (نقاط بازگشت)'],
    ['ohlc4',     'تطبیق چهارکانالهٔ OHLC',       'مقایسهٔ هر چهار قیمتِ هر کندل — نیازمند الگوی تصویری تأییدشده'],
    ['anatomy',   'آناتومی کندل‌ها',              'مقایسهٔ بدنه و سایه‌های تک‌تک کندل‌ها — نیازمند الگوی تصویری تأییدشده'],
    ['multiscale','جستجوی چندمقیاسه',             'یافتن نسخه‌های فشرده یا کشیدهٔ الگو (۰٫۷۵× تا ۱٫۳×)'],
    ['fastscan',  'غربال دومرحله‌ای سریع',        'اسکن سریع کل تاریخچه و سنجش دقیق فقط روی نامزدها']
  ];

  function buildCard() {
    var card = document.createElement('div');
    card.id = CARD_ID;
    card.dir = 'rtl';
    card.style.cssText = 'margin:10px 0;padding:12px;border-radius:12px;background:rgba(30,41,59,.6);border:1px solid rgba(148,163,184,.25);font-size:12px;line-height:1.7;';
    var title = document.createElement('div');
    title.textContent = 'روش‌های جستجو (با تیک انتخاب کنید)';
    title.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:8px;color:#e2e8f0;';
    card.appendChild(title);
    var t = getTicks();
    ITEMS.forEach(function (it) {
      var key = it[0];
      var row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin:6px 0;cursor:pointer;color:#cbd5e1;';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!t[key];
      cb.dataset.method = key;
      cb.style.cssText = 'margin-top:3px;accent-color:#22d3ee;width:15px;height:15px;flex:none;';
      cb.addEventListener('change', function () { setTick(key, cb.checked); });
      var txt = document.createElement('span');
      var b = document.createElement('b');
      b.textContent = it[1];
      b.style.color = '#f1f5f9';
      txt.appendChild(b);
      txt.appendChild(document.createTextNode(' — ' + it[2]));
      row.appendChild(cb);
      row.appendChild(txt);
      card.appendChild(row);
    });
    var note = document.createElement('div');
    note.textContent = 'اگر هیچ‌یک از چهار روش اول تیک نخورد، غربال پایه با پیرسون انجام می‌شود.';
    note.style.cssText = 'margin-top:8px;font-size:11px;color:#94a3b8;';
    card.appendChild(note);
    return card;
  }

  function findAnchor() {
    // the search-params pane contains the similarity-threshold label;
    // match on the node's DIRECT text so ancestors don't shadow the label itself
    var nodes = document.querySelectorAll('label,span,div,p');
    for (var i = 0; i < nodes.length; i++) {
      var tx = '', cn = nodes[i].childNodes;
      for (var j = 0; j < cn.length; j++) if (cn[j].nodeType === 3) tx += cn[j].nodeValue;
      if (tx && (tx.indexOf('آستانه حداقل شباهت') !== -1 || /Threshold\s*%/.test(tx))) return nodes[i];
    }
    return null;
  }

  function ensureCard() {
    if (!enabled()) return false;
    var existing = document.getElementById(CARD_ID);
    if (existing && existing.isConnected) return true;
    var anchor = findAnchor();
    if (!anchor) return false;
    // climb to the field's own block, then insert our card before it
    var block = anchor;
    for (var up = 0; up < 4 && block.parentElement; up++) {
      var cls = String(block.parentElement.className || '');
      if (cls.indexOf('gap-3.5') !== -1 || cls.indexOf('flex-col') !== -1) break;
      block = block.parentElement;
    }
    var parent = block.parentElement || anchor.parentElement;
    if (!parent) return false;
    try { parent.insertBefore(buildCard(), block); } catch (e) { return false; }
    return true;
  }

  function boot() {
    if (!enabled()) return;
    refreshQuery();
    try {
      var mo = new MutationObserver(function () {
        var c = document.getElementById(CARD_ID);
        if (!c || !c.isConnected) ensureCard();
        armPlay();
      });
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    } catch (e) {}
    ensureCard();
    armPlay();
    try { setInterval(armPlay, 1500); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();

  /* test seam */
  window.ChartDnaMethods = {
    version: 37,
    enabled: enabled,
    playOn: playOn,
    armPlay: armPlay,
    getTicks: getTicks,
    setTick: setTick,
    mapWeights: mapWeights,
    cfgWithWeights: cfgWithWeights,
    resample: resample,
    pearson: pearson,
    scoreOhlc4: scoreOhlc4,
    scoreAnatomy: scoreAnatomy,
    refineResults: refineResults,
    dedupe: dedupe,
    fastFind: fastFind,
    wrapMatcher: wrapMatcher,
    ensureCard: ensureCard,
    _setQuery: function (c) { queryCache = { at: Date.now(), candles: c }; }
  };
})();
