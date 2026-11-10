// One-off: renders the app icons from vector art into web/public/.
// Run from the repo root: node web/scripts/render-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const publicDir = new URL('../public/', import.meta.url);

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3f8a5a"/>
      <stop offset="1" stop-color="#22573a"/>
    </linearGradient>
    <linearGradient id="pot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e4895c"/>
      <stop offset="1" stop-color="#c25f37"/>
    </linearGradient>
    <linearGradient id="leaf" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#86cf7f"/>
      <stop offset="1" stop-color="#d3f2bd"/>
    </linearGradient>
  </defs>`;

// Leaf drawn pointing up from its base at (0, 0), length 172.
const leafPath = 'M0 0 C-46 -46 -46 -128 0 -172 C46 -128 46 -46 0 0 Z';
const leaf = (angle, scale, fill, rib) => `
    <g transform="rotate(${angle}) scale(${scale})">
      <path d="${leafPath}" fill="${fill}"/>
      ${rib ? `<path d="M0 -12 L0 -150" stroke="${rib}" stroke-width="8" stroke-linecap="round" opacity=".5"/>` : ''}
    </g>`;

const plant = (colors) => `
  <g transform="translate(0 -18)">
    <g transform="translate(256 290)">
      ${leaf(-52, 0.82, colors.leaf, colors.rib)}
      ${leaf(52, 0.82, colors.leaf, colors.rib)}
      ${leaf(0, 1, colors.leaf, colors.rib)}
    </g>
    <path d="M176 316 H336 L318 418 Q316 430 304 430 H208 Q196 430 194 418 Z" fill="${colors.pot}"/>
    <rect x="160" y="282" width="192" height="42" rx="15" fill="${colors.rim}"/>
  </g>`;

const color = { leaf: 'url(#leaf)', rib: '#2f6f47', pot: 'url(#pot)', rim: '#d9774b' };
const white = { leaf: '#fff', rib: null, pot: '#fff', rim: '#fff' };

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${defs}${body}</svg>\n`;

const any = svg(`<rect width="512" height="512" rx="116" fill="url(#bg)"/>${plant(color)}`);
// Maskable: full-bleed background, art kept well inside the 80 % safe circle.
const maskable = svg(
  `<rect width="512" height="512" fill="url(#bg)"/><g transform="translate(256 256) scale(.86) translate(-256 -256)">${plant(color)}</g>`,
);
// Android status-bar badge: white silhouette on transparent.
const badge = svg(`<g transform="translate(256 256) scale(1.08) translate(-256 -256)">${plant(white)}</g>`);

async function render(source, size, file) {
  const png = await sharp(Buffer.from(source), { density: 144 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(new URL(file, publicDir), png);
}

await mkdir(new URL('icons/', publicDir), { recursive: true });
await writeFile(new URL('icon.svg', publicDir), any);
await Promise.all([
  render(any, 192, 'icons/icon-192.png'),
  render(any, 512, 'icons/icon-512.png'),
  render(maskable, 192, 'icons/icon-maskable-192.png'),
  render(maskable, 512, 'icons/icon-maskable-512.png'),
  render(maskable, 180, 'icons/apple-touch-icon.png'),
  render(any, 32, 'icons/favicon-32.png'),
  render(any, 48, 'icons/favicon-48.png'),
  render(badge, 96, 'icons/badge-96.png'),
]);
console.log('icons written to', publicDir.pathname);
