import { AlarmClock, BellOff, Check, Droplet, Droplets, Images, Settings, Sprout } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PlantDetail, PlantSummary } from '../../../shared/api.ts';
import { AvatarStack, Logo, PageContainer, PlantThumb, ToxicBadge, TopBar, WaterBadge } from '../components/bits.tsx';
import { SnoozeSheet } from '../components/sheets.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, buttonClass, Card, ErrorState, IconButton, IconLink, SectionTitle } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { capitalize, dueText, firstName, formatDayLong, plural, relativeDaysShort } from '../lib/format.ts';
import { useDocumentTitle, useOnForeground, useResource } from '../lib/hooks.ts';
import { useMe } from '../lib/me.tsx';
import { Link, useRestoreScroll } from '../lib/router.tsx';

const byName = (a: PlantSummary, b: PlantSummary) => a.nickname.localeCompare(b.nickname, 'fr');

function needsWater(plant: PlantSummary): boolean {
  return plant.remindersEnabled && (plant.water.state === 'overdue' || plant.water.state === 'due');
}

export function Home() {
  const { me } = useMe();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useResource('plants', (signal) => api.plants(false, signal));
  useOnForeground(reload);
  useRestoreScroll(data !== undefined);
  useDocumentTitle('Plantes');

  const [watering, setWatering] = useState<ReadonlySet<number>>(new Set());
  // Plants watered a moment ago stay in place (with a check) before leaving the list.
  const [justWatered, setJustWatered] = useState<ReadonlyMap<number, number>>(new Map());
  const [snoozeTarget, setSnoozeTarget] = useState<PlantSummary | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const today = data?.today ?? me.today;
  const active = useMemo(() => (data?.plants ?? []).filter((plant) => !plant.archivedAt), [data]);

  const due = useMemo(
    () =>
      active
        .filter((plant) => justWatered.has(plant.id) || needsWater(plant))
        .sort(
          (a, b) =>
            (justWatered.get(a.id) ?? a.water.daysUntilDue) - (justWatered.get(b.id) ?? b.water.daysUntilDue) ||
            byName(a, b),
        ),
    [active, justWatered],
  );
  const soon = useMemo(
    () =>
      active
        .filter((plant) => plant.remindersEnabled && plant.water.state === 'soon' && !justWatered.has(plant.id))
        .sort((a, b) => a.water.daysUntilDue - b.water.daysUntilDue || byName(a, b)),
    [active, justWatered],
  );
  const rooms = useMemo(() => {
    const groups = new Map<string, PlantSummary[]>();
    for (const plant of active) groups.set(plant.room, [...(groups.get(plant.room) ?? []), plant]);
    const order = [...new Set([...(data?.rooms ?? []), ...groups.keys()])].filter((room) => groups.has(room));
    return order.map((room) => ({ room, plants: (groups.get(room) ?? []).sort(byName) }));
  }, [active, data?.rooms]);

  const pendingDue = due.filter((plant) => !justWatered.has(plant.id));
  const nextUp = useMemo(
    () =>
      active
        .filter((plant) => plant.remindersEnabled && plant.water.daysUntilDue > 0)
        .sort((a, b) => a.water.daysUntilDue - b.water.daysUntilDue)[0],
    [active],
  );

  function replacePlant(detail: PlantDetail) {
    setData((current) =>
      current
        ? { ...current, plants: current.plants.map((plant) => (plant.id === detail.id ? detail : plant)) }
        : current,
    );
  }

  function keepInPlace(plants: PlantSummary[]) {
    setJustWatered((current) => {
      const next = new Map(current);
      for (const plant of plants) next.set(plant.id, plant.water.daysUntilDue);
      return next;
    });
    setTimeout(() => {
      setJustWatered((current) => {
        const next = new Map(current);
        for (const plant of plants) next.delete(plant.id);
        return next;
      });
    }, 1800);
  }

  function setBusy(id: number, busy: boolean) {
    setWatering((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function undoWater(plantId: number, eventId: number) {
    try {
      replacePlant(await api.deleteCare(plantId, eventId));
      toast({ message: 'Arrosage annulé' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    }
  }

  async function water(plant: PlantSummary) {
    setBusy(plant.id, true);
    try {
      const detail = await api.care(plant.id, { type: 'water' });
      keepInPlace([plant]);
      replacePlant(detail);
      const event = detail.events[0];
      toast({
        message: `Arrosage noté : ${plant.nickname}`,
        tone: 'success',
        action:
          event?.type === 'water' ? { label: 'Annuler', onClick: () => void undoWater(plant.id, event.id) } : undefined,
      });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy(plant.id, false);
    }
  }

  async function undoWaterMany(ids: number[], since: number) {
    try {
      const details = await Promise.all(ids.map((id) => api.plant(id)));
      await Promise.all(
        details.map((detail) => {
          const last = detail.events.find((event) => event.type === 'water');
          // Only the watering we just logged (allowing for clock skew).
          if (last && Date.parse(last.at) >= since - 120_000) return api.deleteCare(detail.id, last.id);
          return undefined;
        }),
      );
      toast({ message: 'Arrosages annulés' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      reload();
    }
  }

  async function waterAll() {
    const targets = pendingDue;
    if (targets.length === 0) return;
    const ids = targets.map((plant) => plant.id);
    const since = Date.now();
    setBulkBusy(true);
    try {
      const response = await api.waterMany(ids);
      keepInPlace(targets);
      setData(response);
      toast({
        message: `${plural(ids.length, 'plante arrosée', 'plantes arrosées')}`,
        tone: 'success',
        action: { label: 'Annuler', onClick: () => void undoWaterMany(ids, since) },
      });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBulkBusy(false);
    }
  }

  async function snooze(days: number) {
    const plant = snoozeTarget;
    if (!plant) return;
    // Errors propagate to the sheet, which shows them inline.
    const detail = await api.snooze(plant.id, days);
    replacePlant(detail);
    toast({ message: `Rappel reporté : ${dueText(detail.water.daysUntilDue)}`, tone: 'success' });
  }

  let summary = '';
  if (data) {
    if (active.length === 0) summary = 'Ajoute ta première plante avec Claude.';
    else if (pendingDue.length > 0) summary = `${plural(pendingDue.length, 'plante a', 'plantes ont')} besoin d'eau.`;
    else if (nextUp)
      summary = `Rien à arroser aujourd'hui. Prochain arrosage ${dueText(nextUp.water.daysUntilDue)} : ${nextUp.nickname}.`;
    else summary = "Rien à arroser aujourd'hui.";
  }

  return (
    <>
      <TopBar
        left={
          <Link to="/" className="flex items-center gap-2.5 rounded-xl pl-1" aria-label="Plantes, accueil">
            <Logo className="size-9" />
            <span className="font-display text-[1.35rem] font-semibold tracking-tight">Plantes</span>
          </Link>
        }
        right={
          <>
            <AvatarStack users={me.household} />
            <IconLink to="/reglages" label="Réglages" className="ml-1">
              <Settings />
            </IconLink>
          </>
        }
      />
      <PageContainer>
        <section className="pt-3 pb-7">
          <p className="text-sm font-semibold text-ink-3">{capitalize(formatDayLong(today))}</p>
          <h1 className="mt-1 font-display text-[2.1rem] leading-tight font-semibold tracking-tight">
            Bonjour {firstName(me.user)}
          </h1>
          <p className="mt-1.5 min-h-6 text-[17px] text-ink-2">{summary}</p>
        </section>

        {!data && loading && <HomeSkeleton />}
        {!data && error && <ErrorState message={error.message} onRetry={reload} />}

        {data && active.length === 0 && <EmptyState />}

        {due.length > 0 && (
          <section aria-labelledby="due-title" className="mb-8">
            <SectionTitle
              id="due-title"
              aside={
                pendingDue.length >= 2 && (
                  <Button
                    size="sm"
                    variant="soft"
                    icon={<Droplets />}
                    loading={bulkBusy}
                    onClick={() => void waterAll()}
                  >
                    Tout arroser
                  </Button>
                )
              }
            >
              À arroser
            </SectionTitle>
            <Card>
              <ul className="divide-y divide-line/70">
                {due.map((plant) => (
                  <DueRow
                    key={plant.id}
                    plant={plant}
                    done={justWatered.has(plant.id)}
                    busy={watering.has(plant.id)}
                    onWater={() => void water(plant)}
                    onSnooze={() => setSnoozeTarget(plant)}
                  />
                ))}
              </ul>
            </Card>
          </section>
        )}

        {soon.length > 0 && (
          <section aria-labelledby="soon-title" className="mb-8">
            <SectionTitle id="soon-title">Bientôt</SectionTitle>
            <Card>
              <ul className="divide-y divide-line/70">
                {soon.map((plant) => (
                  <li key={plant.id} className="flex items-center gap-3 py-2.5 pr-2 pl-3 sm:pl-4">
                    <Link to={`/plante/${plant.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl">
                      <PlantThumb plant={plant} className="size-11 rounded-xl" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{plant.nickname}</p>
                        <p className="truncate text-sm text-ink-3">{plant.room}</p>
                      </div>
                    </Link>
                    <WaterBadge water={plant.water} />
                    <IconButton
                      label={`Noter l'arrosage de ${plant.nickname}`}
                      size="sm"
                      loading={watering.has(plant.id)}
                      onClick={() => void water(plant)}
                      className="text-water-strong hover:bg-water-soft"
                    >
                      <Droplet />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {rooms.length > 0 && (
          <section aria-labelledby="all-title">
            <SectionTitle
              id="all-title"
              aside={<span className="text-sm text-ink-3">{plural(active.length, 'plante', 'plantes')}</span>}
            >
              Toutes les plantes
            </SectionTitle>
            <div className="space-y-7">
              {rooms.map(({ room, plants }) => (
                <div key={room}>
                  <h3 className="mb-3 flex items-baseline gap-2 px-1">
                    <span className="font-display text-[1.35rem] font-semibold">{room}</span>
                    <span className="text-sm text-ink-3">{plants.length}</span>
                  </h3>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {plants.map((plant) => (
                      <PlantCard key={plant.id} plant={plant} today={today} timeZone={me.timezone} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {data && (
          <p className="mt-10 text-center">
            <Link to="/archives" className="text-sm font-medium text-ink-3 underline-offset-4 hover:underline">
              Plantes archivées
            </Link>
          </p>
        )}
      </PageContainer>

      <SnoozeSheet
        open={snoozeTarget !== null}
        plantName={snoozeTarget?.nickname ?? ''}
        onClose={() => setSnoozeTarget(null)}
        onSnooze={snooze}
      />
    </>
  );
}

function DueRow({
  plant,
  done,
  busy,
  onWater,
  onSnooze,
}: {
  plant: PlantSummary;
  done: boolean;
  busy: boolean;
  onWater: () => void;
  onSnooze: () => void;
}) {
  return (
    <li
      className={`flex items-center gap-2 py-3 pr-2.5 pl-3 transition-opacity sm:gap-3 sm:pl-4 ${done ? 'opacity-70' : ''}`}
    >
      <Link to={`/plante/${plant.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl">
        <PlantThumb plant={plant} className="size-12 rounded-2xl" />
        <div className="min-w-0">
          <p className="line-clamp-2 leading-tight font-semibold break-words">{plant.nickname}</p>
          <p className="mt-0.5 truncate text-sm text-ink-3">{plant.room}</p>
          {!done && <WaterBadge water={plant.water} className="mt-1" />}
        </div>
      </Link>
      {done ? (
        <span
          className="inline-flex h-10 animate-pop items-center gap-1.5 rounded-full bg-brand-soft px-4 font-semibold text-brand-strong"
          role="status"
        >
          <Check className="size-5" aria-hidden />
          Fait
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={`Reporter l'arrosage de ${plant.nickname}`} onClick={onSnooze} className="size-10!">
            <AlarmClock />
          </IconButton>
          <Button variant="water" icon={<Droplet />} loading={busy} onClick={onWater} className="h-10! px-3.5!">
            Arrosé
          </Button>
        </div>
      )}
    </li>
  );
}

function PlantCard({ plant, today, timeZone }: { plant: PlantSummary; today: string; timeZone: string }) {
  const water = plant.water;
  let status: string;
  let tone: string;
  if (!plant.remindersEnabled) {
    status = 'Rappels désactivés';
    tone = 'text-ink-3';
  } else if (water.state === 'overdue') {
    status = `En retard (${-water.daysUntilDue} j)`;
    tone = 'text-danger-strong';
  } else if (water.state === 'due') {
    status = "Aujourd'hui";
    tone = 'text-warn-strong';
  } else {
    status = capitalize(dueText(water.daysUntilDue));
    tone = water.state === 'soon' ? 'text-water-strong' : 'text-ink-2';
  }
  const last = water.lastWateredAt
    ? `${water.lastWateredBy ? `${water.lastWateredBy} · ` : 'Arrosage '}${relativeDaysShort(water.lastWateredAt, timeZone, today)}`
    : "Pas d'arrosage noté";

  return (
    <li>
      <Link
        to={`/plante/${plant.id}`}
        className="group block h-full overflow-hidden rounded-3xl border border-line/80 bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="relative">
          <PlantThumb plant={plant} className="aspect-square w-full" />
          <div className="absolute inset-x-2 top-2 flex items-start gap-1">
            <ToxicBadge toxicity={plant.toxicityPets} compact />
            {!plant.remindersEnabled && (
              <span
                className="ml-auto grid size-7 place-items-center rounded-full bg-surface/85 text-ink-3 backdrop-blur"
                title="Rappels désactivés"
              >
                <BellOff className="size-4" aria-hidden />
              </span>
            )}
          </div>
          {plant.photoCount > 1 && (
            <span
              className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-xs font-semibold text-white tabular-nums backdrop-blur"
              title={`${plant.photoCount} photos dans le journal`}
            >
              <Images className="size-3.5" aria-hidden />
              {plant.photoCount}
              <span className="sr-only"> photos</span>
            </span>
          )}
        </div>
        <div className="p-3">
          <p className="truncate leading-snug font-semibold">{plant.nickname}</p>
          <p className="truncate text-xs text-ink-3">{plant.commonName}</p>
          <p className={`mt-2 flex items-center gap-1 text-[13px] font-semibold ${tone}`}>
            <Droplet className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{status}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-3" title="Dernier arrosage">
            {last}
          </p>
        </div>
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <Card className="px-6 py-10 text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-full bg-brand-soft text-brand-strong">
        <Sprout className="size-8" aria-hidden />
      </div>
      <h2 className="mt-5 font-display text-2xl font-semibold">Aucune plante pour l'instant</h2>
      <p className="mx-auto mt-2 max-w-sm text-ink-2">
        Les plantes s'ajoutent uniquement avec Claude : il les reconnaît sur ta photo et remplit toute la fiche
        d'entretien.
      </p>
      <p className="mx-auto mt-4 max-w-sm font-semibold text-balance">
        Envoie une photo à Claude et dis « ajoute cette plante ».
      </p>
      <Link to="/reglages#claude" className={buttonClass('soft', 'md', 'mt-6')}>
        Connecter Claude
      </Link>
    </Card>
  );
}

function HomeSkeleton() {
  return (
    <div aria-hidden className="animate-pulse space-y-8">
      <div className="space-y-3">
        <div className="h-4 w-28 rounded-full bg-surface-2" />
        <div className="h-44 rounded-3xl bg-surface-2" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="aspect-[3/4] rounded-3xl bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
