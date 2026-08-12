import {describe,expect,it} from 'vitest';
import {imageFile,PROVIDER_IMAGE_MAX_BYTES,PROVIDER_IMAGE_TYPES} from './images';

describe('provider image policy',()=>{
 it('accepts only provider-supported raster MIME types and rejects SVG before decoding',async()=>{expect([...PROVIDER_IMAGE_TYPES]).toEqual(['image/jpeg','image/png','image/gif','image/webp']);await expect(imageFile(new File(['<svg/>'],'x.svg',{type:'image/svg+xml'}),false,1024)).rejects.toThrow('unsupported image type')});
 it('pins a five MiB hard provider cap',()=>expect(PROVIDER_IMAGE_MAX_BYTES).toBe(5*1024*1024));
});
