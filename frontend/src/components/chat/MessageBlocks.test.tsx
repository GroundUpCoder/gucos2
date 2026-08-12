import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {MessageBlocks,ParsedResult,toolResultPreview} from './MessageBlocks';

describe('tool result accounting',()=>{
  it.each(['stdout_truncated','stderr_truncated'] as const)('renders the truncation warning for durable %s',field=>{
    const html=renderToStaticMarkup(<ParsedResult value={{ok:true,[field]:true,exit_code:7,signal:null,[field.replace('truncated','total_bytes')]:1200000}}/>);
    expect(html).toContain('data-testid="tool-result-truncation"');
    expect(html).toContain('Output was truncated at the configured byte cap.');
    expect(html).toContain('exit_code');
    expect(html).toContain('7');
  });
  it('summarizes a collapsed result with useful output instead of its JSON envelope',()=>{
    const raw=JSON.stringify({ok:true,pid:3,stdout:'deployed-parity\n',stderr:'',exit_code:0});
    expect(toolResultPreview(raw,JSON.parse(raw))).toBe('deployed-parity');
    expect(toolResultPreview('{"ok":true}',{ok:true})).toBe('{"ok":true}');
  });
});

describe('streaming never auto-opens thinking or its group',()=>{
  // A coalesced two-round turn: round-1 thinking+tool+result, round-2 thinking
  // still streaming. activeBlockCount=1 means only the trailing round-2 thinking
  // is "active" (styled as streaming); the round-1 thinking is an ordinary
  // completed block. Neither auto-opens — disclosure is always user-driven.
  const TWO_ROUND=[
    {type:'thinking',thinking:'older round reasoning',signature:'sig'},
    {type:'tool_use',id:'a',name:'Bash',input:{command:'ls'}},
    {type:'tool_result',tool_use_id:'a',status:'completed',content:'bin'},
    {type:'thinking',thinking:'newer round reasoning',signature:'sig'},
  ];
  it('keeps every thinking and its group collapsed during streaming, but styles the active card',()=>{
    const html=renderToStaticMarkup(<MessageBlocks content={TWO_ROUND} streaming activeBlockCount={1}/>);
    // Exactly one thinking card carries the active "Thinking…" label (styling).
    expect(html.match(/Thinking…/g)).toHaveLength(1);
    expect(html).toContain('border-violet-400/50');
    expect(html).toContain('animate-pulse');
    // No thinking body is rendered and no group is open — streaming never
    // auto-opens disclosure.
    expect(html.match(/data-testid="thinking-body"/g)).toBeNull();
    expect(html).not.toContain('open=""');
    // Both thinking cards still render their (collapsed) labels.
    expect(html.match(/data-testid="thinking-card"/g)).toHaveLength(2);
  });
  it('keeps every thinking collapsed once the turn is finalized (no active block)',()=>{
    const html=renderToStaticMarkup(<MessageBlocks content={TWO_ROUND} streaming={false} activeBlockCount={0}/>);
    // No active label, no open body, no open group — fully collapsed.
    expect(html.match(/Thinking…/g)).toBeNull();
    expect(html.match(/data-testid="thinking-body"/g)).toBeNull();
    expect(html).not.toContain('open=""');
    expect(html.match(/data-testid="thinking-card"/g)).toHaveLength(2);
  });
  it('keeps a lone streaming round collapsed by default (no auto-open)',()=>{
    const html=renderToStaticMarkup(<MessageBlocks content={[{type:'thinking',thinking:'only round'}]} streaming activeBlockCount={1}/>);
    expect(html.match(/Thinking…/g)).toHaveLength(1);
    expect(html).toContain('animate-pulse');
    expect(html.match(/data-testid="thinking-body"/g)).toBeNull();
    expect(html).not.toContain('open=""');
  });
});
