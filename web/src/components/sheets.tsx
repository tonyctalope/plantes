import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { CareType } from '../../../shared/api.ts';
import { errorMessage } from '../lib/api.ts';
import { careLabel } from '../lib/labels.ts';
import { localTodayKey } from '../lib/format.ts';
import { CareIcon } from './CareIcon.tsx';
import { Dialog } from './Dialog.tsx';
import { Button } from './ui.tsx';

/** Error shown inside the sheet (toasts would sit behind the modal dialog). */
function SheetError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

const snoozeChoices: { days: number; label: string }[] = [
  { days: 1, label: 'Demain' },
  { days: 2, label: 'Dans 2 jours' },
  { days: 3, label: 'Dans 3 jours' },
  { days: 7, label: 'Dans une semaine' },
];

export function SnoozeSheet({
  plantName,
  open,
  onClose,
  onSnooze,
}: {
  plantName: string;
  open: boolean;
  onClose: () => void;
  onSnooze: (days: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(days: number) {
    setBusy(days);
    setError(null);
    try {
      await onSnooze(days);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason)); // keep the sheet open to retry
    } finally {
      setBusy(null);
    }
  }

  function close() {
    setError(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Reporter « ${plantName} »`}
      description="La terre est encore humide ? Décale le prochain rappel d'arrosage."
    >
      <SheetError message={error} />
      <div className={`grid grid-cols-2 gap-2 ${error ? 'mt-3' : ''}`}>
        {snoozeChoices.map((choice) => (
          <Button
            key={choice.days}
            variant="outline"
            size="lg"
            loading={busy === choice.days}
            disabled={busy !== null && busy !== choice.days}
            onClick={() => void choose(choice.days)}
          >
            {choice.label}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}

const loggableTypes: CareType[] = ['fertilize', 'repot', 'prune', 'treat', 'mist', 'note', 'water'];

export interface CareDraft {
  type: CareType;
  note?: string;
  at?: string;
}

/** "Noter un soin": any care type, an optional note and a date (today or earlier). */
export function CareSheet({
  plantName,
  open,
  onClose,
  onSubmit,
}: {
  plantName: string;
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: CareDraft) => Promise<void>;
}) {
  const [type, setType] = useState<CareType>('fertilize');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(localTodayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = localTodayKey();

  function close() {
    setError(null);
    onClose();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const draft: CareDraft = { type };
      const trimmed = note.trim();
      if (trimmed) draft.note = trimmed;
      // Past day: record it at noon local time; today: let the server use "now".
      if (date && date < today) draft.at = new Date(`${date}T12:00:00`).toISOString();
      await onSubmit(draft);
      setNote('');
      setDate(localTodayKey());
      onClose();
    } catch (reason) {
      setError(errorMessage(reason)); // keep the sheet open to retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title="Noter un soin" description={plantName}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-2">Type de soin</legend>
          <div className="flex flex-wrap gap-2">
            {loggableTypes.map((option) => (
              <label
                key={option}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-brand [&_svg]:size-4 ${
                  type === option
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name="care-type"
                  value={option}
                  checked={type === option}
                  onChange={() => setType(option)}
                  className="sr-only"
                />
                <CareIcon type={option} />
                {careLabel[option]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-2">Date</span>
          <input
            type="date"
            value={date}
            max={today}
            required
            onChange={(event) => setDate(event.target.value)}
            className="h-11 w-full rounded-2xl border border-line bg-surface px-3.5 text-ink focus:border-brand focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-2">Note (facultatif)</span>
          <textarea
            value={note}
            maxLength={500}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex. : engrais liquide dilué de moitié"
            className="w-full resize-y rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
          />
        </label>
        <SheetError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" loading={busy}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const archiveReasons = ['Morte', 'Donnée', 'Autre'] as const;

export function ArchiveSheet({
  plantName,
  open,
  onClose,
  onArchive,
}: {
  plantName: string;
  open: boolean;
  onClose: () => void;
  onArchive: (reason: string | undefined) => Promise<void>;
}) {
  const [choice, setChoice] = useState<(typeof archiveReasons)[number] | null>(null);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    onClose();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const reason = choice === 'Autre' ? other.trim() || undefined : (choice ?? undefined);
      await onArchive(reason);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason)); // keep the sheet open to retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Archiver « ${plantName} » ?`}
      description="Elle disparaît de la liste et des rappels. Son historique est conservé et tu pourras la restaurer depuis les archives."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-2">Raison (facultatif)</legend>
          <div className="flex flex-wrap gap-2">
            {archiveReasons.map((option) => (
              <label
                key={option}
                className={`inline-flex cursor-pointer items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-brand ${
                  choice === option
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name="archive-reason"
                  value={option}
                  checked={choice === option}
                  onChange={() => setChoice(option)}
                  className="sr-only"
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
        {choice === 'Autre' && (
          <input
            type="text"
            value={other}
            maxLength={120}
            onChange={(event) => setOther(event.target.value)}
            placeholder="Raison"
            aria-label="Autre raison"
            autoFocus
            className="h-11 w-full rounded-2xl border border-line bg-surface px-3.5 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
          />
        )}
        <SheetError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" loading={busy}>
            Archiver
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
