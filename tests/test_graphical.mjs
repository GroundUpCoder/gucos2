import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(APP, 'frontend', 'package.json'));
const { chromium } = require('playwright-core');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8117;
const server = spawn(process.execPath, [path.join(APP, 'backend/dist/bin/server.js')], {
  env: { ...process.env, GUCOS2_PORT: String(port), GUCOS2_DIST: path.join(APP, 'frontend', 'dist') }, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', b => process.stdout.write('[server] ' + b));
server.stderr.on('data', b => process.stderr.write('[server] ' + b));
const sleep = n => new Promise(r => setTimeout(r, n));
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {}
    await sleep(100);
  }
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  page.on('console', m => console.log('[browser]', m.type(), m.text()));
  page.on('pageerror', e => console.error('[pageerror]', e));
  await page.goto(`http://127.0.0.1:${port}/files/root`);
  await page.waitForFunction(() => window.__osState === 'ready');
  await page.locator('input[type=file]').setInputFiles(path.join(APP, 'tests/fixtures/sdl-smoke.c'));
  await page.getByText('sdl-smoke.c', { exact: true }).waitFor();
  await page.click('[data-testid="nav-term"]');
  await page.waitForFunction(() => window.__terminals.size === 1);
  const id = await page.evaluate(() => window.__activeTerminal);
  await page.evaluate(id => window.__terminalInput(id,
    'cc /root/sdl-smoke.c -o /root/sdl-smoke && SDL_RENDER_DRIVER=software /root/sdl-smoke\n'), id);
  await page.waitForSelector('[data-testid="graphical-process-host"]', { timeout: 120000 });
  const pixel = () => page.locator('canvas').evaluate(c =>
    [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data]);
  const blue = await pixel();
  if (!(blue[2] > blue[0] * 2)) throw new Error('software surface did not render blue: ' + blue);
  await page.locator('canvas').focus();
  await page.keyboard.press('a');
  await sleep(500);
  const red = await pixel();
  if (!(red[0] > red[2] * 2)) throw new Error('keyboard did not reach SDL: ' + red);
  await page.getByLabel('Background graphical process').click();
  await page.click('[data-testid="nav-processes"]');
  const row = page.locator('[data-testid="process-row"]', { hasText: 'sdl-smoke' });
  await row.waitFor();
  await row.locator('[data-testid="process-view"]').click();
  await page.waitForSelector('[data-testid="graphical-process-host"]');
  await page.getByLabel('Background graphical process').click();
  await row.locator('[data-testid="process-kill"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="process-row"]')?.textContent.includes('sdl-smoke'));
  console.log('test_graphical: real gucOS SDL software surface, frame/input, background/reopen, signal/cleanup passed');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
