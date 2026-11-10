import { ShieldCheck } from 'lucide-react';
import { Logo } from '../components/bits.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export function Login() {
  useDocumentTitle('Connexion · Plantes');
  const here = window.location.pathname + window.location.search;
  const href = here && here !== '/' ? `/auth/google/start?next=${encodeURIComponent(here)}` : '/auth/google/start';

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] bg-[radial-gradient(ellipse_at_top,var(--brand-soft),transparent_70%)]"
      />
      <div className="relative w-full max-w-sm animate-fade-in text-center">
        <Logo className="mx-auto size-24 drop-shadow-lg" />
        <h1 className="mt-7 font-display text-5xl font-semibold tracking-tight">Plantes</h1>
        <p className="mt-3 text-lg text-balance text-ink-2">
          Les plantes de la maison, leurs fiches d'entretien et des rappels d'arrosage partagés.
        </p>
        <a
          href={href}
          className="mt-10 flex h-14 items-center justify-center gap-3 rounded-full border border-line bg-surface text-base font-semibold shadow-sm transition-colors hover:bg-surface-2 active:scale-[.98]"
        >
          <GoogleMark />
          Se connecter avec Google
        </a>
        <p className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-3">
          <ShieldCheck className="size-4" aria-hidden />
          Accès réservé aux membres du foyer.
        </p>
      </div>
    </main>
  );
}
