// PIN lock. The app itself is in app.bin, encrypted with the owner's code.
// This file asks for the code once, remembers the derived key on this device,
// decrypts the app in memory and starts it. Format: see tools/bundle.mjs.
const KEY = 'bowlomatic.unlockKey';
const lock = document.getElementById('lock');
const dots = lock.querySelector('.dots');
const msg = lock.querySelector('.msg');
const te = new TextEncoder();
let pin = '';
let busy = false;
let bundle = null;
let pinLen = 6;

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function say(text, bad) {
  msg.textContent = text;
  msg.classList.toggle('bad', !!bad);
}
function drawDots() {
  dots.innerHTML = '';
  for (let i = 0; i < pinLen; i++) {
    const d = document.createElement('i');
    if (i < pin.length) d.className = 'on';
    dots.appendChild(d);
  }
}

async function load() {
  const res = await fetch('app.bin', { cache: 'no-cache' });
  if (!res.ok) throw new Error('missing');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (String.fromCharCode(...buf.subarray(0, 4)) !== 'BOM1') throw new Error('bad');
  const dv = new DataView(buf.buffer);
  return { iter: dv.getUint32(4), pinLen: buf[8], salt: buf.slice(9, 25), iv: buf.slice(25, 37), ct: buf.slice(37) };
}

async function derive(code) {
  const base = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bundle.salt, iterations: bundle.iter }, base, 256));
}

async function decrypt(raw) {
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bundle.iv }, key, bundle.ct);
  return JSON.parse(new TextDecoder().decode(pt)).files;
}

// Turn each module into a blob: URL, pointing its "./x.js" imports at the
// other blobs, so the app runs exactly as it would from separate files.
function start(files, raw) {
  // The 18+ clips (clips/*.bin) are locked with the same key; the app opens them with it.
  window.__bowlKey = raw;
  const urls = {};
  const modUrl = (path, seen = []) => {
    if (urls[path]) return urls[path];
    if (seen.includes(path) || files[path] == null) throw new Error('module ' + path);
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const code = files[path].replace(/((?:\bfrom|\bimport)\s*\(?\s*)(['"])\.\/([\w./-]+\.js)\2/g,
      (m, pre, q, rel) => pre + q + modUrl(dir + rel, [...seen, path]) + q);
    return (urls[path] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  };
  const style = document.createElement('style');
  style.textContent = files['css/style.css'];
  document.head.appendChild(style);
  const main = modUrl('js/app.js');
  lock.remove();
  return import(main);
}

async function tryCode(code) {
  busy = true;
  say('CHECKING…');
  try {
    const raw = await derive(code);
    const files = await decrypt(raw);
    try { localStorage.setItem(KEY, b64(raw)); } catch { /* private mode: ask again next time */ }
    await start(files, raw);
  } catch {
    pin = '';
    drawDots();
    lock.classList.remove('shake');
    void lock.offsetWidth;
    lock.classList.add('shake');
    say('OOPS! TRY AGAIN', true);
    busy = false;
  }
}

function press(k) {
  if (busy || !bundle) return;
  if (k === 'back') pin = pin.slice(0, -1);
  else if (pin.length < pinLen) pin += k;
  drawDots();
  say('TYPE YOUR CODE');
  if (pin.length === pinLen) tryCode(pin);
}

lock.querySelector('.pad').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) press(b.dataset.k);
});
document.addEventListener('keydown', (e) => {
  if (!lock.isConnected) return;
  if (/^\d$/.test(e.key)) press(e.key);
  else if (e.key === 'Backspace') press('back');
});

(async () => {
  drawDots();
  try {
    bundle = await load();
    pinLen = bundle.pinLen || 6;
    drawDots();
  } catch {
    say('NO INTERNET? CLOSE AND OPEN AGAIN', true);
    return;
  }
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (saved) {
    try { const raw = unb64(saved); await start(await decrypt(raw), raw); return; } catch {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    }
  }
  lock.classList.add('ready');
  say('TYPE YOUR CODE');
})();
