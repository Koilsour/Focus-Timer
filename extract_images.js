const fs = require('fs');
const path = require('path');
const base = __dirname;

const html = fs.readFileSync(path.join(base,'index.html'), 'utf8');

const marker = 'data:image/png;base64,';
const imgs = [];
let searchPos = 0;

while (true) {
  const startIdx = html.indexOf(marker, searchPos);
  if (startIdx === -1) break;
  const dataStart = startIdx + marker.length;
  let endIdx = dataStart;
  while (endIdx < html.length) {
    const c = html[endIdx];
    if (c === '"' || c === "'" || c === ')' || c === '\n' || c === '\r' || c === ' ') break;
    endIdx++;
  }
  const b64 = html.slice(dataStart, endIdx);
  const fingerprint = b64.slice(0, 80);
  const existing = imgs.find(x => x.fingerprint === fingerprint);
  if (existing) {
    existing.positions.push(startIdx);
  } else {
    imgs.push({ fingerprint, b64, positions: [startIdx], size: Buffer.from(b64, 'base64').length });
  }
  searchPos = endIdx;
}

// Image 0 (3.09MB) = city — appears first in CSS .scene
// Image 1 (3.68MB) = castle — appears with castle context
imgs.forEach((img, i) => {
  const name = i === 0 ? 'city.png' : 'castle.png';
  const buf = Buffer.from(img.b64, 'base64');
  const outPath = path.join(base, 'assets', 'images', name);
  fs.writeFileSync(outPath, buf);
  console.log('Saved', name, (buf.length/1024/1024).toFixed(2)+'MB', '->', outPath);
});

// Also save thumbnails (same images, just referenced differently — we will generate proper thumbs later)
// For now copy city as thumb too
const cityBuf = Buffer.from(imgs[0].b64, 'base64');
const castleBuf = Buffer.from(imgs[1].b64, 'base64');
fs.writeFileSync(path.join(base,'assets','images','city_thumb.png'), cityBuf);
fs.writeFileSync(path.join(base,'assets','images','castle_thumb.png'), castleBuf);
console.log('Done! Assets saved.');
