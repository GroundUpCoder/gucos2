// test_chat_streaming — proves the streaming flicker/thinking fix on real
// Chrome at desktop AND 375px. A two-round assistant turn (round 1:
// thinking+Bash tool_use; round 2: thinking+text end_turn) is driven through a
// fetch override that emits SSE events one at a time with a delay, so mid-stream
// state is observable deterministically (route.fulfill cannot stream — its body
// is a string/Buffer delivered in one shot).
//
// What this proves, per the reproduction (Codex 019fedef):
//  - One logical turn keeps ONE article node and ONE data-message-key across
//    round-1 streaming -> round-1 finalize -> round-2 streaming -> round-2
//    finalize. A MutationObserver records zero assistant-article removals (the
//    old key=streamId bug remounted the article 3 times).
//  - Streaming NEVER auto-opens a thinking block or its enclosing non-text
//    group: every streaming round stays collapsed by default. The currently
//    streaming thinking is still styled active (violet pulse + "Thinking…"),
//    but it is not opened.
//  - A user-opened disclosure during streaming stays usable through
//    completion (the stable article identity means no remount, so the
//    useState disclosure survives finalization — no effect machinery needed).
//  - Toggling a disclosure after completion still works (close then reopen).
//  - Reload replays only the durable transcript: every disclosure collapses
//    (live open state is not durable), with no error.
//  - No scroll regression: a new send still pins the user message to the top
//    exactly once and never follows the stream.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  require = createRequire(path.join(APP, 'frontend/package.json')),
  { chromium } = require('playwright-core');
const port = 8118,
  server = spawn(process.execPath, [path.join(APP, 'backend/dist/bin/server.js')], {
    env: { ...process.env, GUCOS2_PORT: String(port), GUCOS2_DIST: path.join(APP, 'frontend', 'dist') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const sleep = (n) => new Promise((r) => setTimeout(r, n));
async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('server did not start');
}

// Per-event delay (ms): large enough to click mid-stream and to let React
// paint between onUpdate deltas, small enough to keep the test quick. Inlined
// into initScript below (addInitScript functions can't close over outer scope).
// Installs a streaming fetch override for the DeepSeek endpoint. Round 1 emits
// thinking + a Bash tool_use (so the session runs a real tool and continues);
// round 2 emits thinking + a closing text block (end_turn). Each SSE event is
// enqueued separately with DELAY between, so transport's reader.read() loop
// yields to the event loop between deltas and React paints mid-stream.
// NOTE: passed as a FUNCTION (not a string) to addInitScript — a string source
// is evaluated in an isolated world and the Element.prototype.scrollIntoView
// spy never reaches the main world, so the scroll-pin assertion sees nothing.
function initScript() {
  if (location.protocol === 'http:') localStorage.setItem('gucos2:apikey:deepseek', 'acceptance-browser-only-secret');
  window.__scrollIntoViewCalls = [];
  Element.prototype.scrollIntoView = function (options) { window.__scrollIntoViewCalls.push({ id: this.id, options }); };
  window.__dsDelay = 80;
  const SSE = (events) => events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('');
  const enc = new TextEncoder();
  let round = 0;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.includes('api.deepseek.com')) return originalFetch(input, init);
    round++;
    let events;
    if (round === 1) {
      events = [
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'round one plan' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed:r1' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"command":"echo hi"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
      ];
    } else {
      events = [
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'round two plan' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed:r2' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Done.' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      ];
    }
    const delay = window.__dsDelay || 50;
    const stream = new ReadableStream({
      async start(controller) {
        for (const e of events) {
          controller.enqueue(enc.encode(SSE([e])));
          await new Promise((r) => setTimeout(r, delay));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

// Snapshot of the assistant article identity + thinking disclosure state.
const facts = (page) => page.evaluate(() => {
  const a = document.querySelector('article[data-role="assistant"][data-stamp="persistent"]');
  const cards = [...document.querySelectorAll('[data-testid="thinking-card"]')];
  return {
    articlePresent: !!a,
    articleKey: a?.getAttribute('data-message-key') ?? null,
    cardCount: cards.length,
    activeThinking: document.querySelectorAll('[data-testid="thinking-card"] svg.animate-pulse').length,
    openBodies: document.querySelectorAll('[data-testid="thinking-body"]').length,
    firstCardHasBody: !!cards[0]?.querySelector('[data-testid="thinking-body"]'),
    lastCardHasBody: !!cards.at(-1)?.querySelector('[data-testid="thinking-body"]'),
    groupOpen: document.querySelector('[data-testid="thinking-tool-group"]')?.open === true,
    streaming: !!document.querySelector('[data-streaming="true"]'),
  };
});

async function runScenario(page, label) {
  // Stamp the assistant article for identity tracking + observe article removals.
  await page.evaluate(() => {
    window.__scrollIntoViewCalls = [];
    window.__articleRemovals = [];
    const container = document.querySelector('[data-testid="chat-messages"]');
    const obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.removedNodes) {
        if (n.nodeType === 1 && (n.matches?.('article[data-role="assistant"]') || n.querySelector?.('article[data-role="assistant"]')))
          window.__articleRemovals.push(n.getAttribute?.('data-message-key') || '(no key)');
      }
    });
    obs.observe(container, { childList: true, subtree: true });
    window.__articleObs = obs;
  });
  await page.getByTestId('chat-input').fill('Run the streaming parity turn');
  await page.getByTestId('chat-send').click();
  // Wait for the assistant article, then stamp it so a remount (new key) is
  // detectable: a remounted article would not carry data-stamp="persistent".
  await page.waitForSelector('article[data-role="assistant"]', { timeout: 30000 });
  const stampedKey = await page.evaluate(() => {
    const a = document.querySelector('article[data-role="assistant"]');
    a.dataset.stamp = 'persistent';
    return a.getAttribute('data-message-key');
  });
  if (!stampedKey) throw new Error(`${label}: assistant article had no data-message-key`);

  // Mid round 1: one thinking card, styled active (pulse), but COLLAPSED —
  // streaming never auto-opens disclosure.
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="thinking-card"] svg.animate-pulse').length === 1, null, { timeout: 30000 });
  let f = await facts(page);
  if (!f.articlePresent || f.articleKey !== stampedKey) throw new Error(`${label}: article identity changed mid round 1: ${JSON.stringify(f)}`);
  if (f.cardCount !== 1 || f.activeThinking !== 1 || f.openBodies !== 0) throw new Error(`${label}: round-1 mid-stream should be active but collapsed: ${JSON.stringify(f)}`);
  if (f.firstCardHasBody) throw new Error(`${label}: round-1 thinking auto-opened during streaming: ${JSON.stringify(f)}`);

  // Mid round 2: two thinking cards. The newest (round 2) is styled active;
  // the older (round 1) is muted. BOTH stay collapsed — no auto-open.
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="thinking-card"]').length === 2, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="thinking-card"] svg.animate-pulse').length === 1, null, { timeout: 30000 });
  f = await facts(page);
  if (!f.articlePresent || f.articleKey !== stampedKey) throw new Error(`${label}: article identity changed mid round 2: ${JSON.stringify(f)}`);
  if (f.cardCount !== 2 || f.activeThinking !== 1 || f.openBodies !== 0) throw new Error(`${label}: round-2 mid-stream should have one active but all collapsed: ${JSON.stringify(f)}`);
  if (f.firstCardHasBody || f.lastCardHasBody) throw new Error(`${label}: a thinking auto-opened during round-2 streaming: ${JSON.stringify(f)}`);

  // Explicit open DURING streaming: open the enclosing non-text group, then
  // the older (round-1) thinking card inside it. Both are user-driven
  // disclosures that must persist through completion.
  await page.getByTestId('thinking-tool-group').first().locator('summary').click();
  await page.getByTestId('thinking-card').first().locator('button').click();
  await page.waitForFunction(() => !!document.querySelectorAll('[data-testid="thinking-card"]')[0]?.querySelector('[data-testid="thinking-body"]'), null, { timeout: 5000 });
  f = await facts(page);
  if (!f.groupOpen || f.openBodies !== 1 || !f.firstCardHasBody) throw new Error(`${label}: user-opened group/thinking did not open during streaming: ${JSON.stringify(f)}`);
  if (f.lastCardHasBody) throw new Error(`${label}: newest round-2 thinking opened without user action: ${JSON.stringify(f)}`);

  // Final: turn ended, no streaming. The user-opened thinking survives
  // finalization; everything else stays collapsed.
  await page.getByTestId('chat-send').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(150);
  f = await facts(page);
  if (f.streaming) throw new Error(`${label}: turn never left streaming state: ${JSON.stringify(f)}`);
  if (!f.articlePresent || f.articleKey !== stampedKey) throw new Error(`${label}: article identity changed at final: ${JSON.stringify(f)}`);
  if (f.cardCount !== 2) throw new Error(`${label}: final thinking-card count wrong: ${JSON.stringify(f)}`);
  if (f.activeThinking !== 0) throw new Error(`${label}: final state still had active thinking: ${JSON.stringify(f)}`);
  if (!f.groupOpen || f.openBodies !== 1 || !f.firstCardHasBody) throw new Error(`${label}: user-opened group/thinking did not survive to final: ${JSON.stringify(f)}`);

  // Toggling AFTER completion works: close it, then reopen it.
  await page.getByTestId('thinking-card').first().locator('button').click();
  await page.waitForFunction(() => !document.querySelectorAll('[data-testid="thinking-card"]')[0]?.querySelector('[data-testid="thinking-body"]'), null, { timeout: 5000 });
  f = await facts(page);
  if (f.openBodies !== 0) throw new Error(`${label}: post-completion close did not collapse the thinking: ${JSON.stringify(f)}`);
  await page.getByTestId('thinking-card').first().locator('button').click();
  await page.waitForFunction(() => !!document.querySelectorAll('[data-testid="thinking-card"]')[0]?.querySelector('[data-testid="thinking-body"]'), null, { timeout: 5000 });
  f = await facts(page);
  if (f.openBodies !== 1 || !f.firstCardHasBody) throw new Error(`${label}: post-completion reopen did not open the thinking: ${JSON.stringify(f)}`);

  // Zero assistant-article removals: the article never remounted.
  const removals = await page.evaluate(() => window.__articleRemovals);
  if (removals.length) throw new Error(`${label}: assistant article was removed/remounted: ${JSON.stringify(removals)}`);

  // Scroll regression: exactly one pin to the authored user message, never a
  // stream-following pin on assistant chunks/rounds. This is deliberately
  // strict: a fast first chunk used to cancel the pending requestAnimationFrame
  // and produce zero calls, which was a real product race.
  const scrolls = await page.evaluate(() => window.__scrollIntoViewCalls);
  const pins = scrolls.filter((s) => s.id === 'message-0' && s.options?.block === 'start');
  if (scrolls.length !== pins.length) throw new Error(`${label}: stream caused a non-user or non-start scroll: ${JSON.stringify(scrolls)}`);
  if (pins.length !== 1) throw new Error(`${label}: user message must pin exactly once without following the stream: ${JSON.stringify(scrolls)}`);

  // Reload: the durable replay must present the same final disclosure (all
  // collapsed — the user-opened live state is not durable, only the kernel
  // transcript is) without errors.
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, { timeout: 120000 });
  await page.waitForSelector('article[data-role="assistant"]', { timeout: 30000 });
  const reloaded = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="thinking-card"]')];
    return { cardCount: cards.length, activeThinking: document.querySelectorAll('[data-testid="thinking-card"] svg.animate-pulse').length, openBodies: document.querySelectorAll('[data-testid="thinking-body"]').length, groupOpen: document.querySelector('[data-testid="thinking-tool-group"]')?.open === true, error: !!document.querySelector('[data-testid="chat-error"]') };
  });
  if (reloaded.error) throw new Error(`${label}: clean streaming turn was marked interrupted after reload`);
  if (reloaded.cardCount !== 2 || reloaded.activeThinking !== 0 || reloaded.openBodies !== 0 || reloaded.groupOpen) throw new Error(`${label}: reloaded final disclosure not fully collapsed: ${JSON.stringify(reloaded)}`);
}

let browser;
try {
  await waitServer();
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  for (const vp of [
    { width: 375, height: 667, isMobile: true, hasTouch: true, label: '375px' },
    { width: 1440, height: 900, isMobile: false, hasTouch: false, label: 'desktop' },
  ]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, serviceWorkers: 'block' });
    await context.addInitScript(initScript);
    const browserErrors = [];
    context.on('page', (p) => {
      p.on('pageerror', (e) => browserErrors.push('pageerror: ' + e));
      p.on('console', (m) => { if (m.type() === 'error') browserErrors.push('console: ' + m.text()); });
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/chat`);
    await page.waitForFunction(() => window.__osState === 'ready', null, { timeout: 120000 });
    await runScenario(page, vp.label);
    if (browserErrors.length) throw new Error(`${vp.label}: browser emitted console/page errors: ${JSON.stringify(browserErrors)}`);
    await context.close();
    console.log(`test_chat_streaming: ${vp.label} stable-identity + streaming-never-auto-opens + user-opened preservation + post-completion toggle + scroll parity passed`);
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
