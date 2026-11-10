import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PlantSummary } from '../../../shared/api.ts';
import { PageContainer, PlantThumb, TopBar } from '../components/bits.tsx';
import { useConfirm } from '../components/Dialog.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, ErrorState, IconButton, Spinner } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';
import { useDocumentTitle, useResource } from '../lib/hooks.ts';
import { useMe } from '../lib/me.tsx';
import { Link } from '../lib/router.tsx';

export function Archives() {
  const { me } = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  useDocumentTitle('Archives · Plantes');
  const { data, error, loading, reload, setData } = useResource('archives', (signal) => api.plants(true, signal));
  const [busy, setBusy] = useState<number | null>(null);

  const archived = useMemo(
    () =>
      (data?.plants ?? [])
        .filter((plant) => plant.archivedAt !== null)
        .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')),
    [data],
  );

  function drop(id: number) {
    setData((current) =>
      current ? { ...current, plants: current.plants.filter((plant) => plant.id !== id) } : current,
    );
  }

  async function restore(plant: PlantSummary) {
    setBusy(plant.id);
    try {
      await api.unarchive(plant.id);
      drop(plant.id);
      toast({ message: `« ${plant.nickname} » est de retour`, tone: 'success' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function remove(plant: PlantSummary) {
    const ok = await confirm({
      title: `Supprimer « ${plant.nickname} » ?`,
      message: 'Sa fiche, sa photo et son historique seront effacés définitivement.',
      confirmLabel: 'Supprimer définitivement',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(plant.id);
    try {
      await api.deletePlant(plant.id);
      drop(plant.id);
      toast({ message: 'Plante supprimée', tone: 'success' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <TopBar back="/reglages" title="Plantes archivées" />
      <PageContainer className="pt-2">
        {!data && loading && <Spinner />}
        {!data && error && <ErrorState message={error.message} onRetry={reload} />}
        {data && archived.length === 0 && (
          <Card className="px-6 py-10 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-surface-2 text-ink-3">
              <Archive className="size-7" aria-hidden />
            </div>
            <p className="mt-4 font-display text-xl font-semibold">Aucune plante archivée</p>
            <p className="mx-auto mt-1 max-w-xs text-ink-2">
              Les plantes mortes ou données atterrissent ici, avec leur historique.
            </p>
          </Card>
        )}
        {archived.length > 0 && (
          <Card>
            <ul className="divide-y divide-line/70">
              {archived.map((plant) => (
                <li key={plant.id} className="flex items-center gap-3 py-3 pr-2 pl-3 sm:pl-4">
                  <Link to={`/plante/${plant.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl">
                    <PlantThumb plant={plant} className="size-14 rounded-2xl grayscale-[40%]" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{plant.nickname}</p>
                      <p className="truncate text-sm text-ink-3">
                        {plant.commonName} · archivée le {formatDate(plant.archivedAt ?? '', me.timezone)}
                        {plant.archiveReason ? ` (${plant.archiveReason})` : ''}
                      </p>
                    </div>
                  </Link>
                  <Button
                    size="sm"
                    variant="soft"
                    icon={<ArchiveRestore />}
                    loading={busy === plant.id}
                    onClick={() => void restore(plant)}
                  >
                    Restaurer
                  </Button>
                  <IconButton
                    tone="danger"
                    size="sm"
                    label={`Supprimer ${plant.nickname} définitivement`}
                    disabled={busy === plant.id}
                    onClick={() => void remove(plant)}
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </PageContainer>
    </>
  );
}
