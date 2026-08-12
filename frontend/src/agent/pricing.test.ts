import {describe,expect,it} from 'vitest';
import {estimateCostUsd,formatCost} from './pricing';
describe('DeepSeek metadata pricing',()=>{it('prices miss, cache-read, cache-creation and output tokens without hiding tiny costs',()=>{expect(estimateCostUsd('deepseek-v4-flash',{input_tokens:1_000_000,cache_read_input_tokens:1_000_000,cache_creation_input_tokens:1_000_000,output_tokens:1_000_000})).toBeCloseTo(.5628);expect(formatCost(.00001)).toBe('<$0.0001');expect(estimateCostUsd('unknown',{input_tokens:1})).toBeNull()})});
