// Generate logo SVG + semua ikon PWA dari satu sumber. Jalankan: npm run icons
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';

const defs = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset=".55" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#ec4899"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".30"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#1e1b4b" flood-opacity=".35"/>
    </filter>
  </defs>`;

// Glyph: dua panah melingkar (konversi) + dokumen di tengah. Koordinat 512x512.
const glyph = `
  <g filter="url(#sh)">
    <g fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round">
      <path d="M126 233 A132 132 0 0 1 375.6 200.2"/>
      <path d="M386 278.9 A132 132 0 0 1 136.4 311.8"/>
    </g>
    <g fill="#fff">
      <polygon points="388.3,227.4 406.4,185.8 344.8,214.6"/>
      <polygon points="123.7,284.6 105.6,326.2 167.2,297.4"/>
    </g>
    <path fill="#fff" d="M226 204H270L298 232V298A10 10 0 0 1 288 308H226A10 10 0 0 1 216 298V214A10 10 0 0 1 226 204Z"/>
    <path fill="#c7d2fe" d="M270 204V232H298Z"/>
    <rect x="231" y="254" width="52" height="8" rx="4" fill="#6d28d9"/>
    <rect x="231" y="273" width="36" height="8" rx="4" fill="#6d28d9" opacity=".7"/>
  </g>`;

const svg = (inner, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}${bg}${inner}</svg>`;

const rounded = svg(
  glyph,
  `<rect width="512" height="512" rx="112" fill="url(#g)"/><path d="M112 0H400A112 112 0 0 1 512 112V230H0V112A112 112 0 0 1 112 0Z" fill="url(#shine)"/>`
);

const scaled = (s) => svg(
  `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">${glyph}</g>`,
  `<rect width="512" height="512" fill="url(#g)"/><rect width="512" height="256" fill="url(#shine)"/>`
);

mkdirSync('public', { recursive: true });
writeFileSync('public/logo.svg', rounded);
writeFileSync('public/favicon.svg', rounded);

const png = (s, size, file) => sharp(Buffer.from(s), { density: 300 }).resize(size, size).png().toFile(file);

await png(rounded, 192, 'public/pwa-192.png');
await png(rounded, 512, 'public/pwa-512.png');
await png(scaled(0.72), 512, 'public/pwa-maskable-512.png'); // safe zone 80%
await png(scaled(0.86), 180, 'public/apple-touch-icon.png'); // iOS memasang mask sendiri
console.log('icons ok');
