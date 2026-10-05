// Locks and unlocks the app's source with the owner's code (PIN).
//
//   BOWL_PIN=xxxxxx node tools/bundle.mjs lock     # js/ css/ test/ docs/  ->  app.bin
//   BOWL_PIN=xxxxxx node tools/bundle.mjs unlock   # app.bin  ->  js/ css/ test/ docs/
//
// The 18+ animation clips are locked the same way: clips-src/cNN.mp4 (git-ignored)
// <-> clips/cNN-<hash>.bin, each 'BOC1' | iv[12] | AES-256-GCM(mp4), same key as app.bin.
// lock also writes js/clip-files.js (which .bin belongs to which clip) before locking js/.
//
// The repo and the live site are public, so only app.bin (encrypted) is committed.
// The readable folders are in .gitignore. Never write the PIN into any file.
// lock.js decrypts app.bin in the browser with the same format:
//   'BOM1' | iterations u32 BE | pin length u8 | salt[16] | iv[12] | AES-256-GCM(JSON {files:{path:text}})
// Key = PBKDF2-SHA256(pin, salt, iterations). The slow derivation makes guessing a short PIN expensive.
import { webcrypto as wc, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const DIRS = ['js', 'css', 'test', 'docs'];
const ITER = 2_000_000;
const BIN = join(ROOT, 'app.bin');
const CLIPS = join(ROOT, 'clips');
const CLIPS_SRC = join(ROOT, 'clips-src');

const pin = process.env.BOWL_PIN;
const cmd = process.argv[2];
if (!pin || !/^\d{4,12}$/.test(pin) || !['lock', 'unlock'].includes(cmd)) {
  console.error('usage: BOWL_PIN=<digits> node tools/bundle.mjs lock|unlock');
  process.exit(2);
}

async function keyFor(salt, iter) {
  const base = await wc.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return wc.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function parse(buf) {
  if (buf.subarray(0, 4).toString() !== 'BOM1') throw new Error('app.bin: bad header');
  return { iter: buf.readUInt32BE(4), salt: buf.subarray(9, 25), iv: buf.subarray(25, 37), ct: buf.subarray(37) };
}

async function open() {
  const h = parse(readFileSync(BIN));
  try {
    const pt = await wc.subtle.decrypt({ name: 'AES-GCM', iv: h.iv }, await keyFor(h.salt, h.iter), h.ct);
    return { h, files: JSON.parse(new TextDecoder().decode(pt)).files };
  } catch { throw new Error('wrong PIN for app.bin'); }
}

function walk(dir, out = []) {
  for (const n of readdirSync(join(ROOT, dir)).sort()) {
    if (n === '.DS_Store') continue;
    const p = `${dir}/${n}`;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const clipBins = () => (existsSync(CLIPS) ? readdirSync(CLIPS).filter((n) => /^c\d+-[0-9a-f]{12}\.bin$/.test(n)).sort() : []);

if (cmd === 'unlock') {
  const { h, files } = await open();
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(ROOT, p)), { recursive: true });
    writeFileSync(join(ROOT, p), text);
  }
  console.log(`unlocked ${Object.keys(files).length} files`);
  const bins = clipBins();
  if (bins.length) {
    const key = await keyFor(h.salt, h.iter);
    mkdirSync(CLIPS_SRC, { recursive: true });
    for (const n of bins) {
      const buf = readFileSync(join(CLIPS, n));
      const pt = await wc.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(4, 16) }, key, buf.subarray(16));
      writeFileSync(join(CLIPS_SRC, n.split('-')[0] + '.mp4'), Buffer.from(pt));
    }
    console.log(`unlocked ${bins.length} clips into clips-src/`);
  }
} else {
  // Keep the same salt when the PIN is unchanged, so phones that already
  // unlocked keep working without typing the code again.
  let salt = wc.getRandomValues(new Uint8Array(16));
  if (existsSync(BIN)) {
    try { salt = new Uint8Array((await open()).h.salt); } catch { console.log('new PIN: phones will ask for the code again'); }
  }
  // Clips: the file name carries a hash of key + clip, so an unchanged clip keeps
  // its .bin (no new upload, phones keep their cached copy) and a changed one gets a new name.
  if (existsSync(CLIPS_SRC)) {
    const key = await keyFor(salt, ITER);
    const kh = createHash('sha256').update(salt).update(pin).digest();
    mkdirSync(CLIPS, { recursive: true });
    const map = {}, keep = new Set();
    for (const n of readdirSync(CLIPS_SRC).filter((x) => /^c\d+\.mp4$/.test(x)).sort()) {
      const id = n.slice(0, -4);
      const mp4 = readFileSync(join(CLIPS_SRC, n));
      const out = `${id}-${createHash('sha256').update(kh).update(mp4).digest('hex').slice(0, 12)}.bin`;
      if (!existsSync(join(CLIPS, out))) {
        const iv = wc.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv }, key, mp4));
        writeFileSync(join(CLIPS, out), Buffer.concat([Buffer.from('BOC1'), iv, ct]));
      }
      map[id] = `clips/${out}`;
      keep.add(out);
    }
    for (const n of clipBins()) if (!keep.has(n)) unlinkSync(join(CLIPS, n));
    writeFileSync(join(ROOT, 'js/clip-files.js'), `// Written by tools/bundle.mjs lock. Encrypted 18+ clip files (see js/adult-pack.js).\nexport const CLIP_FILES = ${JSON.stringify(map, null, 2)};\n`);
    console.log(`locked ${keep.size} clips into clips/`);
  }
  const files = {};
  for (const d of DIRS) for (const p of walk(d)) files[p] = readFileSync(join(ROOT, p), 'utf8');
  const iv = wc.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(salt, ITER), new TextEncoder().encode(JSON.stringify({ files }))));
  const head = Buffer.alloc(9);
  head.write('BOM1'); head.writeUInt32BE(ITER, 4); head.writeUInt8(pin.length, 8);
  writeFileSync(BIN, Buffer.concat([head, salt, iv, ct]));
  console.log(`locked ${Object.keys(files).length} files into app.bin (${ct.length} bytes)`);
}
