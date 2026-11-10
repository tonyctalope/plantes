import type {
  ApiError as ApiErrorBody,
  BulkWaterRequest,
  CareRequest,
  ConnectionsResponse,
  MeResponse,
  PlantDetail,
  PlantPatch,
  PlantsResponse,
  PushSubscriptionRequest,
  SnoozeRequest,
  UserSettings,
} from '../../../shared/api.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Called whenever the server answers 401: the app goes back to the login screen. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function defaultMessage(status: number): string {
  if (status === 403) return 'Action refusée.';
  if (status === 404) return 'Introuvable.';
  if (status === 413) return 'Fichier trop volumineux.';
  if (status === 429) return 'Trop de requêtes, réessaie dans un instant.';
  if (status >= 500) return 'Le serveur a rencontré une erreur. Réessaie plus tard.';
  return 'La requête a échoué.';
}

function parseError(status: number, text: string): ApiError {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = text ? (JSON.parse(text) as Partial<ApiErrorBody>) : null;
  } catch {
    body = null;
  }
  const message = typeof body?.message === 'string' && body.message ? body.message : defaultMessage(status);
  const code = typeof body?.error === 'string' && body.error ? body.error : `http_${status}`;
  return new ApiError(status, code, message);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, 'network', 'Connexion impossible. Vérifie ta connexion internet.');
  }

  if (response.status === 401) {
    unauthorizedHandler?.();
    throw new ApiError(401, 'unauthorized', 'Ta session a expiré, reconnecte-toi.');
  }

  const text = response.status === 204 ? '' : await response.text();
  if (!response.ok) throw parseError(response.status, text);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, 'bad_json', 'Réponse inattendue du serveur.');
  }
}

/** multipart upload with progress (fetch cannot report upload progress). */
function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401) {
        unauthorizedHandler?.();
        reject(new ApiError(401, 'unauthorized', 'Ta session a expiré, reconnecte-toi.'));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(parseError(xhr.status, xhr.responseText));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch {
        reject(new ApiError(xhr.status, 'bad_json', 'Réponse inattendue du serveur.'));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Envoi impossible. Vérifie ta connexion internet.'));
    xhr.onabort = () => reject(new DOMException('Envoi annulé', 'AbortError'));
    xhr.send(form);
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Une erreur inattendue est survenue.';
}

export const api = {
  me: (signal?: AbortSignal) => request<MeResponse>('GET', '/api/me', undefined, signal),

  plants: (archived = false, signal?: AbortSignal) =>
    request<PlantsResponse>('GET', archived ? '/api/plants?archived=1' : '/api/plants', undefined, signal),

  plant: (id: number, signal?: AbortSignal) => request<PlantDetail>('GET', `/api/plants/${id}`, undefined, signal),

  patchPlant: (id: number, patch: PlantPatch) => request<PlantDetail>('PATCH', `/api/plants/${id}`, patch),

  care: (id: number, body: CareRequest) => request<PlantDetail>('POST', `/api/plants/${id}/care`, body),

  deleteCare: (id: number, eventId: number) => request<PlantDetail>('DELETE', `/api/plants/${id}/care/${eventId}`),

  waterMany: (ids: number[]) =>
    request<PlantsResponse>('POST', '/api/plants/water', { ids } satisfies BulkWaterRequest),

  snooze: (id: number, days: number) =>
    request<PlantDetail>('POST', `/api/plants/${id}/snooze`, { days } satisfies SnoozeRequest),

  archive: (id: number, reason?: string) =>
    request<PlantDetail>('POST', `/api/plants/${id}/archive`, reason ? { reason } : {}),

  unarchive: (id: number) => request<PlantDetail>('POST', `/api/plants/${id}/unarchive`),

  deletePlant: (id: number) => request<void>('DELETE', `/api/plants/${id}`),

  uploadPhoto: (id: number, file: File, onProgress?: (fraction: number) => void) => {
    const form = new FormData();
    form.append('photo', file, file.name);
    return upload<PlantDetail>(`/api/plants/${id}/photo`, form, onProgress);
  },

  saveSettings: (settings: UserSettings) => request<UserSettings>('PUT', '/api/settings', settings),

  subscribePush: (subscription: PushSubscriptionRequest) =>
    request<void>('POST', '/api/push/subscriptions', subscription),

  unsubscribePush: (endpoint: string) => request<void>('DELETE', '/api/push/subscriptions', { endpoint }),

  testPush: () => request<{ sent: number }>('POST', '/api/push/test'),

  connections: (signal?: AbortSignal) => request<ConnectionsResponse>('GET', '/api/connections', undefined, signal),

  revokeConnection: (id: string) => request<void>('DELETE', `/api/connections/${encodeURIComponent(id)}`),

  logout: () => request<void>('POST', '/auth/logout'),
};
