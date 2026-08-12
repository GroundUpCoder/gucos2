import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { kernelClient } from './kernel-client';
import type { KernelState } from './protocol';

const Context = createContext(kernelClient);
export function KernelProvider({ children }: { children: ReactNode }) {
  useEffect(() => { kernelClient.boot(); }, []);
  return <Context.Provider value={kernelClient}>{children}</Context.Provider>;
}
export function useKernel() { return useContext(Context); }
export function useKernelState(): KernelState {
  const kernel = useKernel();
  const [state, setState] = useState(kernel.state);
  useEffect(() => kernel.subscribeState(setState), [kernel]);
  return state;
}
