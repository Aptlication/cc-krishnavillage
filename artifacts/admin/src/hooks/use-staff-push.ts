import { useEffect, useRef, useState } from "react";
import { getVapidPublicKey } from "@workspace/api-client-react";

const BASE_URL = import.meta.env.BASE_URL as string;
const PREF_KEY = "staffPushAlertsEnabled";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function getApiBase(): string {
  if (typeof window === "undefined") return "/api";
  const base = BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base.replace(/\/[^/]*$/, "")}/api`;
}

function readToken(): string | null {
  try {
    const raw = localStorage.getItem("staffSession");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { session?: { token?: string } };
    return parsed.session?.token ?? null;
  } catch {
    return null;
  }
}

function readPref(): boolean {
  try {
    const val = localStorage.getItem(PREF_KEY);
    if (val === null) return true;
    return val === "true";
  } catch {
    return true;
  }
}

function writePref(val: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, String(val));
  } catch {}
}

async function registerSubscription(subscription: PushSubscription, token: string): Promise<void> {
  await fetch(`${getApiBase()}/notifications/staff-subscribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
}

async function unregisterSubscription(endpoint: string, token: string): Promise<void> {
  await fetch(`${getApiBase()}/notifications/staff-subscribe`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

export interface StaffPushResult {
  pushEnabled: boolean;
  setPushEnabled: (val: boolean) => void;
}

export function useStaffPush(loggedIn: boolean): StaffPushResult {
  const [enabled, setEnabledState] = useState(() => readPref());
  const subEndpointRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const setPushEnabled = (val: boolean) => {
    writePref(val);
    setEnabledState(val);
  };

  useEffect(() => {
    if (!loggedIn || !enabled) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    let cancelled = false;

    (async () => {
      try {
        const token = readToken();
        if (!token) return;

        const swUrl = `${BASE_URL}sw.js`;
        const reg = await navigator.serviceWorker.register(swUrl, { scope: BASE_URL });
        if (cancelled) return;

        const permissionResult = await Notification.requestPermission();
        if (cancelled || permissionResult !== "granted") return;

        const vapidResult = await getVapidPublicKey().catch(() => null);
        if (cancelled || !vapidResult?.publicKey) return;

        const applicationServerKey = urlBase64ToUint8Array(vapidResult.publicKey) as Uint8Array<ArrayBuffer>;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        }
        if (cancelled || !sub) return;

        subEndpointRef.current = sub.endpoint;
        tokenRef.current = token;
        await registerSubscription(sub, token);
      } catch {
        // Push not supported or denied — silently continue
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loggedIn, enabled]);

  useEffect(() => {
    if (loggedIn && enabled) return;

    const endpoint = subEndpointRef.current;
    const token = tokenRef.current ?? readToken();

    if (token) {
      if (endpoint) {
        unregisterSubscription(endpoint, token);
        subEndpointRef.current = null;
        tokenRef.current = null;
      } else if ("serviceWorker" in navigator && "PushManager" in window) {
        (async () => {
          try {
            const reg = await navigator.serviceWorker.getRegistration(BASE_URL);
            if (!reg) return;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
              await unregisterSubscription(sub.endpoint, token);
            }
          } catch {
            // Service worker not available or no subscription — nothing to remove
          }
        })();
      }
    }
  }, [loggedIn, enabled]);

  return { pushEnabled: enabled, setPushEnabled };
}
