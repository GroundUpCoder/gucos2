import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  require = createRequire(path.join(APP, 'frontend/package.json')),
  { chromium } = require('playwright-core');
const port = 8117,
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
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
let browser;
try {
  await waitServer();
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    if (location.protocol === 'http:') localStorage.setItem('gucos2:apikey:deepseek', 'acceptance-browser-only-secret');
    window.__scrollIntoViewCalls = [];
    Element.prototype.scrollIntoView = function (options) {
      window.__scrollIntoViewCalls.push({ id: this.id, options });
    };
  });
  const browserErrors = [];
  context.on('page', (p) => {
    p.on('pageerror', (e) => browserErrors.push('pageerror: ' + e));
    p.on('console', (m) => {
      if (m.type() === 'error') browserErrors.push('console: ' + m.text());
    });
  });
  const page = await context.newPage();
  let rounds = 0,
    bodies = [];
  await page.route('https://api.deepseek.com/**', async (route) => {
    bodies.push(route.request().postData() || '');
    rounds++;
    let events;
    if (rounds === 1)
      events = [
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Plan the workspace flood check.' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'signed:acceptance' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"command":"pwd >&2; printf agent-file > shared.txt; env | sort >&2; yes x | head -c 1200000","stdout_max_bytes":1024}',
          },
        },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 1 },
        },
      ];
    else if (rounds === 3) {
      await sleep(5000);
      events = [
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'must never become durable' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      ];
    } else if (rounds === 4)
      events = [
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'stop-active',
            name: 'Bash',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"command":"sh -c \\\"trap \'\' TERM; while :; do :; done\\\" & wait","timeout_ms":30000}',
          },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'stop-pending',
            name: 'Write',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"path":"must-not-exist","content":"bad"}',
          },
        },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 1 },
        },
      ];
    else
      events = [
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Workspace ready.' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 2 },
        },
      ];
    try {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse(events),
      });
    } catch (e) {
      if (rounds !== 3) throw e;
    }
  });
  await page.goto(`http://127.0.0.1:${port}/chat`);
  await page.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  const rootLock = await page.evaluate(() => ({
    innerHeight,
    html: getComputedStyle(document.documentElement).height,
    body: getComputedStyle(document.body).overscrollBehavior,
    root: getComputedStyle(document.getElementById('root')).height,
  }));
  if (parseFloat(rootLock.html) !== rootLock.innerHeight || parseFloat(rootLock.root) !== rootLock.innerHeight || rootLock.body !== 'none') throw new Error('100dvh/root overscroll lock mismatch: ' + JSON.stringify(rootLock));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.getByTestId('new-thread').evaluate((node) => getComputedStyle(node).transitionDuration);
  if (parseFloat(reduced) > 0.01) throw new Error('reduced motion transition was not bounded: ' + reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const endpointBadge = page.getByTestId('endpoint-select');
  if ((await endpointBadge.evaluate((node) => node.tagName)) === 'SELECT' || (await endpointBadge.getAttribute('data-profile')) !== 'deepseek-direct' || (await endpointBadge.innerText()) !== 'DeepSeek' || (await page.getByTestId('model-select').inputValue()) !== 'deepseek-v4-pro') throw new Error('endpoint badge/model selector do not present the active compatible profile');
  const modelOptions = await page
    .getByTestId('model-select')
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => ({
        label: option.textContent,
        value: option.value,
      })),
    );
  if (
    JSON.stringify(modelOptions) !==
    JSON.stringify([
      { label: 'V4 Pro', value: 'deepseek-v4-pro' },
      { label: 'V4 Flash', value: 'deepseek-v4-flash' },
    ])
  )
    throw new Error('DeepSeek model choices mismatch: ' + JSON.stringify(modelOptions));
  await page.getByTestId('model-select').selectOption('deepseek-v4-flash');
  await page.evaluate(() => { window.__scrollIntoViewCalls = []; });
  await page.getByTestId('chat-input').fill('Use flash');
  await page.getByTestId('chat-send').click();
  await page.getByText('Workspace ready.', { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(100);
  const automaticScrolls = await page.evaluate(() => window.__scrollIntoViewCalls);
  if (automaticScrolls.length !== 1 || automaticScrolls[0].id !== 'message-0' || automaticScrolls[0].options?.block !== 'start' || automaticScrolls[0].options?.behavior !== 'smooth') throw new Error('new user turn must pin once to top and never follow assistant chunks: ' + JSON.stringify(automaticScrolls));
  const spacerGeometry = await page.getByTestId('chat-scroll-spacer').evaluate((node) => ({ spacer: node.getBoundingClientRect().height, viewport: innerHeight }));
  if (spacerGeometry.spacer < spacerGeometry.viewport) throw new Error('scroll spacer cannot place final user message at top: ' + JSON.stringify(spacerGeometry));
  await page.getByTestId('scroll-to-latest-button').click();
  await page.waitForTimeout(100);
  const manualScrolls = await page.evaluate(() => window.__scrollIntoViewCalls);
  if (manualScrolls.length !== 2 || manualScrolls[1].id !== 'message-0' || manualScrolls[1].options?.block !== 'start') throw new Error('Latest must pin the newest user message to top: ' + JSON.stringify(manualScrolls));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('scroll-to-latest-button').click();
  await page.waitForTimeout(100);
  const reducedScrolls = await page.evaluate(() => window.__scrollIntoViewCalls);
  if (reducedScrolls.length !== 3 || reducedScrolls[2].id !== 'message-0' || reducedScrolls[2].options?.behavior !== 'auto') throw new Error('reduced motion must pin instantly, never smoothly: ' + JSON.stringify(reducedScrolls));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (JSON.parse(bodies.at(-1)).model !== 'deepseek-v4-flash') throw new Error('flash selection missing from provider request');
  // The assistant text renders before turn_end is journaled; reloading in that
  // window leaves an unmatched turn_start and the replay marks the turn
  // interrupted. chat-send returns only from the post-turn_end cleanup (the
  // same terminal signal the Stop flow waits on), so wait for it first.
  await page.getByTestId('chat-send').waitFor({ timeout: 30000 });
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  await page.getByText('Workspace ready.', { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(100);
  const reloadScrolls = await page.evaluate(() => window.__scrollIntoViewCalls);
  if (reloadScrolls.length !== 0) throw new Error('reloading a populated thread must not auto-scroll its historical messages: ' + JSON.stringify(reloadScrolls));
  if ((await page.getByTestId('model-select').inputValue()) !== 'deepseek-v4-flash') throw new Error('flash selection did not survive reload');
  if (await page.getByTestId('chat-error').count()) throw new Error('clean turn followed by model update was marked interrupted');
  await page.getByTestId('model-select').selectOption('deepseek-v4-pro');
  await page.getByTestId('new-thread').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="chat-messages"] article'), null, { timeout: 30000 });
  rounds = 0;
  bodies = [];
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-page').waitFor();
  const settingsText = await page.getByTestId('settings-page').innerText();
  if (!settingsText.includes('Third-party disclosure') || !settingsText.includes('xi-api-key') || !settingsText.includes('never written to Chat JSONL')) throw new Error('voice/secret disclosure is incomplete');
  if ((await page.getByTestId('voice-auto-submit-toggle').isChecked()) !== true) throw new Error('voice auto-submit is not enabled by default');
  const readerChoices = await page.getByTestId('reader-size-section').getByRole('button').allTextContents();
  if (JSON.stringify(readerChoices) !== JSON.stringify(['Small', 'Medium', 'Large', 'X-Large'])) throw new Error('reader sizes do not match cc: ' + JSON.stringify(readerChoices));
  if (!(await page.getByTestId('reader-size-large').evaluate((node) => node.className.includes('ring-1')))) throw new Error('reader size does not default to Large');
  await page.getByTestId('reader-size-xlarge').click();
  if ((await page.evaluate(() => localStorage.getItem('gucos2:reader-size'))) !== 'xlarge') throw new Error('reader size did not persist reactively');
  await page.getByTestId('reader-size-large').click();
  if (/read aloud|voice id|text-to-speech/i.test(settingsText)) throw new Error('TTS controls remain in Settings');
  const autoScrollToggle = page.getByTestId('auto-scroll-toggle');
  if (!(await autoScrollToggle.isChecked())) throw new Error('auto-scroll is not enabled by default');
  await autoScrollToggle.click();
  if ((await page.evaluate(() => localStorage.getItem('gucos2:auto-scroll'))) !== 'off') throw new Error('auto-scroll toggle did not persist off');
  await page.getByTestId('nav-chat').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="chat-messages"] article'), null, { timeout: 30000 });
  await page.evaluate(() => { window.__scrollIntoViewCalls = []; });
  const locked = await context.newPage();
  await locked.goto(`http://127.0.0.1:${port}/chat`);
  await locked.waitForFunction(() => window.__osState === 'locked', null, {
    timeout: 30000,
  });
  if (await locked.getByTestId('chat-input').count()) throw new Error('locked second tab exposed a composer');
  await locked.close();
  await page.getByTestId('chat-input').fill('Prepare the workspace');
  await page.getByTestId('chat-composer').evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  try {
    await page.getByText('Prepare the workspace', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByText('Workspace ready.', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByTestId('chat-send').waitFor({ state: 'visible', timeout: 30000 });
  } catch (e) {
    throw new Error('chat did not finish; rounds=' + rounds + ' body=' + (await page.locator('body').innerText()) + ' requests=' + JSON.stringify(bodies));
  }
  if ((await page.getByText('Prepare the workspace', { exact: true }).count()) !== 1 || rounds !== 2) throw new Error('rapid double submit started more than one turn: rounds=' + rounds);
  const prefOffScrolls = await page.evaluate(() => window.__scrollIntoViewCalls);
  if (prefOffScrolls.length !== 0) throw new Error('auto-scroll off must not pin a new send: ' + JSON.stringify(prefOffScrolls));
  await page.getByTestId('scroll-to-latest-button').click();
  await page.waitForTimeout(100);
  const prefOffManual = await page.evaluate(() => window.__scrollIntoViewCalls);
  if (prefOffManual.length !== 1 || prefOffManual[0].id !== 'message-0' || prefOffManual[0].options?.block !== 'start') throw new Error('Latest must still pin the newest user message with auto-scroll off: ' + JSON.stringify(prefOffManual));
  await page.evaluate(() => localStorage.removeItem('gucos2:auto-scroll'));
  // Assistant metadata must be a single leading header bar (cc/c idiom): the
  // first element of every assistant article, before any thinking/tool group
  // and before any Markdown prose. MessageBlocks emits thinking-tool-group
  // when the run carries thinking blocks, tool-group otherwise.
  const metaHeaderFacts = () => page.evaluate(() => {
    const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING;
    return [...document.querySelectorAll('[data-testid="chat-messages"] article[data-role="assistant"]')].map((a) => {
      const meta = a.querySelector('[data-testid="assistant-meta"]');
      const group = a.querySelector('[data-testid="thinking-tool-group"], [data-testid="tool-group"]');
      const prose = a.querySelector('table, pre, p');
      const before = (x, y) => (x && y ? Boolean(x.compareDocumentPosition(y) & FOLLOWS) : null);
      return { hasMeta: !!meta, metaCount: a.querySelectorAll('[data-testid="assistant-meta"]').length, metaFirst: meta ? a.firstElementChild.contains(meta) : false, thinkingGroup: !!a.querySelector('[data-testid="thinking-tool-group"]'), metaBeforeGroup: before(meta, group), metaBeforeProse: before(meta, prose) };
    });
  });
  const assertMetaHeader = (facts, label) => {
    if (!facts.length || facts.some((m) => !m.hasMeta || m.metaCount !== 1 || !m.metaFirst || m.metaBeforeGroup === false || m.metaBeforeProse === false)) throw new Error(label + ': assistant metadata is not a single leading header: ' + JSON.stringify(facts));
  };
  const runGroup = page.getByTestId('thinking-tool-group').or(page.getByTestId('tool-group')).first();
  await runGroup.locator('summary').click();
  const floodResult = runGroup.getByTestId('tool-result').first();
  if ((await floodResult.getAttribute('data-status')) !== 'completed') throw new Error('flood Bash result lost completed status');
  if (await page.locator('article[data-role="user"] [data-testid="tool-result"]').count()) throw new Error('tool result rendered as a separate user message');
  await floodResult.getByRole('button').click();
  await floodResult.getByTestId('tool-result-truncation').waitFor();
  const floodDetail = await floodResult.innerText();
  if (!floodDetail.includes('Output was truncated') || !floodDetail.includes('exit_code') || !floodDetail.includes('0') || !floodDetail.includes('stdout_total_bytes') || !floodDetail.includes('1200000')) throw new Error('expanded flood result lost truncation/exit/accounting facts: ' + floodDetail.slice(-4000));
  const workspaceOrder = await metaHeaderFacts();
  assertMetaHeader(workspaceOrder, 'workspace thread');
  if (!workspaceOrder.some((m) => m.thinkingGroup && m.metaBeforeGroup === true && m.metaBeforeProse === true)) throw new Error('the multi-round thinking/tool/result thread did not prove metadata-before-group-and-Markdown: ' + JSON.stringify(workspaceOrder));
  const userHeaderFacts = await page.evaluate(() => [...document.querySelectorAll('article[data-user-authored="true"]')].map((article) => {
    const meta = article.querySelector('[data-testid="user-meta"]'), content = article.children[1];
    return { count: article.querySelectorAll('[data-testid="user-meta"]').length, leading: !!meta && article.firstElementChild?.contains(meta), beforeContent: !!meta && !!content && Boolean(meta.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING), text: meta?.textContent ?? '' };
  }));
  if (!userHeaderFacts.length || userHeaderFacts.some((fact) => fact.count !== 1 || !fact.leading || !fact.beforeContent || !fact.text.includes('USER'))) throw new Error('user metadata is not a single truthful leading header: ' + JSON.stringify(userHeaderFacts));
  const firstUser = page.locator('article[data-user-authored="true"]').first();
  await firstUser.getByRole('button', { name: 'Expand user metadata' }).click();
  const userDetail = await firstUser.getByTestId('message-meta-detail').innerText();
  if (!userDetail.includes('Source\nauthored in this browser') || !userDetail.includes('Thread ID') || !userDetail.includes('Journal record')) throw new Error('expanded user provenance is incomplete: ' + userDetail);
  await firstUser.getByRole('button', { name: 'Collapse user message' }).click();
  if (await firstUser.getByTestId('user-text').count()) throw new Error('user content remained mounted after message collapse');
  if (!(await firstUser.getByTestId('message-meta-detail').isVisible())) throw new Error('message collapse incorrectly closed the independent metadata expansion');
  await firstUser.getByRole('button', { name: 'Expand user message' }).click();
  await firstUser.getByTestId('user-text').waitFor();
  const groupedAssistantMatch = page.locator('article[data-role="assistant"]', { has: runGroup }).first(), groupedAssistantId = await groupedAssistantMatch.getAttribute('id');
  if (!groupedAssistantId) throw new Error('grouped assistant lacks a stable article id');
  const groupedAssistant = page.locator(`#${groupedAssistantId}`);
  await groupedAssistant.getByRole('button', { name: 'Collapse assistant message' }).click();
  if (await groupedAssistant.getByTestId('thinking-tool-group').or(groupedAssistant.getByTestId('tool-group')).count()) throw new Error('assistant grouped content remained mounted after message collapse');
  await groupedAssistant.getByRole('button', { name: 'Expand assistant message' }).click();
  await groupedAssistant.getByTestId('thinking-tool-group').or(groupedAssistant.getByTestId('tool-group')).waitFor();
  const userContrast = await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    const node = document.querySelector('[data-user-authored="true"]')?.children[1],
      missing = !node,
      style = getComputedStyle(node),
      lum = (value) => {
        const match = value.match(/oklch\(([^ ]+) ([^ ]+) ([^) ]+)/);
        if (!match) throw new Error('unexpected computed color ' + value);
        const L = Number(match[1]),
          C = Number(match[2]),
          h = (Number(match[3]) * Math.PI) / 180,
          a = C * Math.cos(h),
          b = C * Math.sin(h),
          l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3),
          m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3),
          s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3),
          r = Math.max(0, Math.min(1, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
          g = Math.max(0, Math.min(1, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
          bl = Math.max(0, Math.min(1, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s));
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      },
      a = lum(style.color),
      b = lum(style.backgroundColor);
    return missing ? 0 : (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  if (userContrast < 4.5) throw new Error('light user bubble computed contrast failed: ' + userContrast);
  if (bodies.some((b) => b.includes('acceptance-browser-only-secret'))) throw new Error('API key leaked into provider body');
  const artifact = await page.evaluate(async () => new TextDecoder().decode(await window.__kernelReadRange('/root/agent/shared.txt', 0, 10)));
  if (artifact !== 'agent-file') throw new Error('Bash artifact not visible through filesystem');
  const roots = await page.evaluate(async () => ({
    work: await window.__kernelStat('/root/agent'),
    state: await window.__kernelStat('/root/.guc/agent'),
    threads: await window.__kernelStat('/root/.guc/agent/threads'),
    wrong: await window.__kernelStat('/root/agent/.guc'),
  }));
  if (!roots.work || !roots.state || !roots.threads || roots.wrong) throw new Error('agent roots were not created or metadata leaked under workspace');
  await page.getByTestId('new-thread').click();
  await page.getByTestId('chat-input').fill('Stop while provider streams');
  await page.getByTestId('chat-send').click();
  await page.waitForFunction(() => document.querySelector('[data-streaming="true"]') && document.querySelector('[data-testid="chat-stop"]'));
  await page.getByTestId('chat-stop').click();
  await page.getByTestId('chat-send').waitFor({ timeout: 30000 });
  if (await page.locator('[data-streaming="true"]').count()) throw new Error('provider Stop left a provisional assistant bubble');
  if ((await page.getByText('Stop while provider streams', { exact: true }).count()) !== 1) throw new Error('provider Stop duplicated the user turn');
  await page.evaluate(() => { window.__scrollIntoViewCalls = []; });
  await page.getByTestId('nav-threads').click();
  await page.getByTestId('thread-open').first().click();
  await page.waitForURL(/\/chat\/[0-9a-f-]+$/);
  await page.getByText('Stop while provider streams', { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(100);
  const openScrolls = await page.evaluate(() => window.__scrollIntoViewCalls);
  if (openScrolls.length !== 0) throw new Error('opening a populated thread must not auto-scroll its historical messages: ' + JSON.stringify(openScrolls));
  const stoppedLink = page.url(),
    beforeReload = await page.locator('[data-testid="chat-messages"] article').evaluateAll((ns) =>
      ns.map((n) => ({
        role: n.getAttribute('data-role'),
        text: n.textContent,
      })),
    );
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  await page.getByText('Stop while provider streams', { exact: true }).waitFor();
  const afterReload = await page.locator('[data-testid="chat-messages"] article').evaluateAll((ns) =>
    ns.map((n) => ({
      role: n.getAttribute('data-role'),
      text: n.textContent,
    })),
  );
  if (JSON.stringify(beforeReload) !== JSON.stringify(afterReload) || page.url() !== stoppedLink) throw new Error('provider Stop transcript differs from durable reload: ' + JSON.stringify({ beforeReload, afterReload }));
  await page.getByTestId('new-thread').click();
  await page.waitForFunction(async () => {
    try { await window.__kernelProcesses(); return true; } catch { return false; }
  }, null, { timeout: 120000 });
  const pwd = await page.evaluate(() => window.__kernelExec('pwd; env | sort', 10000)),
    expectedEnv = '/root/agent\nHOME=/root\nHUSH_VERSION=1.37.0-wasm\nLANG=C.UTF-8\nLOGNAME=root\nPATH=/usr/local/bin:/usr/bin:/bin\nPWD=/root/agent\nSHELL=/bin/sh\nUSER=root\n';
  if (pwd.stdout !== expectedEnv || pwd.stdout.includes('acceptance-browser-only-secret')) throw new Error('fixed cwd/env or key isolation failed: ' + pwd.stdout);
  const secretScan = await page.evaluate(() => window.__kernelExec("grep -R 'acceptance-browser-only-secret' /root/agent /root/.guc/agent 2>/dev/null || true", 10000));
  if (secretScan.stdout || secretScan.stderr) throw new Error('API key entered gucOS trees: ' + JSON.stringify(secretScan));
  const killed = await page.evaluate(() => window.__kernelExec('trap "" TERM; while :; do :; done', 100));
  if (killed.exit.signal !== 9 || !killed.exit.escalated || killed.exit.leakedPids.length) throw new Error('SIGKILL escalation/reaping failed: ' + JSON.stringify(killed));
  const capped = await page.evaluate(() => window.__kernelExec('yes x | head -c 1200000', 30000));
  if (!capped.exit.truncated || capped.exit.outputBytes !== 1048576 || capped.exit.leakedPids.length) throw new Error('bounded output/reaping failed: ' + JSON.stringify(capped.exit));
  const errCapped = await page.evaluate(() => window.__kernelExec('yes e | head -c 1200000 >&2', 30000));
  if (errCapped.exit.stderrCapturedBytes !== 1048576 || errCapped.exit.stderrTotalBytes !== 1200000 || !errCapped.exit.stderrTruncated || errCapped.exit.stdoutTotalBytes !== 0) throw new Error('stderr cap/accounting failed: ' + JSON.stringify(errCapped.exit));
  const mixed = await page.evaluate(() => window.__kernelExec('yes o | head -c 1100000; yes e | head -c 1150000 >&2; exit 7', 30000));
  if (mixed.exit.stdoutCapturedBytes !== 1048576 || mixed.exit.stdoutTotalBytes !== 1100000 || mixed.exit.stderrCapturedBytes !== 1048576 || mixed.exit.stderrTotalBytes !== 1150000 || !mixed.exit.stdoutTruncated || !mixed.exit.stderrTruncated || mixed.exit.status !== 7 || mixed.exit.signal !== null) throw new Error('mixed fd cap/exit accounting failed: ' + JSON.stringify(mixed.exit));
  const observed = await page.evaluate(async () => {
    window.__processEvents.length = 0;
    const pending = window.__kernelExec('sleep 0.05; exit 7', 10000);
    await new Promise((r) => setTimeout(r, 20));
    const live = await window.__kernelProcesses(),
      done = await pending;
    return { live, done, events: window.__processEvents };
  });
  const started = observed.events.flat().find((p) => p.pid === observed.done.start.pid && p.state === 'running'),
    zombie = observed.events.flat().find((p) => p.pid === observed.done.start.pid && p.state === 'zombie');
  if (!started || started.pgid !== observed.done.start.pgid || !zombie || zombie.exitStatus !== 7 * 256) throw new Error('captured PID/PGID or pre-reap raw wait-status missing: ' + JSON.stringify(observed));
  const ringLength = await page.evaluate(async () => {
    for (let i = 0; i < 70; i++) await window.__kernelExec('true', 10000);
    return window.__processEvents.length;
  });
  if (ringLength !== 128) throw new Error('process diagnostic ring is not capped at 128: ' + ringLength);
  await page.getByTestId('new-thread').click();
  await page.evaluate(() => {
    window.__processEvents.length = 0;
  });
  await page.getByTestId('chat-input').fill('Stop the running process group');
  await page.getByTestId('chat-send').click();
  await page.getByTestId('chat-stop').waitFor();
  await page.waitForFunction(() => window.__processEvents.flat().some((p) => p.cwd === '/root/agent' && p.command.includes('trap')), null, { timeout: 30000 });
  await page.getByTestId('chat-stop').click();
  await page.getByTestId('chat-send').waitFor({ timeout: 30000 });
  const stopStatuses = await page.getByTestId('tool-result').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-status')));
  if (!stopStatuses.includes('aborted') || !stopStatuses.includes('not_run')) throw new Error('routine Stop did not render honest aborted/not_run results: ' + JSON.stringify(stopStatuses));
  if ((await page.evaluate(() => window.__kernelStat('/root/agent/must-not-exist'))) !== null) throw new Error('same-round not_run Write executed');
  const stopLeaks = await page.evaluate(async () => {
    const deadline = Date.now() + 30000;
    let leaks = [];
    do {
      leaks = (await window.__kernelProcesses()).filter((p) => p.cwd === '/root/agent');
      if (!leaks.length) {
        await new Promise((r) => setTimeout(r, 100));
        leaks = (await window.__kernelProcesses()).filter((p) => p.cwd === '/root/agent');
        if (!leaks.length) return leaks;
      }
      await new Promise((r) => setTimeout(r, 25));
    } while (Date.now() < deadline);
    return leaks;
  });
  if (stopLeaks.length) throw new Error('routine Stop leaked process-group descendants: ' + JSON.stringify(stopLeaks));
  const liveStopDom = await page
    .getByTestId('chat-messages')
    .locator('article')
    .evaluateAll((ns) => ns.map((n) => n.outerHTML));
  const liveStopUrl = page.url();
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  await page.getByTestId('tool-result').first().waitFor({ state: 'attached' });
  const reloadedStopDom = await page
    .getByTestId('chat-messages')
    .locator('article')
    .evaluateAll((ns) => ns.map((n) => n.outerHTML));
  if (JSON.stringify(liveStopDom) !== JSON.stringify(reloadedStopDom) || page.url() !== liveStopUrl) throw new Error('live aborted/not_run DOM differs after durable reload');
  const stopOrder = await metaHeaderFacts();
  assertMetaHeader(stopOrder, 'grouped tool thread');
  if (!stopOrder.some((m) => m.metaBeforeGroup === true)) throw new Error('no grouped thinking/tool/result response proved metadata-before-group');
  await page.getByTestId('nav-threads').click();
  await page.getByTestId('threads-page').waitFor();
  const managed = page.getByTestId('thread-row').first();
  const managedMenu = managed.getByRole('button', { name: /^More actions for / });
  await managedMenu.click();
  // RowMenu keyboard behavior (Radix DropdownMenu): focus enters the menu,
  // ArrowDown/End navigate the menuitems, Escape returns focus to the trigger.
  await page.locator('[role="menu"]').waitFor();
  if (!(await page.evaluate(() => document.activeElement?.closest('[role="menu"]') != null))) throw new Error('thread menu open left focus outside the menu');
  const menuText = () => page.evaluate(() => document.activeElement?.textContent?.trim());
  // Radix swallows a keydown that lands in the same tick as a focus move, so
  // press() settles ~120ms like human cadence (probe-verified against Radix).
  const press = async (k) => { await page.keyboard.press(k); await sleep(120); };
  await press('ArrowDown');
  if ((await menuText()) !== 'Rename') throw new Error('thread menu ArrowDown did not focus Rename');
  await press('End');
  if ((await menuText()) !== 'Fork') throw new Error('thread menu End did not focus Fork');
  await press('Escape');
  await page.locator('[role="menu"]').waitFor({ state: 'detached' });
  await page.waitForFunction(() => (document.activeElement?.getAttribute('aria-label') || '').startsWith('More actions for '), null, { timeout: 3000 }).catch(() => { throw new Error('thread menu Escape did not return focus to the trigger'); });
  await managedMenu.click();
  await page.getByRole('menuitem', { name: /^Rename / }).click();
  await managed.getByLabel('Thread title').fill('Parity managed thread');
  await managed.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Parity managed thread', { exact: true }).waitFor();
  await managedMenu.click();
  await page.getByRole('menuitem', { name: 'Pin Parity managed thread' }).click();
  await managedMenu.click();
  await page.getByRole('menuitem', { name: 'Archive Parity managed thread' }).click();
  await page.getByLabel('Archived').check();
  await page.getByText('Parity managed thread', { exact: true }).waitFor();
  await managedMenu.click();
  await page.getByRole('menuitem', { name: 'Restore Parity managed thread' }).click();
  await page.getByTestId('thread-search').fill('Parity managed');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="thread-row"]').length === 1);
  if ((await page.getByTestId('thread-row').count()) !== 1) throw new Error('thread search did not filter journal-backed threads');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await managed.getByRole('button', { name: 'Delete Parity managed thread' }).click();
  const deletion = page.getByRole('alertdialog');
  await deletion.waitFor();
  if (!(await deletion.innerText()).includes('Permanently delete')) throw new Error('safe thread delete confirmation missing');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Delete');
  const activeLabel = () => page.evaluate(() => document.activeElement?.textContent?.trim());
  await press('Tab');
  if ((await activeLabel()) !== 'Cancel') throw new Error('thread delete dialog Tab escaped instead of cycling to Cancel');
  await press('Shift+Tab');
  if ((await activeLabel()) !== 'Delete') throw new Error('thread delete dialog Shift+Tab did not wrap back to Delete');
  await press('Escape');
  await deletion.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => (document.activeElement?.getAttribute('aria-label') || '').startsWith('Delete '), null, { timeout: 3000 }).catch(() => { throw new Error('destructive dialog did not return focus to its trigger'); });
  await page.getByTestId('thread-search').fill('Prepare the workspace');
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="thread-row"]')];
    return rows.length === 1 && rows[0].textContent?.includes('Prepare the workspace');
  });
  await page.getByTestId('thread-row').getByTestId('thread-open').click();
  await page.waitForURL(/\/chat\/[0-9a-f-]+$/);
  const originalForkDom = await page
    .getByTestId('chat-messages')
    .locator('article')
    .evaluateAll((ns) => ns.map((n) => n.outerHTML));
  await page.getByTestId('nav-threads').click();
  await page.getByTestId('thread-search').fill('Prepare the workspace');
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="thread-row"]')];
    return rows.length === 1 && rows[0].textContent?.includes('Prepare the workspace');
  });
  await page
    .getByTestId('thread-row')
    .getByRole('button', { name: /^More actions for / })
    .click();
  await page.getByRole('menuitem', { name: /^Fork / }).click();
  await page.waitForURL(/\/chat\/[0-9a-f-]+$/);
  const forkUrl = page.url(),
    forkDom = await page
      .getByTestId('chat-messages')
      .locator('article')
      .evaluateAll((ns) => ns.map((n) => n.outerHTML));
  if (JSON.stringify(forkDom) !== JSON.stringify(originalForkDom) || forkDom.join('').includes('time unavailable')) throw new Error('fork transcript or metadata was not lossless: ' + JSON.stringify({ originalForkDom, forkDom }));
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  await page.getByText('Workspace ready.', { exact: true }).waitFor();
  const forkReloadDom = await page
    .getByTestId('chat-messages')
    .locator('article')
    .evaluateAll((ns) => ns.map((n) => n.outerHTML));
  if (page.url() !== forkUrl || JSON.stringify(forkReloadDom) !== JSON.stringify(forkDom)) throw new Error('fork deep link did not survive reload exactly');
  await page.getByTestId('nav-threads').click();
  await page.getByTestId('threads-page').waitFor();
  if ((await page.locator('#app').boundingBox()).width !== 375) throw new Error('375px Chat/Threads overflow');
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  await page.getByTestId('thread-search').fill('Prepare the workspace (fork)');
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="thread-row"]')];
    return rows.length === 1 && rows[0].textContent?.includes('(fork)');
  });
  await page.getByTestId('thread-row').getByTestId('thread-open').click();
  await page.getByText('Workspace ready.', { exact: true }).waitFor();
  if (!/\/chat\/[0-9a-f-]+$/.test(page.url())) throw new Error('thread open did not produce a deep link: ' + page.url());
  const deepLink = page.url();
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  await page.getByText('Workspace ready.', { exact: true }).waitFor();
  if (page.url() !== deepLink) throw new Error('deep-link reload changed route');
  if (await page.getByTestId('chat-error').count()) throw new Error('clean fork/open/reload was marked interrupted');
  await page.getByTestId('nav-threads').click();
  await page.getByTestId('threads-page').waitFor();
  await page.getByLabel('Archived').check();
  await page.getByTestId('thread-search').fill('Prepare the workspace (fork)');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="thread-row"]').length === 1);
  const metadataRow = page.getByTestId('thread-row').first();
  const metadataMenu = metadataRow.getByRole('button', { name: /^More actions for / });
  await metadataMenu.click();
  await page.getByRole('menuitem', { name: /^Rename / }).click();
  await metadataRow.getByLabel('Thread title').fill('Metadata clean thread');
  await metadataRow.getByRole('button', { name: 'Save' }).click();
  await metadataMenu.click();
  await page.getByRole('menuitem', { name: 'Pin Metadata clean thread' }).click();
  await metadataMenu.click();
  await page.getByRole('menuitem', { name: 'Archive Metadata clean thread' }).click();
  await metadataMenu.click();
  await page.getByRole('menuitem', { name: 'Restore Metadata clean thread' }).click();
  await metadataRow.getByTestId('thread-open').click();
  await page.waitForURL(/\/chat\/[0-9a-f-]+$/);
  if (await page.getByTestId('chat-error').count()) throw new Error('clean turn followed by rename/pin/archive updates was marked interrupted');
  const interruptedId = page.url().split('/').at(-1);
  const appendInterrupted = await page.evaluate((id) => window.__kernelExec(`file=$(ls /root/.guc/agent/threads/*_${id}.jsonl); seq=$(wc -l < "$file"); seq=$((seq+1)); printf '{"schema_version":1,"thread_id":"${id}","seq":%s,"timestamp":"2026-01-01T00:00:00Z","type":"turn_start"}\\n' "$seq" >> "$file"`, 10000), interruptedId);
  if (appendInterrupted.exit.status !== 0) throw new Error('failed to create interrupted journal fixture: ' + JSON.stringify(appendInterrupted));
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  await page.getByTestId('chat-error').waitFor();
  if (!(await page.getByTestId('chat-error').innerText()).includes('Interrupted turn')) throw new Error('genuinely unmatched turn_start did not surface its warning');
  let richBody = '';
  await page.route('https://api.deepseek.com/**', async (route) => {
    richBody = route.request().postData() || '';
    const fixture = '| Feature | State |\n|---|---|\n| GFM | ready |\n\n[external](https://example.com) and `inline` <script>window.hostile=true</script>\n\n```js\nconst exact = "' + 'x'.repeat(1200) + '";\n```';
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: fixture },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: {
            input_tokens: 17,
            output_tokens: 18,
            cache_read_input_tokens: 3,
          },
        },
      ]),
    });
  });
  await page.getByTestId('new-thread').click();
  await page.evaluate(() => localStorage.setItem('gucos2:image-compress', 'false'));
  await page.locator('input[type=file]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64'),
  });
  await page.getByLabel('Pending image attachments').locator('img').waitFor();
  await page.getByTestId('chat-input').fill('Render parity fixture');
  await page.getByTestId('chat-send').click();
  await page.getByRole('table').waitFor({ timeout: 30000 });
  if (!richBody.includes('media_type') || !richBody.includes('image/')) throw new Error('durable image attachment missing from provider wire');
  if ((await page.getByTestId('chat-messages').locator('script').count()) || (await page.evaluate(() => window.hostile === true))) throw new Error('hostile assistant HTML executed');
  const external = page.getByRole('link', { name: 'external' });
  if ((await external.getAttribute('target')) !== '_blank' || !(await external.getAttribute('rel')).includes('noopener')) throw new Error('external link safety attributes missing');
  if ((await page.getByTestId('code-block').getAttribute('data-fence-closed')) !== 'true' || !(await page.getByTestId('code-block').innerText()).includes('JavaScript')) throw new Error('Prism code presentation missing');
  const assistantMeta = page.getByTestId('assistant-meta').last();
  const metaBar = await assistantMeta.innerText();
  if (!metaBar.includes('ASSISTANT') || !metaBar.includes('deepseek-v4-pro') || !metaBar.includes('end_turn') || !metaBar.includes('record') || metaBar.includes('18 tok') || metaBar.includes('$')) throw new Error('compact metadata bar has the wrong facts: ' + metaBar);
  await assistantMeta.getByRole('button').first().click();
  const metaDetail = await assistantMeta.getByTestId('message-meta-detail').innerText();
  if (!metaDetail.includes('Input tokens\n17') || !metaDetail.includes('Output tokens\n18') || !metaDetail.includes('Cache read\n3 tokens') || !metaDetail.includes('Cost (estimate)') || !metaDetail.includes('Stop reason\nend_turn') || !metaDetail.includes('Thread ID') || !metaDetail.includes('Journal record')) throw new Error('expanded metadata facts are incomplete: ' + metaDetail);
  assertMetaHeader(await metaHeaderFacts(), 'rich markdown thread');
  const liveProvenance = await assistantMeta.getByTestId('message-meta-detail').locator('dd').allTextContents();
  const widthFacts = async () => page.evaluate(() => { const article=document.querySelector('article[data-user-authored="true"]'), parent=article?.parentElement; return { article:article?.getBoundingClientRect().width, transcript:parent?.getBoundingClientRect().width, overflow:document.documentElement.scrollWidth>innerWidth }; });
  const mobileWidths = await widthFacts();
  if (!mobileWidths.article || !mobileWidths.transcript || Math.abs(mobileWidths.article / mobileWidths.transcript - .8) > .02 || mobileWidths.overflow) throw new Error('375px cc user width/wrapping mismatch: ' + JSON.stringify(mobileWidths));
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopWidths = await widthFacts();
  if (!desktopWidths.article || !desktopWidths.transcript || Math.abs(desktopWidths.article / desktopWidths.transcript - .8) > .02 || desktopWidths.overflow) throw new Error('desktop cc user width/wrapping mismatch: ' + JSON.stringify(desktopWidths));
  await page.setViewportSize({ width: 375, height: 667 });
  const composerGeometry = await page.getByTestId('chat-composer').evaluate((node) => [...node.querySelectorAll('button')].map((button) => ({ width: button.getBoundingClientRect().width, icon: button.querySelector('svg')?.getBoundingClientRect().width ?? 0 })));
  if (composerGeometry.some((item) => item.width < 36 || item.icon < 20)) throw new Error('composer controls are smaller than cc precedent: ' + JSON.stringify(composerGeometry));
  const chatBox = await page.getByTestId('chat-page').boundingBox();
  if (!chatBox || chatBox.width > 375) throw new Error('rich Chat overflowed 375px viewport');
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  await page.getByRole('table').waitFor();
  if ((await page.getByTestId('chat-messages').locator('img').count()) !== 1) throw new Error('image attachment did not survive journal reload');
  if (!(await page.getByTestId('chat-messages').innerText()).includes('const exact')) throw new Error('rich Markdown did not reload equivalently');
  const reloadedAssistantMeta = page.getByTestId('assistant-meta').last();
  await reloadedAssistantMeta.getByRole('button', { name: 'Expand assistant metadata' }).click();
  const reloadedProvenance = await reloadedAssistantMeta.getByTestId('message-meta-detail').locator('dd').allTextContents();
  if (JSON.stringify(reloadedProvenance) !== JSON.stringify(liveProvenance)) throw new Error('expanded assistant provenance changed across reload: ' + JSON.stringify({ liveProvenance, reloadedProvenance }));
  await page.getByTestId('new-thread').click();
  await page.evaluate(() => {
    localStorage.removeItem('gucos2:voice-auto-submit');
    localStorage.setItem('gucos2:stt-mode', 'web-speech');
    class MockRecognition {
      continuous = true;
      interimResults = true;
      lang = '';
      start() {
        queueMicrotask(() => {
          this.onresult?.({
            results: [{ 0: { transcript: 'Voice submitted' }, isFinal: true }],
          });
          this.onend?.();
        });
      }
      stop() {
        this.onend?.();
      }
    }
    window.SpeechRecognition = MockRecognition;
  });
  await page.getByTestId('voice-input').click();
  await page.getByText('Voice submitted', { exact: true }).waitFor();
  await page.getByRole('table').waitFor();
  await page.getByTestId('chat-send').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByTestId('new-thread').click();
  await page.evaluate(() => localStorage.setItem('gucos2:voice-auto-submit', 'false'));
  await page.getByTestId('voice-input').click();
  await page.getByTestId('chat-input').waitFor();
  if ((await page.getByTestId('chat-input').inputValue()) !== 'Voice submitted') throw new Error('voice opt-out did not leave transcription in composer');
  if (await page.locator('article[data-user-authored="true"]').count()) throw new Error('voice opt-out still auto-submitted');
  await page.reload();
  await page.waitForFunction(() => window.__osState === 'ready', null, { timeout: 120000 });
  await page.getByTestId('new-thread').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-messages"] article').length === 0);
  await page.getByTestId('chat-input').fill('');
  await page.evaluate(() => {
    localStorage.setItem('gucos2:stt-mode', 'elevenlabs');
    localStorage.setItem('gucos2:elevenlabs-key', 'sk_test-key-acceptance');
    localStorage.removeItem('gucos2:voice-auto-submit');
  });
  const elevenRequests = [];
  await page.route('https://api.elevenlabs.io/v1/speech-to-text', async (route) => {
    const req = route.request();
    elevenRequests.push({ method: req.method(), headers: req.headers(), body: req.postData() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'ElevenLabs transcribed' }) });
  });
  await page.evaluate(() => {
    class MockMediaRecorder {
      static isTypeSupported(mime) {
        return ['audio/webm;codecs=opus', 'audio/webm'].includes(mime);
      }
      constructor(stream, options) {
        this.stream = stream;
        this.mimeType = options?.mimeType || 'audio/webm;codecs=opus';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = 'recording';
        setTimeout(() => {
          const blob = new Blob(['fake-webm-audio'], { type: this.mimeType });
          this.ondataavailable?.({ data: blob });
        }, 10);
      }
      stop() {
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 10);
      }
    }
    window.MediaRecorder = MockMediaRecorder;
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop: () => {} }],
    });
  });
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-input"]')?.getAttribute('aria-pressed') === 'false');
  await page.getByTestId('voice-input').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-input"]')?.getAttribute('aria-pressed') === 'true');
  await sleep(120);
  await page.getByTestId('voice-input').click();
  for (let i = 0; i < 50 && elevenRequests.length === 0; i++) await sleep(100);
  if (!elevenRequests.length) throw new Error('WebM Scribe mock made no request: ' + JSON.stringify(await page.evaluate(() => ({ alert: document.querySelector('[role="alert"]')?.textContent, input: document.querySelector('[data-testid="chat-input"]')?.value, pressed: document.querySelector('[data-testid="voice-input"]')?.getAttribute('aria-pressed') }))));
  await page.getByText('ElevenLabs transcribed', { exact: true }).waitFor({ timeout: 30000 }).catch(async error => { throw new Error('WebM Scribe mock did not complete: ' + JSON.stringify(await page.evaluate(() => ({ alert: document.querySelector('[role="alert"]')?.textContent, input: document.querySelector('[data-testid="chat-input"]')?.value, pressed: document.querySelector('[data-testid="voice-input"]')?.getAttribute('aria-pressed'), users: [...document.querySelectorAll('article[data-user-authored="true"]')].map(node => node.textContent) }))) + '\n' + error); });
  if (elevenRequests.length !== 1) throw new Error('ElevenLabs request count mismatch: ' + elevenRequests.length);
  const elevenReq = elevenRequests[0];
  if (elevenReq.method !== 'POST') throw new Error('ElevenLabs method mismatch: ' + elevenReq.method);
  if (elevenReq.headers['xi-api-key'] !== 'sk_test-key-acceptance') throw new Error('ElevenLabs auth header missing or wrong');
  if (!elevenReq.body) throw new Error('ElevenLabs body missing');
  const multipartBoundary = elevenReq.headers['content-type']?.match(/boundary=([^;]+)/)?.[1];
  if (!multipartBoundary) throw new Error('multipart boundary missing from content-type');
  const bodyLines = elevenReq.body.split('\r\n');
  const fileFieldIndex = bodyLines.findIndex((l) => l.includes('name="file"'));
  if (fileFieldIndex === -1) throw new Error('multipart file field missing');
  const fileDisposition = bodyLines[fileFieldIndex];
  if (!fileDisposition.includes('filename="speech.webm"')) throw new Error('multipart filename not speech.webm: ' + fileDisposition);
  const fileTypeIndex = fileFieldIndex + 1;
  if (bodyLines[fileTypeIndex] !== 'Content-Type: audio/webm;codecs=opus') throw new Error('multipart file Content-Type not exact recorder MIME: ' + bodyLines[fileTypeIndex]);
  const modelFieldIndex = bodyLines.findIndex((l) => l.includes('name="model_id"'));
  if (modelFieldIndex === -1) throw new Error('multipart model_id field missing');
  const modelValue = bodyLines[modelFieldIndex + 2];
  if (modelValue !== 'scribe_v1') throw new Error('model_id value not scribe_v1: ' + modelValue);
  await page.getByTestId('new-thread').click();
  await page.evaluate(() => {
    class MockMediaRecorderMP4 {
      static isTypeSupported(mime) {
        return ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'].includes(mime);
      }
      constructor(stream, options) {
        this.stream = stream;
        this.mimeType = options?.mimeType || 'audio/mp4;codecs=mp4a.40.2';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = 'recording';
        setTimeout(() => {
          const blob = new Blob(['fake-mp4-audio'], { type: this.mimeType });
          this.ondataavailable?.({ data: blob });
        }, 10);
      }
      stop() {
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 10);
      }
    }
    window.MediaRecorder = MockMediaRecorderMP4;
  });
  elevenRequests.length = 0;
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-input"]')?.getAttribute('aria-pressed') === 'false');
  await page.getByTestId('voice-input').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-input"]')?.getAttribute('aria-pressed') === 'true');
  await sleep(120);
  await page.getByTestId('voice-input').click();
  await page.getByText('ElevenLabs transcribed', { exact: true }).waitFor({ timeout: 30000 }).catch(async error => { throw new Error('MP4 Scribe mock did not complete: ' + await page.locator('body').innerText() + '\n' + error); });
  if (elevenRequests.length !== 1) throw new Error('ElevenLabs Safari-style request missing');
  const safariReq = elevenRequests[0];
  const safariFileField = safariReq.body?.split('\r\n').find((l) => l.includes('name="file"'));
  if (!safariFileField?.includes('filename="speech.m4a"')) throw new Error('Safari-style MP4 filename not speech.m4a: ' + safariFileField);
  const safariTypeField = safariReq.body?.split('\r\n')[safariReq.body.split('\r\n').findIndex((l) => l.includes('name="file"')) + 1];
  if (!safariTypeField?.includes('Content-Type: audio/mp4')) throw new Error('Safari-style MP4 Content-Type wrong: ' + safariTypeField);
  await page.getByTestId('new-thread').click();
  await page.route('https://api.elevenlabs.io/v1/speech-to-text', async (route) => {
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: 'Audio duration is too short' }) });
  });
  await page.getByTestId('voice-input').click();
  await sleep(120);
  await page.getByTestId('voice-input').click();
  const providerError = page.getByRole('alert');
  await providerError.getByText('ElevenLabs HTTP 400', { exact: false }).waitFor({ timeout: 5000 });
  const providerErrorText = await providerError.innerText();
  if (!providerErrorText.includes('Audio duration is too short') || !providerErrorText.includes('speech.m4a') || !providerErrorText.includes('audio/mp4') || !providerErrorText.includes('scribe_v1') || providerErrorText.includes('sk_test-key-acceptance')) throw new Error('sanitized provider diagnostics incomplete or secret-bearing: ' + providerErrorText);
  const expected400Console = browserErrors.findIndex(message => message.includes('status of 400'));
  if (expected400Console >= 0) browserErrors.splice(expected400Console, 1);
  await page.getByTestId('new-thread').click();
  await page.evaluate(() => {
    class MockMediaRecorderEmpty {
      static isTypeSupported = window.MediaRecorder.isTypeSupported;
      constructor(stream, options) {
        this.stream = stream;
        this.mimeType = options?.mimeType || 'audio/webm;codecs=opus';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = 'recording';
        setTimeout(() => {
          const blob = new Blob([], { type: this.mimeType });
          this.ondataavailable?.({ data: blob });
        }, 10);
      }
      stop() {
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 10);
      }
    }
    window.MediaRecorder = MockMediaRecorderEmpty;
  });
  await page.getByTestId('voice-input').click();
  await sleep(120);
  await page.getByTestId('voice-input').click();
  await page.getByText('Recording is empty', { exact: false }).waitFor({ timeout: 5000 });
  await page.unroute('https://api.elevenlabs.io/v1/speech-to-text');
  let pendingUploadStarted = false, pendingUploadAborted = false;
  const observeScribeAbort = request => { if (request.url() === 'https://api.elevenlabs.io/v1/speech-to-text') pendingUploadAborted = true; };
  page.on('requestfailed', observeScribeAbort);
  await page.route('https://api.elevenlabs.io/v1/speech-to-text', async route => {
    pendingUploadStarted = true;
    await sleep(3000);
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'must not render' }) }); }
    catch { pendingUploadAborted = true; }
  });
  await page.evaluate(() => {
    window.MediaRecorder = class {
      static isTypeSupported = type => type.startsWith('audio/webm');
      constructor(stream, options) { this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive'; this.ondataavailable = null; this.onstop = null; }
      start() { this.state = 'recording'; setTimeout(() => this.ondataavailable?.({ data: new Blob(['pending-upload'], { type: this.mimeType }) }), 10); }
      stop() { this.state = 'inactive'; setTimeout(() => this.onstop?.(), 10); }
    };
  });
  await page.getByTestId('voice-input').click();
  await sleep(120);
  await page.getByTestId('voice-input').click();
  for (let i = 0; i < 50 && !pendingUploadStarted; i++) await sleep(100);
  if (!pendingUploadStarted) throw new Error('delayed Scribe upload never started');
  await page.click('[data-testid="nav-settings"]');
  await page.getByTestId('settings-page').waitFor();
  for (let i = 0; i < 50 && !pendingUploadAborted; i++) await sleep(100);
  page.off('requestfailed', observeScribeAbort);
  if (!pendingUploadAborted) throw new Error('unmount did not abort the pending Scribe upload');
  await page.click('[data-testid="nav-chat"]');
  await page.unroute('https://api.elevenlabs.io/v1/speech-to-text');
  await page.route('https://api.elevenlabs.io/v1/speech-to-text', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'Opt-out transcription' }) });
  });
  await page.evaluate(() => localStorage.setItem('gucos2:voice-auto-submit', 'false'));
  await page.getByTestId('new-thread').click();
  await page.evaluate(() => {
    window.MediaRecorder = class {
      static isTypeSupported = () => true;
      constructor(stream, options) {
        this.mimeType = options?.mimeType || 'audio/webm;codecs=opus';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        setTimeout(() => this.ondataavailable?.({ data: new Blob(['enough-data-for-validation'], { type: this.mimeType }) }), 10);
      }
      stop() {
        setTimeout(() => this.onstop?.(), 10);
      }
    };
  });
  await page.getByTestId('voice-input').click();
  await sleep(120);
  await page.getByTestId('voice-input').click();
  await page.getByTestId('chat-input').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="chat-input"]')?.value === 'Opt-out transcription');
  if ((await page.getByTestId('chat-input').inputValue()) !== 'Opt-out transcription') throw new Error('ElevenLabs opt-out did not leave transcription in composer');
  if (await page.locator('article[data-user-authored="true"]').count()) throw new Error('ElevenLabs opt-out still auto-submitted');
  await page.evaluate(() => localStorage.setItem('gucos2:model', 'deliberately-incompatible'));
  await page.goto(`http://127.0.0.1:${port}/chat`);
  await page.getByTestId('profile-model-error').waitFor();
  if (!(await page.getByTestId('profile-model-error').innerText()).includes('not supported')) throw new Error('incompatible endpoint/model path was not visible');
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (options) => newContext({ ...options, serviceWorkers: 'block' });
  await context.close();
  const recoveryContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const recoveryPage = await recoveryContext.newPage();
  await recoveryPage.goto(`http://127.0.0.1:${port}/`);
  await recoveryPage.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  await recoveryPage.evaluate(() => window.__kernelExec('printf preserve > /root/reset-sentinel', 10000));
  const workerPattern = '**/runtime/*/os/kernel-worker.js*';
  await recoveryPage.route(workerPattern, (route) => route.abort());
  await recoveryPage.reload();
  await recoveryPage.getByTestId('kernel-fatal').waitFor({ timeout: 30000 });
  const repairLoad = await recoveryPage.evaluate(() => performance.timeOrigin);
  await recoveryPage.getByTestId('repair-system').click();
  await recoveryPage.waitForFunction((origin) => performance.timeOrigin !== origin, repairLoad, { timeout: 30000 });
  await recoveryPage.waitForLoadState('domcontentloaded');
  await recoveryPage.getByTestId('kernel-fatal').waitFor({ timeout: 30000 });
  await recoveryPage.unroute(workerPattern);
  await recoveryPage.reload();
  await recoveryPage.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  if ((await recoveryPage.evaluate(() => window.__kernelStat('/root/reset-sentinel'))) === null) throw new Error('system repair deleted writable-root data');
  await recoveryPage.route(workerPattern, (route) => route.abort());
  await recoveryPage.reload();
  await recoveryPage.getByTestId('kernel-fatal').waitFor({ timeout: 30000 });
  await recoveryPage.getByTestId('factory-reset').click();
  const resetDialog = recoveryPage.getByTestId('dialog');
  await resetDialog.waitFor();
  if (!(await resetDialog.innerText()).includes('files, settings, and Chat history')) throw new Error('factory reset dialog does not disclose destructive scope');
  const resetLoad = await recoveryPage.evaluate(() => performance.timeOrigin);
  await resetDialog.getByText('Erase and reset', { exact: true }).click();
  await recoveryPage.waitForFunction((origin) => performance.timeOrigin !== origin, resetLoad, { timeout: 30000 });
  await recoveryPage.waitForLoadState('domcontentloaded');
  await recoveryPage.getByTestId('kernel-fatal').waitFor({ timeout: 30000 });
  await recoveryPage.unroute(workerPattern);
  await recoveryPage.reload();
  await recoveryPage.waitForFunction(() => window.__osState === 'ready', null, {
    timeout: 120000,
  });
  if ((await recoveryPage.evaluate(() => window.__kernelStat('/root/reset-sentinel'))) !== null) throw new Error('factory reset preserved writable-root data');
  await recoveryContext.close();
  if (browserErrors.length) throw new Error('browser emitted console/page errors: ' + JSON.stringify(browserErrors));
  console.log('test_chat_agent: provider Stop cleanup/reload, double-submit guard, 128 process ring, mobile Chat and captured-process checks passed');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
