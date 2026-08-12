import {afterEach,describe,expect,it,vi} from 'vitest';
import {disposeRecognition,disposeRecording} from './voice-lifecycle';

describe('voice lifecycle cleanup',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('stops recognition and removes callbacks before unmount',()=>{const handle={stop:vi.fn(),onresult:vi.fn(),onerror:vi.fn(),onend:vi.fn()};disposeRecognition(handle);expect(handle.stop).toHaveBeenCalledOnce();expect(handle.onresult).toBeUndefined();expect(handle.onerror).toBeUndefined();expect(handle.onend).toBeUndefined()});
 it('aborts transcription, detaches recorder callbacks, stops recording and every mic track',()=>{const abort=new AbortController(),tracks=[{stop:vi.fn()},{stop:vi.fn()}],media={state:'recording',stop:vi.fn(),ondataavailable:vi.fn() as unknown,onstop:vi.fn() as unknown};disposeRecording({media,stream:{getTracks:()=>tracks},abort});expect(abort.signal.aborted).toBe(true);expect(media.ondataavailable).toBeNull();expect(media.onstop).toBeNull();expect(media.stop).toHaveBeenCalledOnce();expect(tracks.every(track=>track.stop.mock.calls.length===1)).toBe(true)});
});
