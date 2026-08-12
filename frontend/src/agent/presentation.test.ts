import {describe,expect,it} from 'vitest';
import {coalescePresentationMessages} from './presentation';
describe('turn presentation',()=>{it('folds every provider round and durable result into one assistant turn without crossing authored text',()=>{const got=coalescePresentationMessages([{role:'user',content:'go'},{role:'assistant',content:[{type:'thinking'},{type:'tool_use'}],usage:{input_tokens:10,output_tokens:2},durationMs:3,round:1,toolCount:1},{role:'user',content:[{type:'tool_result'}]},{role:'assistant',content:[{type:'thinking'},{type:'tool_use'}],usage:{input_tokens:12,output_tokens:4},durationMs:5,round:2,toolCount:1},{role:'user',content:[{type:'tool_result'}]},{role:'assistant',content:[{type:'text',text:'done'}],usage:{input_tokens:14,output_tokens:6},durationMs:7,round:3,toolCount:0}]);expect(got).toHaveLength(2);expect(got[1]).toMatchObject({role:'assistant',usage:{input_tokens:36,output_tokens:12},durationMs:15,round:3,toolCount:2});expect(got[1].content).toHaveLength(7)});
it('keeps one stable turn id across round-1 finalize and round-2 streaming, and marks only the streaming round active',()=>{
  const turnId='turn-1';
  const got=coalescePresentationMessages([{role:'user',content:'go'},{role:'assistant',content:[{type:'thinking',thinking:'r1'},{type:'tool_use',id:'a',name:'Bash',input:{}}],streaming:false,id:turnId,streamId:'s-1',round:1,usage:{input_tokens:1,output_tokens:1},durationMs:1,toolCount:1},{role:'user',content:[{type:'tool_result'}]},{role:'assistant',content:[{type:'thinking',thinking:'r2'},{type:'text',text:'final'}],streaming:true,id:turnId,streamId:'s-2',round:2,usage:{input_tokens:2,output_tokens:2},durationMs:2,toolCount:0}]);
  expect(got).toHaveLength(2);
  // Same identity across s-1 (finalize) -> s-2 (streaming): no remount.
  expect(got[1].id).toBe(turnId);
  expect(got[1].streamId).toBe('s-2');
  expect(got[1].streaming).toBe(true);
  // Round 2 contributed two trailing blocks; only those are active.
  expect(got[1].activeBlockCount).toBe(2);
  // content = [r1 thinking, r1 tool_use, r1 tool_result, r2 thinking, r2 text]
  expect(got[1].content).toHaveLength(5);
});
it('marks the only round active while it streams alone (push branch counts active blocks)',()=>{
  const turnId='turn-1';
  const got=coalescePresentationMessages([{role:'user',content:'go'},{role:'assistant',content:[{type:'thinking',thinking:'r1'}],streaming:true,id:turnId,streamId:'s-1',round:1,usage:{input_tokens:1,output_tokens:1},durationMs:1,toolCount:0}]);
  expect(got[1].streaming).toBe(true);
  expect(got[1].activeBlockCount).toBe(1);
});
it('clears activeBlockCount once the turn is fully finalized (no round streaming)',()=>{
  const turnId='turn-1';
  const got=coalescePresentationMessages([{role:'user',content:'go'},{role:'assistant',content:[{type:'thinking',thinking:'r1'}],streaming:false,id:turnId,streamId:'s-1',round:1,usage:{input_tokens:1,output_tokens:1},durationMs:1,toolCount:0},{role:'user',content:[{type:'tool_result'}]},{role:'assistant',content:[{type:'text',text:'done'}],streaming:false,id:turnId,streamId:'s-2',round:2,usage:{input_tokens:2,output_tokens:2},durationMs:2,toolCount:0}]);
  expect(got[1].streaming).toBe(false);
  expect(got[1].activeBlockCount).toBe(0);
  expect(got[1].id).toBe(turnId);
})});
