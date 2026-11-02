// Renders the master document: diagrams SVG -> PNG (for Word) and master.html -> PDF.
// Run after `python3 docs/master/src/build.py html`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
fs.mkdirSync(path.join(BUILD, 'png'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const f of fs.readdirSync(path.join(BUILD, 'svg'))) {
  const svg = fs.readFileSync(path.join(BUILD, 'svg', f), 'utf8');
  const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
  await page.setViewportSize({ width: Math.ceil(w), height: Math.ceil(h) });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: path.join(BUILD, 'png', f.replace('.svg', '.png')) });
}

const doc = await browser.newPage();
await doc.goto('file://' + path.join(BUILD, 'master.html'), { waitUntil: 'networkidle' });
await doc.evaluate(() => document.fonts.ready);
const foot = `<div style="width:100%;font:7.5px Inter,Helvetica,sans-serif;color:#6b6880;padding:0 17mm;display:flex;justify-content:space-between">
  <span>FinSight Terminal — Master Product &amp; Engineering Document</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
await doc.pdf({ path: path.join(ROOT, 'FinSight-Master-Document.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: foot });
// The cover has no footer: print it alone, then swap it in as page 1.
const cover = path.join(BUILD, 'cover.pdf');
await doc.addStyleTag({ content: 'body > :not(.cover){display:none!important}' });
await doc.pdf({ path: cover, format: 'A4', printBackground: true, preferCSSPageSize: true, pageRanges: '1' });
await browser.close();
console.log('pdf ok');
