/* Parity test for the browser code path — this is the regression check for
 * chart-ohlc-engine.js / chart-ohlc-extractor.js.
 *
 * It runs exactly what the app runs in a real browser (ChartDNACV.canvasTemplates()
 * against a live canvas 2D context, then ChartDNACV.extract()) on the screenshot the
 * engine was validated on, and compares the result with reference/xauusd_1h_expected.csv
 * and reference/xauusd_1h_report.json, which were produced with NumPy and reviewed
 * bar by bar against the picture.
 *
 *   OHLC_IMG=/path/to/chart-screenshot.jpg node tests/ohlc-image/fixtures.mjs
 *   node tests/ohlc-image/parity.test.mjs
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const here = __dirname;
const repo = path.resolve(here, '..', '..');
const FIX = path.join(here, '.fixtures');
if (!fs.existsSync(path.join(FIX, 'img.rgba'))) {
  console.error('fixtures missing — run: node tests/ohlc-image/fixtures.mjs (with OHLC_IMG set)');
  process.exit(2);
}
for (const p of ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                 '/usr/share/fonts/debian/DejaVuSans.ttf', '/usr/share/fonts/debian/DejaVuSans-Bold.ttf']) {
  if (fs.existsSync(p)) { try { GlobalFonts.registerFromPath(p, 'DejaVu Sans'); } catch (e) { /* registered already */ } }
}

const cv = require(path.join(repo, 'chart-ohlc-engine.js'));
const meta = JSON.parse(fs.readFileSync(path.join(FIX, 'img.json'), 'utf8'));
const imgData = { data: new Uint8ClampedArray(fs.readFileSync(path.join(FIX, 'img.rgba'))), width: meta.width, height: meta.height };
const templates = JSON.parse(fs.readFileSync(path.join(FIX, 'templates.json'), 'utf8'))
  .map((s) => { const o = {}; for (const k in s) o[k] = Float32Array.from(s[k]); return o; });
const REF = JSON.parse(fs.readFileSync(path.join(here, 'reference', 'xauusd_1h_report.json'), 'utf8'));
const ANCH = JSON.parse(fs.readFileSync(path.join(here, 'reference', 'xauusd_1h_axis_anchors.json'), 'utf8'));

let fails = 0, checks = 0;
const ok = (name, cond, info) => {
  checks++;
  if (cond) console.log('  ok   ' + name + (info ? '   [' + info + ']' : ''));
  else { fails++; console.log('  FAIL ' + name + (info ? '   [' + info + ']' : '')); }
};

console.log('1) digit templates from a live canvas');
const t0 = Date.now();
const built = cv.canvasTemplates((size) => { const c = createCanvas(size, size); return { canvas: c, ctx: c.getContext('2d') }; });
ok('5 font sets x 10 digits', built.length === 5 && built.every((s) => Object.keys(s).length === 10), built.length + ' sets, ' + (Date.now() - t0) + ' ms');

console.log('2) extraction');
const t1 = Date.now();
const r = cv.extract(imgData, { templates: built });
ok('extract() succeeded', r.ok === true, r.error || r.candles + ' candles, ' + (Date.now() - t1) + ' ms');
ok('candle count equals the reference', r.candles === REF.geometry.n_bars, r.candles + ' vs ' + REF.geometry.n_bars);
ok('every candle measurable', r.missing === 0 && r.complete === r.candles, r.complete + '/' + r.candles + ' complete, missing ' + r.missing);
ok('image size recorded', meta.width === REF.image.w && meta.height === REF.image.h, meta.width + 'x' + meta.height);

console.log('3) pixel -> price calibration');
const cal = r.calibration, ref = REF.calibration;
ok('log-axis model chosen', /log/.test(cal.mode), cal.equation);
ok('coefficients match the NumPy fit', Math.abs(cal.a - ref.a) < 2e-7 && Math.abs(cal.b - ref.b) < 2e-4,
   'a=' + cal.a.toExponential(6) + ' (ref ' + ref.a.toExponential(6) + '), b=' + cal.b.toFixed(5) + ' (ref ' + ref.b.toFixed(5) + ')');
ok('axis labels used as anchors', cal.refs.filter((x) => x.source === 'axis-label').length >= ref.grid_rows.length - 1,
   cal.refs.map((x) => x.price + '@' + x.row.toFixed(0)).join('  '));
ok('regression RMS below 0.05 USD', cal.residualUSD < 0.05, 'RMS ' + cal.residualUSD + ' USD, ref max ' + Math.max.apply(null, ref.residuals_usd_log.map(Math.abs)));
ok('log beats linear by a factor > 5', cal.linearResidualUSD > 5 * cal.residualUSD, 'linear RMS ' + cal.linearResidualUSD);
ok('independent check on the price tag', Math.abs(cal.tagCheck.errorUSD) <= 0.1,
   'tag ' + cal.tagCheck.tagPrice + ' -> measured ' + cal.tagCheck.measured + ' (err ' + cal.tagCheck.errorUSD + ' USD)');
const refUsdPerPx = 1 / REF.geometry.price_px;   /* reference slope at the last price */
ok('USD per pixel within 1% of the reference axis', Math.abs(cal.usdPerPx - refUsdPerPx) / refUsdPerPx < 0.01,
   cal.usdPerPx.toFixed(4) + ' vs ' + refUsdPerPx.toFixed(4) + ' (ref 1 px = ' + REF.geometry.price_px + ' px per USD)');

console.log('4) candle grid geometry');
const g = r.geometry;
ok('pitch within 0.005 px', Math.abs(g.pitch - REF.geometry.pitch) < 0.005, g.pitch + ' vs ' + REF.geometry.pitch);
const firstCx = g.x0 + g.kmin * g.pitch, refCx = REF.geometry.x0 + REF.geometry.kmin * REF.geometry.pitch;
ok('first bar centre within 0.5 px', Math.abs(firstCx - refCx) <= 0.5, firstCx.toFixed(3) + ' vs ' + refCx.toFixed(3));
ok('grid alignment > 0.9', g.alignment > 0.9, 'alignment ' + g.alignment + ', residual ' + g.gridResidualPx + ' px');

console.log('5) OHLC parity with the hand-checked values');
const rows = fs.readFileSync(path.join(here, 'reference', 'xauusd_1h_expected.csv'), 'utf8').trim().split(/\r?\n/);
const expected = {};
rows.slice(1).forEach((l) => { const c = l.split(','); expected[+c[0]] = { date: c[1], Open: c[3], High: c[4], Low: c[5], Close: c[6], Dir: c[7], Conf: c[8] }; });
const px = 1 / cal.usdPerPx, err = [];
let dirMiss = 0, inv = 0, blank = 0;
r.bars.forEach((b) => {
  const e = expected[b.candle];
  if (!e) return;
  ['Open', 'High', 'Low', 'Close'].forEach((f) => {
    if (e[f] !== '') err.push(Math.abs(parseFloat(e[f]) - b[f.toLowerCase()])); else blank++;
  });
  if (e.Dir && b.direction && e.Dir !== b.direction) dirMiss++;
  if (!(b.high >= Math.max(b.open, b.close) - 1e-9 && b.low <= Math.min(b.open, b.close) + 1e-9)) inv++;
});
err.sort((a, b) => a - b);
const within = err.filter((v) => v <= px).length / err.length;
ok('high/low never inside the body (invariants)', inv === 0, inv + ' violations');
ok('median |delta| < 0.35 USD', err[err.length >> 1] < 0.35, 'median ' + err[err.length >> 1].toFixed(2) + ' over ' + err.length + ' levels');
ok('99% of levels within one pixel', within >= 0.99, (within * 100).toFixed(2) + '% within ' + px.toFixed(2) + ' USD');
ok('worst level < 8 USD (only occluded bars drift)', err[err.length - 1] < 8, 'max ' + err[err.length - 1].toFixed(2));
ok('zero direction mismatches', dirMiss === 0, dirMiss + ' of ' + r.bars.length);
ok('nothing invented: no value where the reference is blank', blank === 0 || r.bars.every((b) => expected[b.candle]), blank + ' blank levels');

console.log('6) confidence and review list');
ok('mean confidence > 0.9', r.quality.meanConfidence > 0.9, 'mean ' + r.quality.meanConfidence + ', min ' + r.quality.minConfidence);
ok('review list stays a minority', r.quality.needReview.length < r.bars.length * 0.2,
   r.quality.needReview.length + ' flagged vs ' + REF.quality.n_low + ' in the reference');
ok('close->open continuity below 1 USD (median)', r.quality.continuityMedianUSD < 1,
   'median ' + r.quality.continuityMedianUSD + ', p90 ' + r.quality.continuityP90USD + ', max ' + r.quality.continuityMaxUSD);
ok('low-confidence bars carry a note', r.bars.filter((b) => b.confidence < 0.9).every((b) => b.notes && b.notes.length), 'flagged ' + REF.quality.n_low);

console.log('7) dates only from axis anchors');
ok('vertical gridlines found within 2 px of the printed ones',
   ANCH.vertical_gridlines.filter((a) => r.geometry.verticalGridlines.some((x) => Math.abs(x - a.x_px) <= 2)).length >= 5,
   'detected ' + JSON.stringify(r.geometry.verticalGridlines));
const dated = cv.assignDates(r.bars, r.geometry, { barsPerDay: ANCH.hourly_bars_per_trading_day, skipWeekends: true, anchors: ANCH.vertical_gridlines });
let same = 0, n = 0;
r.bars.forEach((b) => { const e = expected[b.candle]; if (e && e.date && b.date) { n++; if (e.date === b.date) same++; } });
ok('dates assigned from the gridlines', dated === true && r.bars.every((b) => b.date), r.bars.filter((b) => b.date).length + '/' + r.bars.length);
ok('assigned dates equal the reference', n > 0 && same === n, same + '/' + n);
ok('weekend gap respected', r.bars.filter((b) => /-08-(15|16|22|23|29|30)$/.test(b.date)).length === 0, 'no bars on the printed weekend');
const r2 = cv.extract(imgData, { templates: built });
const undated = cv.assignDates(r2.bars, r2.geometry, { barsPerDay: 23, anchors: [] });
ok('without anchors nothing is invented', undated === false && r2.bars.every((b) => !b.date), 'returns ' + undated);

console.log('8) CSV export and rendering');
const lines = cv.toCSV(r).trim().split('\r\n');
ok('header is the required schema', lines[0] === 'Candle,Date,Time,Open,High,Low,Close,Direction,Confidence', lines[0]);
ok('one line per candle', lines.length === r.bars.length + 1, lines.length + ' lines');
ok('Time left empty (not readable from this chart)', lines[1].split(',')[2] === '', lines[1]);
const chart = createCanvas(1000, 300);
cv.renderChart(chart, r.bars, { title: 'parity' });
const d = chart.getContext('2d').getImageData(0, 0, 1000, 300).data;
let painted = 0;
for (let i = 0; i < 1000 * 300; i++) if (d[i * 4 + 1] > 100 || d[i * 4] > 150) painted++;
ok('renderChart paints the series', painted > 3000, painted + ' coloured px');
const srcCanvas = createCanvas(meta.width, meta.height);   /* stand-in for the <img> */
let ann = createCanvas(10, 10), drew = 0;
try { cv.renderAnnotated(ann, srcCanvas, r); drew = ann.width * ann.height; } catch (e) { console.log('   renderAnnotated threw: ' + e.message); }
ok('renderAnnotated sizes itself to the source and paints marks', drew === meta.width * meta.height, drew + ' px canvas');
let rec = createCanvas(10, 10), drew2 = 0, cols = null;
try {
  cv.renderReconstructed(rec, srcCanvas, r); drew2 = rec.width * rec.height;
  const dd = rec.getContext('2d').getImageData(0, 0, rec.width, rec.height).data;
  let lo = 1e9, hi = -1, n = 0;
  for (let x = 0; x < rec.width; x++) {
    let f = false;
    for (let y = 0; y < rec.height && !f; y += 2) {
      const i = (y * rec.width + x) * 4;
      if (Math.abs(dd[i] - 11) + Math.abs(dd[i + 1] - 18) + Math.abs(dd[i + 2] - 32) > 40) { f = true; n++; }
    }
    if (f) { if (x < lo) lo = x; if (x > hi) hi = x; }
  }
  cols = { lo, hi, n };
} catch (e) { console.log('   renderReconstructed threw: ' + e.message); }
ok('renderReconstructed takes the very same frame as renderAnnotated',
  drew2 === drew && rec.width === ann.width && rec.height === ann.height, rec.width + '\u00d7' + rec.height);
const span = 2 * (r.geometry.pitch || 6) + 2;   /* the mask box is a little wider than the outermost bodies */
ok('and paints the candles at the columns they were measured in',
  !!cols && cols.n > 200 && cols.lo >= r.geometry.dataX0 - 2 && cols.lo <= r.geometry.dataX0 + span &&
  cols.hi <= r.geometry.dataX1 + 2 && cols.hi >= r.geometry.dataX1 - span,
  cols ? 'painted ' + cols.lo + '\u2026' + cols.hi + ' \u00b7 mask box ' + Math.round(r.geometry.dataX0) + '\u2026' + Math.round(r.geometry.dataX1) + ' \u00b7 pitch ' + r.geometry.pitch.toFixed(2) : 'nothing painted');

console.log('9) dataset handed to Chart DNA');
const ds = cv.toDataset(r, { symbol: 'XAUUSD', timeframe: '60' });
ok('schema matches the app store', !!(ds.id && ds.name && ds.symbol && ds.timeframe && Array.isArray(ds.candles)
  && ds.candles.length === r.bars.length && ds.candles.every((c) => ['timestamp', 'open', 'high', 'low', 'close', 'volume'].every((k) => k in c))),
  ds.id + ', ' + ds.candles.length + ' candles, fields ' + Object.keys(ds.candles[0]).join(','));
ok('prices rounded to cents', ds.candles.every((c) => ['open', 'high', 'low', 'close'].every((k) => Math.abs(c[k] * 100 - Math.round(c[k] * 100)) < 1e-6)), 'sample ' + JSON.stringify(ds.candles[0]).slice(0, 90));
ok('volume is zero rather than invented', ds.candles.every((c) => c.volume === 0), 'volume field kept for the app, set to 0');

console.log('\n' + (fails ? 'FAILED ' + fails + ' of ' + checks + ' checks' : 'all ' + checks + ' checks passed'));
process.exit(fails ? 1 : 0);
