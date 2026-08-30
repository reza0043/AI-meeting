/*
 * Chart DNA — OHLC Vision Engine
 * ---------------------------------------------------------------------------
 * Reconstructs the OHLC of every candlestick *visible in an uploaded chart
 * screenshot*, measuring the image only:
 *
 *   1. colour masks for up/down candles
 *   2. chart chrome removed by shape/typography (overlay ticker text, price
 *      tag, volume subpanel, icons) — never by hard-coded rectangles
 *   3. candle grid recovery (pitch + phase) by least squares on body-run
 *      centres, validated by inter-candle continuity
 *   4. per-candle body/wick extents, repairing rows hidden by the dashed
 *      "last price" line
 *   5. price-axis calibration: gridline rows measured from the background,
 *      labels read with a dependency-free digit OCR, decimal-point repair,
 *      linear vs log axis test, last-price tag as an independent check
 *   6. OHLC invariants + neighbour continuity -> per-candle confidence
 *
 * Nothing is invented: a level that cannot be measured is reported missing, and
 * if the price axis cannot be read the candles are reported in pixels only.
 *
 * Environment agnostic: extract() needs {data, width, height} RGBA, so the same
 * code runs in a browser canvas and in Node (its unit tests).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChartDNACV = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TW = 14, TH = 20;                       // digit template grid (14x20)

  /* ----------------------------------------------------------------- utils */
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[s.length >> 1];
  }
  function percentile(a, p) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  }
  function round(v, d) { var m = Math.pow(10, d == null ? 2 : d); return Math.round(v * m) / m; }
  function std(a) {
    if (!a.length) return 0;
    var m = a.reduce(function (s, v) { return s + v; }, 0) / a.length;
    return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / a.length);
  }
  function mod(a, n) { return ((a % n) + n) % n; }
  function groupRuns(vals, gap) {
    var out = [], cur = [vals[0]];
    for (var i = 1; i < vals.length; i++) {
      if (vals[i] - cur[cur.length - 1] <= gap) cur.push(vals[i]);
      else { out.push([cur[0], cur[cur.length - 1]]); cur = [vals[i]]; }
    }
    out.push([cur[0], cur[cur.length - 1]]);
    return out;
  }
  function dedupe(v, tol) {
    var out = [];
    for (var i = 0; i < v.length; i++) {
      if (!out.length || v[i] - out[out.length - 1] > tol) out.push(v[i]);
      else out[out.length - 1] = (out[out.length - 1] + v[i]) / 2;
    }
    return out;
  }
  /* bridge vertical runs across the row band painted by the dashed price line */
  function bridgeBand(runs, band0, band1, maxGap) {
    if (!runs.length) return [];
    var out = [[runs[0][0], runs[0][1]]];
    for (var i = 1; i < runs.length; i++) {
      var prev = out[out.length - 1], a = runs[i][0], b = runs[i][1];
      var g0 = prev[1] + 1, g1 = a - 1, len = g1 - g0 + 1;
      if (len > 0 && len <= maxGap && g0 >= band0 - 3 && g1 <= band1 + 3) prev[1] = b;
      else out.push([a, b]);
    }
    return out;
  }
  function lstsq2(xs, ys) {                    // ys = a*xs + b
    var n = xs.length, i;
    if (n < 2) return null;
    if (n === 2) {
      var a0 = (ys[1] - ys[0]) / ((xs[1] - xs[0]) || 1e-9);
      return { a: a0, b: ys[0] - a0 * xs[0] };
    }
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    var d = n * sxx - sx * sx;
    if (Math.abs(d) < 1e-9) return null;
    var a = (n * sxy - sx * sy) / d, b = (sy - a * sx) / n;
    return { a: a, b: b };
  }
  function weightedRow(arr, a, b) {
    var s = 0, w = 0;
    for (var y = a; y <= b; y++) { s += y * arr[y]; w += arr[y]; }
    return w > 0 ? s / w : (a + b) / 2;
  }
  function mergeRects(rects) {
    var out = [];
    rects = rects.slice().sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; });
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i], merged = false;
      for (var j = 0; j < out.length; j++) {
        var o = out[j];
        if (r.x0 <= o.x1 + 30 && r.x1 >= o.x0 - 30 && r.y0 <= o.y1 + 14 && r.y1 >= o.y0 - 14) {
          o.x0 = Math.min(o.x0, r.x0); o.x1 = Math.max(o.x1, r.x1);
          o.y0 = Math.min(o.y0, r.y0); o.y1 = Math.max(o.y1, r.y1);
          merged = true; break;
        }
      }
      if (!merged) out.push({ x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 });
    }
    return out;
  }

  /* ------------------------------------------------------------ components */
  function components(mask, W, H, maxComp) {
    var labels = new Int32Array(W * H), out = [], stack = new Int32Array(8192), id = 0;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var idx = y * W + x;
      if (!mask[idx] || labels[idx]) continue;
      id++;
      var sp = 0, count = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      stack[sp++] = idx; labels[idx] = id;
      while (sp > 0) {
        var cur = stack[--sp], cy = (cur / W) | 0, cx = cur - cy * W;
        count++;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        if (cx > 0 && mask[cur - 1] && !labels[cur - 1]) { labels[cur - 1] = id; stack[sp++] = cur - 1; }
        if (cx < W - 1 && mask[cur + 1] && !labels[cur + 1]) { labels[cur + 1] = id; stack[sp++] = cur + 1; }
        if (cy > 0 && mask[cur - W] && !labels[cur - W]) { labels[cur - W] = id; stack[sp++] = cur - W; }
        if (cy < H - 1 && mask[cur + W] && !labels[cur + W]) { labels[cur + W] = id; stack[sp++] = cur + W; }
        if (sp >= stack.length) { var ns = new Int32Array(stack.length * 2); ns.set(stack); stack = ns; }
      }
      out.push({ x0: x0, x1: x1, y0: y0, y1: y1, count: count, fill: count / ((x1 - x0 + 1) * (y1 - y0 + 1)) });
      if (out.length >= maxComp) return out;
    }
    return out;
  }
  /* components restricted to a rectangle (much cheaper than full-image CC) */
  function componentsIn(mask, W, H, x0, x1, y0, y1, maxComp) {
    var sub = new Uint8Array((x1 - x0 + 1) * (y1 - y0 + 1)), sw = x1 - x0 + 1;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++)
      if (mask[y * W + x]) sub[(y - y0) * sw + (x - x0)] = 1;
    var cs = components(sub, sw, y1 - y0 + 1, maxComp);
    for (var i = 0; i < cs.length; i++) { cs[i].x0 += x0; cs[i].x1 += x0; cs[i].y0 += y0; cs[i].y1 += y0; }
    return cs;
  }
  /* group components into text lines (shared baseline, adjacent in x) */
  function textLines(comps, opt) {
    var maxH = opt.maxH, minH = opt.minH == null ? 4 : opt.minH, maxW = opt.maxW,
        minPer = opt.minPerLine == null ? 2 : opt.minPerLine, gapX = opt.gapX == null ? 40 : opt.gapX,
        lineGapY = opt.lineGapY == null ? 6 : opt.lineGapY, minSpan = opt.minSpan == null ? 20 : opt.minSpan;
    var cand = [], i, j;
    for (i = 0; i < comps.length; i++) {
      var c = comps[i];
      var w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
      if (h < minH || h > maxH || w > maxW || c.count < 4) continue;
      if (opt.y1 != null && c.y0 > opt.y1) continue;
      if (opt.y0 != null && c.y1 < opt.y0) continue;
      cand.push(c);
    }
    if (cand.length < minPer) return [];
    cand.sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; });
    var used = new Uint8Array(cand.length), lines = [];
    for (i = 0; i < cand.length; i++) {
      if (used[i]) continue;
      var grp = [cand[i]]; used[i] = 1;
      for (j = i + 1; j < cand.length; j++) {
        if (used[j]) continue;
        var last = grp[grp.length - 1], q = cand[j];
        if (Math.abs(q.y0 - last.y0) <= lineGapY && q.x0 - last.x1 <= gapX) { grp.push(q); used[j] = 1; }
      }
      if (grp.length < minPer) continue;
      var X0 = 1e9, X1 = -1, Y0 = 1e9, Y1 = -1, cnt = 0;
      for (j = 0; j < grp.length; j++) {
        X0 = Math.min(X0, grp[j].x0); X1 = Math.max(X1, grp[j].x1);
        Y0 = Math.min(Y0, grp[j].y0); Y1 = Math.max(Y1, grp[j].y1); cnt += grp[j].count;
      }
      if (X1 - X0 < minSpan) continue;
      lines.push({ x0: X0, x1: X1, y0: Y0, y1: Y1, cy: (Y0 + Y1) / 2, count: cnt, comps: grp });
    }
    lines.sort(function (a, b) { return a.cy - b.cy; });
    return lines;
  }

  /* ------------------------------------------------------------- templates */
  /* Digit templates are 14x20 ink-density grids. A browser rasterises them
   * with canvas (a few generic families; the best match wins). A host may
   * inject its own set — that is how the Node tests feed them in.          */
  function canvasTemplates(makeCtx) {
    var sets = [], fonts = ['sans-serif', 'Arial', 'Helvetica', 'Verdana', 'monospace'];
    for (var f = 0; f < fonts.length; f++) {
      var set = {}, ok = true;
      for (var d = 0; d <= 9; d++) {
        var g = null;
        try { g = makeGlyph(makeCtx, String(d), fonts[f]); } catch (e) { g = null; }
        if (!g) { ok = false; break; }
        set[String(d)] = g;
      }
      if (ok) sets.push(set);
    }
    return sets;
  }
  function makeGlyph(makeCtx, ch, font) {
    var S = 160, o = makeCtx(S), ctx = o.ctx || o, cv = o.canvas || ctx.canvas, x, y;
    cv.width = S; cv.height = S;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
    ctx.font = Math.round(S * 0.72) + 'px ' + font;
    ctx.fillText(ch, 2, 2);
    var d = ctx.getImageData(0, 0, S, S).data;
    var mask = [], x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (y = 0; y < S; y++) {
      var row = [];
      for (x = 0; x < S; x++) {
        var on = d[(y * S + x) * 4] > 90 ? 1 : 0;
        row.push(on);
        if (on) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      mask.push(row);
    }
    if (x1 < 0) return null;
    var sub = mask.slice(y0, y1 + 1).map(function (r) { return r.slice(x0, x1 + 1); });
    return downsample(sub, TW, TH);
  }
  function downsample(mask, tw, th) {
    var h = mask.length, w = mask[0].length, out = new Float32Array(tw * th);
    var area = (w * h) / (tw * th), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (!mask[y][x]) continue;
      out[Math.min(th - 1, Math.floor(y * th / h)) * tw + Math.min(tw - 1, Math.floor(x * tw / w))] += 1;
    }
    for (var i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / area);
    return out;
  }
  function ncc(a, b) {
    var ma = 0, mb = 0, i;
    for (i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    ma /= a.length; mb /= b.length;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < a.length; i++) { var x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    var den = Math.sqrt(da * db);
    return den > 1e-6 ? num / den : 0;
  }
  /* read a strip as a number: glyph runs, separators by vertical position */
  function readNumber(lum, W, y0, y1, xs, xe, base, templates) {
    if (!templates || !templates.length) return null;
    var cols = [], x, y, hit, i;
    xs = Math.max(0, xs); xe = Math.min(W - 1, xe);
    for (x = xs; x <= xe; x++) {
      hit = 0;
      for (y = y0; y <= y1; y++) if (Math.abs(lum[y * W + x] - base) > 26) hit++;
      if (hit > 0) cols.push(x);
    }
    if (cols.length < 3) return null;
    var cl = groupRuns(cols, 7);                        // leftmost cluster only
    var x0 = cl[0][0], x1 = cl[0][1];
    var runs = groupRuns(cols.filter(function (v) { return v <= x1; }), 2);
    var items = [];
    for (i = 0; i < runs.length; i++) {
      var p = runs[i][0], q = runs[i][1], mask = [], ry0 = 1e9, ry1 = -1;
      for (y = y0; y <= y1; y++) {
        var row = [];
        for (x = p; x <= q; x++) row.push(Math.abs(lum[y * W + x] - base) > 26 ? 1 : 0);
        mask.push(row);
        for (var k = 0; k < row.length; k++) if (row[k]) { if (y < ry0) ry0 = y; if (y > ry1) ry1 = y; }
      }
      if (ry1 < 0) continue;
      items.push({ w: q - p + 1, h: ry1 - ry0 + 1, ry0: ry0 - y0, ry1: ry1 - y0, mask: mask.slice(ry0 - y0, ry1 - y0 + 1) });
    }
    if (!items.length) return null;
    // digit metrics: median of the taller runs (the "0 6 8 9" bodies)
    var hs = items.map(function (v) { return v.h; }).sort(function (a, b) { return a - b; });
    var maxH = items.length > 3 ? percentile(hs, 0.75) : hs[hs.length - 1];
    var baseline = 0;
    for (i = 0; i < items.length; i++) if (items[i].h >= 0.6 * maxH) baseline = Math.max(baseline, items[i].ry1);
    // touching glyphs: a blob much wider than a digit is split into slots
    var split = [];
    for (i = 0; i < items.length; i++) {
      var it0 = items[i];
      if (it0.h < 0.6 * maxH || it0.w <= 1.45 * maxH) { split.push(it0); continue; }
      var parts = Math.max(2, Math.min(6, Math.round(it0.w / (0.62 * it0.h))));
      var pw = it0.w / parts;
      for (var pi = 0; pi < parts; pi++) {
        var a0 = Math.round(pi * pw), a1 = Math.round((pi + 1) * pw) - 1;
        if (a1 < a0) continue;
        var m2 = it0.mask.map(function (rw) { return rw.slice(a0, a1 + 1); });
        var any = m2.some(function (rw) { return rw.some(function (v) { return v === 1; }); });
        if (!any) continue;
        split.push({ w: a1 - a0 + 1, h: it0.h, ry0: it0.ry0, ry1: it0.ry1, mask: m2, merged: true });
      }
    }
    items = split;
    var text = '', scoreSum = 0, scoreN = 0, digitN = 0;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.h < 0.6 * maxH) { text += (it.ry1 > baseline + 1) ? ',' : '.'; continue; }
      var grid = downsample(it.mask, TW, TH), bs = -2, bc = '';
      for (var t = 0; t < templates.length; t++) {
        var set = templates[t];
        for (var ch in set) { var sc = ncc(grid, set[ch]); if (sc > bs) { bs = sc; bc = ch; } }
      }
      text += bc; scoreSum += bs; scoreN++; digitN++;
      it.score = bs;
    }
    var lowScore = 1;
    for (i = 0; i < items.length; i++) if (items[i].score != null) lowScore = Math.min(lowScore, items[i].score);
    return { text: text, value: parseNumber(text), score: scoreN ? scoreSum / scoreN : 0, digits: digitN, glyphScore: lowScore, x0: x0, x1: x1, height: maxH };
  }
  /* "4,600.00" | "4.600,00" | "4600" -> 4600 : last separator = decimal point */
  function parseNumber(s) {
    var m = String(s).replace(/[^0-9.,]/g, '');
    if (!m) return 0;
    var last = Math.max(m.lastIndexOf(','), m.lastIndexOf('.'));
    var intPart = last < 0 ? m : m.slice(0, last);
    var decPart = last < 0 ? '' : m.slice(last + 1);
    if (decPart.length > 8) decPart = decPart.slice(0, 8);
    var iv = parseFloat(intPart.replace(/[.,]/g, '') || '0');
    if (!isFinite(iv)) return 0;
    var dv = decPart.length ? (parseFloat(decPart.replace(/[.,]/g, '') || '0') / Math.pow(10, decPart.length)) : 0;
    return iv + (isFinite(dv) ? dv : 0);
  }

  /* ---------------------------------------------------------------- extract */
  function extract(img, opts) {
    opts = opts || {};
    var W = img.width, H = img.height, D = img.data, n = W * H, i, x, y, p;
    var lum = new Float32Array(n);
    var red = new Uint8Array(n), green = new Uint8Array(n), tag = new Uint8Array(n);
    for (p = 0, i = 0; p < n; p++, i += 4) {
      var r = D[i], g = D[i + 1], b = D[i + 2];
      lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (r > 120 && r - g > 45 && r - b > 30) red[p] = 1;
      if (g > 100 && g - r > 35 && g - b > 15) green[p] = 1;
      // a *solid* filled badge (mean colour well past the thin candle stroke)
      if (r > 150 && r - g > 70 && r - b > 55 && g < 110) tag[p] = 1;
    }
    var candle = new Uint8Array(n);
    for (p = 0; p < n; p++) if (red[p] || green[p]) candle[p] = 1;

    /* --- 1. plot extent (raw colours; widest continuous x cluster) ------ */
    var colHas = new Uint8Array(W), rowSeen = new Uint8Array(H);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (candle[y * W + x]) { colHas[x] = 1; rowSeen[y] = 1; }
    var xsAll = [];
    for (x = 0; x < W; x++) if (colHas[x]) xsAll.push(x);
    if (xsAll.length < 8) return fail('no candlestick pixels found — is this a candle chart?');
    var xCl = groupRuns(xsAll, 8), dataX0 = xCl[0][0], dataX1 = xCl[0][1], bestSpan = dataX1 - dataX0;
    for (i = 1; i < xCl.length; i++) {
      var spn = xCl[i][1] - xCl[i][0];
      if (spn > bestSpan) { bestSpan = spn; dataX0 = xCl[i][0]; dataX1 = xCl[i][1]; }
    }

    /* --- 2. chrome: solid price tag in the gutter, overlay text lines ---- */
    var priceTag = null, tagRects = [];
    if (dataX1 < W - 12 || dataX0 > 12) {
      var tx0 = dataX1 < W - 12 ? Math.min(W - 1, dataX1 + 2) : 0;
      var tx1 = dataX1 < W - 12 ? W - 1 : Math.max(0, dataX0 - 2);
      tagRects = componentsIn(tag, W, H, tx0, tx1, 0, H - 1, 4000).filter(function (c) {
        var w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
        return c.count >= 150 && c.fill > 0.45 && w >= 24 && w <= 0.42 * W && h >= 10 && h <= 0.2 * H;
      });
    }
    for (i = 0; i < tagRects.length; i++) {
      var tr = tagRects[i];
      for (y = tr.y0; y <= tr.y1; y++) for (x = tr.x0; x <= tr.x1; x++) { candle[y * W + x] = 0; red[y * W + x] = 0; green[y * W + x] = 0; }
      if (!priceTag || tr.count > priceTag.count) priceTag = tr;
    }
    /* --- 2b. overlay text (symbol/price ticker painted on the plot) ------
     * A text line is found by typography — several glyphs of similar height
     * on one baseline, tightly spaced — and then *tested against the candle
     * grid*: pixels sitting on the bar centres are candles and stay, pixels
     * that ignore the grid are chrome and are removed. */
    var uiRects = [];
    if (!opts.noChromeMask) {
      uiRects = findChrome(candle, W, H, dataX0, dataX1);
      for (i = 0; i < uiRects.length; i++) {
        var u = uiRects[i];
        for (y = Math.max(0, u.y0); y <= Math.min(H - 1, u.y1); y++)
          for (x = Math.max(0, u.x0); x <= Math.min(W - 1, u.x1); x++) {
            candle[y * W + x] = 0; red[y * W + x] = 0; green[y * W + x] = 0;
          }
      }
    }

    /* --- 3. price pane; a volume subpanel below is a separate cluster ---- */
    var rowPix = new Int32Array(H), rowRed = new Int32Array(H);
    for (y = 0; y < H; y++) {
      var cnt = 0, cntR = 0;
      for (x = dataX0; x <= dataX1; x++) { var q = y * W + x; if (candle[q]) cnt++; if (red[q]) cntR++; }
      rowPix[y] = cnt; rowRed[y] = cntR;
    }
    var rowsWith = [];
    for (y = 0; y < H; y++) if (rowPix[y] >= 1) rowsWith.push(y);
    if (!rowsWith.length) return fail('candle pixels do not form a price pane');
    var rCl = groupRuns(rowsWith, 8), bestRow = rCl[0], bestPix = -1;
    for (i = 0; i < rCl.length; i++) {
      var s = 0;
      for (y = rCl[i][0]; y <= rCl[i][1]; y++) s += rowPix[y];
      if (s > bestPix) { bestPix = s; bestRow = rCl[i]; }
    }
    // extend while the cluster keeps a contiguous trail of coloured rows
    var e0 = bestRow[0], e1 = bestRow[1];
    while (e0 - 1 >= 0 && rowPix[e0 - 1] >= 1) e0--;
    while (e1 + 1 < H && rowPix[e1 + 1] >= 1) e1++;
    var paneTop = Math.max(0, e0 - 12), paneBot = Math.min(H - 1, e1 + 12);
    var volumePane = null;
    for (i = 0; i < rCl.length; i++) {
      if (rCl[i][1] <= e1 + 2) continue;
      var s2 = 0;
      for (y = rCl[i][0]; y <= rCl[i][1]; y++) s2 += rowPix[y];
      if (s2 > 0.02 * (dataX1 - dataX0)) { volumePane = { top: rCl[i][0], bottom: rCl[i][1] }; paneBot = Math.min(paneBot, rCl[i][0] - 2); }
    }
    var prefix = rowPrefix(red, green, W, H, dataX0, dataX1);

    /* --- 4. dashed last-price line: an occluder, not a candle ------------ */
    var span = Math.max(1, dataX1 - dataX0), plRows = [];
    for (y = paneTop; y <= paneBot; y++) if (rowRed[y] > 0.10 * span) plRows.push(y);
    var plBand = plRows.length ? groupRuns(plRows, 2)[0] : null;
    var band0 = plBand ? plBand[0] - 2 : -1000, band1 = plBand ? plBand[1] + 3 : -990;
    var priceLineRow = plBand ? weightedRow(rowRed, plBand[0], plBand[1]) : null;

    /* --- 5. price axis: gridline rows + label OCR + price tag ------------ */
    var gutter = gutterSide(lum, W, H, dataX0, dataX1, paneTop, paneBot);
    var axis = detectAxis(lum, W, H, dataX0, dataX1, gutter, paneTop, paneBot);
    var refs = [], labels = [];
    if (gutter && opts.templates && opts.templates.length) {
      labels = readAxisLabels(lum, W, H, axis, gutter, opts.templates, band0, band1, paneTop, paneBot);
    }
    for (i = 0; i < labels.length; i++) refs.push({ row: labels[i].row, price: labels[i].price, source: 'axis-label', text: labels[i].text, score: labels[i].score });
    var tagRead = null;
    if (priceTag && opts.templates && opts.templates.length) tagRead = readTag(lum, W, priceTag, axis.base, opts.templates);
    if (tagRead && tagRead.value > 0 && priceLineRow != null && tagRead.glyphScore > 0.45) {
      refs.push({ row: priceLineRow, price: tagRead.value, source: 'price-tag', text: tagRead.text });
    }
    (opts.extraRefs || []).forEach(function (e) { refs.push({ row: e.row, price: e.price, source: e.source || 'manual' }); });
    var calib = buildCalibration(refs);

    /* --- 6. candle grid + per-candle geometry ---------------------------- */
    var medW = modalBodyWidth(candle, W, dataX0, dataX1, paneTop, paneBot, band0, band1);
    var grids = fitGrid(candle, W, dataX0, dataX1, paneTop, paneBot, band0, band1, medW);
    if (!grids.length) return fail('could not resolve a regular candle grid (not a candlestick chart?)');
    var bars = extractBars(red, green, W, H, dataX0, dataX1, paneTop, paneBot, band0, band1, grids[0], calib);
    var bestScore = scoreContinuity(bars);
    for (i = 1; i < Math.min(grids.length, 4); i++) {
      var b2 = extractBars(red, green, W, H, dataX0, dataX1, paneTop, paneBot, band0, band1, grids[i], calib);
      var sc = scoreContinuity(b2);
      if (sc > bestScore + 0.02) { bestScore = sc; bars = b2; grids[0] = grids[i]; }
    }
    var grid = grids[0];

    /* --- 7. flags: neighbour discontinuities ---------------------------- */
    if (calib && calib.detected) {
      for (i = 1; i < bars.length; i++) {
        var a1 = bars[i - 1], a2 = bars[i];
        if (a1.status !== 'ok' || a2.status !== 'ok') continue;
        if (Math.abs(a2.open - a1.close) > 4.0) {
          penalise(a1, 0.08, 'open/close jump vs the previous candle (merged or split pixels)');
          penalise(a2, 0.08, 'open/close jump vs the previous candle (merged or split pixels)');
        }
      }
    }
    var okBars = bars.filter(function (bb) { return bb.status === 'ok'; });
    var contPx = [], contUsd = [];
    for (i = 1; i < okBars.length; i++) {
      contPx.push(Math.abs(okBars[i].openPx - okBars[i - 1].closePx));
      if (calib && calib.detected) contUsd.push(Math.abs(okBars[i].open - okBars[i - 1].close));
    }
    var bad = 0;
    for (i = 0; i < bars.length; i++) if (bars[i].status !== 'ok') bad++;

    return {
      ok: true, version: '1.0.0',
      bars: bars,
      candles: okBars.length - bad + bad,          // total slots measured
      complete: okBars.length,
      missing: bars.length - okBars.length,
      calibration: calib,
      labels: labels,
      priceTag: tagRead ? { text: tagRead.text, value: tagRead.value, row: round(priceLineRow, 2), score: round(tagRead.glyphScore, 2) } : null,
      axis: { side: gutter ? gutter.side : null, gridlineRows: axis.gridRows.map(function (v) { return round(v, 2); }), background: round(axis.base, 1), strip: axis.strip },
      volumePane: volumePane,
      chromeRects: uiRects,
      geometry: {
        pitch: round(grid.pitch, 5), x0: round(grid.x0, 4), kmin: grid.kmin, kmax: grid.kmax,
        bars: grid.kmax - grid.kmin + 1, bodyHalf: grid.half, bodyWidthPx: medW,
        dataX0: dataX0, dataX1: dataX1, paneTop: paneTop, paneBot: paneBot,
        priceLineRows: plBand, gridlineRows: axis.gridRows.map(function (v) { return round(v, 2); }),
        verticalGridlines: verticalGridlines(candle, lum, W, H, dataX0, dataX1, paneTop, paneBot, band0, band1),
        alignment: grid.alignment, gridResidualPx: round(grid.residualStd, 3)
      },
      quality: {
        meanConfidence: okBars.length ? round(okBars.reduce(function (t, bb) { return t + bb.confidence; }, 0) / okBars.length, 3) : 0,
        minConfidence: okBars.length ? round(Math.min.apply(null, okBars.map(function (bb) { return bb.confidence; })), 2) : 0,
        needReview: okBars.filter(function (bb) { return bb.confidence < 0.9; }).map(function (bb) { return bb.candle; }),
        continuityMedianUSD: round(median(contUsd), 3),
        continuityP90USD: round(percentile(contUsd, 0.9), 3),
        continuityMaxUSD: round(contUsd.length ? Math.max.apply(null, contUsd) : 0, 3),
        continuityMedianPx: round(median(contPx), 3),
        alignment: grid.alignment,
        calibrated: !!(calib && calib.detected),
        usdPerPx: calib && calib.detected ? round(calib.usdPerPx, 4) : null
      },
      note: calib && calib.detected
        ? 'measured from pixels; 1 pixel row = ' + round(calib.usdPerPx, 3) + ' so every level carries about +/- that amount'
        : 'price axis not readable — pixel geometry reported, no price values invented'
    };
  }
  function fail(msg) { return { ok: false, error: msg, bars: [], candles: 0, complete: 0, calibration: { mode: 'none', detected: false, refs: [] } }; }
  function penalise(b, d, note) {
    b.confidence = round(Math.max(0.3, b.confidence - d), 2);
    if (b.notes.indexOf(note) < 0) b.notes.push(note);
  }
  /* per-row colour counts for any x window, O(1) per query */
  function rowPrefix(red, green, W, H, x0, x1) {
    var w = x1 - x0 + 2, pr = new Int32Array(H * w), pg = new Int32Array(H * w);
    for (var y = 0; y < H; y++) {
      var so = y * w, ro = y * W + x0, accR = 0, accG = 0;
      pr[so] = 0; pg[so] = 0;
      for (var x = 0; x <= x1 - x0; x++) {
        accR += red[ro + x]; accG += green[ro + x];
        pr[so + x + 1] = accR; pg[so + x + 1] = accG;
      }
    }
    return {
      x0: x0, w: w, r: pr, g: pg,
      row: function (mask, y, a, b) { return mask[y * this.w + (b - this.x0 + 1)] - mask[y * this.w + (a - this.x0)]; }
    };
  }
  function modalBodyWidth(candle, W, x0, x1, y0, y1, b0, b1) {
    var hist = new Int32Array(20), total = 0;
    for (var y = y0; y <= y1; y++) {
      if (y >= b0 && y <= b1) continue;
      var run = -1;
      for (var x = x0; x <= x1 + 1; x++) {
        var on = x <= x1 && candle[y * W + x];
        if (on && run < 0) run = x;
        else if (!on && run >= 0) {
          var w = x - run;
          if (w >= 2 && w <= 19) { hist[w]++; total++; }
          run = -1;
        }
      }
    }
    if (!total) return 4;
    var bestW = 4, bestC = -1;
    for (var k = 3; k < 13; k++) if (hist[k] > bestC) { bestC = hist[k]; bestW = k; }
    return bestW;
  }

  function findChrome(candle, W, H, x0, x1, y0band, y1band) {
    var topBand = Math.round(0.4 * H);
    var comps = componentsIn(candle, W, H, x0, x1, 0, topBand - 1, 40000);
    var hh = Math.max(9, Math.round(0.05 * H));
    /* text in a caption is uniform in size: take the dominant glyph height of
       the band and keep components in a tight band around it (drops both specks
       and the tall candle fragments that happen to be there) */
    var hs0 = comps.map(function (c) { return c.y1 - c.y0 + 1; }).filter(function (v) { return v >= 5; });
    var medH = median(hs0.slice().sort(function (a, b) { return a - b; }));
    if (!(medH >= 5)) return [];
    comps = comps.filter(function (c) {
      var h = c.y1 - c.y0 + 1;
      return h >= 0.6 * medH && h <= 1.4 * medH;
    });
    var lines = textLines(comps, {
      maxH: hh, minH: Math.max(5, Math.round(0.012 * H)), maxW: Math.round(0.95 * hh),
      minPerLine: 5, gapX: Math.round(1.1 * hh), minSpan: Math.round(0.09 * W), lineGapY: 3
    });
    var out = [];
    for (var li = 0; li < lines.length; li++) {
      var L = lines[li];
      // baseline alignment: most glyphs must end at the same row
      var ys = L.comps.map(function (c) { return c.y1; }).sort(function (a, b) { return a - b; });
      var med = median(ys), onBase = 0;
      for (var i = 0; i < ys.length; i++) if (Math.abs(ys[i] - med) <= 2) onBase++;
      if (onBase < 0.75 * ys.length) continue;
      var hs = L.comps.map(function (c) { return c.y1 - c.y0 + 1; }).sort(function (a, b) { return a - b; });
      if (percentile(hs, 0.9) > 1.9 * percentile(hs, 0.2)) continue;
      // reject if these pixels sit on the bar centres: those are candles
      var align = gridAlignFraction(candle, W, L, x0, x1);
      if (align > 0.5) continue;
      out.push({ x0: L.x0 - 3, x1: L.x1 + 3, y0: L.y0 - 3, y1: L.y1 + 3, align: round(align, 2), w: L.x1 - L.x0, h: L.y1 - L.y0 });
    }
    return mergeRects(out);
  }
  /* how strongly a blob group sits on the body-run centres of the candle grid */
  function gridAlignFraction(candle, W, box, x0, x1) {
    var centers = [], y, x;
    for (y = box.y0; y <= box.y1; y++) {
      var run = -1;
      for (x = box.x0; x <= box.x1 + 1; x++) {
        var on = x <= box.x1 && candle[y * W + x];
        if (on && run < 0) run = x;
        else if (!on && run >= 0) { centers.push((run + x - 1) / 2); run = -1; }
      }
    }
    if (centers.length < 6) return 0;
    // text: centres are irregular. candles: constant pitch -> low residual of
    // a least-squares fit of centre index vs position
    var best = 0;
    var lo = Math.max(3, box.h * 0.6), hi = box.w / 2;
    for (var pitch = lo; pitch <= hi; pitch += 0.05) {
      var hits = 0, ph;
      for (ph = 0; ph < pitch; ph += 0.5) {
        var h = 0;
        for (var i = 0; i < centers.length; i++) if (Math.abs(mod(centers[i] - ph, pitch) - pitch / 2) <= 1.2) h++;
        if (h > hits) hits = h;
      }
      best = Math.max(best, hits / centers.length);
    }
    return best;
  }

  /* ------------------------------------------------------------- axis text */
  function gutterSide(lum, W, H, dataX0, dataX1, y0, y1) {
    // a price axis is a block of label text in the empty margin beside the plot:
    // find columns carrying glyph ink, take the first column cluster there
    function probe(from, to) {
      var cols = [];
      for (var x = from; x <= to; x++) {
        var hit = 0;
        for (var y = y0; y <= y1; y++) if (lum[y * W + x] > 55) hit++;
        if (hit > 4) cols.push(x);
      }
      if (cols.length < 8) return null;
      var cl = groupRuns(cols, 10);
      var run = cl[0];
      for (var i = 1; i < cl.length; i++) if (cl[i][1] - cl[i][0] > run[1] - run[0]) run = cl[i];
      return { x0: run[0], x1: run[1], n: cols.length, all: cols };
    }
    var right = probe(Math.min(W - 1, dataX1 + 2), W - 1);
    var left = probe(0, Math.max(0, dataX0 - 2));
    if (!right && !left) return null;
    if (right && left && left.x1 - left.x0 > right.x1 - right.x0) right = null;
    else if (right && left) left = null;
    return right
      ? { side: 'right', x0: right.x0, x1: right.x1, plotEdge: dataX1, n: right.n }
      : { side: 'left', x0: left.x0, x1: left.x1, plotEdge: dataX0, n: left.n };
  }
  /* gridline rows: measured where only background lives — the empty strip
     between the last bar and the price labels (or the plot's right edge) */
  function detectAxis(lum, W, H, dataX0, dataX1, gutter, y0, y1) {
    var xa, xb;
    if (gutter && gutter.side === 'right') { xa = (gutter.plotEdge || dataX1) + 6; xb = gutter.x0 - 6; }
    else if (gutter && gutter.side === 'left') { xa = gutter.x1 + 6; xb = (gutter.plotEdge || dataX0) - 6; }
    else { xa = dataX0; xb = dataX1; }
    if (xb - xa < 24) { xa = Math.max(dataX0, dataX1 - 260); xb = dataX1 - 4; }
    xa = Math.max(0, Math.min(W - 2, xa)); xb = Math.max(xa + 4, Math.min(W - 1, xb));
    var n = Math.max(1, y1 - y0 + 1), meds = new Float32Array(n), y, x;
    var buf = [];
    for (y = 0; y < n; y++) {
      buf.length = 0;
      for (x = xa; x <= xb; x += 2) buf.push(lum[(y0 + y) * W + x]);
      meds[y] = median(buf);
    }
    var base = median(Array.prototype.slice.call(meds)), up = 0, dn = 0;
    for (y = 0; y < n; y++) { up += Math.max(0, meds[y] - base); dn += Math.max(0, base - meds[y]); }
    var sign = up >= dn ? 1 : -1;
    /* many dark themes dither the background by +/-1 grey level, which would
       make every other row look like a line: smooth first, then threshold */
    var sm = new Float32Array(n);
    for (y = 0; y < n; y++) {
      var a = meds[Math.max(0, y - 1)] + meds[y] + meds[Math.min(n - 1, y + 1)];
      sm[y] = a / 3;
    }
    var dev = new Float32Array(n), i2;
    for (i2 = 0; i2 < n; i2++) dev[i2] = sign * (sm[i2] - base);
    var abs = new Float32Array(n);
    for (i2 = 0; i2 < n; i2++) abs[i2] = Math.abs(sm[i2] - base);
    var sig = median(Array.prototype.slice.call(abs));
    var rows = findLines(dev, y0, Math.max(1.5, 4 * sig));
    if (rows.length < 2) rows = findLines(dev, y0, 1.5);
    return { gridRows: dedupe(rows, 3), base: base, sigma: round(sig, 3), strip: [Math.round(xa), Math.round(xb)] };
  }
  function findLines(dev, origin, k) {
    var rows = [], y = 0, n = dev.length;
    while (y < n) {
      if (dev[y] > k) {
        var e = y;
        while (e + 1 < n && dev[e + 1] > k * 0.6) e++;
        var sw = 0, s2 = 0;
        for (var t = y; t <= e; t++) { var wv = Math.max(0, dev[t]); sw += (origin + t) * wv; s2 += wv; }
        rows.push(s2 > 0 ? sw / s2 : origin + y);
        y = e + 1;
      } else y++;
    }
    return rows;
  }
  function readAxisLabels(lum, W, H, axis, gutter, templates, band0, band1, y0, y1) {
    var x0 = Math.max(0, gutter.x0 - 3), x1 = Math.min(W - 1, gutter.x1 + 3);
    var ya = Math.max(0, y0 - 20), yb = Math.min(H - 1, y1 + 20);
    void x0;
    if (x1 - x0 < 6) return [];
    var ink = new Uint8Array(W * H), any = 0;
    for (var y = ya; y <= yb; y++) for (var x = x0; x <= x1; x++) {
      var q = y * W + x;
      if (Math.abs(lum[q] - axis.base) > 24) { ink[q] = 1; any++; }
    }
    if (any < 40) return [];
    // label row bands: rows that carry ink in the gutter
    var bandRows = [];
    for (var yy = ya; yy <= yb; yy++) {
      var hcnt = 0;
      for (var xx = x0; xx <= x1; xx++) if (ink[yy * W + xx]) hcnt++;
      if (hcnt > 2) bandRows.push(yy);
    }
    if (bandRows.length < 6) return [];
    var bands = groupRuns(bandRows, 4);
    var out = [];
    for (var li = 0; li < bands.length; li++) {
      var bya = Math.max(ya, bands[li][0] - 2), byb = Math.min(yb, bands[li][1] + 2);
      var cx0 = 1e9, cx1 = -1;
      for (yy = bya; yy <= byb; yy++) for (xx = x0; xx <= x1; xx++) if (ink[yy * W + xx]) { if (xx < cx0) cx0 = xx; if (xx > cx1) cx1 = xx; }
      if (cx1 < 0 || cx1 - cx0 < 6) continue;
      var L = { x0: cx0, x1: cx1, y0: bya, y1: byb, cy: (bands[li][0] + bands[li][1]) / 2 };
      var row = L.cy, best = null;
      for (var gi = 0; gi < axis.gridRows.length; gi++) {
        var d = Math.abs(axis.gridRows[gi] - row);
        if (d < Math.max(8, 0.6 * (L.y1 - L.y0)) && (!best || d < best.d)) best = { row: axis.gridRows[gi], d: d };
      }
      var useRow = best ? best.row : row;
      if (useRow > band0 - 6 && useRow < band1 + 6) continue;      // the price tag line
      var r = readNumber(lum, W, L.y0, L.y1, L.x0 - 1, L.x1 + 1, axis.base, templates);
      if (!r || !r.value || r.digits < 2) continue;
      if (!/^[0-9.,\s]+$/.test(r.text)) continue;
      if (r.glyphScore < 0.35) continue;                            // at least one glyph is garbage
      out.push({ row: round(useRow, 2), labelRow: round(row, 1), price: r.value, text: r.text, score: round(r.score, 2), snapped: !!best, box: [L.x0, L.y0, L.x1, L.y1] });
    }
    return out;
  }
  function readTag(lum, W, tr, fallbackBase, templates) {
    var vals = [], x, y;
    for (y = tr.y0; y <= tr.y1; y += 1) for (x = tr.x0; x <= tr.x1; x += 1) vals.push(lum[y * W + x]);
    var base = median(vals);
    return readNumber(lum, W, tr.y0 + 1, tr.y1 - 1, tr.x0 + 2, tr.x1 - 2, base, templates);
  }

  /* ------------------------------------------------------------ calibration */
  function buildCalibration(refs) {
    var uniq = {};
    refs.forEach(function (r) { uniq[Math.round(r.row * 100) + '|' + r.price] = r; });
    var list = Object.keys(uniq).map(function (k) { return uniq[k]; }).sort(function (a, b) { return a.row - b.row; });
    if (!list.length) return { mode: 'none', detected: false, refs: [] };
    if (list.length < 2) return { mode: 'relative', detected: false, refs: list, note: 'need at least two axis references for a price scale' };
    // monotonic: price must decrease as the pixel row increases
    var kept = list.filter(function (r, i2) { return i2 === 0 || r.row > list[i2 - 1].row + 1; });
    // decimal-point repair: a mis-read separator shifts a label by 10^k
    var notes = [];
    for (var pass = 0; pass < 2; pass++) {
      var fit = lstsq2(kept.map(function (r) { return r.row; }), kept.map(function (r) { return Math.log(Math.max(1e-9, r.price)); }));
      if (!fit) break;
      var changed = false;
      kept = kept.map(function (r) {
        var want = Math.exp(fit.a * r.row + fit.b);
        if (!(want > 0) || !(r.price > 0)) return r;
        var ratio = want / r.price, k = Math.round(Math.log(ratio) / Math.LN10);
        if (Math.abs(k) < 1) return r;
        if (Math.abs(Math.log(ratio) - k * Math.LN10) > 0.35) return r;      // not a decimal shift
        changed = true;
        notes.push({ text: r.text, row: r.row, from: r.price, to: r.price * Math.pow(10, k), why: 'decimal point repositioned to fit the axis spacing' });
        return Object.assign({}, r, { price: r.price * Math.pow(10, k), repaired: true });
      });
      if (!changed) break;
    }
    var ys = kept.map(function (r) { return r.row; }), ps = kept.map(function (r) { return r.price; });
    var lin = lstsq2(ys, ps), logs = ps.map(function (v) { return Math.log(Math.max(1e-9, v)); });
    var log = lstsq2(ys, logs);
    var rms = function (a) { return Math.sqrt(a.reduce(function (s, v) { return s + v * v; }, 0) / a.length); };
    var resLin = lin ? ys.map(function (yy, i2) { return ps[i2] - (lin.a * yy + lin.b); }) : [Infinity];
    var resLog = log ? ys.map(function (yy, i2) { return Math.exp(log.a * yy + log.b) - ps[i2]; }) : [Infinity];
    var rLin = rms(resLin), rLog = rms(resLog);
    var useLog = !!log && rLog < rLin * 0.85;
    var c = useLog
      ? { mode: 'log', a: log.a, b: log.b, price: function (row) { return Math.exp(log.a * row + log.b); } }
      : { mode: 'linear', a: lin.a, b: lin.b, price: function (row) { return lin.a * row + lin.b; } };
    var mid = (ys[0] + ys[ys.length - 1]) / 2;
    c.usdPerPx = Math.abs(c.price(mid) - c.price(mid + 1));
    c.residualUSD = round(useLog ? rLog : rLin, 4);
    c.linearResidualUSD = round(rLin, 4);
    c.modelChoice = useLog ? 'log price axis (fits the labels clearly better than linear)' : 'linear price axis';
    c.refs = kept.map(function (r) { return { row: round(r.row, 1), price: r.price, source: r.source, text: r.text, repaired: !!r.repaired }; });
    c.residuals = (useLog ? resLog : resLin).map(function (v) { return round(v, 3); });
    c.repairs = notes;
    c.detected = true;
    c.equation = useLog
      ? 'price = exp(' + round(c.a, 7) + ' * row + ' + round(c.b, 5) + ')   [log axis]'
      : 'price = ' + round(c.a, 6) + ' * row + ' + round(c.b, 4) + '   [linear axis]';
    // independent check: the tag price vs the dashed line row
    var tagRef = kept.filter(function (r) { return r.source === 'price-tag'; })[0];
    var other = kept.filter(function (r) { return r.source !== 'price-tag'; });
    if (tagRef && other.length >= 2) {
      var t2 = buildCalibration(other);
      if (t2.detected) {
        var measured = t2.price(tagRef.row);
        c.tagCheck = { tagPrice: tagRef.price, measured: round(measured, 2), errorUSD: round(measured - tagRef.price, 3) };
      }
    }
    return c;
  }

  /* ------------------------------------------------------------------- grid */
  function fitGrid(candle, W, x0, x1, y0, y1, b0, b1, medW) {
    /* body-run centres, kept only when the same structure repeats on the next
       row (a real body is 2+ rows tall; JPEG specks and serif fragments are not) */
    var centers = [], y, x, i;
    var wlo = Math.max(3, medW), whi = Math.max(4, medW) + 4;
    var prev = null, cur = [];
    for (y = y0; y <= y1; y++) {
      prev = cur; cur = [];
      if (y >= b0 && y <= b1) { cur = null; continue; }
      var run = -1;
      for (x = x0; x <= x1 + 1; x++) {
        var on = x <= x1 && candle[y * W + x];
        if (on && run < 0) run = x;
        else if (!on && run >= 0) {
          var w = x - run;
          if (w >= wlo && w <= whi) {
            var ce = (run + x - 1) / 2;
            var ok = false;
            if (prev) for (i = 0; i < prev.length; i++) if (Math.abs(prev[i] - ce) <= 1) { ok = true; break; }
            if (ok) centers.push(ce);
            cur.push(ce);
          }
          run = -1;
        }
      }
    }
    if (centers.length < 12) return [];
    var lo = Math.max(3, medW + 0.4), hi = Math.max(lo + 3, medW * 6);
    var BIN = 0.1, scored = [];
    /* for each candidate pitch, bin the centres by phase and slide a window:
       O(n) per pitch instead of O(n * phases) */
    for (var pitch = lo; pitch <= hi; pitch += 0.02) {
      var nb = Math.max(4, Math.round(pitch / BIN));
      var hist = new Int32Array(nb);
      for (i = 0; i < centers.length; i++) hist[Math.floor(mod(centers[i], pitch) / pitch * nb) % nb]++;
      var tolBins = Math.max(2, Math.round(Math.min(0.9, Math.max(0.45, pitch * 0.11)) / BIN));
      var hits = 0, hbin = 0, sum = 0, t;
      for (t = 0; t < nb + tolBins; t++) sum += hist[t % nb];
      for (t = 0; t < nb; t++) {
        sum += hist[(t + tolBins) % nb] - hist[t % nb];
        if (sum > hits) { hits = sum; hbin = t + Math.floor(tolBins / 2); }
      }
      scored.push({ pitch: pitch, phase: ((hbin + 0.5) / nb) * pitch, hits: hits });
      scored.sort(function (a, b) { return b.hits - a.hits; });
      if (scored.length > 40) scored.pop();
    }
    var out = [];
    var binW = Math.max(40, (x1 - x0) / 8);
    for (i = 0; i < scored.length; i++) {
      var g = refineGrid(centers, scored[i].pitch, scored[i].phase, medW, { x0: x0, x1: x1, binW: binW });
      if (g) out.push(g);
    }
    out = out.filter(function (g) {
      return g.pitch >= lo && g.bars >= 0.55 * (x1 - x0) / g.pitch;
    });
    /* rank by how well the WHOLE plot agrees, then by raw hits */
    out.sort(function (a, b) { return (b.cover * b.alignment) - (a.cover * a.alignment) || b.hits - a.hits; });
    var ded = [], j;
    for (i = 0; i < out.length; i++) {
      var dup = false;
      for (j = 0; j < ded.length; j++) {
        var samePhase = Math.abs(mod(out[i].x0 - ded[j].x0, out[i].pitch)) < 0.8 ||
                        Math.abs(mod(out[i].x0 - ded[j].x0 + out[i].pitch / 2, out[i].pitch)) < 0.8;
        if (Math.abs(out[i].pitch - ded[j].pitch) < 0.05 && samePhase) dup = true;
      }
      if (!dup) ded.push(out[i]);
    }
    return ded;
  }
  function refineGrid(centers, pitch, phase, medW, bin) {
    var p = pitch, x0 = phase, ks, xs, i, k, r, it;
    for (it = 0; it < 8; it++) {
      ks = []; xs = [];
      var tol = Math.max(0.5, Math.min(0.9, p * 0.11));
      for (i = 0; i < centers.length; i++) {
        k = Math.round((centers[i] - x0) / p);
        r = centers[i] - (x0 + p * k);
        if (Math.abs(r) <= tol) { ks.push(k); xs.push(centers[i]); }
      }
      if (xs.length < 6) return null;
      var fit = lstsq2(ks, xs);
      if (!fit || fit.a <= 2 || fit.a >= 40) return null;
      if (Math.abs(fit.a - p) < 1e-7 && Math.abs(fit.b - x0) < 1e-7) { p = fit.a; x0 = fit.b; break; }
      p = fit.a; x0 = fit.b;
    }
    ks = []; xs = [];
    var tol2 = Math.max(0.5, Math.min(0.9, p * 0.11)), resid = [];
    for (i = 0; i < centers.length; i++) {
      k = Math.round((centers[i] - x0) / p);
      r = centers[i] - (x0 + p * k);
      if (Math.abs(r) <= tol2) { ks.push(k); xs.push(centers[i]); resid.push(r); }
    }
    if (ks.length < 6) return null;
    var cover = 1;
    if (bin) {
      var nb = Math.max(1, Math.floor((bin.x1 - bin.x0) / bin.binW));
      var nIn = new Int32Array(nb), nHit = new Int32Array(nb), ci;
      for (ci = 0; ci < centers.length; ci++) {
        var bi = Math.min(nb - 1, Math.max(0, Math.floor((centers[ci] - bin.x0) / bin.binW)));
        nIn[bi]++;
      }
      for (ci = 0; ci < ks.length; ci++) {
        var bj = Math.min(nb - 1, Math.max(0, Math.floor((xs[ci] - bin.x0) / bin.binW)));
        nHit[bj]++;
      }
      var worst = 1, seen = 0;
      for (ci = 0; ci < nb; ci++) {
        if (nIn[ci] < 6) continue;
        seen++;
        var fr = nHit[ci] / Math.max(1, nIn[ci]);
        if (fr < worst) worst = fr;
      }
      cover = seen >= 4 ? worst : 0;
    }
    return {
      pitch: p, x0: x0, hits: xs.length, total: centers.length, alignment: round(xs.length / centers.length, 3), cover: round(cover, 3),
      kmin: Math.min.apply(null, ks), kmax: Math.max.apply(null, ks),
      half: Math.max(1, Math.min(3, Math.round(p * 0.32))),
      residualStd: std(resid), bars: Math.max.apply(null, ks) - Math.min.apply(null, ks) + 1
    };
  }

  /* ------------------------------------------------------------- per candle */
  function extractBars(red, green, W, H, x0, x1, y0, y1, b0, b1, grid, calib) {
    var half = grid.half == null ? 2 : grid.half, out = [];
    var win = 2 * half + 1;
    for (var k = grid.kmin; k <= grid.kmax; k++) {
      var xc = grid.x0 + grid.pitch * k, cx = Math.round(xc);
      var wx0 = Math.max(x0, cx - half), wx1 = Math.min(x1, cx + half);
      var nw = wx1 - wx0 + 1;
      /* local mask (union of both colours), vertically repaired across the row
         band painted by the dashed last-price line so a candle is not cut in two */
      var hh = y1 - y0 + 1, m = new Uint8Array(nw * hh), i, j, y, x;
      for (y = y0; y <= y1; y++) {
        var yy = y - y0;
        for (x = wx0; x <= wx1; x++) m[yy * nw + (x - wx0)] = (red[y * W + x] || green[y * W + x]) ? 1 : 0;
      }
      var a0 = Math.max(0, b0 - y0), a1 = Math.min(hh - 1, b1 - y0);
      for (y = a0; y <= a1; y++) for (x = 0; x < nw; x++) {
        if (m[y * nw + x]) continue;
        var up = 0, dn = 0;
        for (var t = 1; t <= 3; t++) {
          if (y - t >= 0 && m[(y - t) * nw + x]) up++;
          if (y + t < hh && m[(y + t) * nw + x]) dn++;
        }
        if (up && dn) m[y * nw + x] = 2;                      // repaired pixel
      }
      /* components inside the window: the candle is the big one, floating
         overlay text (tickers, watermarks) stays a separate small component */
      var lab = new Int32Array(nw * hh), id = 0, sizes = [], spans = [];
      var st = [];
      for (y = 0; y < hh; y++) for (x = 0; x < nw; x++) {
        var q0 = y * nw + x;
        if (!m[q0] || lab[q0]) continue;
        id++;
        st.length = 0; st.push(q0); lab[q0] = id;
        var cnt = 0, ty0 = y, ty1 = y;
        while (st.length) {
          var cur = st.pop(), cy = (cur / nw) | 0, cxx = cur - cy * nw;
          cnt++;
          if (cy < ty0) ty0 = cy; if (cy > ty1) ty1 = cy;
          if (cxx > 0 && m[cur - 1] && !lab[cur - 1]) { lab[cur - 1] = id; st.push(cur - 1); }
          if (cxx < nw - 1 && m[cur + 1] && !lab[cur + 1]) { lab[cur + 1] = id; st.push(cur + 1); }
          if (cy > 0 && m[cur - nw] && !lab[cur - nw]) { lab[cur - nw] = id; st.push(cur - nw); }
          if (cy < hh - 1 && m[cur + nw] && !lab[cur + nw]) { lab[cur + nw] = id; st.push(cur + nw); }
        }
        sizes.push(cnt); spans.push([ty0 + y0, ty1 + y0]);
      }
      if (!sizes.length) { out.push(missingBar(k, grid, xc, 'no coloured pixels in this bar slot')); continue; }
      var big = 0;
      for (i = 1; i < sizes.length; i++) if (sizes[i] > sizes[big]) big = i;
      var cid = big + 1, compTop = spans[big][0], compBot = spans[big][1];
      /* colour vote inside the candle only (an overlay text is red or white and
         would otherwise flip the direction of a green bar) */
      var nR = 0, nG = 0;
      for (y = compTop; y <= compBot; y++) {
        if (y >= b0 && y <= b1) continue;
        for (x = wx0; x <= wx1; x++) {
          var q = y * W + x;
          if (lab[(y - y0) * nw + (x - wx0)] !== cid) continue;
          nR += red[q]; nG += green[q];
        }
      }
      var bull = nG > nR;
      var own = bull ? green : red;
      var ownRows = new Int32Array(H);
      for (y = compTop; y <= compBot; y++) {
        var c = 0;
        for (x = wx0; x <= wx1; x) { break; }
        for (x = wx0; x <= wx1; x++) if (own[y * W + x] && lab[(y - y0) * nw + (x - wx0)] === cid) c++;
        ownRows[y] = c;
      }
      var need = Math.max(2, nw - 1), thr = need, bodyRows = [];
      for (y = compTop; y <= compBot; y++) if (ownRows[y] >= need) bodyRows.push(y);
      if (!bodyRows.length) { thr = Math.max(2, nw - 2); for (y = compTop; y <= compBot; y++) if (ownRows[y] >= thr) bodyRows.push(y); }
      if (!bodyRows.length) { thr = 2; for (y = compTop; y <= compBot; y++) if (ownRows[y] >= 2) bodyRows.push(y); }
      if (!bodyRows.length) { out.push(missingBar(k, grid, xc, 'body not separable from wick', 0.4)); continue; }
      var segs = groupRuns(bodyRows, 1);
      var bt = segs[0][0], bb = segs[0][1];
      for (i = 0; i < segs.length; i++) if (segs[i][1] - segs[i][0] > bb - bt) { bt = segs[i][0]; bb = segs[i][1]; }
      var top = compTop, bot = compBot;
      var rec = {
        candle: k - grid.kmin + 1, k: k, x: round(xc, 2), status: 'ok',
        rowHigh: top, rowLow: bot + 1, rowBodyTop: bt, rowBodyBot: bb + 1,
        openPx: bull ? bb + 1 : bt, closePx: bull ? bt : bb + 1,
        direction: bull ? 'Bullish' : 'Bearish', confidence: 0.95, notes: [],
        componentPx: sizes[big], components: sizes.length
      };
      if (thr < need) { rec.confidence -= 0.06; rec.notes.push('body only ' + thr + 'px wide in the measurement window'); }
      if (compTop <= b1 && compBot >= b0) { rec.confidence -= 0.06; rec.notes.push('crosses the dashed last-price line (hidden pixels repaired)'); }
      if (bb === bt) { rec.confidence -= 0.05; rec.notes.push('1px body: open and close within one pixel row'); }
      if (bot - top <= 2) { rec.confidence -= 0.07; rec.notes.push('whole candle <= 3px tall'); }
      if (top <= y0 || bot >= y1) { rec.confidence -= 0.15; rec.notes.push('candle touches the detected pane border'); }
      var mixed = Math.min(nR, nG) / Math.max(1, Math.max(nR, nG));
      if (mixed > 0.45) { rec.confidence -= 0.12; rec.notes.push('both colours present — direction ambiguous'); }
      if (sizes.length > 1 && sizes[0] < 0.35 * sizes[big]) { /* stray specks: ignored */ }
      rec.confidence = round(Math.max(0.3, Math.min(0.97, rec.confidence)), 2);
      if (calib && calib.detected) {
        var pTop = calib.price(bt), pBot = calib.price(bb + 1);
        var pH = calib.price(top), pL = calib.price(bot + 1);
        var o = bull ? pBot : pTop, c2 = bull ? pTop : pBot;
        if (pH < Math.max(o, c2)) { pH = Math.max(o, c2); rec.confidence = round(Math.max(0.3, rec.confidence - 0.1), 2); rec.notes.push('wick/body inconsistency repaired'); }
        if (pL > Math.min(o, c2)) { pL = Math.min(o, c2); rec.confidence = round(Math.max(0.3, rec.confidence - 0.1), 2); rec.notes.push('wick/body inconsistency repaired'); }
        rec.open = round(o, 2); rec.high = round(pH, 2); rec.low = round(pL, 2); rec.close = round(c2, 2);
      } else {
        rec.open = rec.high = rec.low = rec.close = null;
      }
      out.push(rec);
    }
    return out;
  }
  function missingBar(k, grid, xc, msg, conf) {
    return {
      candle: k - grid.kmin + 1, k: k, x: round(xc, 2), status: msg,
      open: null, high: null, low: null, close: null,
      confidence: conf == null ? 0 : conf, notes: [msg]
    };
  }
  function scoreContinuity(bars) {
    var ok = bars.filter(function (b) { return b.status === 'ok'; });
    if (ok.length < 3) return 0;
    var s = 0, n = 0;
    for (var i = 1; i < ok.length; i++) {
      var a = ok[i - 1], b = ok[i];
      var scale = Math.max(1.2, (a.rowLow - a.rowHigh) * 0.12);
      s += Math.min(1, Math.abs(b.openPx - a.closePx) / scale);
      n++;
    }
    return n ? 1 - s / n : 0;
  }
  /* vertical gridlines: on most charts they mark whole days/months, so they
     are the anchors that tie bar indices to calendar dates */
  function verticalGridlines(candle, lum, W, H, x0, x1, y0, y1, b0, b1) {
    /* A column is a time gridline when the *background* pixels in it are
       brighter than the background elsewhere: the candles themselves are
       excluded, otherwise the dense zones hide the lines. */
    var n = x1 - x0 + 1, meds = new Float32Array(n), x, y;
    for (x = 0; x < n; x++) {
      var buf = [];
      for (y = y0; y <= y1; y++) {
        if (y >= b0 && y <= b1) continue;
        var q = y * W + (x0 + x);
        if (candle[q]) continue;
        buf.push(lum[q]);
      }
      meds[x] = buf.length > 40 ? median(buf) : -1;
    }
    var ok = [];
    for (x = 0; x < n; x++) if (meds[x] >= 0) ok.push(meds[x]);
    if (ok.length < 20) return [];
    var base = median(ok), cand = [];
    for (x = 1; x < n - 1; x++) {
      if (meds[x] < 0) continue;
      if (meds[x] - base > 1.2 && meds[x] >= meds[x - 1] && meds[x] >= meds[x + 1]) cand.push({ x: x0 + x, s: meds[x] - base });
    }
    cand = cand.filter(function (v, i2) { return !i2 || v.x - cand[i2 - 1].x > 20; });
    if (cand.length < 2) return cand.map(function (v) { return v.x; });
    /* keep the lattice that explains the most candidates at one spacing */
    var best = null, i, j, m;
    for (i = 0; i < cand.length; i++) {
      for (j = i + 1; j < cand.length; j++) {
        var d = cand[j].x - cand[i].x;
        if (d < 40) continue;
        for (m = 1; m <= 6; m++) {
          var sp = d / m;
          if (sp < 40) continue;
          var keep = [], err = 0, kk;
          for (kk = 0; kk < cand.length; kk++) {
            var off = (cand[kk].x - cand[i].x) / sp;
            var e = Math.abs(off - Math.round(off)) * sp;
            if (e <= 3) { keep.push(cand[kk].x); err += e; }
          }
          var score = keep.length - err / Math.max(1, keep.length) * 0.6;
          if (keep.length >= 2 && (!best || score > best.score)) best = { score: score, keep: keep, spacing: sp };
        }
      }
    }
    return best ? best.keep : cand.map(function (v) { return v.x; });
  }
  /* ------------------------------------------------------- dates (anchored) */
  /* Bar dates come from the printed time axis. The engine reports where the
     vertical gridlines are; the host supplies the label of one or more of them
     (from OCR of the bottom axis, or typed by the user) plus the timeframe,
     e.g. {anchors:[{x:398, iso:'2026-08-14'}], barsPerDay:23, skipWeekends:true}.
     Time stays blank unless the screenshot shows per-candle times. */
  function assignDates(bars, geometry, cfg) {
    if (!cfg || !cfg.anchors || !cfg.anchors.length || !cfg.barsPerDay) return false;
    var vgl = geometry.verticalGridlines || [], maps = [], i, g;
    for (i = 0; i < cfg.anchors.length; i++) {
      var a = cfg.anchors[i], bar = a.bar;
      var ax = a.x != null ? a.x : (a.x_px != null ? a.x_px : a.px);   /* accept the field names the axis work uses */
      var iso = a.iso || a.iso_date || a.date || a.label;
      if (bar == null && ax != null) {
        var best = null;
        for (g = 0; g < vgl.length; g++) {
          var d = Math.abs(vgl[g] - ax);
          if (!best || d < best.d) best = { i: g, d: d };
        }
        if (!best || best.d > 6) continue;
        bar = Math.round((vgl[best.i] - geometry.x0) / geometry.pitch);
      }
      var dt = Date.parse(iso + 'T00:00:00Z');
      if (bar != null && isFinite(dt)) maps.push({ bar: bar, t: dt });
    }
    if (!maps.length) return false;
    var perDay = cfg.barsPerDay, skip = cfg.skipWeekends !== false;
    for (i = 0; i < bars.length; i++) {
      var b = bars[i];
      if (b.status !== 'ok') continue;
      var bd = b.k != null ? b.k : geometry.kmin + b.candle - 1;
      var src = null, bestD = 1e9;
      for (g = 0; g < maps.length; g++) {
        var dd = Math.abs(bd - maps[g].bar);
        if (dd < bestD) { bestD = dd; src = maps[g]; }
      }
      /* floor, not trunc: bars before the anchor on a fractional day belong to
         the previous trading day */
      var days = (bd - src.bar) / perDay, whole = Math.floor(days);
      var t = src.t, step = whole >= 0 ? 1 : -1;
      for (var s = 0; s < Math.abs(whole); s++) {
        do { t += step * 86400000; } while (skip && (new Date(t).getUTCDay() === 6 || new Date(t).getUTCDay() === 0));
      }
      b.date = new Date(t).toISOString().slice(0, 10);
      b.dateConfidence = bestD <= 1 ? 0.9 : 0.6;
      if (Math.abs(days - whole) > 0.5 || bestD > 1) b.notes.push('date interpolated from an axis gridline anchor (not a printed timestamp)');
    }
    return true;
  }

  /* ------------------------------------------------------------- rendering */
  function renderChart(canvas, bars, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, i;
    ctx.fillStyle = opts.bg || '#0b1220'; ctx.fillRect(0, 0, W, H);
    var ok = bars.filter(function (b) { return b.status === 'ok' && b.high != null; });
    var rel = ok.length === 0;
    if (rel) ok = bars.filter(function (b) { return b.status === 'ok'; }).map(function (b) {
      return { high: b.rowHigh, low: b.rowLow, open: b.rowBodyBot, close: b.rowBodyTop, rowHigh: b.rowHigh, rowLow: b.rowLow, direction: b.direction, confidence: b.confidence };
    });
    if (!ok.length) return;
    var vs = [];
    for (i = 0; i < ok.length; i++) { vs.push(ok[i].high, ok[i].low); }
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), pad = (hi - lo) * 0.06 + 1e-9;
    lo -= pad; hi += pad;
    var Y = function (v) { return H - 16 - ((v - lo) / (hi - lo)) * (H - 32); };
    var dx = (W - 10) / ok.length;
    ctx.strokeStyle = '#182235'; ctx.lineWidth = 1;
    for (var gy = 0; gy <= 4; gy++) {
      var yv = lo + (hi - lo) * gy / 4, yy = Y(yv);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
      if (!rel) {
        ctx.fillStyle = '#64748b'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left';
        ctx.fillText(yv.toFixed(2), 4, yy - 2);
      }
    }
    for (i = 0; i < ok.length; i++) {
      var b = ok[i], x = 5 + i * dx + dx / 2, up = b.direction === 'Bullish';
      ctx.strokeStyle = ctx.fillStyle = up ? '#26a69a' : '#ef5350';
      ctx.lineWidth = Math.max(1, dx * 0.12);
      ctx.beginPath(); ctx.moveTo(x, Y(b.high)); ctx.lineTo(x, Y(b.low)); ctx.stroke();
      var y1 = Y(Math.max(b.open, b.close)), y2 = Y(Math.min(b.open, b.close));
      ctx.fillRect(x - dx * 0.34, y1, Math.max(1, dx * 0.68), Math.max(1, y2 - y1));
      if (b.confidence < 0.9) { ctx.fillStyle = '#f59e0b'; ctx.fillRect(x - 1, 3, 2, 3); }
    }
    if (opts.title) { ctx.fillStyle = '#94a3b8'; ctx.font = '11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(opts.title, W / 2, H - 3); }
  }

  /* the reconstructed candles in the pixel space of the very same picture: the bars
     land at the measured x and rows, so this view can be laid over the original or
     over the marked one candle for candle. No auto-fit, no rescaling of the series. */
  function renderReconstructed(canvas, src, result) {
    var iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
    canvas.width = iw; canvas.height = ih;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, iw, ih);
    if (!result || !result.geometry) return;
    if (result.scale && result.scale !== 1) { /* measured at this scale: map back up */
      ctx.setTransform(1 / result.scale, 0, 0, 1 / result.scale, 0, 0);
    }
    var g = result.geometry, step = g.pitch || 1;
    ctx.lineWidth = Math.max(1, iw / 1000);
    result.bars.forEach(function (b) {
      if (b.status !== 'ok') { ctx.strokeStyle = '#ff4d4d'; ctx.strokeRect(b.x - step / 2, g.paneTop, step, 26); return; }
      var up = b.direction === 'Bullish';
      ctx.strokeStyle = ctx.fillStyle = up ? '#26a69a' : '#ef5350';
      ctx.beginPath(); ctx.moveTo(b.x, b.rowHigh); ctx.lineTo(b.x, b.rowLow); ctx.stroke();
      ctx.fillRect(b.x - step * 0.37, b.rowBodyTop, Math.max(1, step * 0.74), Math.max(1, b.rowBodyBot - b.rowBodyTop));
      if (b.confidence < 0.9) { ctx.fillStyle = '#f59e0b'; ctx.fillRect(b.x - 1, Math.max(0, b.rowHigh - 7), 2, 3); }
    });
  }

  function renderAnnotated(canvas, src, result) {
    var ctx = canvas.getContext('2d');
    var iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
    canvas.width = iw; canvas.height = ih;
    ctx.drawImage(src, 0, 0, iw, ih);
    var g = result.geometry, step = g.pitch;
    if (result.scale && result.scale !== 1) { /* the image was analysed at this scale: map marks up */
      var k = 1 / result.scale;
      ctx.setTransform(k, 0, 0, k, 0, 0);
    }
    ctx.lineWidth = Math.max(1, canvas.width / 1000);
    var fnt = Math.max(9, Math.round(canvas.width / 300)) + 'px ui-monospace,monospace';
    if (result.calibration && result.calibration.detected) {
      ctx.strokeStyle = 'rgba(253,224,71,.85)'; ctx.fillStyle = '#fde047'; ctx.font = fnt; ctx.textAlign = 'left';
      (result.calibration.refs || []).forEach(function (r) {
        ctx.beginPath(); ctx.moveTo(g.dataX0 - 4, r.row); ctx.lineTo(canvas.width, r.row); ctx.stroke();
        ctx.fillText((r.text ? r.text + ' ' : '') + r.price + ' @ y=' + Math.round(r.row) + ' [' + r.source + ']', 4, Math.max(10, r.row - 3));
      });
    }
    (result.chromeRects || []).forEach(function (u) { ctx.strokeStyle = 'rgba(148,163,184,.75)'; ctx.strokeRect(u.x0, u.y0, u.x1 - u.x0, u.y1 - u.y0); });
    if (g.priceLineRows) {
      ctx.strokeStyle = 'rgba(56,189,248,.7)';
      ctx.beginPath(); ctx.moveTo(g.dataX0, (g.priceLineRows[0] + g.priceLineRows[1]) / 2); ctx.lineTo(g.dataX1, (g.priceLineRows[0] + g.priceLineRows[1]) / 2); ctx.stroke();
    }
    result.bars.forEach(function (b) {
      if (b.status !== 'ok') { ctx.strokeStyle = '#ff4d4d'; ctx.strokeRect(b.x - step / 2, g.paneTop, step, 26); return; }
      ctx.strokeStyle = b.confidence < 0.9 ? '#f59e0b' : '#22d3ee';
      ctx.beginPath(); ctx.moveTo(b.x, b.rowHigh); ctx.lineTo(b.x, b.rowLow); ctx.stroke();
      ctx.strokeRect(b.x - step * 0.4, b.rowBodyTop, step * 0.8, Math.max(1, b.rowBodyBot - b.rowBodyTop));
    });
    var every = Math.max(1, Math.round(result.bars.length / 26));
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = fnt;
    result.bars.forEach(function (b) {
      if ((b.candle - 1) % every) return;
      ctx.fillText(String(b.candle), b.x, Math.max(12, g.paneTop - 5));
    });
  }

  function toCSV(result) {
    var lines = ['Candle,Date,Time,Open,High,Low,Close,Direction,Confidence'];
    result.bars.forEach(function (b) {
      var f = function (v) { return v == null ? '' : v.toFixed(2); };
      lines.push([b.candle, b.date || '', b.time || '', f(b.open), f(b.high), f(b.low), f(b.close), b.direction || '', b.confidence == null ? '' : b.confidence.toFixed(2)].join(','));
    });
    return lines.join('\r\n');
  }
  /* a dataset in the shape Chart DNA stores: {id,name,symbol,timeframe,candles:[...]} */
  function toDataset(result, meta) {
    meta = meta || {};
    var cal = result.calibration && result.calibration.detected;
    return {
      id: meta.id || ('img-' + Date.now().toString(36)),
      name: meta.name || 'Image extraction',
      symbol: meta.symbol || 'IMAGE',
      timeframe: meta.timeframe || '1h',
      source: 'pixel-reconstruction',
      note: meta.note || (cal
        ? 'reconstructed from an uploaded screenshot by pixel measurement (confidence ' + result.quality.meanConfidence + ')'
        : 'pixel geometry only — the price axis could not be read'),
      candles: result.bars.filter(function (b) { return b.status === 'ok' && (cal ? b.open != null : true); }).map(function (b) {
        return {
          timestamp: b.date ? (b.date + (b.time ? 'T' + b.time : '')) : 'Candle ' + b.candle,
          open: cal ? b.open : 1, high: cal ? b.high : 1.01, low: cal ? b.low : 0.99, close: cal ? b.close : 1,
          volume: 0, confidence: b.confidence, notes: b.notes
        };
      })
    };
  }

  return {
    extract: extract, assignDates: assignDates, toCSV: toCSV, toDataset: toDataset,
    renderChart: renderChart, renderReconstructed: renderReconstructed, renderAnnotated: renderAnnotated,
    canvasTemplates: canvasTemplates, parseNumber: parseNumber,
    components: components, textLines: textLines, version: '1.1.0',
    _readNumber: readNumber, _downsample: downsample, _ncc: ncc,
    _componentsIn: componentsIn, _textLines2: textLines, _gridAlign: gridAlignFraction, _findChrome: findChrome, _fitGrid: fitGrid, _modalBodyWidth: modalBodyWidth
  };
});
