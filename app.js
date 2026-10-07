'use strict';

const POLL_MS = 3000;
const MAX_EDGE = 2560;
const THUMB_EDGE = 600;
const MAX_UPLOAD_BYTES = 14 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png'];

const $ = (id) => document.getElementById(id);
let photos = [];           // newest first: {id, name, ts}
const tiles = new Map();   // id -> tile element
let pollTimer = null;
let lbIndex = -1;

class AuthError extends Error {}

async function api(action, body) {
  const res = await fetch('api.php?action=' + action, body ? { method: 'POST', body } : {});
  if (res.status === 401) throw new AuthError();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
  return data;
}

const imgUrl = (id, thumb) => 'api.php?action=img&id=' + id + (thumb ? '&s=t' : '');

// ---------- screens ----------

function showLogin() {
  stopPolling();
  closeLightbox();
  $('app').hidden = true;
  $('login').hidden = false;
  $('password').focus();
}

function showApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  startPolling();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  const fd = new FormData();
  fd.append('password', $('password').value);
  try {
    await api('login', fd);
    $('password').value = '';
    showApp();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('logout', new FormData()).catch(() => {});
  photos = [];
  tiles.clear();
  $('grid').replaceChildren();
  showLogin();
});

$('toggle-upload').addEventListener('click', () => {
  const on = document.body.classList.toggle('presenter');
  $('upload-form').hidden = on;
  $('toggle-upload').textContent = on ? 'Show upload' : 'Presenter mode';
});

// ---------- gallery ----------

function startPolling() {
  stopPolling();
  refresh();
  pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    render((await api('list')).photos);
  } catch (err) {
    if (err instanceof AuthError) showLogin();
  } finally {
    refreshing = false;
  }
}

function makeTile(p) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  const img = document.createElement('img');
  img.src = imgUrl(p.id, true);
  img.alt = 'Photo by ' + p.name;
  img.loading = 'lazy';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = p.name;
  const del = document.createElement('button');
  del.className = 'del';
  del.type = 'button';
  del.title = 'Delete';
  del.textContent = '×';
  del.addEventListener('click', (e) => { e.stopPropagation(); deletePhoto(p); });
  tile.addEventListener('click', () => openLightbox(photos.findIndex((x) => x.id === p.id)));
  tile.append(img, name, del);
  return tile;
}

function render(list) {
  const grid = $('grid');
  const ids = new Set(list.map((p) => p.id));
  for (const [id, el] of tiles) {
    if (!ids.has(id)) { el.remove(); tiles.delete(id); }
  }
  list.forEach((p, i) => {
    let el = tiles.get(p.id);
    if (!el) { el = makeTile(p); tiles.set(p.id, el); }
    if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
  });

  const current = lbIndex >= 0 ? photos[lbIndex] : null;
  photos = list;
  if (current) {
    lbIndex = photos.findIndex((x) => x.id === current.id);
    if (lbIndex < 0) closeLightbox();
  }
  $('empty').hidden = list.length > 0;
  $('count').textContent = list.length === 1 ? '1 photo' : list.length + ' photos';
}

async function deletePhoto(p) {
  if (!confirm('Delete this photo by ' + p.name + '?')) return;
  const fd = new FormData();
  fd.append('id', p.id);
  try {
    await api('delete', fd);
    render(photos.filter((x) => x.id !== p.id));
  } catch (err) {
    if (err instanceof AuthError) showLogin(); else alert(err.message);
  }
}

// ---------- lightbox ----------

function openLightbox(i) {
  if (i < 0) return;
  lbIndex = i;
  showLightboxPhoto();
  const lb = $('lightbox');
  lb.hidden = false;
  if (lb.requestFullscreen && !document.fullscreenElement) lb.requestFullscreen().catch(() => {});
}

function showLightboxPhoto() {
  const p = photos[lbIndex];
  $('lb-img').src = imgUrl(p.id, false);
  $('lb-img').alt = 'Photo by ' + p.name;
  $('lb-caption').textContent = p.name;
  // Preload neighbours for snappy navigation.
  [lbIndex - 1, lbIndex + 1].forEach((j) => { if (photos[j]) new Image().src = imgUrl(photos[j].id, false); });
}

function stepLightbox(d) {
  if (lbIndex < 0 || !photos.length) return;
  lbIndex = (lbIndex + d + photos.length) % photos.length;
  showLightboxPhoto();
}

function closeLightbox() {
  lbIndex = -1;
  $('lightbox').hidden = true;
  $('lb-img').removeAttribute('src');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

$('lb-close').addEventListener('click', closeLightbox);
$('lb-prev').addEventListener('click', () => stepLightbox(-1));
$('lb-next').addEventListener('click', () => stepLightbox(1));
$('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && lbIndex >= 0) closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (lbIndex < 0) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') stepLightbox(-1);
  else if (e.key === 'ArrowRight') stepLightbox(1);
});

let touchX = null;
$('lightbox').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('lightbox').addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
  touchX = null;
});

// ---------- upload ----------

$('name').value = localStorage.getItem('pv_name') || '';

$('files').addEventListener('change', () => {
  const n = $('files').files.length;
  $('file-label').textContent = n === 0 ? 'Choose photos…' : n === 1 ? $('files').files[0].name : n + ' photos selected';
});

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* fall back */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(img.src); };
    img.onerror = () => reject(new Error('Cannot read image'));
    img.src = URL.createObjectURL(file);
  });
}

function encode(src, maxEdge, type, quality) {
  const w = src.width, h = src.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Cannot process image'))), type, quality));
}

// Resizes in the browser: keeps uploads small and strips metadata such as GPS location.
async function prepare(file) {
  const bmp = await loadBitmap(file);
  let photo = await encode(bmp, MAX_EDGE, file.type, 0.88);
  if (photo.size > MAX_UPLOAD_BYTES && file.type === 'image/png') photo = await encode(bmp, MAX_EDGE, 'image/jpeg', 0.88);
  const thumb = await encode(bmp, THUMB_EDGE, 'image/jpeg', 0.8);
  if (bmp.close) bmp.close();
  return { photo, thumb, ext: photo.type === 'image/png' ? 'png' : 'jpg' };
}

$('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  if (!name) { $('name').focus(); return; }
  localStorage.setItem('pv_name', name);

  const files = [...$('files').files];
  const status = $('upload-status');
  const bad = files.filter((f) => !ALLOWED.includes(f.type));
  const good = files.filter((f) => ALLOWED.includes(f.type));
  const errors = bad.map((f) => f.name + ': only JPG and PNG are allowed');

  $('upload-btn').disabled = true;
  let done = 0;
  for (const f of good) {
    status.textContent = 'Uploading ' + (done + 1) + ' of ' + good.length + '…';
    try {
      const { photo, thumb, ext } = await prepare(f);
      const fd = new FormData();
      fd.append('name', name);
      fd.append('photo', photo, 'photo.' + ext);
      fd.append('thumb', thumb, 'thumb.jpg');
      await api('upload', fd);
      done++;
      refresh();
    } catch (err) {
      if (err instanceof AuthError) { $('upload-btn').disabled = false; showLogin(); return; }
      errors.push(f.name + ': ' + err.message);
    }
  }
  $('upload-btn').disabled = false;
  $('files').value = '';
  $('file-label').textContent = 'Choose photos…';
  status.textContent = (done ? 'Uploaded ' + done + (done === 1 ? ' photo.' : ' photos.') : '') +
    (errors.length ? ' Failed: ' + errors.join('; ') : '');
});

// ---------- start ----------

api('list').then((d) => { render(d.photos); showApp(); }).catch(showLogin);
