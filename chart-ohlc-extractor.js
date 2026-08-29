/* Chart OHLC extractor — browser-side computer vision
 * Extracts candle geometry from screenshots and maps pixel-Y to price.
 * No market data/API is used. Price calibration can be automatic (Tesseract OCR)
 * or manual with two visible price/row reference points.
 */
(() => {
  const STYLE = `
  #ohlc-tool{position:fixed;right:18px;bottom:82px;z-index:2147483647;font-family:Inter,system-ui,sans-serif}
  #ohlc-open{background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;padding:11px 14px;box-shadow:0 8px 30px #0008;cursor:pointer;font-weight:700}
  #ohlc-modal{display:none;position:fixed;inset:0;background:#020617cc;backdrop-filter:blur(8px);z-index:2147483647;align-items:center;justify-content:center;padding:16px}
  #ohlc-card{width:min(980px,96vw);max-height:92vh;overflow:auto;background:#0b1220;color:#e5e7eb;border:1px solid #334155;border-radius:18px;padding:18px;box-shadow:0 25px 80px #000a}
  #ohlc-card h2{margin:0 0 8px;font-size:20px}.ohlc-muted{color:#94a3b8;font-size:13px;line-height:1.6}
  .ohlc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ohlc-box{border:1px solid #243244;border-radius:12px;padding:12px;background:#0f172a}
  .ohlc-box label{display:block;font-size:12px;color:#94a3b8;margin-bottom:6px}.ohlc-box input{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:9px;padding:9px}
  .ohlc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.ohlc-actions button{border:0;border-radius:10px;padding:10px 13px;cursor:pointer;font-weight:700}
  .ohlc-primary{background:#10b981;color:#04130e}.ohlc-secondary{background:#1e293b;color:#e2e8f0}.ohlc-danger{background:#7f1d1d;color:#fecaca}
  #ohlc-preview{max-width:100%;max-height:360px;margin-top:12px;border-radius:10px;border:1px solid #334155;display:none}
  #ohlc-status{margin-top:10px;color:#a7f3d0;font-size:13px;white-space:pre-wrap}.ohlc-table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}.ohlc-table th,.ohlc-table td{padding:6px;border-bottom:1px solid #1e293b;text-align:right}.ohlc-table th{color:#94a3b8}
  @media(max-width:700px){.ohlc-grid{grid-template-columns:1fr}#ohlc-tool{right:10px;bottom:76px}}
  `;
  const style=document.createElement('style');style.textContent=STYLE;document.head.appendChild(style);

  const root=document.createElement('div');root.id='ohlc-tool';root.innerHTML=`<button id="ohlc-open">📈 استخراج OHLC</button>`;document.body.appendChild(root);
  const modal=document.createElement('div');modal.id='ohlc-modal';modal.innerHTML=`
    <div id="ohlc-card">
      <h2>استخراج OHLC از تصویر نمودار</h2>
      <div class="ohlc-muted">Computer Vision روی خود پیکسل‌های تصویر انجام می‌شود. هیچ قیمت یا کندلی از اینترنت دریافت نمی‌شود. برای قیمت دقیق، دو نقطه مرجع محور Y لازم است.</div>
      <div class="ohlc-grid" style="margin-top:12px">
        <div class="ohlc-box"><label>تصویر نمودار</label><input id="ohlc-file" type="file" accept="image/*"></div>
        <div class="ohlc-box"><label>کالیبراسیون قیمت (اختیاری؛ اگر OCR جواب نداد)</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px"><input id="y1" placeholder="Y پیکسلی مرجع 1"><input id="p1" placeholder="قیمت مرجع 1"><input id="y2" placeholder="Y پیکسلی مرجع 2"><input id="p2" placeholder="قیمت مرجع 2"></div></div>
      </div>
      <div class="ohlc-actions">
        <button class="ohlc-primary" id="ohlc-run">استخراج کندل‌ها</button>
        <button class="ohlc-secondary" id="ohlc-ocr">OCR محور قیمت</button>
        <button class="ohlc-secondary" id="ohlc-csv" disabled>دانلود CSV</button>
        <button class="ohlc-secondary" id="ohlc-png" disabled>دانلود تصویر Annotated</button>
        <button class="ohlc-danger" id="ohlc-close">بستن</button>
      </div>
      <div id="ohlc-status"></div>
      <img id="ohlc-preview">
      <div id="ohlc-results"></div>
    </div>`;document.body.appendChild(modal);

  const $=id=>document.getElementById(id); let image=null, rows=[], annotatedUrl=null;
  $('ohlc-open').onclick=()=>modal.style.display='flex'; $('ohlc-close').onclick=()=>modal.style.display='none';
  modal.addEventListener('click',e=>{if(e.target===modal)modal.style.display='none'});
  $('ohlc-file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;image=new Image();image.onload=()=>{const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d');x.drawImage(image,0,0);$('ohlc-preview').src=c.toDataURL('image/png');$('ohlc-preview').style.display='block';setStatus(`تصویر آماده شد: ${image.naturalWidth}×${image.naturalHeight}`)};image.src=URL.createObjectURL(f)};
  function setStatus(s){$('ohlc-status').textContent=s}
  function download(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

  function calibration(){
    const y1=parseFloat($('y1').value),p1=parseFloat($('p1').value),y2=parseFloat($('y2').value),p2=parseFloat($('p2').value);
    if([y1,p1,y2,p2].every(Number.isFinite)&&y1!==y2){const a=(p2-p1)/(y2-y1),b=p1-a*y1;return y=>a*y+b}
    return null;
  }

  function extract(){
    if(!image){setStatus('ابتدا تصویر را انتخاب کن.');return}
    const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const d=ctx.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height;
    const red=new Uint8Array(w*h), teal=new Uint8Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,r=d[i],g=d[i+1],b=d[i+2];
      red[y*w+x]=(r>100&&r>g*1.30&&r>b*1.18)?1:0;
      teal[y*w+x]=(g>65&&g>r*1.20&&g>b*0.88)?1:0;
    }
    // Candle chart region heuristic: exclude browser/UI edges and obvious text-heavy top area.
    const y0=Math.max(25,Math.floor(h*.06)), y1=Math.floor(h*.82), x0=Math.floor(w*.02), x1=Math.floor(w*.92);
    const col=new Int32Array(x1-x0);
    for(let x=x0;x<x1;x++)for(let y=y0;y<y1;y++){if((red[y*w+x]||teal[y*w+x]) && !(y>h*.50&&y<h*.57))col[x-x0]++}
    // Find candle centers as local maxima, then merge very close maxima.
    const centers=[];for(let x=1;x<col.length-1;x++)if(col[x]>=3&&col[x]>=col[x-1]&&col[x]>=col[x+1])centers.push(x+x0);
    const merged=[];for(const x of centers){if(!merged.length||x-merged[merged.length-1]>2)merged.push(x);else if(col[x-x0]>col[merged[merged.length-1]-x0])merged[merged.length-1]=x}
    // Keep only centers belonging to clusters; typical screenshots have 2–8 px candle spacing.
    const xs=[];for(const x of merged){if(!xs.length||x-xs[xs.length-1]>=3)xs.push(x)}
    const priceFn=calibration();
    if(!priceFn){setStatus('کندل‌ها پیدا شدند، اما کالیبراسیون قیمت نداریم. دو نقطه Y/Price وارد کن و دوباره Extract را بزن.\nمثال: Y=148 → 4600 و Y=248 → 4500');return}
    rows=[];
    for(let n=0;n<xs.length;n++){
      const x=xs[n], xa=Math.max(x0,x-2),xb=Math.min(x1-1,x+2), rr=[],tt=[];
      for(let y=y0;y<y1;y++){let r=0,t=0;for(let xx=xa;xx<=xb;xx++){r+=red[y*w+xx];t+=teal[y*w+xx]}if(r||t) {rr.push([y,r]);tt.push([y,t])}}
      const sr=rr.reduce((s,v)=>s+v[1],0), st=tt.reduce((s,v)=>s+v[1],0); if(!sr&&!st)continue;
      const bull=st>sr, arr=bull?tt:rr, ys=arr.map(v=>v[0]);if(!ys.length)continue;
      const high=Math.min(...ys),low=Math.max(...ys);const body=arr.filter(v=>v[1]>=2).map(v=>v[0]);const bt=body.length?Math.min(...body):high,bb=body.length?Math.max(...body):low;
      const oy=bull?bb:bt,cy=bull?bt:bb;const O=priceFn(oy),C=priceFn(cy),H=priceFn(high),L=priceFn(low);
      rows.push({Candle:rows.length+1,Open:+O.toFixed(2),High:+Math.max(H,O,C).toFixed(2),Low:+Math.min(L,O,C).toFixed(2),Close:+C.toFixed(2),Direction:bull?'Bullish':'Bearish',Confidence:+Math.max(.35,Math.min(.99,(body.length?0.85:0.6)*(Math.min(1,(Math.abs(C-O)+0.01)/(Math.abs(H-L)+0.01))))).toFixed(2)});
    }
    drawAnnotated(c,xs,rows,priceFn);renderRows();$('ohlc-csv').disabled=!rows.length;$('ohlc-png').disabled=!annotatedUrl;
    setStatus(`${rows.length} کندل استخراج شد.\nتوجه: داده از تصویر بازسازی شده و برای بک‌تست دقیق مالی مناسب نیست.`)
  }

  function drawAnnotated(c,xs,data,priceFn){const z=document.createElement('canvas');z.width=c.width;z.height=c.height;const q=z.getContext('2d');q.drawImage(c,0,0);q.font='bold 12px sans-serif';q.textAlign='center';data.forEach((r,i)=>{const x=xs[i];const y=12;q.fillStyle='#fbbf24';q.fillText(String(r.Candle),x,y+12);q.beginPath();q.moveTo(x,25);q.lineTo(x,40);q.strokeStyle='#fbbf24';q.stroke()});annotatedUrl=z.toDataURL('image/png');$('ohlc-preview').src=annotatedUrl}
  function renderRows(){const show=rows.slice(0,80);$('ohlc-results').innerHTML=`<div class="ohlc-muted" style="margin-top:12px">نمایش ${show.length} ردیف اول از ${rows.length}</div><table class="ohlc-table"><thead><tr><th>Candle</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Direction</th><th>Confidence</th></tr></thead><tbody>${show.map(r=>`<tr><td>${r.Candle}</td><td>${r.Open}</td><td>${r.High}</td><td>${r.Low}</td><td>${r.Close}</td><td>${r.Direction}</td><td>${r.Confidence}</td></tr>`).join('')}</tbody></table>`}
  $('ohlc-run').onclick=extract;
  $('ohlc-csv').onclick=()=>{if(!rows.length)return;const cols=['Candle','Open','High','Low','Close','Direction','Confidence'];const csv=[cols.join(','),...rows.map(r=>cols.map(k=>r[k]).join(','))].join('\n');download('chart_OHLC_extracted.csv',new Blob([csv],{type:'text/csv;charset=utf-8'}))};
  $('ohlc-png').onclick=()=>{if(annotatedUrl)download('chart_OHLC_annotated.png',dataURLtoBlob(annotatedUrl))};
  function dataURLtoBlob(u){const [m,b]=u.split(',');const bin=atob(b),arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return new Blob([arr],{type:m.match(/:(.*?);/)[1]})}
  $('ohlc-ocr').onclick=async()=>{if(!image){setStatus('ابتدا تصویر را انتخاب کن.');return}setStatus('OCR محور قیمت در حال بارگذاری است...');try{if(!window.Tesseract){await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)})}const {data}=await Tesseract.recognize(image,'eng',{logger:m=>{if(m.status==='recognizing text')setStatus(`OCR: ${Math.round((m.progress||0)*100)}%`)}});const nums=(data.words||[]).filter(x=>/\d/.test(x.text)).map(x=>({text:x.text.trim(),y:(x.bbox.y0+x.bbox.y1)/2})).filter(x=>/\d{3,}(?:[.,]\d+)?/.test(x.text));setStatus(nums.length?`OCR شناسایی کرد:\n${nums.slice(0,20).map(x=>`${x.text} @ Y≈${Math.round(x.y)}`).join('\n')}\n\nدر صورت صحت، دو مورد را در کادر کالیبراسیون وارد کن.`:'OCR عدد قابل استفاده‌ای روی محور پیدا نکرد. کالیبراسیون دستی را استفاده کن.')}catch(e){setStatus('OCR اجرا نشد. کالیبراسیون دستی را استفاده کن.')}};
})();
