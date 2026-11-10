import { Sprout } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MeResponse } from '../../shared/api.ts';
import { Logo, PageContainer, TopBar } from './components/bits.tsx';
import { ConfirmProvider } from './components/Dialog.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { Button, buttonClass, Card } from './components/ui.tsx';
import { api, ApiError, errorMessage, setUnauthorizedHandler } from './lib/api.ts';
import { MeProvider, type MeContextValue } from './lib/me.tsx';
import { resyncPush } from './lib/push.ts';
import { Link, matchRoute, usePathname } from './lib/router.tsx';
import { Archives } from './pages/Archives.tsx';
import { Home } from './pages/Home.tsx';
import { Login } from './pages/Login.tsx';
import { PlantPage } from './pages/PlantPage.tsx';
import { Settings } from './pages/Settings.tsx';

type Session =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'error'; message: string }
  | { status: 'ready'; me: MeResponse };

export function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const me = await api.me();
      setSession({ status: 'ready', me });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setSession({ status: 'anonymous' });
      else setSession({ status: 'error', message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession({ status: 'anonymous' }));
    void load();
    return () => setUnauthorizedHandler(null);
  }, [load]);

  const ready = session.status === 'ready';
  useEffect(() => {
    // Keep this device's push subscription known to the server.
    if (ready) resyncPush().catch(() => undefined);
  }, [ready]);

  if (session.status === 'loading') return <Splash />;
  if (session.status === 'anonymous') return <Login />;
  if (session.status === 'error') return <ServerDown message={session.message} onRetry={() => void load()} />;
  return <AuthenticatedApp me={session.me} setSession={setSession} />;
}

function AuthenticatedApp({ me, setSession }: { me: MeResponse; setSession: (session: Session) => void }) {
  const setMe = useCallback<MeContextValue['setMe']>(
    (update) => setSession({ status: 'ready', me: update(me) }),
    [me, setSession],
  );
  const refreshMe = useCallback(async () => {
    try {
      setSession({ status: 'ready', me: await api.me() });
    } catch {
      // A 401 already switched to the login screen; other errors keep the current data.
    }
  }, [setSession]);
  const value = useMemo<MeContextValue>(() => ({ me, setMe, refreshMe }), [me, setMe, refreshMe]);

  return (
    <MeProvider value={value}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes />
        </ConfirmProvider>
      </ToastProvider>
    </MeProvider>
  );
}

function Routes() {
  const route = matchRoute(usePathname());
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'plant':
      return <PlantPage key={route.id} id={route.id} />;
    case 'settings':
      return <Settings />;
    case 'archives':
      return <Archives />;
    case 'notfound':
      return <NotFound />;
  }
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Chargement">
      <Logo className="size-16 animate-pulse" />
    </div>
  );
}

function ServerDown({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <Card className="max-w-sm p-7 text-center">
        <Logo className="mx-auto size-14" />
        <p className="mt-5 font-display text-2xl font-semibold">Serveur injoignable</p>
        <p className="mt-2 text-ink-2">{message}</p>
        <Button variant="soft" className="mt-6" onClick={onRetry}>
          Réessayer
        </Button>
      </Card>
    </main>
  );
}

function NotFound() {
  return (
    <>
      <TopBar back="/" />
      <PageContainer>
        <Card className="mx-auto mt-6 max-w-md p-8 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-brand-strong">
            <Sprout className="size-7" aria-hidden />
          </div>
          <h1 className="mt-4 font-display text-2xl font-semibold">Page introuvable</h1>
          <p className="mt-2 text-ink-2">Cette page n'existe pas (ou plus).</p>
          <Link to="/" className={buttonClass('soft', 'md', 'mt-6')}>
            Retour aux plantes
          </Link>
        </Card>
      </PageContainer>
    </>
  );
}
