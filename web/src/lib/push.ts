import type { PushSubscriptionRequest } from '../../../shared/api.ts';
import { api } from './api.ts';

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

export function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia('(display-mode: standalone)').matches;
}

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const view = new Uint8Array(a);
  return view.every((byte, index) => byte === b[index]);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

export async function getPushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription();
    return subscription && Notification.permission === 'granted' ? 'on' : 'off';
  } catch {
    return 'unsupported';
  }
}

export function toRequest(subscription: PushSubscription): PushSubscriptionRequest {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error("L'abonnement aux notifications est incomplet.");
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

export class PushPermissionError extends Error {}

/** Asks for permission, subscribes this device and returns the subscription. */
export async function enablePush(vapidPublicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new PushPermissionError(
      permission === 'denied'
        ? 'Notifications bloquées : autorise-les dans les réglages du navigateur.'
        : "Tu n'as pas autorisé les notifications.",
    );
  }
  const reg = await registration();
  const key = base64UrlToBytes(vapidPublicKey);
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // A subscription made with another server key cannot be reused.
    if (sameKey(existing.options.applicationServerKey, key)) return existing;
    await existing.unsubscribe();
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

/** Unsubscribes this device and returns the endpoint to forget on the server. */
export async function disablePush(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

/**
 * Re-sends this device's subscription (idempotent on the server): push
 * services rotate endpoints, and a restored server may have lost it.
 */
export async function resyncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) await api.subscribePush(toRequest(subscription));
}
