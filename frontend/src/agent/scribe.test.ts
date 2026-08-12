import { describe, expect, it } from 'vitest';
import { chooseRecorderMime, looksLikeCurrentElevenLabsApiKey, SCRIBE_MODEL, scribeHttpError, scribeMediaFacts } from './scribe';

describe('ElevenLabs Scribe request contract', () => {
  it('prefers Chromium WebM and falls back to Safari AAC-in-MP4', () => {
    expect(chooseRecorderMime(type => type.includes('webm'))).toBe('audio/webm;codecs=opus');
    expect(chooseRecorderMime(type => type.includes('mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(SCRIBE_MODEL).toBe('scribe_v1');
  });
  it('derives filenames from the actual media type and never labels MP4 as WebM', () => {
    expect(scribeMediaFacts('audio/webm;codecs=opus')).toEqual({ mime: 'audio/webm', extension: 'webm' });
    expect(scribeMediaFacts('audio/mp4;codecs=mp4a.40.2')).toEqual({ mime: 'audio/mp4', extension: 'm4a' });
    expect(() => scribeMediaFacts('application/octet-stream')).toThrow('Unsupported recording media type');
  });
  it('distinguishes an ElevenLabs secret key from an API key ID', () => {
    expect(looksLikeCurrentElevenLabsApiKey('sk_example')).toBe(true);
    expect(looksLikeCurrentElevenLabsApiKey(' API_KEY_ID ')).toBe(false);
    expect(looksLikeCurrentElevenLabsApiKey('')).toBe(false);
  });
  it('bounds and sanitizes JSON and text provider errors while retaining request facts', async () => {
    const error = await scribeHttpError(new Response(JSON.stringify({ detail: 'bad secret-key\nmedia' }), { status: 400 }), 'secret-key', 'speech.m4a, audio/mp4, 12 bytes, scribe_v1');
    expect(error.message).toContain('ElevenLabs HTTP 400: bad [redacted] media');
    expect(error.message).toContain('speech.m4a, audio/mp4, 12 bytes, scribe_v1');
    expect(error.message).not.toContain('secret-key');
  });
});
