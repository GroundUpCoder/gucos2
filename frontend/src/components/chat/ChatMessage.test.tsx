import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Message } from './ChatMessage';
import type { ChatMessage } from '../../agent/session';

vi.mock('react-syntax-highlighter', () => ({ Prism: ({ children, language }: { children: string; language?: string }) => <pre data-language={language}><code>{children}</code></pre> }));
vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({ oneDark: {} }));

// A long multi-round assistant turn: two thinking/tool/result rounds and a
// closing Markdown answer — the shape that made footer metadata invisible.
const GROUPED = [
  { type: 'thinking', thinking: 'round one', signature: 'sig' },
  { type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'ls /' } },
  { type: 'tool_result', tool_use_id: 'a', status: 'completed', content: 'bin' },
  { type: 'thinking', thinking: 'round two', signature: 'sig' },
  { type: 'tool_use', id: 'b', name: 'Read', input: { path: '/root/x' } },
  { type: 'tool_result', tool_use_id: 'b', status: 'completed', content: 'x' },
  { type: 'text', text: 'the final **answer**' },
] as ChatMessage['content'];

const ASSISTANT: ChatMessage = {
  role: 'assistant', content: GROUPED, model: 'deepseek-v4-pro', createdAt: '2026-08-10T01:00:00Z',
  usage: { input_tokens: 17, output_tokens: 18 }, stopReason: 'end_turn', durationMs: 1200,
};

describe('Chat message metadata placement', () => {
  it('renders assistant metadata as a leading header before the thinking/tool group and Markdown, exactly once', () => {
    const html = renderToStaticMarkup(<Message index={0} message={ASSISTANT} />);
    const article = html.indexOf('<article'), meta = html.indexOf('data-testid="assistant-meta"'), group = html.indexOf('data-testid="thinking-tool-group"'), answer = html.indexOf('the final');
    expect(article).toBeGreaterThan(-1);
    expect(meta).toBeGreaterThan(article);
    expect(group).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(group);
    expect(meta).toBeLessThan(answer);
    expect(html.match(/data-testid="assistant-meta"/g)).toHaveLength(1);
    expect(html).toContain('bg-muted/50');
  });
  it('keeps every truthful metadata field and the copy interaction in the header', () => {
    const html = renderToStaticMarkup(<Message index={0} message={ASSISTANT} />);
    expect(html).toContain('deepseek-v4-pro');
    expect(html).toContain('end_turn');
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain('aria-label="Collapse assistant message"');
    expect(html).toContain('aria-label="Expand assistant metadata"');
    expect(html).not.toContain('18 tok');
    expect(html).not.toContain('1.2s');
  });
  it('renders user-authored metadata as a leading header before text, exactly once', () => {
    const user: ChatMessage = { role: 'user', content: [{ type: 'text', text: 'hello there' }], createdAt: '2026-08-10T01:00:00Z' };
    const html = renderToStaticMarkup(<Message index={1} message={user} />);
    const text = html.indexOf('hello there'), meta = html.indexOf('data-testid="user-meta"');
    expect(meta).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(text);
    expect(html.match(/data-testid="user-meta"/g)).toHaveLength(1);
    expect(html).toContain('USER');
    expect(html).toContain('aria-label="Collapse user message"');
    expect(html).toContain('aria-label="Expand user metadata"');
    expect(html).toContain('bg-slate-100');
    expect(html).not.toContain('assistant-meta');
  });
  it('uses cc date-aware compact time for an older message and omits copy for image-only content', () => {
    const old: ChatMessage = { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }], createdAt: '2020-01-02T15:04:00Z', threadId: 'thread-real', recordSeq: 7 };
    const html = renderToStaticMarkup(<Message index={2} message={old} />);
    expect(html).toContain('Jan ');
    expect(html).toContain('record 7');
    expect(html).not.toContain('aria-label="Copy message"');
  });
});
