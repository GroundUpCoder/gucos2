// Chat scroll model — exact cc/c parity (c/frontend/src/pages/ChatPage.tsx,
// cc/frontend/src/components/ChatSheet.tsx): sending a message pins the
// question to the top of the transcript and the reply streams in below.
// Nothing follows the stream and nothing re-scrolls until the next genuine
// send; a user who scrolled away keeps their position. The transcript ends in
// a viewport-sized spacer so the last question can actually reach the top.
//
// "New" is decided by a per-thread tracker, not by an index diff: the first
// observation of a thread's message list PRIMES the tracker without pinning,
// so a replayed transcript (initial load, reload, thread switch, remount
// mid-turn) never scrolls — only a user message appended after the thread's
// baseline pins, and only once.

export const AUTO_SCROLL_KEY = 'gucos2:auto-scroll';

/** Sticky browser-local preference (c's gucos2-c:auto-scroll). Default on. */
export function resolveAutoScroll(stored: string | null): boolean {
  return stored !== 'off';
}
export function getAutoScroll(): boolean {
  return resolveAutoScroll(localStorage.getItem(AUTO_SCROLL_KEY));
}
export function setAutoScroll(on: boolean): void {
  localStorage.setItem(AUTO_SCROLL_KEY, on ? 'on' : 'off');
}

export type ScrollMessage = { role: string; id?: string; streamId?: string; createdAt?: string };

/** Index of the latest authored user message, -1 when there is none. Runs on
 *  the coalesced presentation list, so tool-result rounds never count — the
 *  same "latest user message" cc/c compute over their folded turns. */
export function latestUserIndex(messages: { role: string }[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i;
  return -1;
}

/** Stable identity of a presentation message. A live assistant turn carries one
 *  `id` (the turnId) stamped on every provider round and preserved through
 *  coalescing, so the article's identity is invariant across round-1 streaming
 *  → round-1 finalize → round-2 streaming → round-2 finalize — no remount, no
 *  flicker. `streamId` is the per-round update handle (used to mutate one round
 *  in flight) and MUST NOT be the React key, or the article remounts on every
 *  round boundary. A journaled/replayed message has no live id and falls back to
 *  its durable record timestamp; position is the last resort. Rendered onto the
 *  article as data-message-key so a scheduled pin can verify it still targets
 *  the same message when the frame fires. */
export function messageKey(message: { id?: string; streamId?: string; createdAt?: string }, index: number): string {
  return message.id ?? message.streamId ?? message.createdAt ?? `index:${index}`;
}

export type PinTarget = { index: number; key: string };

/** Per-thread pin memory. `primed`/`primedThread` record which thread's
 *  baseline has been observed; `pinnedKey` is the identity of the latest user
 *  message that is already accounted for (pinned or historical). */
export type PinTracker = { primed: boolean; primedThread: string | null; pinnedKey: string | null };

export function newPinTracker(): PinTracker {
  return { primed: false, primedThread: null, pinnedKey: null };
}

/** Advance the tracker against the current presentation list and return the
 *  pin target when a NEW authored user message appeared, else null.
 *
 *  The first observation of any thread primes without pinning. This relies on
 *  how the session commits state: opening a thread commits the thread AND its
 *  replayed messages in one render (baseline = the replay), while sending on a
 *  fresh thread commits the new thread one render BEFORE the user message
 *  lands (baseline = empty), so the send still pins exactly once. Identity,
 *  not index, is compared: assistant chunks, tool rounds, thinking, images,
 *  and Markdown reflow keep the latest user message's key, so they never
 *  re-pin even when coalescing shifts positions. */
export function trackLatestUserMessage(tracker: PinTracker, threadId: string | null, messages: ScrollMessage[]): PinTarget | null {
  const idx = latestUserIndex(messages);
  const key = idx === -1 ? null : messageKey(messages[idx], idx);
  if (!tracker.primed || tracker.primedThread !== threadId) {
    tracker.primed = true;
    tracker.primedThread = threadId;
    tracker.pinnedKey = key;
    return null;
  }
  if (key === null || key === tracker.pinnedKey) return null;
  tracker.pinnedKey = key;
  return { index: idx, key };
}

/** Pin message-<index> to the top of the scroll container on the next frame
 *  (the rAF matches cc/c so the scroll lands after the new message's frame is
 *  laid out). cc/c always use 'smooth'; os additionally honors the
 *  reduced-motion preference (a strict superset — default behavior is
 *  identical). The caller deliberately does not cancel this frame merely
 *  because an assistant chunk changed the message list: a fast first chunk can
 *  otherwise win the race and suppress the turn's only pin. The frame verifies
 *  the target's identity, so a stale frame after navigation or a thread switch
 *  finds no matching element and does nothing. */
export function pinMessageToTop(target: PinTarget): () => void {
  const frame = requestAnimationFrame(() => {
    const el = document.getElementById(`message-${target.index}`);
    if (!(el instanceof HTMLElement) || el.dataset.messageKey !== target.key) return;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
  return () => cancelAnimationFrame(frame);
}
