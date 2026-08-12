import type {ImageAttachment} from './session';

export const PROVIDER_IMAGE_TYPES=new Set(['image/jpeg','image/png','image/gif','image/webp']);
export const PROVIDER_IMAGE_MAX_BYTES=5*1024*1024;
export async function imageFile(file:File,compress:boolean,maxBytes:number):Promise<ImageAttachment>{
 if(!PROVIDER_IMAGE_TYPES.has(file.type))throw new Error(`${file.name} uses unsupported image type ${file.type||'(missing)'}; choose JPEG, PNG, GIF, or WebP`);
 let blob:Blob=file;
 if(compress){const bitmap=await createImageBitmap(file),scale=Math.min(1,1536/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Image compression failed')),'image/jpeg',.84))}
 const cap=Math.min(PROVIDER_IMAGE_MAX_BYTES,Math.max(1,maxBytes));if(blob.size>cap)throw new Error(`${file.name} exceeds ${(cap/1048576).toFixed(1)} MB after compression`);
 const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.readAsDataURL(blob)});
 if(!PROVIDER_IMAGE_TYPES.has(blob.type))throw new Error(`Image conversion produced unsupported type ${blob.type}`);
 return{mediaType:blob.type,data,name:file.name}
}
