// Real minimal-image gucman/libpng acceptance against the assembled repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url)), APP=path.resolve(HERE,'..');
const GUC=path.join(APP,'guc'), DIST=path.join(APP,'frontend','dist');
let failures=0;const check=(n,c,d='')=>c?console.log('  ok  '+n):(failures++,console.error('  FAIL '+n+(d?' — '+d:'')));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gucos2-packages-'));
const servers=[];
let serveSeq=0;
async function serve(packagesDir){
  const root=path.join(tmp,'serve-'+(++serveSeq));
  fs.mkdirSync(path.join(root,'dist'),{recursive:true});
  fs.cpSync(packagesDir,path.join(root,'dist','packages'),{recursive:true});
  const child=spawn(process.execPath,[path.join(GUC,'serve.js'),root,'0'],{stdio:['ignore','pipe','pipe']});servers.push(child);
  let buf='';return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('package server timeout: '+buf)),10000);child.stdout.on('data',d=>{buf+=d;const m=/http:\/\/localhost:(\d+)/.exec(buf);if(m){clearTimeout(timer);resolve(Number(m[1]));}});child.stderr.on('data',d=>buf+=d);child.on('exit',c=>reject(new Error('package server exited '+c+': '+buf)));});
}
function boot(image,port,lines){return spawnSync(process.execPath,[path.join(GUC,'os','boot.js'),`--image=${image}`,`--manifest=${path.join(APP,'build','cli-image.json')}`,`--fixture=${path.join(DIST,'os','os-system.img')}`,'--stale-ok','--packages=none','--no-default-packages','--wait-lock=1800'],{cwd:GUC,input:['mkdir -p /etc/gucman',`echo http://127.0.0.1:${port}/packages > /etc/gucman/repos`,...lines,'exit',''].join('\n'),encoding:'utf8',maxBuffer:64<<20,timeout:40*60*1000});}
const program=[
  "cat > /root/pngrt.c << 'EOF'",'#include <SDL3/SDL.h>','#include <SDL3_image/SDL_image.h>','#include <png.h>','#include <stdio.h>','#include <stdlib.h>','#include <string.h>',
  'int main(void){int W=6,H=4;unsigned char *b=malloc(W*H*4);for(int i=0;i<W*H;i++){b[i*4]=i*10;b[i*4+1]=i*6;b[i*4+2]=i*3;b[i*4+3]=255;}png_image w;memset(&w,0,sizeof w);w.version=PNG_IMAGE_VERSION;w.width=W;w.height=H;w.format=PNG_FORMAT_RGBA;if(!png_image_write_to_file(&w,"/root/t.png",0,b,0,NULL))return 2;SDL_Surface*s=IMG_Load("/root/t.png");if(!s)return 3;unsigned char*p=s->pixels;printf("PNGRT %dx%d %d,%d,%d OWNED=%d\\n",s->w,s->h,p[20],p[21],p[22],!!(s->flags&IMG_SURFACE_OWNED));SDL_DestroySurface(s);free(b);return 0;}','EOF'
];
try{
  function variant(name,mutate){const dir=path.join(tmp,name);fs.cpSync(path.join(DIST,'packages'),dir,{recursive:true});const p=path.join(dir,'index.json'),idx=JSON.parse(fs.readFileSync(p,'utf8'));mutate(idx,dir);fs.writeFileSync(p,JSON.stringify(idx,null,2)+'\n');return dir;}
  const depRepo=variant('dependency-packages',idx=>{idx.packages.libpng.deps=['lua'];});
  const cycleRepo=variant('cycle-packages',idx=>{idx.packages.libpng.deps=['lua'];idx.packages.lua.deps=['libpng'];});
  const minBaseRepo=variant('minbase-packages',idx=>{idx.packages.libpng.minBase=idx.baseVersion+1;});
  const port=await serve(depRepo);
  const declared=JSON.parse(fs.readFileSync(path.join(APP,'package-repository-set.json'),'utf8'));
  const image=path.join(tmp,'ok.img');
  const r=boot(image,port,['echo ==catalog','gucman list --all','echo ==info','gucman info libpng','echo ==install','gucman install libpng; echo INSTALL=$?','test -f /var/lib/gucman/lua.json && echo DEPENDENCY-OK','test -f /usr/local/include/png.h && test -f /usr/local/include/zlib.h && echo HEADERS-OK','test -f /usr/local/src/png/png.c && test -f /usr/local/src/z/inflate.c && echo SOURCES-OK','test -f /opt/libpng/licenses/LICENSE.libpng && test -f /opt/libpng/licenses/LICENSE.zlib && echo LICENSES-OK','echo ==installedinfo','gucman info libpng','echo ==compile',...program,'cd /root && cc pngrt.c -o pngrt && ./pngrt; echo RUN=$?','gucman remove libpng; echo REMOVE=$?','removed=1; for p in /opt/libpng /opt/libpng/licenses/LICENSE.libpng /opt/libpng/licenses/LICENSE.zlib /usr/local/src/png /usr/local/src/z /usr/local/include/png.h /usr/local/include/pngconf.h /usr/local/include/pnglibconf.h /usr/local/include/zlib.h /usr/local/include/zconf.h; do { test ! -e "$p" && test ! -L "$p"; } || removed=0; done; test "$removed" = 1 && echo REMOVED-OK','gucman install libpng; echo REINSTALL=$?']);
  const out=String(r.stdout||'')+'\n'+String(r.stderr||'');
  const catalog=(out.split('==catalog\n')[1]||'').split('==info')[0];
  const info=(out.split('==info\n')[1]||'').split('==install')[0];
  const installedInfo=(out.split('==installedinfo\n')[1]||'').split('==compile')[0];
  check('minimal package boot exits cleanly',r.status===0,`status=${r.status}`);
  for(const name of [...declared.publishedDefinitions,...declared.publishedSourceCompanions])check(`catalog contains ${name}`,new RegExp(`(^|\\s)${name}(\\s|$)`,'m').test(catalog));
  check('libpng catalog info reports coherent version',info.includes('libpng')&&info.includes('1.6.58'),info);
  check('installed libpng info reports both source namespaces',installedInfo.includes('source namespaces:')&&installedInfo.includes('/usr/local/src/png')&&installedInfo.includes('/usr/local/src/z'),installedInfo);
  check('libpng dependency installs depth-first',out.includes('INSTALL=0')&&out.includes('DEPENDENCY-OK')&&out.indexOf('installed lua')<out.indexOf('installed libpng'));
  check('libpng installs and plants headers/source namespaces/licenses',out.includes('HEADERS-OK')&&out.includes('SOURCES-OK')&&out.includes('LICENSES-OK'));
  check('PNG write and SDL_image decode fixture compiles/runs',out.includes('PNGRT 6x4 50,30,15 OWNED=1')&&out.includes('RUN=0'));
  check('libpng remove and reinstall succeed',out.includes('REMOVE=0')&&out.includes('REMOVED-OK')&&out.includes('REINSTALL=0'));

  const corrupt=path.join(tmp,'corrupt-packages');fs.cpSync(path.join(DIST,'packages'),corrupt,{recursive:true});
  const idx=JSON.parse(fs.readFileSync(path.join(corrupt,'index.json'),'utf8')), payload=path.join(corrupt,idx.packages.libpng.payload.url);
  const bytes=fs.readFileSync(payload);bytes[Math.floor(bytes.length/2)]^=0xff;fs.writeFileSync(payload,bytes);
  const badPort=await serve(corrupt),cyclePort=await serve(cycleRepo),minBasePort=await serve(minBaseRepo),bad=boot(path.join(tmp,'bad.img'),badPort,['gucman install libpng; echo BADRC=$?','test ! -e /opt/libpng && test ! -e /var/lib/gucman/libpng.json && echo CORRUPT-CLEAN',`echo http://127.0.0.1:${cyclePort}/packages > /etc/gucman/repos`,'gucman install libpng; echo CYCLERC=$?','test ! -e /opt/libpng && test ! -e /opt/lua && echo CYCLE-CLEAN',`echo http://127.0.0.1:${minBasePort}/packages > /etc/gucman/repos`,'gucman install libpng; echo MINBASERC=$?','test ! -e /opt/libpng && echo MINBASE-CLEAN']);
  const badOut=String(bad.stdout||'')+'\n'+String(bad.stderr||'');
  check('corrupt libpng payload is refused without partial install',/BADRC=[1-9]/.test(badOut)&&badOut.includes('CORRUPT-CLEAN')&&/sha256 mismatch/i.test(badOut),badOut.slice(-1200));
  check('dependency cycle is refused without partial installs',/CYCLERC=[1-9]/.test(badOut)&&badOut.includes('CYCLE-CLEAN')&&/cycle/i.test(badOut),badOut.slice(-1200));
  check('future minBase is refused without partial install',/MINBASERC=[1-9]/.test(badOut)&&badOut.includes('MINBASE-CLEAN')&&/base|version/i.test(badOut),badOut.slice(-1200));
}finally{for(const s of servers)try{s.kill();}catch{}fs.rmSync(tmp,{recursive:true,force:true});}
if(failures)process.exit(1);console.log('test_packages: all checks passed');
