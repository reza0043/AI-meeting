/* Build the raw fixtures the tests need, using a real canvas backend (Skia) so the
   pixel data is exactly what a browser would hand to the engine:

     OHLC_IMG=/path/to/chart-screenshot.jpg node tests/ohlc-image/fixtures.mjs

   Writes .fixtures/img.rgba, .fixtures/img.json and .fixtures/templates.json
*/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
/* resolved through require() so NODE_PATH keeps working in a repo without node_modules */
const req = createRequire(import.meta.url);
const { createCanvas, loadImage } = req('@napi-rs/canvas');
const here = path.dirname(fileURLToPath(import.meta.url));
const img = process.env.OHLC_IMG;
if (!img || !fs.existsSync(img)) {
  console.error('set OHLC_IMG to a chart screenshot (no such file: ' + img + ')');
  process.exit(2);
}
const out = path.join(here, '.fixtures');
fs.mkdirSync(out, { recursive: true });

const src = await loadImage(img);
const c = createCanvas(src.width, src.height);
const ctx = c.getContext('2d');
ctx.drawImage(src, 0, 0);
const d = ctx.getImageData(0, 0, src.width, src.height);
fs.writeFileSync(path.join(out, 'img.rgba'), Buffer.from(new Uint8Array(d.data)));
fs.writeFileSync(path.join(out, 'img.json'), JSON.stringify({ width: src.width, height: src.height, file: path.basename(img) }));

const cv = req(path.join(here, '..', '..', 'chart-ohlc-engine.js'));
const sets = cv.canvasTemplates((size) => { const cc = createCanvas(size, size); return { canvas: cc, ctx: cc.getContext('2d') }; });
fs.writeFileSync(path.join(out, 'templates.json'),
  JSON.stringify(sets.map((s) => { const o = {}; for (const k in s) o[k] = Array.from(s[k]); return o; })));
console.log('fixtures written: ' + src.width + 'x' + src.height + ' px, ' + sets.length + ' template sets -> ' + path.relative(process.cwd(), out));
