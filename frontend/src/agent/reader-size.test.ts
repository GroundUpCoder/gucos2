import {describe,expect,it} from 'vitest';
import {resolveReaderSize} from './reader-size';
describe('reader size',()=>{it('matches cc with a large default and four validated sizes',()=>{expect(resolveReaderSize(null)).toBe('large');expect(['small','medium','large','xlarge'].map(resolveReaderSize)).toEqual(['small','medium','large','xlarge']);expect(resolveReaderSize('normal')).toBe('large')})});
