// Settings presentation follows c/frontend/src/pages/SettingsPage.tsx: an h1 page
// header, icon-titled sections separated by borders, draft-based key fields with
// Save/Clear, checkbox rows with description paragraphs, and progressive
// disclosure (the ElevenLabs key appears only when Scribe is selected). All
// values stay browser-local (localStorage); the kernel section only reads state.
import { Info, KeyRound, Mic, Monitor, Moon, Palette, SlidersHorizontal, Sun, Type } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useKernelState } from '../kernel/context';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { DEFAULT_PROFILE, keyStorageName } from '../agent/transport';
import { READER_SIZES, READER_SIZE_LABELS, setReaderSize, useReaderSize } from '../agent/reader-size';
import { looksLikeCurrentElevenLabsApiKey } from '../agent/scribe';
import { getAutoScroll, setAutoScroll } from '../agent/scroll';

function Section({ icon: Icon, title, children }: { icon: typeof Palette; title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-muted-foreground" />{title}</h2>
      {children}
    </section>
  );
}

function KeyField({ label, saved, onSave, onClear, inputTestId, saveTestId, clearTestId, savedError }: {
  label: string; saved: boolean; onSave: (key: string) => void; onClear: () => void; inputTestId?: string; saveTestId?: string; clearTestId?: string; savedError?: string;
}) {
  const [draft, setDraft] = useState('');
  // The password field lives in a real form (Chromium warns otherwise). Enter
  // submits — the guard keeps an empty draft a no-op, matching the disabled
  // Save button, so an empty submit can never delete a stored key.
  const saveDraft = () => { const key = draft.trim(); if (!key) return; onSave(key); setDraft(''); };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{label}{saved ? ' (key saved in this browser)' : ' (none saved)'}</p>
      {savedError && <p role="alert" className="text-xs text-destructive">{savedError}</p>}
      <form className="flex items-center gap-2 flex-wrap" onSubmit={e => { e.preventDefault(); saveDraft(); }}>
        <input
          type="password" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value)}
          data-testid={inputTestId}
          className="flex-1 min-w-40 h-8 px-2 text-sm rounded-md border border-input bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()} data-testid={saveTestId}>Save</Button>
        {saved && <Button type="button" size="sm" variant="ghost" data-testid={clearTestId} onClick={() => { onClear(); setDraft(''); }}>Clear</Button>}
      </form>
    </div>
  );
}

function CheckboxRow({ label, description, checked, onChange, testId }: {
  label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; testId?: string;
}) {
  return (
    <label className="flex items-start gap-2 py-1 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} data-testid={testId} className="mt-0.5 shrink-0" />
      <div>
        <span className="text-sm">{label}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}

const get = (key: string, fallback = '') => localStorage.getItem(key) ?? fallback;
const THEMES = [['light', Sun], ['dark', Moon], ['system', Monitor]] as const;

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const state = useKernelState();
  const readerSize = useReaderSize();
  const storageKey = keyStorageName(DEFAULT_PROFILE.provider);
  const [hasApiKey, setHasApiKey] = useState(() => !!get(storageKey));
  const [elevenKeyState, setElevenKeyState] = useState<'none'|'current'|'unrecognized'>(() => {const key=get('gucos2:elevenlabs-key');return !key?'none':looksLikeCurrentElevenLabsApiKey(key)?'current':'unrecognized'});
  const [stt, setStt] = useState(() => get('gucos2:stt-mode', 'web-speech'));
  const [voiceAutoSubmit, setVoiceAutoSubmit] = useState(() => get('gucos2:voice-auto-submit', 'true') !== 'false');
  const [compress, setCompress] = useState(() => get('gucos2:image-compress', 'true') !== 'false');
  const [imageMax, setImageMax] = useState(() => get('gucos2:image-max', '1048576'));
  const [instructions, setInstructions] = useState(() => get('gucos2:custom-instructions'));
  const [keepAwake, setKeepAwake] = useState(() => get('gucos2:keep-awake', 'false') === 'true');
  const [autoScroll, setAutoScrollState] = useState(getAutoScroll);
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [storagePersistence,setStoragePersistence]=useState(()=>get('gucos2:storage-persisted','pending'));

  const save = (key: string, value: string) => { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); };

  // Remove keys from the retired read-aloud feature; speech-to-text settings stay.
  // INVARIANT: 'gucos2:elevenlabs-key' (Scribe STT) is never touched here —
  // not on mount, not on provider toggle, not on an empty draft. Only the
  // KeyField's explicit labeled Clear removes it (c's KeyField pattern: a plain
  // labeled button, no confirmation — key removal is reversible by re-entry and
  // needs no dialog, unlike destructive thread/file deletion).
  useEffect(() => { localStorage.removeItem('gucos2:elevenlabs-voice'); localStorage.removeItem('gucos2:speak-mode'); }, []);
  useEffect(()=>{const update=(event:Event)=>setStoragePersistence(String((event as CustomEvent).detail));addEventListener('gucos2:storage-persistence',update);return()=>removeEventListener('gucos2:storage-persistence',update)},[]);

  return (
    <div className="flex-1 overflow-y-auto" data-testid="settings-page">
      <div className="mx-auto max-w-xl">
        <h1 className="border-b border-border px-4 py-4 text-lg font-semibold">Settings</h1>

        <Section icon={Palette} title="Appearance">
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map(([value, Icon]) => (
              <Button key={value} variant="outline" onClick={() => setTheme(value)} className={cn('capitalize', theme === value && 'bg-accent ring-1 ring-ring')} data-testid={`theme-${value}`}>
                <Icon />{value}
              </Button>
            ))}
          </div>
          <div className="space-y-2" data-testid="reader-size-section">
            <div className="flex items-center gap-2 text-sm font-medium"><Type className="size-4" />Reader text size</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {READER_SIZES.map(size => (
                <Button key={size} variant="outline" onClick={() => setReaderSize(size)} className={cn(readerSize === size && 'bg-accent ring-1 ring-ring')} data-testid={`reader-size-${size}`}>
                  {READER_SIZE_LABELS[size]}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Scales user messages, assistant Markdown, tables, and code. Defaults to Large, matching cc.</p>
          </div>
        </Section>

        <Section icon={KeyRound} title="AI endpoint">
          <KeyField
            label={`${DEFAULT_PROFILE.label} API key`} saved={hasApiKey}
            inputTestId="deepseek-api-key" saveTestId="save-api-key"
            onSave={key => { localStorage.setItem(storageKey, key); setHasApiKey(true); }}
            onClear={() => { localStorage.removeItem(storageKey); setHasApiKey(false); }}
          />
          <p className="text-xs text-muted-foreground">
            Direct browser transport to {DEFAULT_PROFILE.baseUrl}. Supported: {DEFAULT_PROFILE.models.join(', ')}.
            This secret is never written to Chat JSONL, gucOS files, environment variables, or logs.
          </p>
        </Section>

        <Section icon={Mic} title="Speech input">
          <div className="space-y-1.5" data-testid="stt-mode">
            <p className="text-xs text-muted-foreground">Transcription provider</p>
            <div className="space-y-1">
              {([
                { value: 'web-speech', label: 'Browser Web Speech', desc: 'Uses the browser/OS speech service. No key needed.' },
                { value: 'elevenlabs', label: 'ElevenLabs Scribe', desc: 'Cloud transcription. Requires your own ElevenLabs key.' },
              ] as const).map(option => (
                <label key={option.value} className="flex items-start gap-2 py-1 cursor-pointer">
                  <input
                    type="radio" name="stt-mode" checked={stt === option.value}
                    onChange={() => { setStt(option.value); save('gucos2:stt-mode', option.value); }}
                    data-testid={`stt-mode-${option.value}`} className="mt-0.5 shrink-0"
                  />
                  <div>
                    <span className="text-sm">{option.label}</span>
                    <p className="text-xs text-muted-foreground">{option.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          {stt === 'elevenlabs' && (
            <KeyField
              label="ElevenLabs API key" saved={elevenKeyState !== 'none'}
              inputTestId="elevenlabs-api-key" saveTestId="save-elevenlabs-key" clearTestId="clear-elevenlabs-key"
              savedError={elevenKeyState === 'unrecognized' ? 'This saved value does not match ElevenLabs’ current sk_ secret-key format. An API key ID cannot authenticate requests. Replace it with the secret shown when ElevenLabs creates or rotates a key if transcription fails.' : undefined}
              onSave={key => { localStorage.setItem('gucos2:elevenlabs-key', key); setElevenKeyState(looksLikeCurrentElevenLabsApiKey(key)?'current':'unrecognized'); }}
              onClear={() => { localStorage.removeItem('gucos2:elevenlabs-key'); setElevenKeyState('none'); }}
            />
          )}
          <CheckboxRow
            label="Voice auto-submit" testId="voice-auto-submit-toggle" checked={voiceAutoSubmit}
            description="Send the completed transcription immediately instead of filling the box and waiting. Enabled by default."
            onChange={checked => { setVoiceAutoSubmit(checked); save('gucos2:voice-auto-submit', String(checked)); }}
          />
          <div className="rounded-md border border-amber-400/40 bg-amber-500/5 p-3 text-xs leading-relaxed">
            <strong>Third-party disclosure:</strong> ElevenLabs Scribe sends microphone audio directly from this
            browser to ElevenLabs using <code>xi-api-key</code>. Neither the key nor audio is journaled. Browser
            Web Speech data handling depends on your browser and OS.
          </div>
        </Section>

        <Section icon={SlidersHorizontal} title="Chat behavior">
          <CheckboxRow
            label="Auto-scroll the chat" testId="auto-scroll-toggle" checked={autoScroll}
            description="When on, sending a message pins your question to the top of the view and lets the reply stream in below. Turn off to keep your scroll position. The Latest button in the chat header jumps to the newest message at any time."
            onChange={checked => { setAutoScroll(checked); setAutoScrollState(checked); }}
          />
          <CheckboxRow
            label="Compress attached images" checked={compress}
            description="Resize images to at most 1536 px on the long edge and re-encode before sending."
            onChange={checked => { setCompress(checked); save('gucos2:image-compress', String(checked)); }}
          />
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground" htmlFor="image-max">Maximum provider image bytes (hard cap 5 MiB)</label>
            <input
              id="image-max" type="number" min="65536" max="5242880" step="65536" value={imageMax}
              onChange={e => { setImageMax(e.target.value); save('gucos2:image-max', e.target.value); }}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <CheckboxRow
            label="Keep screen awake during a turn" checked={keepAwake}
            description="Hold a screen wake lock while the agent runs so long turns are not interrupted by display sleep."
            onChange={checked => { setKeepAwake(checked); save('gucos2:keep-awake', String(checked)); }}
          />
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground" htmlFor="custom-instructions">Custom agent instructions (browser-local)</label>
            <textarea
              id="custom-instructions" rows={4} value={instructions}
              onChange={e => { setInstructions(e.target.value); setInstructionsSaved(false); }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <div className="flex items-center justify-end gap-2">
              {instructionsSaved && <span className="text-xs text-muted-foreground">Saved.</span>}
              <Button size="sm" variant="outline" onClick={() => { save('gucos2:custom-instructions', instructions); setInstructionsSaved(true); }}>Save instructions</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Drafts, saved prompts, reader size, and these preferences stay in this browser. Message content and
            image data are durable only when sent and then live in the local JSONL journal.
          </p>
        </Section>

        <Section icon={Info} title="System">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Kernel</dt><dd>{state.status}</dd>
            {state.status === 'ready' && (
              <>
                <dt className="text-muted-foreground">Image version</dt><dd className="break-all font-mono text-xs">{state.imageVersion ?? 'unknown'}</dd>
                <dt className="text-muted-foreground">Mount</dt><dd>{state.mode}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Persistent storage</dt><dd data-testid="storage-persistence">{storagePersistence==='true'?'granted':storagePersistence==='false'?'refused by browser':storagePersistence==='error'?'request failed':'requesting…'}</dd>
          </dl>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            Files, terminals, compilers, packages, processes, graphical surfaces, Chat journals, and agent tools
            are owned by this browser and gucOS. The host backend provides only health and local static serving.
          </div>
        </Section>

        <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">ui build {__BUILD_NUMBER__}</div>
        <div className="h-8 safe-bottom" />
      </div>
    </div>
  );
}
