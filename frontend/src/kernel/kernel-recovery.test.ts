import {describe,expect,it,vi} from 'vitest';
import {resetKernelStorage,SYSTEM_IMAGE_ENTRIES,WRITABLE_ROOT_ENTRIES} from './kernel-recovery';

describe('kernel storage recovery',()=>{
 it('repairs only regenerable system images and gucOS caches',async()=>{const removed:string[]=[],deleted:string[]=[];await expect(resetKernelStorage('system',{removeEntry:async name=>{removed.push(name)}},{keys:async()=>['gucos-old','unrelated'],delete:async name=>(deleted.push(name),true)})).resolves.toEqual([...SYSTEM_IMAGE_ENTRIES]);expect(removed).toEqual([...SYSTEM_IMAGE_ENTRIES]);expect(deleted).toEqual(['gucos-old']);});
 it('factory reset also removes every writable gucOS root',async()=>{const removed:string[]=[];await resetKernelStorage('factory',{removeEntry:async name=>{removed.push(name)}},{keys:async()=>[],delete:vi.fn()});expect(removed).toEqual([...SYSTEM_IMAGE_ENTRIES,...WRITABLE_ROOT_ENTRIES]);});
 it('ignores absent entries but surfaces persistent deletion failures',async()=>{await expect(resetKernelStorage('system',{removeEntry:async()=>{throw new DOMException('gone','NotFoundError')}},{keys:async()=>[],delete:vi.fn()})).resolves.toBeTruthy();vi.useFakeTimers();const failed=expect(resetKernelStorage('system',{removeEntry:async()=>{throw new DOMException('busy','InvalidStateError')}},{keys:async()=>[],delete:vi.fn()})).rejects.toThrow('Could not remove os-system.v4.img');await vi.runAllTimersAsync();await failed;vi.useRealTimers();});
});
