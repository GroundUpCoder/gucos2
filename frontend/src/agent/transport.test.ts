import { describe, expect, it } from 'vitest';
import { consumeSseRecord } from './transport';

describe('consumeSseRecord', () => {
  it('consumes a final message_delta without a trailing blank line', () => {
    const state = { blocks: [], stop_reason: null as string|null, usage: {} };
    consumeSseRecord('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}', state, {});
    expect(state.stop_reason).toBe('end_turn');
    expect(state.usage).toEqual({ output_tokens: 7 });
  });

  it('ignores whitespace and the DONE sentinel', () => {
    const state = { blocks: [], stop_reason: null as string|null, usage: {} };
    consumeSseRecord('  \n', state, {});
    consumeSseRecord('data: [DONE]', state, {});
    expect(state).toEqual({ blocks: [], stop_reason: null, usage: {} });
  });
});
