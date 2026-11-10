import {
  Archive,
  Bell,
  BellRing,
  Camera,
  ChevronRight,
  Copy,
  LogOut,
  Plug,
  Smartphone,
  Sparkles,
  Terminal,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Connection, UserSettings } from '../../../shared/api.ts';
import { Avatar, PageContainer, TopBar } from '../components/bits.tsx';
import { useConfirm } from '../components/Dialog.tsx';
import { useToast } from '../components/Toast.tsx';
import { Badge, Button, Card, SectionTitle, Spinner, Switch, toneClasses, type Tone } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { displayName, formatDate, plural, relativeDays } from '../lib/format.ts';
import { useDocumentTitle, useResource } from '../lib/hooks.ts';
import { useMe } from '../lib/me.tsx';
import { disablePush, enablePush, getPushState, PushPermissionError, toRequest, type PushState } from '../lib/push.ts';
import { Link } from '../lib/router.tsx';

export function Settings() {
  useDocumentTitle('Réglages · Plantes');

  useEffect(() => {
    // Deep link from the empty state: /reglages#claude
    const id = window.location.hash.slice(1);
    if (!id) return;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, []);

  return (
    <>
      <TopBar back="/" title="Réglages" />
      <PageContainer className="space-y-8 pt-2">
        <NotificationsSection />
        <ClaudeSection />
        <ConnectionsSection />
        <HouseholdSection />
        <AccountSection />
      </PageContainer>
    </>
  );
}

function SectionIcon({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`grid size-10 shrink-0 place-items-center rounded-2xl [&_svg]:size-5 ${toneClasses(tone)}`}
      aria-hidden
    >
      {children}
    </span>
  );
}

function NotificationsSection() {
  const { me, setMe, refreshMe } = useMe();
  const toast = useToast();
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState<null | 'enable' | 'disable' | 'test'>(null);
  const [time, setTime] = useState(me.settings.reminderTime);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void getPushState().then((value) => {
      if (alive) setState(value);
    });
    return () => {
      alive = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  async function enable() {
    setBusy('enable');
    try {
      const subscription = await enablePush(me.push.vapidPublicKey);
      await api.subscribePush(toRequest(subscription));
      setState('on');
      await refreshMe();
      toast({ message: 'Notifications activées sur cet appareil', tone: 'success' });
    } catch (reason) {
      if (reason instanceof PushPermissionError) setState(Notification.permission === 'denied' ? 'denied' : 'off');
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy('disable');
    try {
      const endpoint = await disablePush();
      if (endpoint) await api.unsubscribePush(endpoint);
      setState('off');
      await refreshMe();
      toast({ message: 'Notifications désactivées sur cet appareil' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    try {
      const { sent } = await api.testPush();
      toast(
        sent > 0
          ? { message: `Notification envoyée (${plural(sent, 'appareil', 'appareils')})`, tone: 'success' }
          : { message: "Aucun appareil n'est abonné pour l'instant.", tone: 'info' },
      );
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(next: UserSettings, previous: UserSettings) {
    setMe((current) => ({ ...current, settings: next }));
    try {
      const saved = await api.saveSettings(next);
      setMe((current) => ({ ...current, settings: saved }));
      toast({ message: 'Réglage enregistré', tone: 'success' });
    } catch (reason) {
      setMe((current) => ({ ...current, settings: previous }));
      setTime(previous.reminderTime);
      toast({ message: errorMessage(reason), tone: 'error' });
    }
  }

  function onTimeChange(value: string) {
    setTime(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!/^\d{2}:\d{2}$/.test(value) || value === me.settings.reminderTime) return;
    const previous = me.settings;
    saveTimer.current = setTimeout(() => void saveSettings({ ...previous, reminderTime: value }, previous), 600);
  }

  const devices = me.push.subscriptions;
  let explanation: ReactNode;
  switch (state) {
    case 'loading':
      explanation = 'Vérification…';
      break;
    case 'unsupported':
      explanation = 'Ce navigateur ne gère pas les notifications push. Essaie avec Chrome, Firefox, Edge ou Safari.';
      break;
    case 'ios-install':
      explanation = (
        <>
          Sur iPhone et iPad, les notifications ne marchent que depuis l'appli installée : touche{' '}
          <strong>Partager</strong> puis <strong>« Sur l'écran d'accueil »</strong>, ouvre Plantes depuis l'icône, puis
          reviens ici pour les activer.
        </>
      );
      break;
    case 'denied':
      explanation =
        'Les notifications sont bloquées pour ce site. Autorise-les dans les réglages du navigateur (icône à gauche de l’adresse), puis recharge la page.';
      break;
    case 'off':
      explanation = "Reçois un rappel sur cet appareil quand des plantes ont besoin d'eau.";
      break;
    case 'on':
      explanation = 'Activées sur cet appareil.';
      break;
  }

  return (
    <section aria-labelledby="notif-title">
      <SectionTitle id="notif-title">Rappels d'arrosage</SectionTitle>
      <Card className="divide-y divide-line/70">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <SectionIcon tone={state === 'on' ? 'brand' : 'neutral'}>
              {state === 'on' ? <BellRing /> : <Smartphone />}
            </SectionIcon>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Notifications sur cet appareil</p>
              <p className="mt-0.5 text-[15px] text-ink-2">{explanation}</p>
              {devices > 0 && (
                <p className="mt-1 text-sm text-ink-3">
                  {plural(devices, 'appareil reçoit', 'appareils reçoivent')} tes rappels.
                </p>
              )}
            </div>
          </div>
          {(state === 'off' || state === 'on') && (
            <div className="mt-4 flex flex-wrap gap-2">
              {state === 'off' ? (
                <Button icon={<Bell />} loading={busy === 'enable'} onClick={() => void enable()}>
                  Activer sur cet appareil
                </Button>
              ) : (
                <>
                  <Button variant="soft" icon={<BellRing />} loading={busy === 'test'} onClick={() => void test()}>
                    Envoyer un test
                  </Button>
                  <Button variant="outline" loading={busy === 'disable'} onClick={() => void disable()}>
                    Désactiver
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 p-5">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Rappel quotidien</p>
            <p className="text-sm text-ink-3">
              Un seul message par jour, avec la liste des plantes à arroser (s'il y en a).
            </p>
          </div>
          <Switch
            label="Rappel quotidien"
            checked={me.settings.remindersEnabled}
            onChange={(remindersEnabled) => void saveSettings({ ...me.settings, remindersEnabled }, me.settings)}
          />
        </div>
        <label className="flex items-center gap-3 p-5">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Heure du rappel</span>
            <span className="block text-sm text-ink-3">Fuseau horaire : {me.timezone}</span>
          </span>
          <input
            type="time"
            step={300}
            value={time}
            disabled={!me.settings.remindersEnabled}
            onChange={(event) => onTimeChange(event.target.value)}
            className="h-11 rounded-2xl border border-line bg-surface px-3 text-base font-semibold text-ink focus:border-brand focus:outline-none disabled:opacity-50"
          />
        </label>
      </Card>
    </section>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast({ message: 'Copié dans le presse-papiers', tone: 'success' });
    } catch {
      toast({ message: 'Copie impossible : sélectionne le texte à la main.', tone: 'error' });
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2/60 p-1.5 pl-3.5">
      <span className="sr-only">{label} : </span>
      <code className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-[13px] whitespace-nowrap text-ink select-all">
        {value}
      </code>
      <Button size="sm" variant="soft" icon={<Copy />} onClick={() => void copy()} aria-label={`Copier ${label}`}>
        Copier
      </Button>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">
        {n}
      </span>
      <span className="min-w-0 pt-0.5">{children}</span>
    </li>
  );
}

function ClaudeSection() {
  const { me } = useMe();
  return (
    <section aria-labelledby="claude" id="claude" className="scroll-mt-20">
      <SectionTitle id="claude-title">Ajouter des plantes avec Claude</SectionTitle>
      <Card className="space-y-6 p-5">
        <div className="flex items-start gap-3">
          <SectionIcon tone="brand">
            <Sparkles />
          </SectionIcon>
          <p className="text-[15px] text-ink-2">
            Les plantes ne s'ajoutent que par Claude : il les reconnaît sur ta photo et remplit toute la fiche (espèce,
            lumière, arrosage, toxicité…). Connecte-le une fois avec cette adresse :
          </p>
        </div>
        <CopyField value={me.mcpUrl} label="l'adresse du connecteur" />

        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Smartphone className="size-4.5 text-ink-3" aria-hidden /> Sur claude.ai ou l'appli Claude
          </h3>
          <ol className="mt-3 space-y-2.5 text-[15px] text-ink-2">
            <Step n={1}>
              <strong className="text-ink">Paramètres → Connecteurs</strong> → « Ajouter un connecteur personnalisé ».
            </Step>
            <Step n={2}>
              Nom : <strong className="text-ink">Plantes</strong>, URL : l'adresse ci-dessus.
            </Step>
            <Step n={3}>
              <strong className="text-ink">Se connecter</strong>, puis autorise l'accès avec ton compte Google.
            </Step>
          </ol>
        </div>

        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Terminal className="size-4.5 text-ink-3" aria-hidden /> Avec Claude Code
          </h3>
          <div className="mt-3 space-y-2.5 text-[15px] text-ink-2">
            <CopyField value={`claude mcp add --transport http plantes ${me.mcpUrl}`} label="la commande" />
            <p>
              Puis lance <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[13px]">/mcp</code> dans
              Claude Code pour t'authentifier.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-2xl bg-brand-soft p-4 text-[15px] text-brand-strong">
          <Camera className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            Ensuite, envoie une photo à Claude et dis <strong>« ajoute cette plante au salon »</strong> : il
            l'identifie, remplit la fiche et te donne un lien pour joindre la photo.
          </p>
        </div>
      </Card>
    </section>
  );
}

function ConnectionsSection() {
  const { me } = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useResource('connections', (signal) => api.connections(signal));

  async function revoke(connection: Connection) {
    const ok = await confirm({
      title: `Déconnecter « ${connection.clientName} » ?`,
      message: "Cette application n'aura plus accès à tes plantes. Tu pourras la reconnecter plus tard.",
      confirmLabel: 'Déconnecter',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.revokeConnection(connection.id);
      setData((current) =>
        current ? { connections: current.connections.filter((item) => item.id !== connection.id) } : current,
      );
      toast({ message: `${connection.clientName} déconnecté`, tone: 'success' });
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    }
  }

  return (
    <section aria-labelledby="connections-title">
      <SectionTitle id="connections-title">Applications connectées</SectionTitle>
      <Card>
        {!data && loading && <Spinner className="py-8" />}
        {!data && error && (
          <div className="flex items-center justify-between gap-3 p-5">
            <p className="text-ink-2">{error.message}</p>
            <Button size="sm" variant="soft" onClick={reload}>
              Réessayer
            </Button>
          </div>
        )}
        {data && data.connections.length === 0 && (
          <div className="flex items-start gap-3 p-5">
            <SectionIcon tone="neutral">
              <Plug />
            </SectionIcon>
            <p className="text-[15px] text-ink-2">
              Aucune application connectée. Une fois Claude connecté, il apparaîtra ici et tu pourras lui retirer
              l'accès à tout moment.
            </p>
          </div>
        )}
        {data && data.connections.length > 0 && (
          <ul className="divide-y divide-line/70">
            {data.connections.map((connection) => (
              <li key={connection.id} className="flex items-center gap-3 p-4">
                <SectionIcon tone="brand">
                  <Plug />
                </SectionIcon>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{connection.clientName}</p>
                  <p className="text-sm text-ink-3">
                    Connectée le {formatDate(connection.createdAt, me.timezone)}
                    {connection.lastUsedAt
                      ? ` · utilisée ${relativeDays(connection.lastUsedAt, me.timezone, me.today)}`
                      : ''}
                  </p>
                </div>
                <Button size="sm" variant="danger-soft" onClick={() => void revoke(connection)}>
                  Déconnecter
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function HouseholdSection() {
  const { me } = useMe();
  return (
    <section aria-labelledby="household-title">
      <SectionTitle id="household-title">Foyer</SectionTitle>
      <Card>
        <ul className="divide-y divide-line/70">
          {me.household.map((member) => (
            <li key={member.id} className="flex items-center gap-3 p-4">
              <Avatar user={member} className="size-10 text-sm ring-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {displayName(member)}
                  {member.id === me.user.id && (
                    <Badge tone="brand" className="ml-2 align-middle">
                      toi
                    </Badge>
                  )}
                </p>
                <p className="truncate text-sm text-ink-3">{member.email}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-start gap-3 border-t border-line/70 p-4 text-sm text-ink-3">
          <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Tout le foyer voit les mêmes plantes et reçoit les mêmes rappels. Pour ajouter quelqu'un, son adresse Google
            doit être ajoutée à la liste autorisée du serveur.
          </p>
        </div>
      </Card>
    </section>
  );
}

function AccountSection() {
  const { me } = useMe();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
    } catch {
      // Going back to the login screen is the right outcome either way.
    }
    window.location.assign('/');
  }

  return (
    <section aria-labelledby="account-title">
      <SectionTitle id="account-title">Compte</SectionTitle>
      <Card className="divide-y divide-line/70">
        <Link to="/archives" className="flex items-center gap-3 rounded-t-3xl p-4 transition-colors hover:bg-surface-2">
          <SectionIcon tone="neutral">
            <Archive />
          </SectionIcon>
          <span className="flex-1 font-semibold">Plantes archivées</span>
          <ChevronRight className="size-5 text-ink-3" aria-hidden />
        </Link>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar user={me.user} className="size-10 text-sm ring-0" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{displayName(me.user)}</p>
              <p className="truncate text-sm text-ink-3">{me.user.email}</p>
            </div>
          </div>
          <Button variant="outline" icon={<LogOut />} loading={busy} onClick={() => void logout()}>
            Se déconnecter
          </Button>
        </div>
      </Card>
    </section>
  );
}
