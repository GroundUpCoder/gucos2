// Dialog and RowMenu are Radix Dialog/AlertDialog/DropdownMenu compositions
// (the c/cc shadcn precedent). Their content renders through a Portal, which
// produces no SSR markup — so content, focus-trap, keyboard-navigation, and
// focus-return assertions live in the real-browser acceptance tests
// (tests/test_browser.mjs: file delete + terminal rename dialogs and the file
// row menu; tests/test_chat_agent.mjs: thread row menu + delete dialog).
// What SSR can still prove stays here.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dialog } from './Dialog';
import { RowMenu } from './RowMenu';

describe('Dialog', () => {
  it('stays unmounted while closed', () => {
    expect(renderToStaticMarkup(<Dialog open={false} title="Hidden" onCancel={() => {}} onConfirm={() => {}} />)).toBe('');
  });
  it('renders no inline content while open — the portal owns the dialog tree', () => {
    expect(renderToStaticMarkup(<Dialog open title="Delete thread?" destructive onCancel={() => {}} onConfirm={() => {}} />)).toBe('');
  });
});

describe('RowMenu', () => {
  it('renders only the labelled menu trigger while closed', () => {
    const html = renderToStaticMarkup(<RowMenu triggerLabel="More actions for Demo" triggerTestId="menu-demo" items={[{ icon: null, label: 'Rename', ariaLabel: 'Rename Demo', onSelect: () => {} }]} />);
    expect(html).toContain('aria-label="More actions for Demo"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-testid="menu-demo"');
    expect(html).not.toContain('Rename Demo');
  });
});
