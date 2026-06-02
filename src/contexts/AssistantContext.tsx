import { createContext, useContext, useState, type ReactNode } from 'react';

interface AssistantState {
  open: boolean;
  seed: string | null; // optional pre-filled prompt
  openWith: (seed?: string) => void;
  close: () => void;
  clearSeed: () => void;
}

const Ctx = createContext<AssistantState | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  return (
    <Ctx.Provider
      value={{
        open,
        seed,
        openWith: (s?: string) => {
          if (s) setSeed(s);
          setOpen(true);
        },
        close: () => setOpen(false),
        clearSeed: () => setSeed(null),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAssistant() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssistant must be used within AssistantProvider');
  return v;
}
