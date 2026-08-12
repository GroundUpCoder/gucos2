import {describe,expect,it} from 'vitest';
import {latestUserIndex,messageKey,newPinTracker,resolveAutoScroll,trackLatestUserMessage} from './scroll';

const user=(createdAt:string)=>({role:'user',createdAt});
const assistant=(createdAt:string)=>({role:'assistant',createdAt});
const streaming=(streamId:string)=>({role:'assistant',streamId});

describe('chat scroll model (cc/c parity)',()=>{
  it('defaults the auto-scroll preference on and only honors an explicit off',()=>{
    expect(resolveAutoScroll(null)).toBe(true);
    expect(resolveAutoScroll('on')).toBe(true);
    expect(resolveAutoScroll('off')).toBe(false);
    expect(resolveAutoScroll('')).toBe(true);
  });
  it('finds the latest authored user message',()=>{
    expect(latestUserIndex([])).toBe(-1);
    expect(latestUserIndex([{role:'assistant'}])).toBe(-1);
    expect(latestUserIndex([{role:'user'}])).toBe(0);
    // Trailing assistant rounds (text + folded tool results) never count: the
    // pin target stays the question that started the turn.
    expect(latestUserIndex([{role:'user'},{role:'assistant'},{role:'assistant'}])).toBe(0);
    expect(latestUserIndex([{role:'user'},{role:'assistant'},{role:'user'},{role:'assistant'}])).toBe(2);
  });
  it('gives messages a stable identity',()=>{
    expect(messageKey({streamId:'s-1'},0)).toBe('s-1');
    expect(messageKey({createdAt:'2026-08-11T00:00:00Z'},3)).toBe('2026-08-11T00:00:00Z');
    expect(messageKey({},2)).toBe('index:2');
  });
  it('prefers the stable turn id over the per-round streamId and timestamp so one logical turn keeps one key across rounds',()=>{
    // The flicker root cause: round-1 streaming carried streamId 's-1', round-2
    // streaming carried 's-2', and finalize swapped in a record timestamp —
    // three keys, three remounts. A single turnId stamped on every round makes
    // all three resolve to the same key, so the article never remounts.
    const turnId='turn-1';
    expect(messageKey({id:turnId,streamId:'s-1'},0)).toBe(turnId);
    expect(messageKey({id:turnId,streamId:'s-2'},0)).toBe(turnId);
    expect(messageKey({id:turnId,createdAt:'2026-08-11T00:00:00Z'},0)).toBe(turnId);
    // A replayed message has no live id: it falls back to its durable timestamp.
    expect(messageKey({createdAt:'2026-08-11T00:00:00Z'},0)).toBe('2026-08-11T00:00:00Z');
  });
});

describe('pin tracker',()=>{
  it('never pins a populated thread on first observation (initial load / reload / remount)',()=>{
    const tracker=newPinTracker();
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')])).toBeNull();
    // Re-running over the same replayed list (streaming re-renders, effect
    // re-fires) keeps returning null.
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')])).toBeNull();
  });
  it('never pins on a populated thread switch',()=>{
    const tracker=newPinTracker();
    trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')]);
    expect(trackLatestUserMessage(tracker,'thread-b',[user('t3'),assistant('t4'),user('t5'),assistant('t6')])).toBeNull();
    // Switching back re-primes against that thread too.
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')])).toBeNull();
  });
  it('pins exactly once when a send appends a user message to an open thread',()=>{
    const tracker=newPinTracker();
    expect(trackLatestUserMessage(tracker,'thread-a',[])).toBeNull();
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1')])).toEqual({index:0,key:'t1'});
    // Assistant chunks, the completed-round replacement, folded tool-result
    // rounds, and repeated effect runs never pin again.
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),streaming('s-1')])).toBeNull();
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')])).toBeNull();
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')])).toBeNull();
  });
  it('still pins the first send on a thread created mid-send',()=>{
    // send() commits the new thread one render before the user message lands:
    // the tracker primes against the still-empty list, then the append pins.
    const tracker=newPinTracker();
    expect(trackLatestUserMessage(tracker,null,[])).toBeNull();
    expect(trackLatestUserMessage(tracker,'thread-new',[])).toBeNull();
    expect(trackLatestUserMessage(tracker,'thread-new',[user('t1')])).toEqual({index:0,key:'t1'});
  });
  it('pins each genuine new send, not just the first',()=>{
    const tracker=newPinTracker();
    trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')]);
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2'),user('t3')])).toEqual({index:2,key:'t3'});
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2'),user('t3'),assistant('t4')])).toBeNull();
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2'),user('t3'),assistant('t4'),user('t5'),assistant('t6'),user('t7')])).toEqual({index:6,key:'t7'});
  });
  it('compares identity, not position: same latest message at a shifted index does not re-pin',()=>{
    const tracker=newPinTracker();
    trackLatestUserMessage(tracker,'thread-a',[user('t1')]);
    // Coalescing folds the tool-result user record into the assistant
    // presentation; the latest authored user message keeps its key at whatever
    // index it lands.
    expect(trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')])).toBeNull();
  });
  it('treats a replaced message list with the same history as unchanged',()=>{
    const tracker=newPinTracker();
    trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')]);
    // A re-render over freshly mapped (new object identities, same keys) list.
    expect(trackLatestUserMessage(tracker,'thread-a',[{...user('t1')},{...assistant('t2')}])).toBeNull();
  });
  it('clears the baseline with the thread (new thread starts unprimed)',()=>{
    const tracker=newPinTracker();
    trackLatestUserMessage(tracker,'thread-a',[user('t1'),assistant('t2')]);
    expect(trackLatestUserMessage(tracker,null,[])).toBeNull();
    expect(trackLatestUserMessage(tracker,'thread-b',[])).toBeNull();
    expect(trackLatestUserMessage(tracker,'thread-b',[user('t3')])).toEqual({index:0,key:'t3'});
  });
});
