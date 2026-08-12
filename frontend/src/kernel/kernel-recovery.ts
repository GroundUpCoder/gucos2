export type RecoveryScope = 'system'|'factory';

export const SYSTEM_IMAGE_ENTRIES = ['os-system.v4.img','os-system.v5.img'] as const;
export const WRITABLE_ROOT_ENTRIES = ['os-root.v3.img','os-root.v5.img','os-user.v4.img'] as const;

type RecoveryDirectory = { removeEntry(name:string,options?:{recursive?:boolean}):Promise<void> };
type RecoveryCaches = { keys():Promise<string[]>; delete(name:string):Promise<boolean> };

const pause = (ms:number) => new Promise<void>(resolve=>setTimeout(resolve,ms));

async function removeWithRetry(root:RecoveryDirectory,name:string):Promise<void>{
 for(let attempt=0;attempt<4;attempt++){
  try{await root.removeEntry(name,{recursive:true});return;}
  catch(error){
   if(error instanceof DOMException&&error.name==='NotFoundError')return;
   if(attempt===3)throw new Error(`Could not remove ${name}: ${error instanceof Error?error.message:String(error)}`);
   await pause(75*(attempt+1));
  }
 }
}

export async function resetKernelStorage(scope:RecoveryScope,root?:RecoveryDirectory,cacheStore?:RecoveryCaches):Promise<string[]>{
 const directory=root??await navigator.storage.getDirectory();
 const entries=[...SYSTEM_IMAGE_ENTRIES,...(scope==='factory'?WRITABLE_ROOT_ENTRIES:[])];
 for(const name of entries)await removeWithRetry(directory,name);
 const storage=cacheStore??(typeof caches==='undefined'?undefined:caches);
 if(storage)for(const name of await storage.keys())if(name.startsWith('gucos-'))await storage.delete(name);
 return entries;
}
