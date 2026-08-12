// Keep the model that existing browser-local keys were already using successfully.
// ElevenLabs currently accepts both scribe_v1 and scribe_v2 on this endpoint.
export const SCRIBE_MODEL = 'scribe_v1';
export const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
] as const;

export function looksLikeCurrentElevenLabsApiKey(value: string): boolean {
  return value.trim().startsWith('sk_');
}

export function chooseRecorderMime(isSupported: (type: string) => boolean): string {
  return RECORDER_MIME_TYPES.find(isSupported) ?? '';
}

export function scribeMediaFacts(rawType: string): { mime: string; extension: string } {
  const mime = rawType.trim().toLowerCase().split(';', 1)[0];
  const extensions: Record<string, string> = {
    'audio/webm': 'webm', 'video/webm': 'webm',
    'audio/mp4': 'm4a', 'video/mp4': 'mp4',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/aac': 'aac', 'audio/x-aac': 'aac', 'audio/wav': 'wav',
    'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
  };
  const extension = extensions[mime];
  if (!extension) throw new Error(`Unsupported recording media type: ${mime || 'unknown'}`);
  return { mime, extension };
}

function providerMessage(text: string): string {
  try {
    const value = JSON.parse(text) as { detail?: unknown; message?: unknown };
    const detail = value.detail ?? value.message;
    return typeof detail === 'string' ? detail : detail == null ? text : JSON.stringify(detail);
  } catch { return text; }
}

export async function scribeHttpError(response: Response, key: string, facts: string): Promise<Error> {
  let body = '';
  try { body = providerMessage(await response.text()); } catch { /* status and request facts remain useful */ }
  const safe = body.replaceAll(key, '[redacted]').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300);
  return new Error(`ElevenLabs HTTP ${response.status}${safe ? `: ${safe}` : ''} (${facts})`);
}
