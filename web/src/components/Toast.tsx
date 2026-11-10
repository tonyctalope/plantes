import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms; defaults to 6 s with an action, 3.5 s otherwise. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'message' | 'tone' | 'duration'>> {
  id: number;
  action?: ToastOptions['action'];
}

type ShowToast = (options: ToastOptions) => void;

const ToastContext = createContext<ShowToast | null>(null);

const icons: Record<ToastTone, ReactNode> = {
  success: <CircleCheck className="size-5 shrink-0 text-brand" aria-hidden />,
  error: <TriangleAlert className="size-5 shrink-0 text-danger" aria-hidden />,
  info: <Info className="size-5 shrink-0 text-water" aria-hidden />,
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback<ShowToast>(
    (options) => {
      const id = nextId++;
      const toast: ToastItem = {
        id,
        message: options.message,
        tone: options.tone ?? 'info',
        action: options.action,
        duration: options.duration ?? (options.action ? 6000 : 3500),
      };
      setToasts((current) => [...current.slice(-2), toast]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), toast.duration),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  return (
    <ToastContext value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex w-full max-w-md animate-toast-in items-center gap-3 rounded-2xl bg-ink py-2.5 pr-2 pl-4 text-[15px] text-bg shadow-xl"
          >
            {icons[toast.tone]}
            <p className="min-w-0 flex-1 py-1 leading-snug">{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                className="shrink-0 rounded-full px-3 py-1.5 font-semibold text-brand-soft underline-offset-4 hover:underline"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Fermer"
              className="grid size-8 shrink-0 place-items-center rounded-full opacity-70 hover:opacity-100"
              onClick={() => dismiss(toast.id)}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast() outside of <ToastProvider>');
  return show;
}
