import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton, type ButtonVariant } from './ui.tsx';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Bottom sheet on phones, centred card on wider screens. */
  sheet?: boolean;
}

/** Native <dialog>: focus trap, Escape and inert background come for free. */
export function Dialog({ open, onClose, title, description, children, sheet = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const placement = sheet
    ? 'mt-auto mb-0 w-full max-w-full rounded-t-[1.75rem] sm:m-auto sm:max-w-md sm:rounded-[1.75rem]'
    : 'm-auto w-[calc(100%-2rem)] max-w-md rounded-[1.75rem]';

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop targets the <dialog> element itself.
        if (event.target === ref.current) onClose();
      }}
      className={`max-h-[90dvh] overflow-visible border-0 bg-transparent p-0 text-ink ${placement}`}
    >
      <div className="max-h-[90dvh] overflow-y-auto rounded-[inherit] bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:pb-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="pt-1.5 font-display text-xl leading-tight font-semibold">
            {title}
          </h2>
          <IconButton label="Fermer" size="sm" onClick={onClose} className="-mt-0.5 -mr-1.5">
            <X />
          </IconButton>
        </div>
        {description && (
          <div id={descriptionId} className="mt-1.5 text-[15px] text-ink-2">
            {description}
          </div>
        )}
        {children && <div className="mt-4">{children}</div>}
      </div>
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const confirmVariant: ButtonVariant = pending?.tone === 'danger' ? 'danger' : 'primary';

  return (
    <ConfirmContext value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onClose={() => settle(false)}
        title={pending?.title ?? ''}
        description={pending?.message}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => settle(false)}>
            {pending?.cancelLabel ?? 'Annuler'}
          </Button>
          <Button variant={confirmVariant} onClick={() => settle(true)} autoFocus>
            {pending?.confirmLabel ?? 'Confirmer'}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm() outside of <ConfirmProvider>');
  return confirm;
}
