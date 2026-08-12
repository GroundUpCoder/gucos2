import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { useKernel, useKernelState } from '../kernel/context';
import { surfaceStore } from '../kernel/surface-store';

declare global { interface Window { createAudioReceiver?: (options:{sharedBuffer:SharedArrayBuffer;bufferSize:number})=>{handleMessage(message:unknown):void}; __osAudio?:string; __osAudioSab?:SharedArrayBuffer } }
const modifiers = (e: KeyboardEvent) => ({ Shift:e.shiftKey, Control:e.ctrlKey, Alt:e.altKey, Meta:e.metaKey, AltGraph:e.getModifierState('AltGraph'), CapsLock:e.getModifierState('CapsLock'), NumLock:e.getModifierState('NumLock'), ScrollLock:e.getModifierState('ScrollLock') });

export function GraphicalProcessHost() {
  const kernel = useKernel(); const kernelState = useKernelState();
  const active = useSyncExternalStore(surfaceStore.subscribe, surfaceStore.snapshot);
  const canvas = useRef<HTMLCanvasElement>(null); const audioReceiver = useRef<{handleMessage(message:unknown):void}|null>(null); const [error, setError] = useState(''); const [activeProcess,setActiveProcess]=useState<{pid:number;command:string}|null>(null);
  useEffect(() => {
    if (kernelState.status !== 'ready') return;
    const openExisting = async () => { try { const ps = await kernel.processes(); const s=ps.flatMap(p=>p.surfaces)[0]; if(s)surfaceStore.show(s.id); } catch (e) { console.error('surface discovery failed', e); } };
    void openExisting();
  }, [kernel, kernelState.status]);
  useEffect(() => { let removeAudioGesture:(()=>void)|null=null; const off=kernel.subscribe(event => {
    if (event.type === 'surface-frame' && event.surfaceId === surfaceStore.active && canvas.current) {
      const c = canvas.current; c.width = event.width; c.height = event.height;
      const context = c.getContext('2d'); if (!context) return;
      if (event.bitmap) { context.drawImage(event.bitmap, 0, 0); event.bitmap.close(); }
      else if (event.rgba) context.putImageData(new ImageData(new Uint8ClampedArray(event.rgba), event.width, event.height), 0, 0);
    }
    if (event.type === 'surface-created') surfaceStore.show(event.surfaceId);
    if (event.type === 'surface-destroyed' && surfaceStore.active === event.surfaceId) surfaceStore.hide();
    if (event.type === 'audio') {
      window.__osAudio = 'ready'; window.__osAudioSab = event.sab;
      const start = () => { removeAudioGesture?.();removeAudioGesture=null;if (!audioReceiver.current && window.createAudioReceiver) { try{audioReceiver.current = window.createAudioReceiver({ sharedBuffer:event.sab, bufferSize:event.bufferSize }); audioReceiver.current.handleMessage({type:'audio-open',id:1,freq:event.freq,format:event.format,channels:event.channels}); audioReceiver.current.handleMessage({type:'audio-pause',id:1,pause:false}); window.__osAudio='playing';}catch(e){setError(`audio: ${String(e)}`);} } };
      window.addEventListener('pointerdown', start, { once:true, capture:true });
      window.addEventListener('keydown', start, { once:true, capture:true });
      removeAudioGesture=()=>{window.removeEventListener('pointerdown',start,true);window.removeEventListener('keydown',start,true);};
    }
    if(event.type==='pointer-lock'&&canvas.current){if(event.wanted&&document.pointerLockElement!==canvas.current)void canvas.current.requestPointerLock().catch(e=>setError(`pointer lock: ${String(e)}`));if(!event.wanted&&document.pointerLockElement===canvas.current)document.exitPointerLock();}
    if(event.type==='cursor'&&canvas.current)canvas.current.style.cursor=event.shape<0?'none':'default';
    if (event.type === 'host-error') {const msg=`${event.operation}: ${event.message}`;setError(msg);toast.error(msg);}
  });return()=>{off();removeAudioGesture?.();};}, [kernel]);
  useEffect(() => {
    if (active === null || !canvas.current) return; const c = canvas.current;
    void kernel.processes().then(ps=>{const p=ps.find(p=>p.surfaces.some(s=>s.id===active));setActiveProcess(p?{pid:p.pid,command:p.command}:null);}).catch(()=>setActiveProcess(null));
    const attach = () => kernel.attachSurface(active, Math.max(1,c.clientWidth), Math.max(1,c.clientHeight)).catch(e => setError(String(e)));
    attach(); const observer = new ResizeObserver(attach); observer.observe(c);
    return () => { observer.disconnect(); void kernel.detachSurface(active); };
  }, [active, kernel]);
  useEffect(()=>{const changed=()=>kernel.surfaceInput({kind:'lockchange',active:document.pointerLockElement===canvas.current});document.addEventListener('pointerlockchange',changed);return()=>document.removeEventListener('pointerlockchange',changed);},[kernel]);
  useEffect(() => {
    if (active === null) return;
    const send = (e: KeyboardEvent, down: boolean) => { kernel.surfaceInput({kind:'key',down,code:e.code,key:e.key,repeat:e.repeat,mods:modifiers(e)}); e.preventDefault(); };
    const down = (e:KeyboardEvent) => send(e,true), up = (e:KeyboardEvent) => send(e,false);
    window.addEventListener('keydown',down); window.addEventListener('keyup',up);
    return () => { window.removeEventListener('keydown',down); window.removeEventListener('keyup',up); };
  }, [active, kernel]);
  if (active === null) return null;
  const point = (e: ReactPointerEvent<HTMLCanvasElement> | ReactWheelEvent<HTMLCanvasElement>) => {
    const c=e.currentTarget,r=c.getBoundingClientRect(),aspect=c.width/c.height;let w:number,h:number,ox:number,oy:number;
    if(r.width/r.height>aspect){h=r.height;w=h*aspect;ox=(r.width-w)/2;oy=0;}else{w=r.width;h=w/aspect;ox=0;oy=(r.height-h)/2;}
    return {x:(e.clientX-r.left-ox)*c.width/w,y:(e.clientY-r.top-oy)*c.height/h};
  };
  return <div className="fixed inset-0 z-50 flex flex-col bg-background safe-top safe-bottom" data-testid="graphical-process-host">
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0"><span className="text-sm font-medium font-mono truncate">{activeProcess?.command??`gucOS surface ${active}`}</span><div className="flex items-center gap-1 shrink-0">{activeProcess&&activeProcess.pid!==1&&<button data-testid="graphical-run-stop" className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent" title="Stop (kills the program)" onClick={()=>void kernel.signal(activeProcess.pid,15)}><Square className="w-5 h-5"/></button>}<button data-testid="graphical-run-close" className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent" title="Hide (keeps running — re-open from Processes)" aria-label="Background graphical process" onClick={()=>surfaceStore.hide()}><X className="w-5 h-5"/></button></div></div>
    <div className="relative flex-1 min-h-0 bg-black">{error && <div className="absolute inset-x-0 top-0 z-10 m-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive backdrop-blur-sm">{error}</div>}
    <canvas ref={canvas} tabIndex={0} className="absolute inset-0 h-full w-full object-contain touch-none" style={{imageRendering:'pixelated'}}
      onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);canvas.current?.focus();kernel.surfaceInput({kind:'down',...point(e),button:e.button,t:e.timeStamp,pointerType:e.pointerType})}}
      onPointerUp={e=>kernel.surfaceInput({kind:'up',...point(e),button:e.button,pointerType:e.pointerType})}
      onPointerMove={e=>kernel.surfaceInput({kind:'move',...point(e),buttons:e.buttons,pointerType:e.pointerType})}
      onWheel={e=>{kernel.surfaceInput({kind:'wheel',...point(e),deltaX:e.deltaX,deltaY:e.deltaY,deltaMode:e.deltaMode});e.preventDefault();}} /></div>
  </div>;
}
