import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const APP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(APP,'frontend','package.json'));
const { chromium }=require('playwright-core');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// The backend must derive this checkout from its compiled module location;
// test_backend positively controls the resolved root before this browser leg.
const port=8116, server=spawn(process.execPath,[path.join(APP,'backend/dist/bin/server.js')],{env:{...process.env,GUCOS2_PORT:String(port)},stdio:['ignore','pipe','pipe']});
server.stdout.on('data',b=>process.stdout.write('[server] '+b));server.stderr.on('data',b=>process.stderr.write('[server] '+b));
const sleep=(n)=>new Promise(r=>setTimeout(r,n));
async function waitServer(){for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return}catch{}await sleep(100)}throw new Error('server did not start')}
let browser;
try{
 await waitServer(); browser=await chromium.launch({executablePath:chrome,headless:true});
 const context=await browser.newContext({viewport:{width:375,height:667},isMobile:true,hasTouch:true});
 const page=await context.newPage(); const pageErrors=[]; const formWarnings=[]; page.on('console',m=>{if(/Password field is not contained in a form/.test(m.text()))formWarnings.push(m.text());console.log('[browser]',m.type(),m.text())});page.on('pageerror',e=>{pageErrors.push(String(e));console.error('[pageerror]',e)});await page.goto(`http://127.0.0.1:${port}/term`);
 setTimeout(async()=>{try{console.log('[probe]',await page.evaluate(()=>({state:window.__osState,status:document.querySelector('#status')?.textContent,terminals:window.__terminals.size,tabs:document.querySelectorAll('#tabs button').length,body:document.body.innerText.slice(0,500)})))}catch{}},10000);
 await page.waitForFunction(()=>window.__osState==='ready'&&window.__terminals.size===1,null,{timeout:120000});
 const header=page.locator('#app header');
 if(/gucOS/i.test(await header.innerText()))throw new Error('header still carries the gucOS wordmark');
 const navOrder=await header.locator('nav a').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-testid')));
 if(JSON.stringify(navOrder)!==JSON.stringify(['nav-home','nav-files','nav-chat','nav-term','nav-processes','nav-threads']))throw new Error('nav order/crowding mismatch: '+JSON.stringify(navOrder));
 const headerBox=await header.boundingBox();if(!headerBox||headerBox.width>375)throw new Error('header overflows 375px: '+JSON.stringify(headerBox));
 if(await page.locator('#status').count())throw new Error('steady-state header still renders the kernel status line');
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:`http://127.0.0.1:${port}`});
 const snap=()=>page.evaluate(()=>Array.from(window.__terminals.values()).map(s=>({id:s.id,pid:s.pid,text:Array.from({length:s.term.buffer.active.length},(_,i)=>s.term.buffer.active.getLine(i)?.translateToString(true)||'').join('\n')})));
 async function waitText(id,text){for(let i=0;i<200;i++){let s=(await snap()).find(x=>x.id===id);if(s&&(s.text.includes(text)||s.text.replace(/\n/g,'').includes(text.replace(/\n/g,''))))return;await sleep(50)}throw new Error(`terminal ${id} missing ${text}: ${JSON.stringify((await snap()).find(x=>x.id===id))}`)}
 let a=(await snap())[0]; await page.evaluate(id=>window.__terminalInput(id,'cd /tmp; export TABVAR=one; pwd; echo TAB1\n'),a.id);
 await waitText(a.id,'\n/tmp\nTAB1\n');
 await page.evaluate(id=>window.__terminalInput(id,"printf GUCOSCOPY | pbcopy\n"),a.id);await page.waitForFunction(async()=>await navigator.clipboard.readText()==='GUCOSCOPY');await sleep(400);await page.evaluate(()=>navigator.clipboard.writeText('HOSTPASTE'));await sleep(400);await page.evaluate(id=>window.__terminalInput(id,'pbpaste; echo\n'),a.id);await waitText(a.id,'HOSTPASTE');
 await page.click('#new'); await page.waitForFunction(()=>window.__terminals.size===2); let ss=await snap(),b=ss.find(x=>x.id!==a.id);
 await page.evaluate(id=>window.__terminalInput(id,'pwd; echo ${TABVAR-unset}; echo TAB2\n'),b.id);
 await waitText(b.id,'\n/root\nunset\nTAB2\n');
 const terminalTabs=page.getByRole('tab');if(await terminalTabs.count()!==2)throw new Error('terminal tab roles missing');
 if(await terminalTabs.evaluateAll(tabs=>tabs.filter(tab=>tab.tabIndex===0).length)!==1)throw new Error('terminal tabs do not have exactly one roving tab stop');
 await terminalTabs.filter({hasText:`Shell ${b.id}`}).focus();await page.keyboard.press('ArrowLeft');
 await page.waitForFunction(id=>document.activeElement?.getAttribute('data-terminal-id')===String(id)&&document.activeElement?.getAttribute('aria-selected')==='true',a.id);
 await terminalTabs.filter({hasText:`Shell ${b.id}`}).click();
 await page.evaluate(id=>window.__terminalInput(id,'sleep 30\n'),b.id);await sleep(100);
 await page.locator('#keys button',{hasText:'Ctrl-C'}).click();
 await page.evaluate(id=>window.__terminalInput(id,'echo OSKROUTE\n'),b.id);await waitText(b.id,'\nOSKROUTE\n');
 ss=await snap();a=ss.find(x=>x.id===a.id);b=ss.find(x=>x.id===b.id);
 if(!a.text.includes('/tmp')||!a.text.includes('TAB1')||!b.text.includes('/root')||!b.text.includes('unset'))throw new Error('independent cwd/environment proof failed');
 await page.evaluate(id=>window.__terminalInput(id,'echo persisted > /root/mobile-proof\n'),a.id);await sleep(300);
 const range=await page.evaluate(async()=>Array.from(await window.__kernelReadRange('/root/mobile-proof',2,4)));if(new TextDecoder().decode(new Uint8Array(range))!=='rsis')throw new Error('filesystem ranged read returned wrong bytes');const rangeError=await page.evaluate(async()=>{try{await window.__kernelReadRange('/root/mobile-proof',0,4194305);return ''}catch(e){return e.code+':'+e.message}});if(!rangeError.startsWith('E2BIG:'))throw new Error('filesystem range limit not enforced: '+rangeError);
 await page.evaluate(id=>window.__terminalInput(id,'(sleep 1; echo BGREPLAY) &\n'),a.id);await page.click('[data-testid="nav-files"]');await sleep(1500);await page.click('[data-testid="nav-term"]');await waitText(a.id,'BGREPLAY');
 await page.getByRole('button',{name:`Close Shell ${b.id}`}).click();await page.waitForFunction(()=>window.__terminals.size===1);
 await page.evaluate(({id,pid})=>window.__terminalInput(id,`kill -0 ${pid} 2>/dev/null || echo REAPED\n`),{id:a.id,pid:b.pid});await waitText(a.id,'\nREAPED\n');
 if((await page.locator('#app').boundingBox()).width!==375)throw new Error('375px layout overflow');
 await page.reload();await page.waitForFunction(()=>window.__osState==='ready'&&window.__terminals.size===1,null,{timeout:120000});
 a=(await snap())[0];await page.evaluate(id=>window.__terminalInput(id,'cat /root/mobile-proof\n'),a.id);
 await waitText(a.id,'\npersisted\n');
 await page.click('[data-testid="nav-files"]');
 await page.waitForSelector('[data-testid="files-page"]');
 await page.getByTitle('New file').click();const nameInput=page.getByTestId('name-input');await nameInput.waitFor();await nameInput.press('Escape'); // RowMenu (Radix DropdownMenu): focus enters the menu on open, menuitems are
 // real menuitem roles, arrows/Home/End navigate cyclically, and Escape
 // dismisses with focus returned to the trigger.
 const entryMenu=page.locator('[data-testid="entry-menu-mobile-proof"]');
 await entryMenu.click();
 const menu=page.locator('[role="menu"]');await menu.waitFor();
 if(!await page.evaluate(()=>document.activeElement?.closest('[role="menu"]')!=null))throw new Error('row menu open left focus outside the menu');
 if(JSON.stringify(await page.locator('[role="menuitem"]').allTextContents())!==JSON.stringify(['Rename','Download','Delete']))throw new Error('file row menu items mismatch: '+JSON.stringify(await page.locator('[role="menuitem"]').allTextContents()));
 const activeText=()=>page.evaluate(()=>document.activeElement?.textContent?.trim());
 // Radix swallows a keydown that lands in the same tick as a focus move (probe-
 // verified: press→evaluate loops see Home/End ignored, a ~100ms settle never
 // fails). Human cadence has that gap, so press() settles like a user would.
 const press=async(k)=>{await page.keyboard.press(k);await sleep(120);};
 await press('ArrowDown');if(await activeText()!=='Rename')throw new Error('ArrowDown did not focus the first menuitem');
 await press('End');if(await activeText()!=='Delete')throw new Error('End did not focus the last menuitem');
 await press('ArrowUp');if(await activeText()!=='Download')throw new Error('ArrowUp did not move to the previous menuitem');
 await press('Home');if(await activeText()!=='Rename')throw new Error('Home did not focus the first menuitem');
 // Radix DropdownMenu clamps at the boundaries (no wrap; the primitive exposes
 // no loop — c/cc's shadcn menus behave identically), so ArrowUp at the first
 // item must stay put.
 await press('ArrowUp');if(await activeText()!=='Rename')throw new Error('ArrowUp at the first menuitem did not clamp to it');
 await press('Escape');await menu.waitFor({state:'detached'});
 if(await page.evaluate(()=>document.activeElement?.getAttribute('data-testid'))!=='entry-menu-mobile-proof')throw new Error('menu Escape did not return focus to the trigger');
 // Dialog (Radix AlertDialog): the destructive confirm is focused on open,
 // Tab/Shift+Tab stay trapped inside, and Escape/Cancel return focus to the
 // invoking element without deleting.
 await entryMenu.click();await page.getByRole('menuitem',{name:'Delete'}).click();
 const dialog=page.locator('[data-testid="dialog"]');await dialog.waitFor();
 if(await activeText()!=='Delete')throw new Error('destructive dialog did not focus the confirm button');
 const db=await dialog.boundingBox();if(!db||Math.round(db.y+db.height)!==667)throw new Error('375px c-style bottom-sheet dialog geometry failed');
 await press('Tab');if(await activeText()!=='Cancel')throw new Error('dialog Tab escaped instead of cycling to Cancel');
 await press('Tab');if(await activeText()!=='Delete')throw new Error('dialog Tab did not wrap back to Delete');
 await press('Shift+Tab');if(await activeText()!=='Cancel')throw new Error('dialog Shift+Tab did not wrap to Cancel');
 await press('Escape');await dialog.waitFor({state:'detached'});
 await page.waitForFunction(()=>document.activeElement?.getAttribute('data-testid')==='entry-menu-mobile-proof');
 await entryMenu.click();await page.getByRole('menuitem',{name:'Delete'}).click();await dialog.waitFor();
 await dialog.getByText('Cancel',{exact:true}).click();await dialog.waitFor({state:'detached'});
 // Radix settles overlay focus restores asynchronously when a dialog opened
 // from a menu closes; poll for the final invoker focus instead of reading
 // the transient mid-teardown activeElement.
 await page.waitForFunction(()=>document.activeElement?.getAttribute('data-testid')==='entry-menu-mobile-proof');
 if(await page.getByText('mobile-proof',{exact:true}).count()!==1)throw new Error('a cancelled delete still removed the file');
 await page.locator('input[type=file]').setInputFiles(path.join(APP,'tests/fixtures/egress-smoke.c'));await page.getByText('egress-smoke.c',{exact:true}).waitFor();await page.click('[data-testid="nav-term"]');await page.waitForFunction(()=>window.__terminals.size===1);a=(await snap())[0];await page.evaluate(id=>window.__terminalInput(id,'cc /root/egress-smoke.c -o /root/egress-smoke && /root/egress-smoke\n'),a.id);await page.waitForFunction(()=>window.__lastEgress?.name==='mobile-proof'&&window.__lastEgress.bytes>0,null,{timeout:120000});await page.click('[data-testid="nav-files"]');
 await page.getByText('mobile-proof',{exact:true}).click();
 await page.waitForSelector('.cm-content');
 await page.locator('.cm-content').click();
 await page.keyboard.press('Meta+A'); await page.keyboard.insertText('edited-through-react\n');
 await page.getByText('Save',{exact:true}).click();
 await page.click('[data-testid="nav-term"]');
 await page.waitForFunction(()=>window.__terminals.size===1);
 a=(await snap())[0]; await page.evaluate(id=>window.__terminalInput(id,'cat /root/mobile-proof\n'),a.id);
 await waitText(a.id,'\nedited-through-react\n');
 // --- overwrite guards (data-loss audit): destroying a file by overwrite asks
 // first, exactly like destroying it by delete. The shell session is kernel-side
 // state, so __terminalInput/__kernelStat work from every route.
 const shellId=a.id,guardDialog=page.locator('[data-testid="dialog"]');
 const readAll=(p)=>page.evaluate(async x=>{const st=await window.__kernelStat(x);if(!st)return null;if(!st.size)return '';return new TextDecoder().decode(new Uint8Array(await window.__kernelReadRange(x,0,st.size)))},p);
 await page.evaluate(id=>window.__terminalInput(id,'echo keep > /root/guard-target\n'),shellId);
 await page.waitForFunction(async()=>!!(await window.__kernelStat('/root/guard-target')));
 // 1. create-over-existing asks; Cancel destroys nothing; Replace truncates and opens the editor
 await page.click('[data-testid="nav-files"]');await page.waitForSelector('[data-testid="files-page"]');await page.getByText('guard-target',{exact:true}).waitFor();
 await page.getByTitle('New file').click();await page.getByTestId('name-input').fill('guard-target');await page.getByTestId('name-input').press('Enter');
 await guardDialog.waitFor();if(!(await guardDialog.innerText()).includes('Replace guard-target?'))throw new Error('create-over-existing did not raise the replace dialog');
 await guardDialog.getByText('Cancel',{exact:true}).click();await guardDialog.waitFor({state:'detached'});
 if(await readAll('/root/guard-target')!=='keep\n')throw new Error('a cancelled create replace still clobbered the file');
 await page.getByTitle('New file').click();await page.getByTestId('name-input').fill('guard-target');await page.getByTestId('name-input').press('Enter');await guardDialog.waitFor();
 await guardDialog.getByText('Replace',{exact:true}).click();await page.waitForSelector('.cm-content');
 if(await readAll('/root/guard-target')!=='')throw new Error('confirmed create replace did not truncate the file');
 // 2. editor conflict: an outside write between open and Save asks; Cancel keeps the disk version; Overwrite is explicit
 await page.locator('.cm-content').click();await page.keyboard.insertText('editor-version');
 await page.evaluate(id=>window.__terminalInput(id,'echo terminal-version > /root/guard-target\n'),shellId);
 await page.waitForFunction(async()=>{const st=await window.__kernelStat('/root/guard-target');return !!st&&st.size===17});
 await page.getByText('Save',{exact:true}).click();await guardDialog.waitFor();
 if(!(await guardDialog.innerText()).includes('File changed on disk'))throw new Error('conflicting save did not raise the conflict dialog');
 await guardDialog.getByText('Cancel',{exact:true}).click();await guardDialog.waitFor({state:'detached'});
 if(await readAll('/root/guard-target')!=='terminal-version\n')throw new Error('a cancelled conflicting save still clobbered the outside write');
 await page.getByText('Save',{exact:true}).click();await guardDialog.waitFor();
 await guardDialog.getByText('Overwrite',{exact:true}).click();await guardDialog.waitFor({state:'detached'});
 await page.waitForFunction(async()=>{const st=await window.__kernelStat('/root/guard-target');return !!st&&st.size===14});
 if(await readAll('/root/guard-target')!=='editor-version')throw new Error('confirmed overwrite did not write the editor version');
 // 3. dirty edits guard navigation: Cancel stays in the editor, Discard leaves without writing
 await page.locator('.cm-content').click();await page.keyboard.insertText('-unsaved');
 await page.click('[data-testid="nav-files"]');await guardDialog.waitFor();
 if(!(await guardDialog.innerText()).includes('Discard unsaved changes?'))throw new Error('dirty navigation did not ask');
 await guardDialog.getByText('Cancel',{exact:true}).click();await guardDialog.waitFor({state:'detached'});
 if(!await page.locator('.cm-content').count())throw new Error('a cancelled discard still left the editor');
 await page.click('[data-testid="nav-files"]');await guardDialog.waitFor();
 await guardDialog.getByText('Discard',{exact:true}).click();await page.waitForSelector('[data-testid="files-page"]');
 if(await readAll('/root/guard-target')!=='editor-version')throw new Error('discarded edits leaked to disk');
 // 4. upload-over-existing asks per collision; Cancel preserves, Replace rewrites
 const uploadStatBefore=await page.evaluate(()=>window.__kernelStat('/root/egress-smoke.c'));
 await page.locator('input[type=file]').setInputFiles(path.join(APP,'tests/fixtures/egress-smoke.c'));await guardDialog.waitFor();
 if(!(await guardDialog.innerText()).includes('Replace egress-smoke.c?'))throw new Error('upload over an existing file did not ask');
 await guardDialog.getByText('Cancel',{exact:true}).click();await guardDialog.waitFor({state:'detached'});
 if((await page.evaluate(()=>window.__kernelStat('/root/egress-smoke.c'))).mtimeMs!==uploadStatBefore.mtimeMs)throw new Error('a cancelled upload replace still rewrote the file');
 await page.locator('input[type=file]').setInputFiles(path.join(APP,'tests/fixtures/egress-smoke.c'));await guardDialog.waitFor();
 await guardDialog.getByText('Replace',{exact:true}).click();
 await page.waitForFunction(async b=>(await window.__kernelStat('/root/egress-smoke.c')).mtimeMs>b,uploadStatBefore.mtimeMs);
 await page.evaluate(id=>window.__terminalInput(id,'rm /root/guard-target\n'),shellId);
 await page.waitForFunction(async()=>!(await window.__kernelStat('/root/guard-target')));
 await page.evaluate(id=>window.__terminalInput(id,'sleep 30\n'),a.id); await sleep(100);
 await page.click('[data-testid="nav-processes"]');
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-testid="process-row"]')).some(e=>e.textContent.includes('sleep 30')));
 const sleepRow=page.locator('[data-testid="process-row"]',{hasText:'sleep 30'}); await sleepRow.locator('[data-testid="process-kill"]').click();
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[data-testid="process-row"]')).some(e=>e.textContent.includes('sleep 30')&&e.textContent.includes('running')));
 await page.click('[data-testid="nav-term"]'); await page.waitForFunction(()=>window.__terminals.size===1);
 a=(await snap())[0]; await page.evaluate(id=>window.__terminalInput(id,'echo PROCESSVIEWOK\n'),a.id); await waitText(a.id,'\nPROCESSVIEWOK\n');
 const exitedId=a.id;await page.evaluate(id=>window.__terminalInput(id,'exit\n'),exitedId);await page.waitForFunction(id=>window.__terminals.size===1&&!window.__terminals.has(id),exitedId);a=(await snap())[0];await page.evaluate(id=>window.__terminalInput(id,'echo EXITRECREATED\n'),a.id);await waitText(a.id,'EXITRECREATED');
 const lastId=a.id;await page.getByRole('button',{name:`Close Shell ${lastId}`}).click();
 await page.waitForFunction(id=>window.__terminals.size===1&&!window.__terminals.has(id),lastId);
 // Input dialog (Radix Dialog, terminal rename via tab double-click): the
 // field is focused with the current name selected, Escape cancels, Enter
 // confirms, and focus returns to the invoking tab.
 const tab=page.getByRole('tab').first(),tabName=await tab.innerText();
 await tab.dblclick();
 const renameDialog=page.locator('[data-testid="dialog"]');await renameDialog.waitFor();
 const renameInput=page.getByTestId('dialog-input');
 if(!await page.evaluate(()=>document.activeElement?.getAttribute('data-testid')==='dialog-input'))throw new Error('input dialog did not focus the field');
 if(!await renameInput.evaluate(n=>n.selectionStart===0&&n.selectionEnd===n.value.length&&n.value.length>0))throw new Error('input dialog did not select the current name');
 await page.keyboard.press('Escape');await renameDialog.waitFor({state:'detached'});
 if(!await page.evaluate(n=>[...document.querySelectorAll('#tabs [role=tab]')].some(s=>s.textContent===n),tabName))throw new Error('Escape renamed the terminal');
 await page.waitForFunction(()=>document.activeElement?.closest('#tabs')!=null,null,{timeout:3000}).catch(()=>{throw new Error('input dialog Escape did not return focus to the invoking tab');});
 await tab.dblclick();await renameInput.waitFor();
 await renameInput.fill('Renamed shell');
 await page.keyboard.press('Enter');await renameDialog.waitFor({state:'detached'});
 await page.getByRole('tab',{name:'Renamed shell'}).waitFor();
 const facts=await page.evaluate(async()=>({isolated:crossOriginIsolated,sw:!!(await navigator.serviceWorker.ready),manifest:!!document.querySelector('link[rel=manifest]'),width:innerWidth,tabs:window.__terminals.size}));
 if(!facts.isolated||!facts.sw||!facts.manifest||facts.width!==375)throw new Error('browser/PWA facts '+JSON.stringify(facts));
 await page.evaluate(()=>localStorage.setItem('gucos2:elevenlabs-key','sk_scribe-regression-key'));
 await page.click('[data-testid="nav-settings"]');await page.getByTestId('settings-page').waitFor();
 if((await page.locator('#app h1').innerText())!=='Settings')throw new Error('Settings lost its c-style h1 page header');
 const elevenKey=page.getByTestId('settings-page').getByText('ElevenLabs API key'),scribeKey=()=>page.evaluate(()=>localStorage.getItem('gucos2:elevenlabs-key'));
 if(await elevenKey.count())throw new Error('ElevenLabs key field must stay hidden until Scribe is selected');
 await page.getByTestId('stt-mode-elevenlabs').check();await elevenKey.waitFor();
 if(!(await page.getByTestId('settings-page').innerText()).includes('(key saved in this browser)'))throw new Error('stored Scribe key is not acknowledged');
 if(await page.getByTestId('save-elevenlabs-key').isEnabled())throw new Error('an empty Scribe draft must keep Save disabled');
 await page.getByTestId('stt-mode-web-speech').check();
 if(await elevenKey.count())throw new Error('ElevenLabs key field did not collapse with Scribe deselected');
 if(await scribeKey()!=='sk_scribe-regression-key')throw new Error('provider toggle cleared the stored Scribe key');
 await page.reload();await page.waitForFunction(()=>window.__osState==='ready',null,{timeout:120000});
 await page.click('[data-testid="nav-settings"]');await page.getByTestId('settings-page').waitFor();
 await page.getByTestId('stt-mode-elevenlabs').check();await elevenKey.waitFor();
 if(await scribeKey()!=='sk_scribe-regression-key')throw new Error('reload with an untouched empty draft cleared the stored Scribe key');
 if(await page.getByTestId('save-elevenlabs-key').isEnabled())throw new Error('an empty Scribe draft must keep Save disabled after reload');
 await page.getByTestId('clear-elevenlabs-key').click();
 if(await scribeKey()!==null)throw new Error('explicit Clear did not remove the stored Scribe key');
 await page.getByTestId('elevenlabs-api-key').fill('API_KEY_ID');await page.getByTestId('save-elevenlabs-key').click();
 await page.getByRole('alert').getByText('API key ID cannot authenticate', {exact:false}).waitFor();
 if(await scribeKey()!=='API_KEY_ID')throw new Error('Settings did not preserve an unrecognized historical key shape for provider validation');
 await page.getByTestId('elevenlabs-api-key').fill('sk_replacement-key');await page.getByTestId('save-elevenlabs-key').click();
 if(await scribeKey()!=='sk_replacement-key')throw new Error('Settings rejected an sk_ ElevenLabs API key');
 await page.getByTestId('clear-elevenlabs-key').click();
 await page.getByTestId('stt-mode-web-speech').check();
 await page.click('[data-testid="nav-term"]');await page.waitForFunction(()=>window.__terminals.size===1);
 if(formWarnings.length)throw new Error('password fields rendered outside a form: '+formWarnings.length+' Chromium warning(s)');
 if(pageErrors.length)throw new Error('uncaught page errors during acceptance: '+JSON.stringify(pageErrors));
 await page.goto(`http://127.0.0.1:${port}/files/root`);await page.waitForFunction(()=>window.__osState==='ready');await page.getByText('mobile-proof',{exact:true}).waitFor();await page.goto(`http://127.0.0.1:${port}/edit/root/mobile-proof`);await page.waitForFunction(()=>window.__osState==='ready');await page.waitForSelector('.cm-content');
 console.log('test_browser: mobile boot/deep links, PTY replay/natural exit/job control, Files+Editor, overwrite/conflict/discard guards, Processes, persistence, COOP/COEP passed');
}finally{if(browser)await browser.close();server.kill('SIGTERM')}
