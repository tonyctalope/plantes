import { createContext, useContext, type ReactNode } from 'react';
import type { MeResponse } from '../../../shared/api.ts';

export interface MeContextValue {
  me: MeResponse;
  setMe: (update: (current: MeResponse) => MeResponse) => void;
  refreshMe: () => Promise<void>;
}

const MeContext = createContext<MeContextValue | null>(null);

export function MeProvider({ value, children }: { value: MeContextValue; children: ReactNode }) {
  return <MeContext value={value}>{children}</MeContext>;
}

export function useMe(): MeContextValue {
  const value = useContext(MeContext);
  if (!value) throw new Error('useMe() outside of <MeProvider>');
  return value;
}
