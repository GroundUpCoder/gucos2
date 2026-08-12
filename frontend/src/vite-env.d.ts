/// <reference types="vite/client" />
declare const __BUILD_NUMBER__: number;
declare const __RUNTIME_GENERATION__: string;

interface Window {
  __osState: string;
  __terminals: Map<number, unknown>;
  __activeTerminal?: number;
  __terminalInput(id: number, data: string): void;
  __kernelReadRange(path:string,offset:number,length:number):Promise<Uint8Array>;
  __kernelStat(path:string):Promise<import('./kernel/protocol').FsStat|null>;
  __kernelProcesses():Promise<import('./kernel/protocol').ProcessInfo[]>;
  /** Most recent 128 process snapshots, oldest discarded first. */
  __processEvents:import('./kernel/protocol').ProcessInfo[][];
  __kernelExec(command:string,timeoutMs?:number):Promise<{start:import('./kernel/protocol').ExecStart;exit:import('./kernel/protocol').ExecExit;stdout:string;stderr:string}>;
  __lastEgress?:{name:string;disposition:string;bytes:number};
}
