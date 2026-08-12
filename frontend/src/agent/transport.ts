export type EndpointProfile = { id: string; label: string; provider: string; protocol: 'anthropic-messages'; baseUrl: string; models: string[]; headers: Record<string,string>; defaults?: Record<string,unknown> };
export const DEFAULT_PROFILE: EndpointProfile = { id: 'deepseek-direct', label: 'DeepSeek', provider: 'deepseek', protocol: 'anthropic-messages', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-v4-pro','deepseek-v4-flash'], headers: {}, defaults: { max_tokens: 8192 } };
export const keyStorageName = (provider: string) => `gucos2:apikey:${provider}`;

export function validateProfile(profile: EndpointProfile): void {
  if (!profile.id || !profile.models.length) throw new Error('Endpoint profile needs an id and supported models');
  for (const name of Object.keys(profile.headers)) if (/^(authorization|proxy-authorization|x-api-key|xi-api-key|api-key|cookie)$/i.test(name)) throw new Error(`Credential-bearing header is forbidden: ${name}`);
  const url = new URL(profile.baseUrl); if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('Endpoint must use HTTPS');
}

type StreamCallbacks = { onBlock?(block: Record<string,unknown>): void; onText?(text: string): void;onUpdate?(blocks:Record<string,unknown>[]):void };
type StreamState = { blocks: Record<string,unknown>[]; stop_reason: string|null; usage: Record<string,unknown> };

export function consumeSseRecord(raw: string, state: StreamState, callbacks: StreamCallbacks): void {
  const data = raw.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
  if (!data || data === '[DONE]') return;
  const event = JSON.parse(data) as {type:string; index?:number; content_block?:Record<string,unknown>; delta?:Record<string,unknown>; message?:{usage?:Record<string,unknown>}; usage?:Record<string,unknown>};
  const blocks = state.blocks;
  if (event.type === 'content_block_start' && event.content_block) {blocks[event.index ?? blocks.length] = structuredClone(event.content_block);callbacks.onUpdate?.(structuredClone(blocks.filter(Boolean)))}
  else if (event.type === 'content_block_delta' && event.delta) { const b = blocks[event.index ?? 0]; if (b && event.delta.type === 'text_delta') { b.text = String(b.text ?? '') + String(event.delta.text ?? ''); callbacks.onText?.(String(event.delta.text ?? '')); } else if (b && event.delta.type === 'input_json_delta') b.__json = String(b.__json ?? '') + String(event.delta.partial_json ?? ''); else if (b && event.delta.type === 'thinking_delta') b.thinking = String(b.thinking ?? '') + String(event.delta.thinking ?? ''); else if (b && event.delta.type === 'signature_delta') b.signature = String(b.signature ?? '') + String(event.delta.signature ?? '');callbacks.onUpdate?.(structuredClone(blocks.filter(Boolean))) }
  else if (event.type === 'content_block_stop') { const b = blocks[event.index ?? 0]; if (b?.__json !== undefined) { b.input = JSON.parse(String(b.__json || '{}')); delete b.__json; } if (b) callbacks.onBlock?.(b); }
  else if (event.type === 'message_delta') { state.stop_reason = String(event.delta?.stop_reason ?? state.stop_reason); state.usage = { ...state.usage, ...event.usage }; }
  else if (event.type === 'message_start') state.usage = event.message?.usage ?? {};
}
export async function streamMessages(profile: EndpointProfile, model: string, messages: unknown[], tools: unknown[], signal: AbortSignal, callbacks: StreamCallbacks = {}, system?: string): Promise<{ content: Record<string,unknown>[]; stop_reason: string|null; usage: Record<string,unknown> }> {
  validateProfile(profile); if (!profile.models.includes(model)) throw new Error(`${model} is not supported by endpoint ${profile.label}`);
  const key = localStorage.getItem(keyStorageName(profile.provider)); if (!key) throw new Error(`Save a ${profile.label} API key in Settings`);
  const inactivity = new AbortController(); const abort = () => inactivity.abort(signal.reason); signal.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout>; const arm = () => { clearTimeout(timer); timer = setTimeout(() => inactivity.abort(new Error('Provider stream inactive for 120 seconds')), 120_000); }; arm();
  try {
    const response = await fetch(`${profile.baseUrl.replace(/\/$/, '')}/v1/messages`, { method: 'POST', signal: inactivity.signal,
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key, ...profile.headers },
      body: JSON.stringify({ model, messages, tools, stream: true, max_tokens: 8192, ...profile.defaults, ...(system ? { system } : {}) }) });
    if (!response.ok || !response.body) throw new Error(`Provider HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = ''; const state: StreamState = { stop_reason: null, usage: {}, blocks: [] };
    for (;;) {
      const {done,value} = await reader.read(); if (done) { buffer += decoder.decode(); break; } arm(); buffer += decoder.decode(value, { stream: true });
      for (;;) { const split = buffer.search(/\r?\n\r?\n/); if (split < 0) break; const raw = buffer.slice(0, split); buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, '');
        consumeSseRecord(raw, state, callbacks);
      }
    }
    if (buffer.trim()) consumeSseRecord(buffer, state, callbacks);
    return { content: state.blocks.filter(Boolean), stop_reason: state.stop_reason, usage: state.usage };
  } finally { clearTimeout(timer!); signal.removeEventListener('abort', abort); }
}
