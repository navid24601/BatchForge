'use strict';

// ════════════════════════════════════════════════
//  GLOBAL STATE
// ════════════════════════════════════════════════
const files = [];
let processing = false;

const gOpts  = { flipH:false, flipV:false, rotation:0 };
const cropPos = { x:0, y:0 };

const logoState = { img:null, dataUrl:null, name:'', position:'bot-right', size:20, opacity:80 };

let pv = { fileId:null, img:null, scale:1, imgX:0, imgY:0, imgW:0, imgH:0 };

let drag = {
  active:false, mode:null,
  startMX:0, startMY:0,
  startCX:0, startCY:0,
  startCW:0, startCH:0,
};

let estTimer=null, prevTimer=null;

// ════════════════════════════════════════════════
//  CANVAS BOOTSTRAP
// ════════════════════════════════════════════════
const canvas     = document.getElementById('preview-canvas');
const canvasWrap = document.getElementById('canvas-wrap');
const ctx        = canvas.getContext('2d');

function initCanvasSize() {
  canvas.width  = canvasWrap.clientWidth  || 600;
  canvas.height = canvasWrap.clientHeight || 420;
  recalcLayout(); renderPreview();
}
requestAnimationFrame(() => requestAnimationFrame(initCanvasSize));
new ResizeObserver(initCanvasSize).observe(canvasWrap);

document.querySelectorAll('input[type="range"]').forEach(syncRange);
updateStatFmt();

// ════════════════════════════════════════════════
//  RANGE ↔ NUMBER INPUT SYNC
// ════════════════════════════════════════════════
function syncRange(el) {
  const pct = ((+el.value - +el.min) / (+el.max - +el.min)) * 100;
  el.style.background = `linear-gradient(to right,#9B177E ${pct}%,rgba(42,20,88,0.12) ${pct}%)`;
}

// Push range value → paired number input
function syncNum(rangeId, numId) {
  const r = document.getElementById(rangeId);
  const n = document.getElementById(numId);
  if (r && n) n.value = r.value;
}

// Pull number input value → range, then sync range bg
function syncRangeFromNum(rangeId, numId) {
  const r = document.getElementById(rangeId);
  const n = document.getElementById(numId);
  if (!r || !n) return;
  const clamped = clampVal(+n.value, +r.min, +r.max);
  n.value = clamped;
  r.value = clamped;
  syncRange(r);
}

function clampVal(v, min, max) {
  if (isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// ════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════
function scheduleEst()     { clearTimeout(estTimer);  estTimer  = setTimeout(updateAllEst, 130); }
function schedulePreview() { clearTimeout(prevTimer); prevTimer = setTimeout(renderPreview,  30); }

function setResizeMode(mode) {
  document.getElementById('field-scale').classList.toggle('active', mode==='scale');
  document.getElementById('field-pixel').classList.toggle('active', mode==='pixel');
  document.getElementById('mode-scale').classList.toggle('active', mode==='scale');
  document.getElementById('mode-pixel').classList.toggle('active', mode==='pixel');
  scheduleEst();
}

function toggleCheck(id) {
  const cb = document.getElementById(id);
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change'));
}

function onCropToggle() {
  const en = document.getElementById('crop-toggle').checked;
  document.getElementById('crop-fields').style.display = en ? 'block' : 'none';
  document.getElementById('crop-pos-bar').classList.toggle('visible', en && !!pv.img);
  renderPreview(); scheduleEst();
}

function onCropDimChange() { clampCropPos(); syncCropDisplays(); renderPreview(); }

function updateStatFmt() {
  const m={'image/png':'PNG','image/jpeg':'JPEG','image/webp':'WebP'};
  document.getElementById('stat-fmt').textContent = m[document.getElementById('export-format').value]||'—';
}

function updateStats() {
  document.getElementById('stat-count').textContent = files.length;
  document.getElementById('stats-bar').style.display = files.length ? 'flex' : 'none';
}

function syncCropDisplays() {
  const x=Math.round(cropPos.x), y=Math.round(cropPos.y);
  const cw=parseInt(document.getElementById('crop-w').value)||0;
  const ch=parseInt(document.getElementById('crop-h').value)||0;
  document.getElementById('crop-x-disp').textContent = x;
  document.getElementById('crop-y-disp').textContent = y;
  document.getElementById('crop-w-disp').textContent = cw || '—';
  document.getElementById('crop-h-disp').textContent = ch || '—';
  document.getElementById('ctrl-x-disp').textContent = x + ' px';
  document.getElementById('ctrl-y-disp').textContent = y + ' px';
}

function clampCropPos() {
  if (!pv.img) return;
  const cw=parseInt(document.getElementById('crop-w').value)||0;
  const ch=parseInt(document.getElementById('crop-h').value)||0;
  const iw=pv.img.naturalWidth, ih=pv.img.naturalHeight;
  if (cw>0) cropPos.x = Math.max(0, Math.min(cropPos.x, iw-cw));
  if (ch>0) cropPos.y = Math.max(0, Math.min(cropPos.y, ih-ch));
  cropPos.x = Math.max(0, cropPos.x);
  cropPos.y = Math.max(0, cropPos.y);
}

// ════════════════════════════════════════════════
//  TRANSFORMS
// ════════════════════════════════════════════════
function applyFlip(axis) {
  if (axis==='h') gOpts.flipH = !gOpts.flipH;
  else            gOpts.flipV = !gOpts.flipV;
  updateTBadges(); renderPreview();
}
function applyRotate(deg) { gOpts.rotation=(gOpts.rotation+deg)%360; updateTBadges(); renderPreview(); }
function resetTransforms() { gOpts.flipH=false; gOpts.flipV=false; gOpts.rotation=0; updateTBadges(); renderPreview(); }
function updateTBadges() {
  const c=document.getElementById('transform-state'); c.innerHTML='';
  if (gOpts.rotation) addBadge(c, '↻'+gOpts.rotation+'°');
  if (gOpts.flipH)    addBadge(c, '⇆H');
  if (gOpts.flipV)    addBadge(c, '⇅V');
}
function addBadge(p,t) { const b=document.createElement('div'); b.className='t-badge'; b.textContent=t; p.appendChild(b); }

// ════════════════════════════════════════════════
//  LOGO OVERLAY
// ════════════════════════════════════════════════
const logoDrop  = document.getElementById('logo-drop-zone');
const logoInput = document.getElementById('logo-file-input');

logoDrop.addEventListener('dragover', e => { e.preventDefault(); logoDrop.classList.add('drag-over'); });
logoDrop.addEventListener('dragleave', () => logoDrop.classList.remove('drag-over'));
logoDrop.addEventListener('drop', e => {
  e.preventDefault(); logoDrop.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) loadLogo(e.dataTransfer.files[0]);
});
logoInput.addEventListener('change', () => {
  if (logoInput.files[0]) { loadLogo(logoInput.files[0]); logoInput.value=''; }
});

function loadLogo(file) {
  const fr = new FileReader();
  fr.onload = e => {
    logoState.dataUrl = e.target.result;
    logoState.name    = file.name;
    const img = new Image();
    img.onload = () => {
      logoState.img = img;
      document.getElementById('logo-drop-zone').style.display    = 'none';
      document.getElementById('logo-preview-wrap').style.display = 'flex';
      document.getElementById('logo-controls').style.display     = 'block';
      document.getElementById('logo-preview-img').src            = logoState.dataUrl;
      document.getElementById('logo-preview-name').textContent   = file.name;
      renderPreview();
    };
    img.src = e.target.result;
  };
  fr.readAsDataURL(file);
}

function removeLogo() {
  logoState.img=null; logoState.dataUrl=null;
  document.getElementById('logo-drop-zone').style.display    = 'block';
  document.getElementById('logo-preview-wrap').style.display = 'none';
  document.getElementById('logo-controls').style.display     = 'none';
  renderPreview();
}

function setLogoPos(pos) {
  logoState.position = pos;
  document.querySelectorAll('.pos-cell').forEach(el => el.classList.toggle('active', el.dataset.pos===pos));
  schedulePreview();
}

function calcLogoRect(areaW, areaH, offsetX, offsetY) {
  if (!logoState.img) return null;
  const shorter = Math.min(areaW, areaH);
  const lSize   = Math.round(shorter * (logoState.size/100));
  const ar      = logoState.img.naturalWidth / logoState.img.naturalHeight;
  let lw, lh;
  if (ar>=1) { lw=lSize; lh=Math.round(lSize/ar); }
  else       { lh=lSize; lw=Math.round(lSize*ar); }
  const mg = Math.round(shorter * 0.03);
  const P = {
    'top-left':   [offsetX+mg,           offsetY+mg],
    'top-center': [offsetX+(areaW-lw)/2, offsetY+mg],
    'top-right':  [offsetX+areaW-lw-mg,  offsetY+mg],
    'mid-left':   [offsetX+mg,           offsetY+(areaH-lh)/2],
    'center':     [offsetX+(areaW-lw)/2, offsetY+(areaH-lh)/2],
    'mid-right':  [offsetX+areaW-lw-mg,  offsetY+(areaH-lh)/2],
    'bot-left':   [offsetX+mg,           offsetY+areaH-lh-mg],
    'bot-center': [offsetX+(areaW-lw)/2, offsetY+areaH-lh-mg],
    'bot-right':  [offsetX+areaW-lw-mg,  offsetY+areaH-lh-mg],
  };
  const [lx,ly] = P[logoState.position] || P['bot-right'];
  return { lx, ly, lw, lh };
}

// ════════════════════════════════════════════════
//  FILE HANDLING
// ════════════════════════════════════════════════
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  handleFiles([...e.dataTransfer.files]);
});
fileInput.addEventListener('change', () => { handleFiles([...fileInput.files]); fileInput.value=''; });

function handleFiles(newFiles) {
  const valid = newFiles.filter(f => f.type.startsWith('image/'));
  valid.forEach(f => {
    const id = Date.now() + Math.random();
    const item = { id, file:f, status:'pending', width:0, height:0, dataUrl:null };
    files.push(item);
    addQueueItem(item);
    const fr = new FileReader();
    fr.onload = e => {
      item.dataUrl = e.target.result;
      const img = new Image();
      img.onload = () => {
        item.width=img.naturalWidth; item.height=img.naturalHeight;
        const d=document.getElementById('qi-dims-'+item.id);
        if (d) d.textContent = item.width+' × '+item.height+' px';
        scheduleEst();
        if (files.length===1) selectFile(item.id);
      };
      img.src = item.dataUrl;
    };
    fr.readAsDataURL(f);
  });
  document.getElementById('empty-msg')?.remove();
  updateStats();
  document.getElementById('process-btn').disabled = false;
  const badge = document.getElementById('count-badge');
  badge.style.display='inline-flex'; badge.textContent=files.length;
}

function addQueueItem(item) {
  const queue = document.getElementById('image-queue');
  const div = document.createElement('div');
  div.className='queue-item'; div.id='qi-'+item.id;
  div.onclick = () => selectFile(item.id);

  const thumb = document.createElement('img');
  thumb.className='queue-thumb'; thumb.alt=item.file.name;
  let pc=0, poll=setInterval(()=>{ if(item.dataUrl){thumb.src=item.dataUrl;clearInterval(poll);}if(++pc>60)clearInterval(poll); },80);

  const info=document.createElement('div'); info.className='queue-info';
  const nm=document.createElement('div'); nm.className='queue-name'; nm.textContent=item.file.name;
  const dm=document.createElement('div'); dm.className='queue-dims'; dm.id='qi-dims-'+item.id; dm.textContent='…';
  const sz=document.createElement('div'); sz.className='queue-sizes';
  const sb=document.createElement('span'); sb.className='size-before'; sb.textContent=fmtSz(item.file.size);
  const sa=document.createElement('span'); sa.className='size-arrow'; sa.textContent='→';
  const se=document.createElement('span'); se.className='size-after'; se.id='qi-est-'+item.id; se.textContent='—';
  sz.append(sb,sa,se); info.append(nm,dm,sz);

  const sdot=document.createElement('div'); sdot.className='queue-status'; sdot.id='qs-'+item.id;
  const rem=document.createElement('button'); rem.className='queue-remove'; rem.innerHTML='✕'; rem.title='Remove';
  rem.onclick=e=>{ e.stopPropagation(); removeItem(item.id); };

  div.append(thumb,info,sdot,rem);
  queue.appendChild(div);
}

function removeItem(id) {
  const idx=files.findIndex(f=>f.id===id);
  if (idx>-1) files.splice(idx,1);
  document.getElementById('qi-'+id)?.remove();
  if (pv.fileId===id) clearPreview();
  updateStats();
  document.getElementById('process-btn').disabled = files.length===0;
  const badge=document.getElementById('count-badge');
  if (!files.length) {
    badge.style.display='none';
    document.getElementById('image-queue').innerHTML='<div class="empty-state" id="empty-msg">No images loaded</div>';
  } else badge.textContent=files.length;
}

function clearAll() {
  files.length=0; clearPreview();
  document.getElementById('image-queue').innerHTML='<div class="empty-state" id="empty-msg">No images loaded</div>';
  document.getElementById('count-badge').style.display='none';
  document.getElementById('process-btn').disabled=true;
  document.getElementById('progress-wrap').classList.remove('visible');
  document.getElementById('stat-done').textContent='0';
  updateStats();
}

function clearPreview() {
  pv={fileId:null,img:null,scale:1,imgX:0,imgY:0,imgW:0,imgH:0};
  document.getElementById('canvas-placeholder').style.display='flex';
  document.getElementById('preview-filename').textContent='No image selected';
  document.getElementById('crop-pos-bar').classList.remove('visible');
  renderPreview();
}

function fmtSz(b) {
  if (b<1024) return b+'B';
  if (b<1048576) return (b/1024).toFixed(1)+'KB';
  return (b/1048576).toFixed(1)+'MB';
}

// ════════════════════════════════════════════════
//  SIZE ESTIMATION
// ════════════════════════════════════════════════
function getOpts() {
  return {
    resizeMode:  document.getElementById('mode-scale').classList.contains('active') ? 'scale' : 'pixel',
    scale:       parseInt(document.getElementById('resize-scale').value)/100,
    pixW:        parseInt(document.getElementById('resize-w').value)||0,
    pixH:        parseInt(document.getElementById('resize-h').value)||0,
    cropEnabled: document.getElementById('crop-toggle').checked,
    cropW:       parseInt(document.getElementById('crop-w').value)||0,
    cropH:       parseInt(document.getElementById('crop-h').value)||0,
    grayscale:   document.getElementById('grayscale-toggle').checked,
    brightness:  document.getElementById('brightness').value,
    contrast:    document.getElementById('contrast').value,
    format:      document.getElementById('export-format').value,
    quality:     parseInt(document.getElementById('export-quality').value),
    rotation:    gOpts.rotation, flipH:gOpts.flipH, flipV:gOpts.flipV,
  };
}

function estOutputSize(w, h, opts) {
  let ow=w, oh=h;
  if (opts.resizeMode==='scale') { ow=Math.round(ow*opts.scale); oh=Math.round(oh*opts.scale); }
  else { if(opts.pixW)ow=opts.pixW; if(opts.pixH)oh=opts.pixH; }
  if (opts.cropEnabled&&opts.cropW&&opts.cropH) { ow=opts.cropW; oh=opts.cropH; }
  if (opts.rotation===90||opts.rotation===270) { [ow,oh]=[oh,ow]; }
  ow=Math.max(1,ow); oh=Math.max(1,oh);
  const px=ow*oh, q=opts.quality/100;
  if (opts.format==='image/png')  return Math.round(px*0.45);
  if (opts.format==='image/jpeg') return Math.round(px*0.14*q);
  return Math.round(px*0.07*q);
}

function updateAllEst() {
  const opts=getOpts();
  files.forEach(it => {
    if (!it.width) return;
    const el=document.getElementById('qi-est-'+it.id);
    if (el) el.textContent='~'+fmtSz(estOutputSize(it.width,it.height,opts));
  });
}

// ════════════════════════════════════════════════
//  PREVIEW SELECTION
// ════════════════════════════════════════════════
function selectFile(id) {
  const item=files.find(f=>f.id===id);
  if (!item) return;
  document.querySelectorAll('.queue-item').forEach(el=>el.classList.remove('selected'));
  document.getElementById('qi-'+id)?.classList.add('selected');

  if (!item.dataUrl) {
    let t=0; const w=setInterval(()=>{ if(item.dataUrl||++t>80){clearInterval(w);if(item.dataUrl)selectFile(id);} },100);
    return;
  }
  pv.fileId=id;
  document.getElementById('canvas-placeholder').style.display='none';
  document.getElementById('preview-filename').textContent=item.file.name;

  const img=new Image();
  img.onload=()=>{
    pv.img=img; recalcLayout(); clampCropPos(); syncCropDisplays();
    document.getElementById('crop-pos-bar').classList.toggle('visible',document.getElementById('crop-toggle').checked);
    renderPreview();
  };
  img.src=item.dataUrl;
}

function recalcLayout() {
  if (!pv.img) return;
  const W=canvas.width, H=canvas.height;
  pv.scale = Math.min(W/pv.img.naturalWidth, H/pv.img.naturalHeight, 1);
  pv.imgW  = pv.img.naturalWidth  * pv.scale;
  pv.imgH  = pv.img.naturalHeight * pv.scale;
  pv.imgX  = (W - pv.imgW) / 2;
  pv.imgY  = (H - pv.imgH) / 2;
}

// ════════════════════════════════════════════════
//  RENDER PREVIEW
// ════════════════════════════════════════════════
function renderPreview() {
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  if (!pv.img) return;

  const opts=getOpts();
  const { imgX, imgY, imgW, imgH, scale } = pv;

  // Draw image with transforms + filters
  ctx.save();
  ctx.translate(imgX+imgW/2, imgY+imgH/2);
  ctx.rotate(gOpts.rotation * Math.PI/180);
  ctx.scale(gOpts.flipH?-1:1, gOpts.flipV?-1:1);

  const filters=[];
  if (opts.grayscale) filters.push('grayscale(100%)');
  filters.push(`brightness(${opts.brightness}%)`);
  filters.push(`contrast(${opts.contrast}%)`);
  ctx.filter = filters.join(' ');

  const swapped = gOpts.rotation===90||gOpts.rotation===270;
  if (swapped) ctx.drawImage(pv.img, -imgH/2, -imgW/2, imgH, imgW);
  else         ctx.drawImage(pv.img, -imgW/2, -imgH/2, imgW, imgH);
  ctx.filter='none';
  ctx.restore();

  // Logo overlay
  if (logoState.img) {
    const lr=calcLogoRect(imgW, imgH, imgX, imgY);
    if (lr) {
      ctx.save();
      ctx.globalAlpha = logoState.opacity/100;
      ctx.drawImage(logoState.img, lr.lx, lr.ly, lr.lw, lr.lh);
      ctx.globalAlpha=1;
      ctx.restore();
    }
  }

  // Crop overlay
  if (opts.cropEnabled && opts.cropW>0 && opts.cropH>0) {
    const bx=imgX+cropPos.x*scale, by=imgY+cropPos.y*scale;
    const bw=opts.cropW*scale,     bh=opts.cropH*scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0,0,W,H);
    ctx.rect(bx,by,bw,bh);
    ctx.fillStyle='rgba(0,0,0,0.48)';
    ctx.fill('evenodd');
    ctx.restore();

    ctx.save();
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=1.5;
    ctx.strokeRect(bx,by,bw,bh);
    ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=1; ctx.setLineDash([3,3]);
    ctx.beginPath();
    for (let i=1;i<3;i++) {
      ctx.moveTo(bx+bw*(i/3),by); ctx.lineTo(bx+bw*(i/3),by+bh);
      ctx.moveTo(bx,by+bh*(i/3)); ctx.lineTo(bx+bw,by+bh*(i/3));
    }
    ctx.stroke(); ctx.setLineDash([]);
    drawHandles(ctx,bx,by,bw,bh,9);
    ctx.restore();
  }
}

function drawHandles(ctx, bx, by, bw, bh, HS) {
  const h2=HS/2;
  [
    {cx:bx,       cy:by},      {cx:bx+bw/2, cy:by},      {cx:bx+bw,  cy:by},
    {cx:bx,       cy:by+bh/2},                             {cx:bx+bw,  cy:by+bh/2},
    {cx:bx,       cy:by+bh},   {cx:bx+bw/2, cy:by+bh},   {cx:bx+bw,  cy:by+bh},
  ].forEach(h => {
    ctx.fillStyle='#fff'; ctx.shadowColor='rgba(0,0,0,0.3)'; ctx.shadowBlur=3;
    ctx.fillRect(h.cx-h2, h.cy-h2, HS, HS);
    ctx.fillStyle='#9B177E'; ctx.shadowBlur=0;
    ctx.fillRect(h.cx-h2+1, h.cy-h2+1, HS-2, HS-2);
  });
}

// ════════════════════════════════════════════════
//  CROP BOX MOUSE / TOUCH
// ════════════════════════════════════════════════
function getCropBoxBounds() {
  const cw=parseInt(document.getElementById('crop-w').value)||0;
  const ch=parseInt(document.getElementById('crop-h').value)||0;
  return { x:pv.imgX+cropPos.x*pv.scale, y:pv.imgY+cropPos.y*pv.scale, w:cw*pv.scale, h:ch*pv.scale };
}

function isCropActive() {
  return document.getElementById('crop-toggle').checked &&
    (parseInt(document.getElementById('crop-w').value)||0)>0 &&
    (parseInt(document.getElementById('crop-h').value)||0)>0 &&
    !!pv.img;
}

function getMC(e) {
  const r=canvas.getBoundingClientRect();
  return { x:(e.clientX-r.left)*(canvas.width/r.width), y:(e.clientY-r.top)*(canvas.height/r.height) };
}

function getHandleAt(mx,my) {
  if (!isCropActive()) return null;
  const b=getCropBoxBounds();
  const handles={
    nw:{cx:b.x,       cy:b.y},      n:{cx:b.x+b.w/2,cy:b.y},      ne:{cx:b.x+b.w,  cy:b.y},
     w:{cx:b.x,       cy:b.y+b.h/2},                                 e:{cx:b.x+b.w,  cy:b.y+b.h/2},
    sw:{cx:b.x,       cy:b.y+b.h},  s:{cx:b.x+b.w/2,cy:b.y+b.h},  se:{cx:b.x+b.w,  cy:b.y+b.h},
  };
  const R=9;
  for (const [name,h] of Object.entries(handles)) {
    if (Math.abs(mx-h.cx)<=R && Math.abs(my-h.cy)<=R) return name;
  }
  return null;
}

const HCursors={ nw:'nw-resize',n:'n-resize',ne:'ne-resize',w:'w-resize',e:'e-resize',sw:'sw-resize',s:'s-resize',se:'se-resize' };

function applyDrag(mx,my) {
  const dx=(mx-drag.startMX)/pv.scale, dy=(my-drag.startMY)/pv.scale;
  const MIN=10;
  if (drag.mode==='move') { cropPos.x=drag.startCX+dx; cropPos.y=drag.startCY+dy; }
  else {
    const mode=drag.mode.replace('resize-','');
    let nx=drag.startCX, ny=drag.startCY, nw=drag.startCW, nh=drag.startCH;
    if (mode.includes('w')) { nx=drag.startCX+dx; nw=drag.startCW-dx; }
    if (mode.includes('e')) { nw=drag.startCW+dx; }
    if (mode.includes('n')) { ny=drag.startCY+dy; nh=drag.startCH-dy; }
    if (mode.includes('s')) { nh=drag.startCH+dy; }
    if (nw<MIN) { if(mode.includes('w')) nx=drag.startCX+drag.startCW-MIN; nw=MIN; }
    if (nh<MIN) { if(mode.includes('n')) ny=drag.startCY+drag.startCH-MIN; nh=MIN; }
    cropPos.x=nx; cropPos.y=ny;
    document.getElementById('crop-w').value=Math.round(nw);
    document.getElementById('crop-h').value=Math.round(nh);
  }
  clampCropPos(); syncCropDisplays(); renderPreview(); scheduleEst();
}

canvasWrap.addEventListener('mousedown', e => {
  if (!isCropActive()) return;
  canvasWrap.focus();
  const m=getMC(e);
  const handle=getHandleAt(m.x,m.y);
  const b=getCropBoxBounds();
  const cw=parseInt(document.getElementById('crop-w').value)||0;
  const ch=parseInt(document.getElementById('crop-h').value)||0;
  drag.startMX=m.x; drag.startMY=m.y;
  drag.startCX=cropPos.x; drag.startCY=cropPos.y;
  drag.startCW=cw; drag.startCH=ch;
  if (handle) { drag.active=true; drag.mode='resize-'+handle; canvasWrap.style.cursor=HCursors[handle]; }
  else if (m.x>=b.x&&m.x<=b.x+b.w&&m.y>=b.y&&m.y<=b.y+b.h) { drag.active=true; drag.mode='move'; canvasWrap.style.cursor='grabbing'; }
  else {
    const ix=(m.x-pv.imgX)/pv.scale, iy=(m.y-pv.imgY)/pv.scale;
    cropPos.x=ix-cw/2; cropPos.y=iy-ch/2;
    clampCropPos(); syncCropDisplays(); renderPreview();
  }
});

canvasWrap.addEventListener('mousemove', e => {
  const m=getMC(e);
  if (!isCropActive()) { canvasWrap.style.cursor='default'; return; }
  if (drag.active) { applyDrag(m.x,m.y); return; }
  const h=getHandleAt(m.x,m.y);
  if (h) { canvasWrap.style.cursor=HCursors[h]; return; }
  const b=getCropBoxBounds();
  canvasWrap.style.cursor=(m.x>=b.x&&m.x<=b.x+b.w&&m.y>=b.y&&m.y<=b.y+b.h)?'grab':'crosshair';
});

canvasWrap.addEventListener('mouseup', () => { drag.active=false; drag.mode=null; if(isCropActive())canvasWrap.style.cursor='crosshair'; });
canvasWrap.addEventListener('mouseleave', () => { drag.active=false; drag.mode=null; });

function touchMC(t) { return getMC({clientX:t.clientX,clientY:t.clientY}); }

canvasWrap.addEventListener('touchstart', e => {
  if (!isCropActive()||e.touches.length!==1) return;
  e.preventDefault();
  const m=touchMC(e.touches[0]);
  const handle=getHandleAt(m.x,m.y);
  const b=getCropBoxBounds();
  const cw=parseInt(document.getElementById('crop-w').value)||0;
  const ch=parseInt(document.getElementById('crop-h').value)||0;
  drag.startMX=m.x; drag.startMY=m.y;
  drag.startCX=cropPos.x; drag.startCY=cropPos.y;
  drag.startCW=cw; drag.startCH=ch;
  if (handle) { drag.active=true; drag.mode='resize-'+handle; }
  else if (m.x>=b.x&&m.x<=b.x+b.w&&m.y>=b.y&&m.y<=b.y+b.h) { drag.active=true; drag.mode='move'; }
  else { const ix=(m.x-pv.imgX)/pv.scale,iy=(m.y-pv.imgY)/pv.scale; cropPos.x=ix-cw/2; cropPos.y=iy-ch/2; clampCropPos(); syncCropDisplays(); renderPreview(); }
},{passive:false});

canvasWrap.addEventListener('touchmove', e => {
  if (!drag.active||e.touches.length!==1) return;
  e.preventDefault(); applyDrag(...Object.values(touchMC(e.touches[0])));
},{passive:false});

canvasWrap.addEventListener('touchend', () => { drag.active=false; drag.mode=null; });

document.addEventListener('keydown', e => {
  if (!isCropActive()) return;
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const step=e.shiftKey?10:1;
  if (e.key==='ArrowLeft')  cropPos.x-=step;
  if (e.key==='ArrowRight') cropPos.x+=step;
  if (e.key==='ArrowUp')    cropPos.y-=step;
  if (e.key==='ArrowDown')  cropPos.y+=step;
  clampCropPos(); syncCropDisplays(); renderPreview();
});

// ════════════════════════════════════════════════
//  PROCESSING PIPELINE
// ════════════════════════════════════════════════
async function processAll() {
  if (!files.length||processing) return;
  processing=true;
  const btn=document.getElementById('process-btn');
  btn.disabled=true; btn.textContent='⏳ Processing…';
  document.getElementById('progress-wrap').classList.add('visible');
  const progBar=document.getElementById('progress-bar');
  const progText=document.getElementById('progress-text');
  const statDone=document.getElementById('stat-done');
  const opts=getOpts();
  opts.ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[opts.format]||'png';

  for (let i=0;i<files.length;i++) {
    const item=files[i];
    const sdot=document.getElementById('qs-'+item.id);
    if (sdot) sdot.className='queue-status processing';
    progText.textContent=`${i+1} / ${files.length}`;
    progBar.style.width=((i/files.length)*100)+'%';
    try { await processOneImage(item,opts); if(sdot)sdot.className='queue-status done'; }
    catch(err) { console.error(item.file.name,err); if(sdot)sdot.className='queue-status error'; }
    statDone.textContent=i+1;
    await sleep(40);
  }

  progBar.style.width='100%';
  progText.textContent=`${files.length} / ${files.length} — DONE`;
  btn.textContent='✓ All Downloaded!'; btn.style.background='#3acf8c';
  processing=false;
  setTimeout(()=>{ btn.textContent='▶ PROCESS & DOWNLOAD'; btn.style.background=''; btn.disabled=false; },3200);
}

function processOneImage(item, opts) {
  return new Promise((resolve,reject) => {
    if (!item.dataUrl) return reject(new Error('No data'));
    const img=new Image();
    img.onload=()=>{
      try {
        const srcW=img.naturalWidth, srcH=img.naturalHeight;
        let sx=0,sy=0,sw=srcW,sh=srcH;
        if (opts.cropEnabled&&opts.cropW>0&&opts.cropH>0) {
          sx=Math.round(Math.max(0,Math.min(cropPos.x,srcW-opts.cropW)));
          sy=Math.round(Math.max(0,Math.min(cropPos.y,srcH-opts.cropH)));
          sw=Math.min(opts.cropW,srcW-sx); sh=Math.min(opts.cropH,srcH-sy);
        }
        let ow,oh;
        if (opts.resizeMode==='scale') { ow=Math.max(1,Math.round(sw*opts.scale)); oh=Math.max(1,Math.round(sh*opts.scale)); }
        else { ow=opts.pixW||sw; oh=opts.pixH||sh; }
        const rot=opts.rotation;
        const fw=(rot===90||rot===270)?oh:ow, fh=(rot===90||rot===270)?ow:oh;
        const oc=document.createElement('canvas'); oc.width=fw; oc.height=fh;
        const cx=oc.getContext('2d');

        const filters=[];
        if (opts.grayscale) filters.push('grayscale(100%)');
        filters.push(`brightness(${opts.brightness}%)`);
        filters.push(`contrast(${opts.contrast}%)`);
        cx.filter=filters.join(' ');
        cx.save();
        cx.translate(fw/2,fh/2);
        if (rot) cx.rotate(rot*Math.PI/180);
        if (opts.flipH) cx.scale(-1,1);
        if (opts.flipV) cx.scale(1,-1);
        cx.drawImage(img,sx,sy,sw,sh,-ow/2,-oh/2,ow,oh);
        cx.restore();

        if (logoState.img) {
          cx.filter='none';
          const shorter=Math.min(fw,fh);
          const lSize=Math.round(shorter*(logoState.size/100));
          const ar=logoState.img.naturalWidth/logoState.img.naturalHeight;
          let lw,lh;
          if (ar>=1){lw=lSize;lh=Math.round(lSize/ar);}else{lh=lSize;lw=Math.round(lSize*ar);}
          const mg=Math.round(shorter*0.03);
          const P={'top-left':[mg,mg],'top-center':[(fw-lw)/2,mg],'top-right':[fw-lw-mg,mg],
            'mid-left':[mg,(fh-lh)/2],'center':[(fw-lw)/2,(fh-lh)/2],'mid-right':[fw-lw-mg,(fh-lh)/2],
            'bot-left':[mg,fh-lh-mg],'bot-center':[(fw-lw)/2,fh-lh-mg],'bot-right':[fw-lw-mg,fh-lh-mg]};
          const [lx,ly]=P[logoState.position]||P['bot-right'];
          cx.globalAlpha=logoState.opacity/100;
          cx.drawImage(logoState.img,lx,ly,lw,lh);
          cx.globalAlpha=1;
        }

        oc.toBlob(blob=>{
          if (!blob) return reject(new Error('toBlob failed'));
          triggerDownload(blob, item.file.name.replace(/\.[^.]+$/,'')+`_batchforged.${opts.ext}`);
          resolve();
        }, opts.format, opts.quality/100);
      } catch(err){reject(err);}
    };
    img.onerror=()=>reject(new Error('Load error'));
    img.src=item.dataUrl;
  });
}

function triggerDownload(blob,filename) {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }