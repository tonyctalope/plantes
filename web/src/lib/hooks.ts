import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, isAbortError } from './api.ts';

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  setData: (update: T | ((current: T | undefined) => T | undefined)) => void;
}

/** Loads `loader` when `key` changes; `reload()` refetches in the background. */
export function useResource<T>(key: string, loader: (signal: AbortSignal) => Promise<T>): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loaderRef = useRef(loader);

  useLayoutEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loaderRef
      .current(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setError(
          reason instanceof ApiError ? reason : new ApiError(0, 'unknown', 'Une erreur inattendue est survenue.'),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}

/** Calls `callback` when the app comes back to the foreground (at most every 20 s). */
export function useOnForeground(callback: () => void): void {
  const ref = useRef(callback);
  useLayoutEffect(() => {
    ref.current = callback;
  });
  useEffect(() => {
    let last = Date.now();
    const handler = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 20_000) return;
      last = Date.now();
      ref.current();
    };
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', handler);
    };
  }, []);
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
