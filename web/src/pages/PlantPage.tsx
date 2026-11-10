import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Camera,
  Check,
  Droplet,
  Droplets,
  FlaskConical,
  ImagePlus,
  Images,
  Pencil,
  Plus,
  Sprout,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CareEvent, PlantDetail, PlantPatch, PlantPhoto } from '../../../shared/api.ts';
import { PageContainer, ToxicBadge, TopBar, waterTone } from '../components/bits.tsx';
import { CareGuide, Essentials } from '../components/care.tsx';
import { CareIcon } from '../components/CareIcon.tsx';
import { useConfirm } from '../components/Dialog.tsx';
import {
  AddPhotoSheet,
  JournalEmpty,
  PhotoGrid,
  PhotoInput,
  PhotoViewer,
  type PhotoDraft,
} from '../components/photos.tsx';
import { ArchiveSheet, CareSheet, SnoozeSheet, type CareDraft } from '../components/sheets.tsx';
import { useToast } from '../components/Toast.tsx';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  IconButton,
  SectionTitle,
  Spinner,
  Switch,
  toneClasses,
} from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import {
  capitalize,
  dueText,
  formatDate,
  formatDateTime,
  formatDayShort,
  plural,
  relativeDays,
} from '../lib/format.ts';
import { useDocumentTitle, useOnForeground, useResource } from '../lib/hooks.ts';
import { careLabel, sourceLabel } from '../lib/labels.ts';
import { useMe } from '../lib/me.tsx';
import { navigate } from '../lib/router.tsx';

const inputClass =
  'h-11 w-full rounded-2xl border border-line bg-surface px-3.5 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none';

export function PlantPage({ id }: { id: number }) {
  const { me } = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: plant, error, reload, setData } = useResource(`plant:${id}`, (signal) => api.plant(id, signal));
  useOnForeground(reload);
  useDocumentTitle(plant ? `${plant.nickname} · Plantes` : 'Plantes');

  const [busy, setBusy] = useState<null | 'water' | 'fertilize' | 'unarchive'>(null);
  const [sheet, setSheet] = useState<null | 'snooze' | 'care' | 'archive'>(null);
  // Photo journal: the file waiting in the "Ajouter une photo" sheet (a new key
  // per pick resets the sheet) and the photo open in the viewer.
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [photoSheetKey, setPhotoSheetKey] = useState(0);
  const [viewerPhotoId, setViewerPhotoId] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!plant) {
    return (
      <>
        <TopBar back="/" />
        <PageContainer>
          {error ? (
            <ErrorState
              title={error.status === 404 ? 'Plante introuvable' : 'Oups'}
              message={error.status === 404 ? "Cette plante n'existe pas ou a été supprimée." : error.message}
              onRetry={error.status === 404 ? undefined : reload}
            />
          ) : (
            <Spinner />
          )}
        </PageContainer>
      </>
    );
  }

  const current: PlantDetail = plant;
  if (viewerPhotoId !== null && !current.photos.some((photo) => photo.id === viewerPhotoId)) {
    // The photo went away (deleted elsewhere, then refreshed): close the viewer for good.
    setViewerPhotoId(null);
  }
  const tz = me.timezone;
  const today = me.today;
  const archived = current.archivedAt !== null;

  async function patch(update: PlantPatch, success?: string): Promise<boolean> {
    try {
      setData(await api.patchPlant(id, update));
      if (success) toast({ message: success, tone: 'success' });
      return true;
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
      return false;
    }
  }

  async function removeEvent(eventId: number, message: string) {
    try {
      setData(await api.deleteCare(id, eventId));
      toast({ message });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    }
  }

  async function quickCare(type: 'water' | 'fertilize') {
    setBusy(type);
    try {
      const detail = await api.care(id, { type });
      setData(detail);
      const event = detail.events[0];
      toast({
        message: type === 'water' ? 'Arrosage noté' : 'Engrais noté',
        tone: 'success',
        action:
          event?.type === type
            ? { label: 'Annuler', onClick: () => void removeEvent(event.id, 'Soin annulé') }
            : undefined,
      });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function snooze(days: number) {
    // Errors propagate to the sheet, which shows them inline.
    const detail = await api.snooze(id, days);
    setData(detail);
    toast({ message: `Rappel reporté : ${dueText(detail.water.daysUntilDue)}`, tone: 'success' });
  }

  async function submitCare(draft: CareDraft) {
    // Errors propagate to the sheet, which shows them inline.
    setData(await api.care(id, draft));
    toast({ message: `Soin enregistré : ${careLabel[draft.type].toLowerCase()}`, tone: 'success' });
  }

  async function confirmRemoveEvent(event: CareEvent) {
    const ok = await confirm({
      title: 'Supprimer ce soin ?',
      message: `${careLabel[event.type]} du ${formatDateTime(event.at, tz)}${event.by ? `, par ${event.by}` : ''}.`,
      confirmLabel: 'Supprimer',
      tone: 'danger',
    });
    if (ok) await removeEvent(event.id, "Soin retiré de l'historique");
  }

  function choosePhoto(file: File) {
    setPhotoSheetKey((key) => key + 1);
    setPendingPhoto(file);
  }

  async function addPhoto(draft: PhotoDraft, onProgress: (fraction: number) => void, signal: AbortSignal) {
    const replacesCover = draft.cover && current.photo !== null;
    const detail = await api.addPhoto(id, draft.file, { note: draft.note, cover: draft.cover }, onProgress, signal);
    setPendingPhoto(null);
    setData(detail);
    const added = detail.photos[0];
    toast({
      message: replacesCover ? 'Photo ajoutée et définie comme principale' : 'Photo ajoutée au journal',
      tone: 'success',
      action: added ? { label: 'Voir', onClick: () => setViewerPhotoId(added.id) } : undefined,
    });
  }

  async function setCoverPhoto(photo: PlantPhoto) {
    setData(await api.patchPhoto(id, photo.id, { cover: true }));
  }

  async function savePhotoNote(photo: PlantPhoto, note: string | null) {
    setData(await api.patchPhoto(id, photo.id, { note }));
  }

  async function deletePhoto(photo: PlantPhoto) {
    const photos = current.photos;
    const index = photos.findIndex((item) => item.id === photo.id);
    // Stay in the viewer on the next (older) photo, else the previous one.
    const neighbour = photos[index + 1] ?? photos[index - 1];
    const detail = await api.deletePhoto(id, photo.id);
    setViewerPhotoId(neighbour?.id ?? null);
    setData(detail);
    if (!neighbour) toast({ message: 'Photo supprimée', tone: 'success' });
  }

  async function archive(reason: string | undefined) {
    // Errors propagate to the sheet, which shows them inline.
    await api.archive(id, reason);
    navigate('/', { replace: true });
    toast({
      message: `« ${current.nickname} » est archivée`,
      tone: 'success',
      action: {
        label: 'Annuler',
        onClick: () =>
          void api
            .unarchive(id)
            .then(() => navigate(`/plante/${id}`))
            .catch((failure: unknown) => toast({ message: errorMessage(failure), tone: 'error' })),
      },
    });
  }

  async function unarchive() {
    setBusy('unarchive');
    try {
      setData(await api.unarchive(id));
      toast({ message: 'Plante restaurée', tone: 'success' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Supprimer « ${current.nickname} » ?`,
      message:
        'Sa fiche, ses photos et tout son historique seront effacés définitivement. Pour en garder une trace, archive-la plutôt.',
      confirmLabel: 'Supprimer définitivement',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.deletePlant(id);
      navigate('/', { replace: true });
      toast({ message: 'Plante supprimée', tone: 'success' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    }
  }

  // Archived plants keep their journal (viewable, editable) but take no new photos (server rule).
  const pickPhoto = archived ? undefined : () => fileInput.current?.click();
  const water = current.water;
  const photos = current.photos;
  const coverPhoto = photos.find((photo) => photo.isCover) ?? photos[0];

  return (
    <>
      <TopBar
        back="/"
        title={current.nickname}
        heading={false}
        right={
          pickPhoto && (
            <IconButton label="Ajouter une photo" onClick={pickPhoto}>
              <Camera />
            </IconButton>
          )
        }
      />
      <PhotoInput inputRef={fileInput} onFile={choosePhoto} />
      <PageContainer>
        {/* Main photo */}
        <div className="relative overflow-hidden rounded-[1.75rem] bg-surface-2">
          {current.photo && coverPhoto ? (
            <button
              type="button"
              onClick={() => setViewerPhotoId(coverPhoto.id)}
              aria-label={`Voir les photos de ${current.nickname} (${plural(photos.length, 'photo', 'photos')})`}
              className="group block w-full"
            >
              <img
                src={current.photo.full}
                alt=""
                className="aspect-[4/3] w-full object-cover transition group-hover:brightness-[.97] sm:aspect-[16/9]"
              />
              <span
                aria-hidden
                className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-sm font-semibold text-white tabular-nums backdrop-blur-sm"
              >
                <Images className="size-4" />
                {photos.length}
              </span>
            </button>
          ) : current.photo ? (
            <img
              src={current.photo.full}
              alt={`Photo de ${current.nickname}`}
              className="aspect-[4/3] w-full object-cover sm:aspect-[16/9]"
            />
          ) : pickPhoto ? (
            <button
              type="button"
              onClick={pickPhoto}
              className="grid aspect-[4/3] w-full place-items-center bg-gradient-to-b from-brand-soft to-surface-2 sm:aspect-[16/9]"
            >
              <span className="flex flex-col items-center gap-2 text-brand-strong">
                <ImagePlus className="size-10" aria-hidden />
                <span className="font-semibold">Ajouter une photo</span>
              </span>
            </button>
          ) : (
            <div
              aria-hidden
              className="grid aspect-[4/3] w-full place-items-center bg-gradient-to-b from-brand-soft to-surface-2 text-brand-strong sm:aspect-[16/9]"
            >
              <Sprout className="size-12 opacity-60" strokeWidth={1.6} />
            </div>
          )}
        </div>

        {/* Names */}
        <section className="mt-5 px-1">
          <InlineText
            label="le nom"
            value={current.nickname}
            maxLength={60}
            onSave={(nickname) => patch({ nickname })}
            display={
              <h1 className="font-display text-[2rem] leading-tight font-semibold tracking-tight">
                {current.nickname}
              </h1>
            }
          />
          <p className="mt-1 text-[17px] text-ink-2">{current.commonName}</p>
          <p className="text-[15px] text-ink-3 italic">{current.scientificName}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <RoomEditor room={current.room} onSave={(room) => patch({ room })} />
            <Badge>{current.care.indoor ? 'Intérieur' : 'Extérieur'}</Badge>
            <ToxicBadge toxicity={current.toxicityPets} />
          </div>
        </section>

        {/* Status */}
        {archived ? (
          <Card className="mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-start gap-3">
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${toneClasses('neutral')}`}>
                <Archive className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">Plante archivée le {formatDate(current.archivedAt ?? '', tz)}</p>
                <p className="text-sm text-ink-3">
                  {current.archiveReason ? `Raison : ${current.archiveReason}. ` : ''}Aucun rappel n'est envoyé.
                </p>
              </div>
            </div>
            <Button
              variant="soft"
              icon={<ArchiveRestore />}
              loading={busy === 'unarchive'}
              onClick={() => void unarchive()}
            >
              Restaurer
            </Button>
          </Card>
        ) : (
          <Card className="mt-6 p-5">
            <div className="flex items-start gap-4">
              <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${toneClasses(waterTone(water))}`}>
                <Droplets className="size-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-3">Prochain arrosage</p>
                <p className="text-xl leading-snug font-semibold">
                  {capitalize(dueText(water.daysUntilDue))}
                  <span className="text-base font-normal whitespace-nowrap text-ink-3">
                    {' '}
                    · {formatDayShort(water.dueDate)}
                  </span>
                </p>
                <p className="mt-1 text-[15px] text-ink-2">
                  {water.lastWateredAt
                    ? `Dernier arrosage ${relativeDays(water.lastWateredAt, tz, today)}${
                        water.lastWateredBy ? ` par ${water.lastWateredBy}` : ''
                      } (${formatDateTime(water.lastWateredAt, tz)}).`
                    : "Pas encore d'arrosage enregistré."}
                </p>
                {water.snoozedUntil && (
                  <p className="mt-1 text-sm font-medium text-warn-strong">
                    Rappel reporté au {formatDayShort(water.snoozedUntil)}.
                  </p>
                )}
                {!current.remindersEnabled && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-3">
                    <BellOff className="size-4" aria-hidden /> Rappels désactivés pour cette plante.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
              <Button
                variant="water"
                size="lg"
                icon={<Droplet />}
                loading={busy === 'water'}
                onClick={() => void quickCare('water')}
                className="col-span-2 sm:col-span-1"
              >
                Arrosé
              </Button>
              <Button variant="outline" size="lg" icon={<AlarmClock />} onClick={() => setSheet('snooze')}>
                Reporter
              </Button>
              <Button
                variant="soft"
                size="lg"
                icon={<FlaskConical />}
                loading={busy === 'fertilize'}
                onClick={() => void quickCare('fertilize')}
              >
                Engrais
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setSheet('care')}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full px-1 text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
            >
              <Plus className="size-4" aria-hidden /> Noter un autre soin
            </button>
          </Card>
        )}

        {/* At a glance */}
        <section aria-labelledby="essentials-title" className="mt-8">
          <SectionTitle id="essentials-title">L'essentiel</SectionTitle>
          <Essentials plant={current} />
        </section>

        {/* Photo journal */}
        <section aria-labelledby="journal-title" className="mt-8">
          <SectionTitle
            id="journal-title"
            aside={
              pickPhoto &&
              photos.length > 0 && (
                <Button size="sm" variant="soft" icon={<ImagePlus />} onClick={pickPhoto}>
                  Ajouter une photo
                </Button>
              )
            }
          >
            Journal photo
          </SectionTitle>
          {photos.length > 0 ? (
            <PhotoGrid photos={photos} timeZone={tz} today={today} onOpen={(photo) => setViewerPhotoId(photo.id)} />
          ) : (
            <JournalEmpty onAdd={pickPhoto} />
          )}
        </section>

        {/* Care sheet */}
        <section aria-labelledby="care-title" className="mt-8">
          <SectionTitle id="care-title">Fiche d'entretien</SectionTitle>
          <CareGuide
            plant={current}
            timeZone={tz}
            today={today}
            onSaveIntervals={(update) => patch(update, 'Fréquence mise à jour')}
          />
        </section>

        {/* Household notes */}
        <section aria-labelledby="notes-title" className="mt-8">
          <SectionTitle id="notes-title">Notes du foyer</SectionTitle>
          <NotesEditor value={current.notes} onSave={(notes) => patch({ notes }, 'Notes enregistrées')} />
        </section>

        {/* History */}
        <section aria-labelledby="history-title" className="mt-8">
          <SectionTitle id="history-title">Historique</SectionTitle>
          <Card>
            {current.events.length === 0 ? (
              <p className="p-5 text-ink-3">Aucun soin enregistré pour l'instant.</p>
            ) : (
              <ul className="divide-y divide-line/70">
                {current.events.map((event) => (
                  <li key={event.id} className="flex items-start gap-3 py-3.5 pr-2 pl-4">
                    <span
                      className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${toneClasses(
                        event.type === 'water' ? 'water' : 'brand',
                      )}`}
                    >
                      <CareIcon type={event.type} className="size-[1.125rem]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {careLabel[event.type]}
                        <span className="font-normal text-ink-3"> · {relativeDays(event.at, tz, today)}</span>
                      </p>
                      <p className="text-sm text-ink-3">
                        {[formatDateTime(event.at, tz), event.by, sourceLabel[event.source]]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {event.note && <p className="mt-1 text-sm whitespace-pre-line text-ink-2">{event.note}</p>}
                    </div>
                    <IconButton
                      size="sm"
                      tone="danger"
                      label={`Supprimer ce soin (${careLabel[event.type]})`}
                      onClick={() => void confirmRemoveEvent(event)}
                    >
                      <Trash2 />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        {/* Management */}
        <section aria-labelledby="manage-title" className="mt-8">
          <SectionTitle id="manage-title">Gérer la plante</SectionTitle>
          <Card>
            <div className="divide-y divide-line/70">
              <div className="flex items-center gap-3 p-4">
                <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${toneClasses('brand')}`}>
                  {current.remindersEnabled ? (
                    <Bell className="size-[1.125rem]" aria-hidden />
                  ) : (
                    <BellOff className="size-[1.125rem]" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Rappels d'arrosage</p>
                  <p className="text-sm text-ink-3">
                    {current.remindersEnabled
                      ? 'Le foyer est prévenu quand elle a soif.'
                      : 'Aucun rappel pour cette plante (elle reste dans la liste).'}
                  </p>
                </div>
                <Switch
                  label="Rappels d'arrosage pour cette plante"
                  checked={current.remindersEnabled}
                  disabled={archived}
                  onChange={(remindersEnabled) =>
                    void patch({ remindersEnabled }, remindersEnabled ? 'Rappels activés' : 'Rappels désactivés')
                  }
                />
              </div>
              {archived ? (
                <ActionRow icon={<ArchiveRestore />} onClick={() => void unarchive()}>
                  Restaurer la plante
                </ActionRow>
              ) : (
                <ActionRow icon={<Archive />} onClick={() => setSheet('archive')}>
                  Archiver (morte, donnée…)
                </ActionRow>
              )}
              <ActionRow icon={<Trash2 />} danger onClick={() => void remove()}>
                Supprimer définitivement
              </ActionRow>
            </div>
          </Card>
        </section>

        <p className="mt-8 px-1 text-center text-sm text-ink-3">
          Ajoutée le {formatDate(current.createdAt, tz)}
          {current.createdBy ? ` par ${current.createdBy}` : ''}
          {current.createdVia ? ` via ${current.createdVia}` : ''}.
        </p>
      </PageContainer>

      <SnoozeSheet
        open={sheet === 'snooze'}
        plantName={current.nickname}
        onClose={() => setSheet(null)}
        onSnooze={snooze}
      />
      <CareSheet
        open={sheet === 'care'}
        plantName={current.nickname}
        onClose={() => setSheet(null)}
        onSubmit={submitCare}
      />
      <ArchiveSheet
        open={sheet === 'archive'}
        plantName={current.nickname}
        onClose={() => setSheet(null)}
        onArchive={archive}
      />
      <AddPhotoSheet
        key={photoSheetKey}
        file={pendingPhoto}
        plantName={current.nickname}
        hasCover={current.photo !== null}
        onClose={() => setPendingPhoto(null)}
        onFileChange={setPendingPhoto}
        onUpload={addPhoto}
      />
      <PhotoViewer
        photos={photos}
        photoId={viewerPhotoId}
        plantName={current.nickname}
        timeZone={tz}
        today={today}
        onSelect={setViewerPhotoId}
        onClose={() => setViewerPhotoId(null)}
        onSetCover={setCoverPhoto}
        onSaveNote={savePhotoNote}
        onDelete={deletePhoto}
      />
    </>
  );
}

function ActionRow({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 p-4 text-left font-semibold transition-colors first:rounded-t-3xl last:rounded-b-3xl hover:bg-surface-2 [&>span>svg]:size-[1.125rem] ${
        danger ? 'text-danger-strong' : ''
      }`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-xl ${toneClasses(danger ? 'danger' : 'neutral')}`}
        aria-hidden
      >
        {icon}
      </span>
      {children}
    </button>
  );
}

/** Text shown with a pencil; turns into an input with save/cancel. */
function InlineText({
  value,
  label,
  display,
  maxLength,
  onSave,
}: {
  value: string;
  label: string;
  display: ReactNode;
  maxLength: number;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <div className="group flex items-start gap-2">
        <div className="min-w-0">{display}</div>
        <IconButton
          size="sm"
          label={`Modifier ${label}`}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="mt-1 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Pencil />
        </IconButton>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex items-center gap-1.5">
      <input
        autoFocus
        value={draft}
        maxLength={maxLength}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
        }}
        className={`${inputClass} text-lg font-semibold`}
      />
      <IconButton type="submit" label="Enregistrer" loading={saving} className="text-brand-strong">
        <Check />
      </IconButton>
      <IconButton label="Annuler" onClick={() => setEditing(false)}>
        <X />
      </IconButton>
    </form>
  );
}

function RoomEditor({ room, onSave }: { room: string; onSave: (room: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(room);
  const [rooms, setRooms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function start() {
    setDraft(room);
    setEditing(true);
    api
      .plants()
      .then((response) => setRooms(response.rooms))
      .catch(() => setRooms([]));
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        aria-label={`Pièce : ${room}. Modifier`}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-strong transition hover:brightness-[.97] dark:hover:brightness-110"
      >
        {room}
        <Pencil className="size-3.5 opacity-70" aria-hidden />
      </button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next || next === room) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex w-full items-center gap-1.5 sm:w-auto">
      <input
        autoFocus
        value={draft}
        maxLength={40}
        list="rooms-list"
        aria-label="Pièce"
        placeholder="Salon, chambre, balcon…"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
        }}
        className={`${inputClass} h-10 sm:w-56`}
      />
      <datalist id="rooms-list">
        {rooms.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <IconButton type="submit" size="sm" label="Enregistrer la pièce" loading={saving} className="text-brand-strong">
        <Check />
      </IconButton>
      <IconButton size="sm" label="Annuler" onClick={() => setEditing(false)}>
        <X />
      </IconButton>
    </form>
  );
}

function NotesEditor({ value, onSave }: { value: string | null; onSave: (notes: string | null) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [base, setBase] = useState(value ?? '');
  // Follow updates from elsewhere (refresh) unless the user is typing.
  if ((value ?? '') !== base && draft === base) {
    setBase(value ?? '');
    setDraft(value ?? '');
  }
  const dirty = draft.trim() !== (value ?? '').trim();

  async function save() {
    setSaving(true);
    const next = draft.trim();
    const ok = await onSave(next ? next : null);
    setSaving(false);
    if (ok) setBase(next);
  }

  return (
    <Card className="p-3">
      <label htmlFor="plant-notes" className="sr-only">
        Notes du foyer
      </label>
      <div className="flex items-start gap-3 p-1">
        <StickyNote className="mt-2.5 size-5 shrink-0 text-ink-3" aria-hidden />
        <textarea
          id="plant-notes"
          value={draft}
          maxLength={2000}
          rows={3}
          placeholder="Où elle était avant, cadeau de qui, astuces de la maison…"
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-20 w-full resize-y rounded-xl bg-transparent px-1 py-2 text-[15px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>
      {dirty && (
        <div className="flex justify-end gap-2 px-1 pb-1">
          <Button size="sm" variant="outline" onClick={() => setDraft(value ?? '')}>
            Annuler
          </Button>
          <Button size="sm" loading={saving} onClick={() => void save()}>
            Enregistrer
          </Button>
        </div>
      )}
    </Card>
  );
}
