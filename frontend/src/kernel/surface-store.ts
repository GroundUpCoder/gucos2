type Listener=()=>void;
class SurfaceStore { active:number|null=null; private listeners=new Set<Listener>(); subscribe=(f:Listener)=>{this.listeners.add(f);return()=>this.listeners.delete(f)}; snapshot=()=>this.active; show(id:number){this.active=id;this.emit()} hide(){this.active=null;this.emit()} private emit(){this.listeners.forEach(f=>f())} }
export const surfaceStore=new SurfaceStore();
