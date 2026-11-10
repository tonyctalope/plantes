import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Bug,
  Camera,
  Check,
  Droplet,
  Droplets,
  FlaskConical,
  Flower2,
  ImagePlus,
  Lightbulb,
  Package,
  PawPrint,
  Pencil,
  Plus,
  ScanSearch,
  Scissors,
  Shovel,
  StickyNote,
  Sun,
  Thermometer,
  Trash2,
  Waves,
  X,
} from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CareEvent, PlantDetail, PlantPatch } from '../../../shared/api.ts';
import { PageContainer, ToxicBadge, TopBar, waterTone } from '../components/bits.tsx';
import { CareIcon } from '../components/CareIcon.tsx';
import { useConfirm } from '../components/Dialog.tsx';
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
  type Tone,
} from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import {
  capitalize,
  dueText,
  everyNDays,
  formatDate,
  formatDateTime,
  formatDayShort,
  relativeDays,
  temperatureRange,
} from '../lib/format.ts';
import { useDocumentTitle, useOnForeground, useResource } from '../lib/hooks.ts';
import { prepareImage } from '../lib/image.ts';
import {
  careLabel,
  confidenceLabel,
  difficultyLabel,
  humidityLabel,
  lightHint,
  lightLabel,
  seasonLabel,
  sourceLabel,
  toxicityLabel,
} from '../lib/labels.ts';
import { useMe } from '../lib/me.tsx';
import { navigate } from '../lib/router.tsx';

const toxicityTone: Record<PlantDetail['toxicityPets'], Tone> = {
  toxic: 'danger',
  mildly_toxic: 'warn',
  non_toxic: 'brand',
  unknown: 'neutral',
};

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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
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
    try {
      const detail = await api.snooze(id, days);
      setData(detail);
      toast({ message: `Rappel reporté : ${dueText(detail.water.daysUntilDue)}`, tone: 'success' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
      throw reason;
    }
  }

  async function submitCare(draft: CareDraft) {
    try {
      setData(await api.care(id, draft));
      toast({ message: `Soin enregistré : ${careLabel[draft.type].toLowerCase()}`, tone: 'success' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
      throw reason;
    }
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

  async function onPhotoChosen(file: File) {
    setUploadProgress(0);
    try {
      const prepared = await prepareImage(file);
      setData(await api.uploadPhoto(id, prepared, setUploadProgress));
      toast({ message: 'Photo mise à jour', tone: 'success' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function archive(reason: string | undefined) {
    try {
      await api.archive(id, reason);
      navigate('/', { replace: true });
      toast({
        message: `« ${current.nickname} » est archivée`,
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
    } catch (failure) {
      toast({ message: errorMessage(failure), tone: 'error' });
      throw failure;
    }
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
      title: `Supprimer « ${current.nickname} » ?`,
      message:
        'Sa fiche, sa photo et tout son historique seront effacés définitivement. Pour en garder une trace, archive-la plutôt.',
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

  const pickPhoto = () => fileInput.current?.click();
  const water = current.water;
  const care = current.care;
  const tempRange = temperatureRange(care.tempMinC, care.tempMaxC);
  const toxicTone = toxicityTone[current.toxicityPets];

  return (
    <>
      <TopBar
        back="/"
        title={current.nickname}
        heading={false}
        right={
          <IconButton label={current.photo ? 'Changer la photo' : 'Ajouter une photo'} onClick={pickPhoto}>
            <Camera />
          </IconButton>
        }
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onPhotoChosen(file);
        }}
      />
      <PageContainer>
        {/* Photo */}
        <div className="relative overflow-hidden rounded-[1.75rem] bg-surface-2">
          {current.photo ? (
            <img
              src={current.photo.full}
              alt={`Photo de ${current.nickname}`}
              className="aspect-[4/3] w-full object-cover sm:aspect-[16/9]"
            />
          ) : (
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
          )}
          {uploadProgress !== null && (
            <div className="absolute inset-0 grid place-items-center bg-black/45 text-white" role="status">
              <div className="w-2/3 max-w-xs">
                <p className="mb-2 text-center font-semibold">
                  Envoi de la photo… {Math.round(uploadProgress * 100)} %
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-white/30">
                  <div
                    className="h-full rounded-full bg-white transition-[width]"
                    style={{ width: `${Math.round(uploadProgress * 100)}%` }}
                  />
                </div>
              </div>
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
            <Badge>{care.indoor ? 'Intérieur' : 'Extérieur'}</Badge>
            {care.difficulty && <Badge>{difficultyLabel[care.difficulty]}</Badge>}
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

        {/* Care sheet */}
        <section aria-labelledby="care-title" className="mt-8">
          <SectionTitle id="care-title">Fiche d'entretien</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard icon={<Sun />} title="Lumière" tone="warn">
              <p className="font-semibold text-ink">{lightLabel[care.light]}</p>
              <p>{lightHint[care.light]}</p>
              {care.lightNotes && <Text>{care.lightNotes}</Text>}
            </InfoCard>

            <InfoCard icon={<Droplets />} title="Arrosage" tone="water">
              <Text>{care.wateringInstructions}</Text>
              {care.waterAmount && (
                <p>
                  <span className="font-semibold text-ink">Quantité : </span>
                  {care.waterAmount}
                </p>
              )}
              <IntervalEditor plant={current} onSave={(update) => patch(update, 'Fréquence mise à jour')} />
            </InfoCard>

            {(care.humidity || care.humidityNotes) && (
              <InfoCard icon={<Waves />} title="Humidité" tone="water">
                {care.humidity && <p className="font-semibold text-ink">{humidityLabel[care.humidity]}</p>}
                {care.humidityNotes && <Text>{care.humidityNotes}</Text>}
              </InfoCard>
            )}

            {(tempRange || care.temperatureNotes) && (
              <InfoCard icon={<Thermometer />} title="Température" tone="warn">
                {tempRange && <p className="font-semibold text-ink">{tempRange}</p>}
                {care.temperatureNotes && <Text>{care.temperatureNotes}</Text>}
              </InfoCard>
            )}

            {care.soil && (
              <InfoCard icon={<Shovel />} title="Substrat" tone="neutral">
                <Text>{care.soil}</Text>
              </InfoCard>
            )}

            {(care.fertilizing || current.lastFertilizedAt) && (
              <InfoCard icon={<FlaskConical />} title="Engrais" tone="brand">
                {care.fertilizing && <Text>{care.fertilizing}</Text>}
                {current.lastFertilizedAt && (
                  <p className="text-sm text-ink-3">
                    Dernier apport : {relativeDays(current.lastFertilizedAt, tz, today)} (
                    {formatDate(current.lastFertilizedAt, tz)}).
                  </p>
                )}
              </InfoCard>
            )}

            {care.repotting && (
              <InfoCard icon={<Flower2 />} title="Rempotage" tone="brand">
                <Text>{care.repotting}</Text>
              </InfoCard>
            )}

            {care.pruning && (
              <InfoCard icon={<Scissors />} title="Taille" tone="brand">
                <Text>{care.pruning}</Text>
              </InfoCard>
            )}

            <InfoCard icon={<PawPrint />} title="Animaux" tone={toxicTone}>
              <p className="font-semibold text-ink">{toxicityLabel[current.toxicityPets]}</p>
              {care.toxicityNotes && <Text>{care.toxicityNotes}</Text>}
            </InfoCard>

            {care.commonProblems && (
              <InfoCard icon={<Bug />} title="Problèmes fréquents" tone="danger">
                <Text>{care.commonProblems}</Text>
              </InfoCard>
            )}

            {care.tips && (
              <InfoCard icon={<Lightbulb />} title="Conseils" tone="warn">
                <Text>{care.tips}</Text>
              </InfoCard>
            )}

            {care.pot && (
              <InfoCard icon={<Package />} title="Pot" tone="neutral">
                <Text>{care.pot}</Text>
              </InfoCard>
            )}

            <InfoCard icon={<ScanSearch />} title="Identification" tone="neutral">
              <p>
                <Badge
                  tone={
                    care.identificationConfidence === 'high'
                      ? 'brand'
                      : care.identificationConfidence === 'medium'
                        ? 'warn'
                        : 'danger'
                  }
                >
                  {confidenceLabel[care.identificationConfidence]}
                </Badge>
              </p>
              <p>
                <span className="italic">{current.scientificName}</span>
                {care.family ? ` · famille des ${care.family}` : ''}
              </p>
              {care.identificationNotes && <Text>{care.identificationNotes}</Text>}
            </InfoCard>
          </div>
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
              <ActionRow icon={<Camera />} onClick={pickPhoto}>
                {current.photo ? 'Changer la photo' : 'Ajouter une photo'}
              </ActionRow>
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
    </>
  );
}

function Text({ children }: { children: string }) {
  return <p className="whitespace-pre-line">{children}</p>;
}

function InfoCard({
  icon,
  title,
  tone = 'brand',
  children,
}: {
  icon: ReactNode;
  title: string;
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-[1.125rem] ${toneClasses(tone)}`}
        >
          {icon}
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="mt-3 space-y-2 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </Card>
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

function IntervalEditor({ plant, onSave }: { plant: PlantDetail; onSave: (patch: PlantPatch) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [growing, setGrowing] = useState(String(plant.care.waterIntervalGrowing));
  const [rest, setRest] = useState(String(plant.care.waterIntervalRest));
  const [saving, setSaving] = useState(false);
  const season = plant.water.season;

  if (!editing) {
    return (
      <div className="mt-1 rounded-2xl bg-surface-2/70 p-3">
        <div className="flex items-start justify-between gap-2">
          <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[15px]">
            {(['growing', 'rest'] as const).map((key) => (
              <div key={key} className="contents">
                <dt className="text-ink-3">{seasonLabel[key]}</dt>
                <dd className={key === season ? 'font-semibold text-ink' : ''}>
                  {everyNDays(key === 'growing' ? plant.care.waterIntervalGrowing : plant.care.waterIntervalRest)}
                  {key === season && (
                    <Badge tone="water" className="ml-2 align-middle">
                      en ce moment
                    </Badge>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <IconButton
            size="sm"
            label="Modifier la fréquence d'arrosage"
            onClick={() => {
              setGrowing(String(plant.care.waterIntervalGrowing));
              setRest(String(plant.care.waterIntervalRest));
              setEditing(true);
            }}
          >
            <Pencil />
          </IconButton>
        </div>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextGrowing = Number(growing);
    const nextRest = Number(rest);
    if (!Number.isInteger(nextGrowing) || !Number.isInteger(nextRest) || nextGrowing < 1 || nextRest < 1) return;
    setSaving(true);
    const ok = await onSave({ waterIntervalGrowing: nextGrowing, waterIntervalRest: nextRest });
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-1 space-y-3 rounded-2xl bg-surface-2/70 p-3">
      <p className="text-sm text-ink-3">Arroser tous les combien de jours ?</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">{seasonLabel.growing}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={90}
            required
            value={growing}
            onChange={(event) => setGrowing(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">{seasonLabel.rest}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={90}
            required
            value={rest}
            onChange={(event) => setRest(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
          Annuler
        </Button>
        <Button size="sm" type="submit" loading={saving}>
          Enregistrer
        </Button>
      </div>
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
