import {describe,expect,it} from 'vitest';
import {isFenceClosed} from './fenced-block';

describe('streaming fenced blocks',()=>{
 it('keeps incomplete backtick and tilde code nodes literal until closed',()=>{expect(isFenceClosed('```ts\nconst x = 1')).toBe(false);expect(isFenceClosed('```ts\nconst x = 1\n```')).toBe(true);expect(isFenceClosed('~~~bash\necho ok')).toBe(false);expect(isFenceClosed('~~~bash\necho ok\n~~~~')).toBe(true)});
 it('does not mistake inline code or an indented fence for a block fence',()=>{expect(isFenceClosed('Use `x` here')).toBe(true);expect(isFenceClosed('    ```\nnot a fence')).toBe(true)});
});
