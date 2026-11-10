import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type Ref } from 'react';

// A deliberately tiny history-API router: four routes don't need a library.

const NAVIGATE_EVENT = 'plantes:navigate';

export type Route =
  { name: 'home' } | { name: 'plant'; id: number } | { name: 'settings' } | { name: 'archives' } | { name: 'notfound' };

interface HistoryState {
  fromApp?: boolean;
  scrollY?: number;
}

function readState(): HistoryState {
  const state: unknown = window.history.state;
  return state && typeof state === 'object' ? (state as HistoryState) : {};
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

export function usePathname(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => '/',
  );
}

export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/' || path === '') return { name: 'home' };
  const plant = /^\/plante\/(\d{1,9})$/.exec(path);
  if (plant?.[1]) return { name: 'plant', id: Number(plant[1]) };
  if (path === '/reglages') return { name: 'settings' };
  if (path === '/archives') return { name: 'archives' };
  return { name: 'notfound' };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  const target = url.pathname + url.search + url.hash;
  const current = readState();
  // Remember where we were so "back" can restore the scroll position.
  window.history.replaceState({ ...current, scrollY: window.scrollY }, '');
  if (options.replace) {
    window.history.replaceState({ fromApp: current.fromApp ?? false, scrollY: 0 } satisfies HistoryState, '', target);
  } else {
    window.history.pushState({ fromApp: true, scrollY: 0 } satisfies HistoryState, '', target);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  if (!url.hash) window.scrollTo(0, 0);
}

/** Back within the app when possible, otherwise to `fallback` (deep link, notification). */
export function goBack(fallback = '/'): void {
  if (readState().fromApp) window.history.back();
  else navigate(fallback, { replace: true });
}

/** Restores the scroll position saved by navigate() once the page content is rendered. */
export function useRestoreScroll(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const y = readState().scrollY;
    if (typeof y === 'number' && y > 0) window.scrollTo(0, y);
  }, [ready]);
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; ref?: Ref<HTMLAnchorElement> };

export function Link({ to, onClick, target, ref, ...rest }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (target && target !== '_self') return;
    event.preventDefault();
    navigate(to);
  }
  return <a ref={ref} href={to} target={target} onClick={handleClick} {...rest} />;
}
