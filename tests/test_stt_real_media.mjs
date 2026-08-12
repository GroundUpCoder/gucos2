import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(APP, 'frontend/package.json'));
const { chromium } = require('playwright-core');
const target = process.env.OS_STT_TARGET || 'https://os2.groundupcoder.com/chat';
const audio = process.env.OS_STT_AUDIO;
if (!audio) throw new Error('OS_STT_AUDIO must point to a WAV fixture');

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${audio}`,
  ],
});

try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  let request;
  await page.route('https://api.elevenlabs.io/v1/speech-to-text', async route => {
    const incoming = route.request();
    request = {
      headers: incoming.headers(),
      body: incoming.postDataBuffer(),
    };
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ detail: { status: 'invalid_audio', message: 'real-media contract probe' } }),
    });
  });
  await page.goto(target);
  await page.waitForFunction(() => window.__osState === 'ready');
  await page.evaluate(() => {
    localStorage.setItem('gucos2:stt-mode', 'elevenlabs');
    localStorage.setItem('gucos2:elevenlabs-key', 'sk_real-media-contract-key');
  });
  const button = page.getByTestId('voice-input');
  await button.click();
  await page.waitForTimeout(1200);
  await button.click();
  await page.getByRole('alert').getByText('ElevenLabs HTTP 400', { exact: false }).waitFor();
  if (!request?.body) throw new Error('no ElevenLabs multipart request captured');
  const bodyText = request.body.toString('latin1');
  const disposition = bodyText.match(/Content-Disposition: form-data; name="file"; filename="([^"]+)"/i)?.[1];
  const fileType = bodyText.match(/name="file"; filename="[^"]+"\r\nContent-Type: ([^\r\n]+)/i)?.[1];
  const model = bodyText.match(/name="model_id"\r\n\r\n([^\r\n]+)/i)?.[1];
  const fileStart = bodyText.search(/name="file"; filename=/i);
  const modelStart = bodyText.search(/name="model_id"/i);
  const encodedFileBytes = fileStart >= 0 && modelStart > fileStart ? modelStart - fileStart : 0;
  const alert = await page.getByRole('alert').innerText();
  const result = { disposition, fileType, model, encodedFileBytes, requestBytes: request.body.length, alert };
  if (disposition !== 'speech.webm' || fileType !== 'audio/webm;codecs=opus' || model !== 'scribe_v1') {
    throw new Error(`unexpected real-media contract: ${JSON.stringify(result)}`);
  }
  if (encodedFileBytes < 1000) throw new Error(`recorded media was implausibly small: ${JSON.stringify(result)}`);
  if (!alert.includes('real-media contract probe') || alert.includes('sk_real-media-contract-key')) {
    throw new Error(`provider diagnostics were missing or secret-bearing: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
