import {
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Images,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { PlantPhoto } from '../../../shared/api.ts';
import { errorMessage, isAbortError } from '../lib/api.ts';
import { formatDateLong, formatShortDate, relativeDays } from '../lib/format.ts';
import { prepareImage } from '../lib/image.ts';
import { Dialog, useConfirm } from './Dialog.tsx';
import { Button, Card } from './ui.tsx';

/** Hidden file input: on phones `accept="image/*"` offers both the camera and the gallery. */
export function PhotoInput({
  inputRef,
  onFile,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) onFile(file);
      }}
    />
  );
}

function photoLabel(photo: PlantPhoto, timeZone: string): string {
  let label = `Photo du ${formatDateLong(photo.takenAt, timeZone)}`;
  if (photo.by) label += `, par ${photo.by}`;
  if (photo.isCover) label += ' (photo principale)';
  if (photo.note) label += ` : ${photo.note}`;
  return label;
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

const INITIAL_COUNT = 12;

export function PhotoGrid({
  photos,
  timeZone,
  today,
  onOpen,
}: {
  photos: PlantPhoto[];
  timeZone: string;
  today: string;
  onOpen: (photo: PlantPhoto) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? photos : photos.slice(0, INITIAL_COUNT);
  return (
    <div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {shown.map((photo) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => onOpen(photo)}
              aria-label={photoLabel(photo, timeZone)}
              className="group relative block aspect-square w-full overflow-hidden rounded-2xl bg-surface-2"
            >
              <img
                src={photo.thumb}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-2.5 pt-8 pb-2 text-left text-xs leading-none font-semibold text-white"
              >
                {formatShortDate(photo.takenAt, timeZone, today)}
              </span>
              {photo.isCover && (
                <span
                  aria-hidden
                  className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-surface/90 py-0.5 pr-2 pl-1.5 text-[11px] font-bold text-ink shadow-sm backdrop-blur"
                >
                  <Star className="size-3 fill-warn text-warn" />
                  Principale
                </span>
              )}
              {photo.note && (
                <span
                  aria-hidden
                  className="absolute right-1.5 bottom-1.5 grid size-6 place-items-center rounded-full bg-black/45 text-white backdrop-blur"
                >
                  <MessageSquareText className="size-3.5" />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {photos.length > INITIAL_COUNT && (
        <div className="mt-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>
            {showAll ? 'Afficher moins' : `Afficher les ${photos.length} photos`}
          </Button>
        </div>
      )}
    </div>
  );
}

export function JournalEmpty({ onAdd }: { onAdd?: () => void }) {
  return (
    <Card className="flex flex-col items-center px-6 py-8 text-center">
      <span aria-hidden className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand-strong">
        <Images className="size-7" />
      </span>
      <p className="mt-3 max-w-xs text-[15px] text-ink-2">
        Ajoute des photos au fil du temps pour suivre sa croissance.
      </p>
      {onAdd && (
        <Button variant="soft" className="mt-4" icon={<ImagePlus />} onClick={onAdd}>
          Ajouter une photo
        </Button>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Add sheet                                                           */
/* ------------------------------------------------------------------ */

export interface PhotoDraft {
  file: File;
  note?: string;
  cover: boolean;
}

/** Preview, optional note and "Photo principale", then upload with progress. Mount it with a fresh key per photo. */
export function AddPhotoSheet({
  file,
  plantName,
  hasCover,
  onClose,
  onFileChange,
  onUpload,
}: {
  /** The picked file; null closes the sheet. */
  file: File | null;
  plantName: string;
  /** false when the plant has no main photo yet: this one becomes it. */
  hasCover: boolean;
  onClose: () => void;
  onFileChange: (file: File) => void;
  /** Resolves once the photo is saved (the caller closes the sheet); rejects to show the error here. */
  onUpload: (draft: PhotoDraft, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [cover, setCover] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const prepared = useRef<Promise<File> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const uploading = progress !== null;

  useEffect(() => {
    if (!file) return;
    let alive = true;
    const urls: string[] = [];
    const show = (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      urls.push(url);
      setPreview(url);
    };
    show(file);
    // Downscale (and convert HEIC) right away so the upload starts sooner;
    // the converted copy also previews photos the browser cannot display.
    const ready = prepareImage(file);
    prepared.current = ready;
    void ready.then((result) => {
      if (alive && result !== file) show(result);
    });
    return () => {
      alive = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [file]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || uploading) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setProgress(0);
    try {
      const ready = await (prepared.current ?? prepareImage(file));
      if (controller.signal.aborted) return;
      const trimmed = note.trim();
      await onUpload(
        { file: ready, note: trimmed || undefined, cover: cover || !hasCover },
        setProgress,
        controller.signal,
      );
    } catch (reason) {
      if (!isAbortError(reason)) setError(errorMessage(reason));
    } finally {
      if (abort.current === controller) abort.current = null;
      setProgress(null);
    }
  }

  function close() {
    abort.current?.abort();
    onClose();
  }

  const percent = progress === null ? 0 : Math.round(progress * 100);

  return (
    <Dialog open={file !== null} onClose={close} title="Ajouter une photo" description={plantName}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl bg-surface-2">
          {preview ? (
            <img src={preview} alt="Aperçu de la photo choisie" className="h-56 w-full object-contain sm:h-64" />
          ) : (
            <div className="h-56 sm:h-64" />
          )}
          {uploading && (
            <div role="status" className="absolute inset-0 grid place-items-center bg-black/50 text-white">
              <div className="w-2/3 max-w-xs">
                <p className="mb-2 text-center text-sm font-semibold">Envoi de la photo… {percent} %</p>
                <div className="h-2 overflow-hidden rounded-full bg-white/30">
                  <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${percent}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="-mt-1.5 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw />}
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            Choisir une autre photo
          </Button>
          <PhotoInput inputRef={input} onFile={onFileChange} />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-2">Note (facultatif)</span>
          <textarea
            value={note}
            maxLength={300}
            rows={2}
            disabled={uploading}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex. : nouvelle feuille, juste après le rempotage…"
            className="w-full resize-none rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none disabled:opacity-60"
          />
        </label>
        <label
          className={`flex items-start gap-3 rounded-2xl border border-line p-3.5 ${
            hasCover && !uploading ? 'cursor-pointer hover:bg-surface-2/60' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={cover || !hasCover}
            disabled={!hasCover || uploading}
            onChange={(event) => setCover(event.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-brand"
          />
          <span className="min-w-0">
            <span className="block font-semibold">Photo principale</span>
            <span className="block text-sm text-ink-3">
              {hasCover
                ? "Elle remplace la photo affichée en haut de la fiche et sur l'accueil."
                : "C'est sa première photo : elle devient la photo principale."}
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" className="rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger-strong">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" loading={uploading} icon={<ImagePlus />}>
            Ajouter
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Viewer                                                              */
/* ------------------------------------------------------------------ */

const viewerButton =
  'inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

function ViewerButton({
  icon,
  busy = false,
  primary = false,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; busy?: boolean; primary?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`${viewerButton} ${primary ? 'bg-white text-black hover:bg-white/90' : 'bg-white/12 text-white hover:bg-white/20'} ${className}`}
      {...rest}
    >
      {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

function ViewerIconButton({
  label,
  busy = false,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; busy?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      className={`grid size-11 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50 [&_svg]:size-5 ${className}`}
      {...rest}
    >
      {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : children}
    </button>
  );
}

/** Full-screen photo viewer (native <dialog>): previous/next with buttons, arrow keys and swipe. */
export function PhotoViewer({
  photos,
  photoId,
  plantName,
  timeZone,
  today,
  onSelect,
  onClose,
  onSetCover,
  onSaveNote,
  onDelete,
}: {
  photos: PlantPhoto[];
  /** The photo shown; null closes the viewer. */
  photoId: number | null;
  plantName: string;
  timeZone: string;
  today: string;
  onSelect: (photoId: number) => void;
  onClose: () => void;
  onSetCover: (photo: PlantPhoto) => Promise<void>;
  onSaveNote: (photo: PlantPhoto, note: string | null) => Promise<void>;
  /** Also moves the viewer to a neighbour (or closes it). */
  onDelete: (photo: PlantPhoto) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirm = useConfirm();
  const noteId = useId();
  const index = photos.findIndex((photo) => photo.id === photoId);
  const photo = index >= 0 ? photos[index] : undefined;
  const open = photo !== undefined;

  const [shownId, setShownId] = useState(photoId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<null | 'cover' | 'note' | 'delete'>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  if (photoId !== shownId) {
    // Another photo: drop the note being edited and any error about the previous one.
    setShownId(photoId);
    setEditing(false);
    if (status?.tone === 'error') setStatus(null);
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (status?.tone !== 'ok') return;
    const timer = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  // Preload the neighbours so that next/previous feel instant.
  useEffect(() => {
    if (index < 0) return;
    for (const neighbour of [photos[index - 1], photos[index + 1]]) {
      if (neighbour) new Image().src = neighbour.full;
    }
  }, [photos, index]);

  // Swipes: touch/pen only, one finger (two are a pinch-zoom).
  const swipe = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const touches = useRef(new Set<number>());

  function go(delta: number) {
    const next = index >= 0 ? photos[index + delta] : undefined;
    if (next) onSelect(next.id);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') return;
    touches.current.add(event.pointerId);
    swipe.current =
      touches.current.size === 1 ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') return;
    touches.current.delete(event.pointerId);
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    touches.current.delete(event.pointerId);
    swipe.current = null;
  }

  async function run(kind: 'cover' | 'note' | 'delete', action: () => Promise<void>, success: string) {
    setBusy(kind);
    setStatus(null);
    try {
      await action();
      setStatus({ tone: 'ok', text: success });
      return true;
    } catch (reason) {
      setStatus({ tone: 'error', text: errorMessage(reason) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function makeCover(target: PlantPhoto) {
    await run('cover', () => onSetCover(target), 'Photo principale mise à jour');
  }

  async function saveNote(event: FormEvent, target: PlantPhoto) {
    event.preventDefault();
    const next = draft.trim();
    if (next === (target.note ?? '')) {
      setEditing(false);
      return;
    }
    const ok = await run('note', () => onSaveNote(target, next || null), next ? 'Note enregistrée' : 'Note retirée');
    if (ok) setEditing(false);
  }

  async function remove(target: PlantPhoto) {
    const ok = await confirm({
      title: 'Supprimer cette photo ?',
      message: `Photo du ${formatDateLong(target.takenAt, timeZone)}. Elle sera effacée définitivement${
        target.isCover && photos.length > 1 ? ' ; la plus récente des autres deviendra la photo principale' : ''
      }.`,
      confirmLabel: 'Supprimer',
      tone: 'danger',
    });
    if (ok) await run('delete', () => onDelete(target), 'Photo supprimée');
  }

  return (
    <dialog
      ref={ref}
      data-fullscreen=""
      aria-label={`Photos de ${plantName}`}
      onClose={() => {
        if (open) onClose();
      }}
      onCancel={(event) => {
        // Escape while editing the note only cancels the edit.
        if (editing) {
          event.preventDefault();
          setEditing(false);
        }
      }}
      onKeyDown={onKeyDown}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-black p-0 text-white [&_:focus-visible]:outline-white"
    >
      {photo && (
        <div className="flex h-full flex-col">
          <div className="shrink-0 pt-[env(safe-area-inset-top)]">
            <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-2">
              <ViewerIconButton label="Fermer" onClick={onClose} className="hover:bg-white/15">
                <X />
              </ViewerIconButton>
              <p className="flex-1 text-center text-sm font-semibold text-white/80 tabular-nums">
                <span aria-hidden>
                  {index + 1} / {photos.length}
                </span>
                <span className="sr-only" aria-live="polite">
                  Photo {index + 1} sur {photos.length}
                </span>
              </p>
              <ViewerIconButton
                label="Supprimer cette photo"
                busy={busy === 'delete'}
                disabled={busy !== null}
                onClick={() => void remove(photo)}
                className="text-red-300 hover:bg-red-400/15"
              >
                <Trash2 />
              </ViewerIconButton>
            </div>
          </div>

          <div
            className="relative min-h-0 flex-1 touch-pan-y touch-pinch-zoom select-none"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            <img
              key={photo.id}
              src={photo.full}
              alt={`${plantName}, photo du ${formatDateLong(photo.takenAt, timeZone)}`}
              draggable={false}
              className="absolute inset-0 size-full animate-fade-in object-contain"
            />
            {index > 0 && (
              <ViewerIconButton
                label="Photo précédente"
                onClick={() => go(-1)}
                className="absolute top-1/2 left-2 -translate-y-1/2 bg-black/50 ring-1 ring-white/20 backdrop-blur hover:bg-black/70 sm:left-4"
              >
                <ChevronLeft className="size-6!" />
              </ViewerIconButton>
            )}
            {index < photos.length - 1 && (
              <ViewerIconButton
                label="Photo suivante"
                onClick={() => go(1)}
                className="absolute top-1/2 right-2 -translate-y-1/2 bg-black/50 ring-1 ring-white/20 backdrop-blur hover:bg-black/70 sm:right-4"
              >
                <ChevronRight className="size-6!" />
              </ViewerIconButton>
            )}
            {status && (
              <p
                role={status.tone === 'error' ? 'alert' : 'status'}
                className={`absolute inset-x-4 top-3 mx-auto flex w-fit max-w-full animate-toast-in items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${
                  status.tone === 'error' ? 'bg-red-100 text-red-900' : 'bg-white text-black'
                }`}
              >
                {status.tone === 'ok' && <Check className="size-4 shrink-0 text-green-700" aria-hidden />}
                {status.text}
              </p>
            )}
          </div>

          <div className="shrink-0 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div className="mx-auto max-h-[40dvh] max-w-2xl overflow-y-auto">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-snug">
                <span className="font-semibold">{formatDateLong(photo.takenAt, timeZone)}</span>
                <span className="text-sm text-white/60">
                  {relativeDays(photo.takenAt, timeZone, today)}
                  {photo.by ? ` · ${photo.by}` : ''}
                </span>
                {photo.isCover && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 py-0.5 pr-2 pl-1.5 text-xs font-semibold">
                    <Star className="size-3 fill-amber-300 text-amber-300" aria-hidden />
                    Principale
                  </span>
                )}
              </p>

              {editing ? (
                <form onSubmit={(event) => void saveNote(event, photo)} className="mt-3 space-y-2">
                  <label htmlFor={noteId} className="sr-only">
                    Note de la photo
                  </label>
                  <textarea
                    id={noteId}
                    autoFocus
                    value={draft}
                    maxLength={300}
                    rows={2}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Ex. : nouvelle feuille, juste après le rempotage…"
                    className="w-full resize-none rounded-2xl border border-white/20 bg-white/10 px-3.5 py-2.5 text-[15px] text-white placeholder:text-white/45 focus:border-white/50 focus:outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <ViewerButton icon={<X />} onClick={() => setEditing(false)}>
                      Annuler
                    </ViewerButton>
                    <ViewerButton type="submit" primary icon={<Check />} busy={busy === 'note'}>
                      Enregistrer
                    </ViewerButton>
                  </div>
                </form>
              ) : (
                <>
                  {photo.note && (
                    <p className="mt-1.5 text-[15px] leading-relaxed whitespace-pre-line text-white/85">{photo.note}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!photo.isCover && (
                      <ViewerButton
                        icon={<Star />}
                        busy={busy === 'cover'}
                        disabled={busy !== null}
                        onClick={() => void makeCover(photo)}
                      >
                        Définir comme principale
                      </ViewerButton>
                    )}
                    <ViewerButton
                      icon={<Pencil />}
                      disabled={busy !== null}
                      onClick={() => {
                        setDraft(photo.note ?? '');
                        setEditing(true);
                      }}
                    >
                      {photo.note ? 'Modifier la note' : 'Ajouter une note'}
                    </ViewerButton>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
