import { useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc } from "@vesnalia/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Device = {
  id: string;
  name: string;
  enabled: boolean;
  notifyIdle: boolean;
  notifyFailed: boolean;
  showPreview: boolean;
  createdAt: number;
  updatedAt: number;
};

type PushState = {
  vapidPublicKey: string;
  workerUrl: string;
  workerScope: string;
  devices: Device[];
};

const DEVICE_ID_KEY = "alia-web-push-notify:device-id";
const DEVICE_NAME_KEY = "alia-web-push-notify:device-name";
let fallbackDeviceId: string | null = null;
let fallbackDeviceName = "This browser";

type PreparedWorker = {
  registration: ServiceWorkerRegistration;
  subscription: PushSubscription | null;
};

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function getDeviceId(): string {
  let existing: string | null = null;
  try {
    existing = window.localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    // Some privacy modes expose localStorage but reject access to it.
  }
  if (existing) return existing;
  fallbackDeviceId ??=
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    window.localStorage.setItem(DEVICE_ID_KEY, fallbackDeviceId);
  } catch {
    // Keep the module-scoped id stable for this page session.
  }
  return fallbackDeviceId;
}

function defaultDeviceName(): string {
  try {
    const stored = window.localStorage.getItem(DEVICE_NAME_KEY);
    if (stored) fallbackDeviceName = stored;
  } catch {
    // Fall back to memory when browser storage is unavailable.
  }
  return fallbackDeviceName;
}

function rememberDeviceName(name: string): void {
  fallbackDeviceName = name;
  try {
    window.localStorage.setItem(DEVICE_NAME_KEY, name);
  } catch {
    // The server still persists the name for the registered device.
  }
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let index = 0; index < bytes.length; index += 1) {
    output[index] = bytes.charCodeAt(index);
  }
  return output;
}

function sameApplicationServerKey(
  subscription: PushSubscription,
  expected: Uint8Array<ArrayBuffer>,
): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return (
    bytes.length === expected.length &&
    bytes.every((value, index) => value === expected[index])
  );
}

function waitForActiveWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorkerRegistration> {
  if (registration.active) return Promise.resolve(registration);
  return new Promise((resolve, reject) => {
    let worker: ServiceWorker | null = null;
    let timeoutId: number | undefined;

    const cleanup = () => {
      registration.removeEventListener("updatefound", attachWorker);
      worker?.removeEventListener("statechange", onStateChange);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
    const finishIfActive = () => {
      if (!registration.active) return false;
      cleanup();
      resolve(registration);
      return true;
    };
    const onStateChange = () => {
      if (finishIfActive()) return;
      if (!worker) return;
      if (worker.state === "activated") {
        cleanup();
        resolve(registration);
      } else if (worker.state === "redundant") {
        cleanup();
        reject(new Error("Service worker installation failed"));
      }
    };
    function attachWorker() {
      if (finishIfActive()) return;
      const nextWorker = registration.installing ?? registration.waiting;
      if (!nextWorker || nextWorker === worker) return;
      worker?.removeEventListener("statechange", onStateChange);
      worker = nextWorker;
      worker.addEventListener("statechange", onStateChange);
      onStateChange();
    }

    registration.addEventListener("updatefound", attachWorker);
    timeoutId = window.setTimeout(() => {
      if (finishIfActive()) return;
      cleanup();
      reject(new Error("Service worker activation timed out"));
    }, 15_000);
    attachWorker();
  });
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback}: ${error.message}` : fallback;
}

function SettingsSection() {
  const rpc = useRpc<typeof rpcContract>();
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    pushSupported() ? Notification.permission : "denied",
  );
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [renamingDevice, setRenamingDevice] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparedWorker, setPreparedWorker] = useState<PreparedWorker | null>(
    null,
  );
  const supported = useMemo(pushSupported, []);
  const deviceId = useMemo(getDeviceId, []);
  const currentDevice = pushState?.devices.find(
    (device) => device.id === deviceId,
  );

  async function refresh(): Promise<PushState> {
    const next = await rpc.call("getPushState", null);
    setPushState(next);
    const current = next.devices.find((device) => device.id === deviceId);
    if (current) setDeviceName(current.name);
    return next;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await refresh();
        if (!supported) return;
        const registration = await navigator.serviceWorker.register(
          next.workerUrl,
          { scope: next.workerScope },
        );
        await waitForActiveWorker(registration);
        const serverKey = applicationServerKey(next.vapidPublicKey);
        let subscription = await registration.pushManager.getSubscription();
        if (
          subscription &&
          !sameApplicationServerKey(subscription, serverKey)
        ) {
          await subscription.unsubscribe();
          subscription = null;
        }
        if (!cancelled) setPreparedWorker({ registration, subscription });
      } catch (error) {
        if (!cancelled) {
          setMessage(
            messageFor(error, "Could not prepare browser notifications"),
          );
        }
      }
    })();
    const updatePermission = () => {
      if (supported) setPermission(Notification.permission);
    };
    window.addEventListener("focus", updatePermission);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", updatePermission);
    };
  }, []);

  async function registerThisBrowser() {
    if (!supported || !pushState || !preparedWorker) return;
    setMessage(null);
    if (Notification.permission === "default") {
      setBusy(true);
      try {
        const nextPermission = await Notification.requestPermission();
        setPermission(nextPermission);
        setMessage(
          nextPermission === "granted"
            ? "Permission granted. Select Enable and test to finish setup."
            : "Notifications are blocked. Allow them in this site's browser settings, then try again.",
        );
      } catch (error) {
        setMessage(
          messageFor(error, "Could not request notification permission"),
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (Notification.permission !== "granted") {
      setPermission(Notification.permission);
      setMessage(
        "Notifications are blocked. Allow them in this site's browser settings, then try again.",
      );
      return;
    }

    // Invoke subscribe synchronously from the click. WebKit and other browsers
    // may require the transient user activation to still be present here.
    const subscriptionPromise = preparedWorker.subscription
      ? Promise.resolve(preparedWorker.subscription)
      : preparedWorker.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(
            pushState.vapidPublicKey,
          ),
        });
    setBusy(true);
    try {
      const subscription = await subscriptionPromise;
      setPreparedWorker({
        registration: preparedWorker.registration,
        subscription,
      });
      const serialized = subscription.toJSON();
      if (
        !serialized.endpoint ||
        !serialized.keys?.p256dh ||
        !serialized.keys.auth
      ) {
        throw new Error("Browser returned an incomplete push subscription");
      }

      const name = deviceName.trim() || "This browser";
      rememberDeviceName(name);
      await rpc.call("registerDevice", {
        id: deviceId,
        name,
        subscription: {
          endpoint: serialized.endpoint,
          keys: {
            p256dh: serialized.keys.p256dh,
            auth: serialized.keys.auth,
          },
        },
      });
      await rpc.call("sendTestNotification", { deviceId });
      await refresh();
      setMessage("This browser is registered. A Web Push test was sent.");
    } catch (error) {
      setMessage(messageFor(error, "Could not register this browser"));
    } finally {
      setBusy(false);
    }
  }

  async function updateDevice(
    id: string,
    changes: Partial<
      Pick<
        Device,
        "name" | "enabled" | "notifyIdle" | "notifyFailed" | "showPreview"
      >
    >,
  ) {
    setBusy(true);
    try {
      await rpc.call("updateDevice", { id, ...changes });
      await refresh();
      setMessage("Notification preferences saved.");
    } catch (error) {
      setMessage(messageFor(error, "Could not update the device"));
    } finally {
      setBusy(false);
    }
  }

  async function saveDeviceName() {
    if (!currentDevice) return;
    const name = deviceName.trim();
    if (!name) return;
    if (name === currentDevice.name) {
      setRenamingDevice(false);
      return;
    }
    setBusy(true);
    try {
      rememberDeviceName(name);
      await rpc.call("updateDevice", { id: deviceId, name });
      await refresh();
      setRenamingDevice(false);
      setMessage("Device name saved.");
    } catch (error) {
      setMessage(messageFor(error, "Could not save the device name"));
    } finally {
      setBusy(false);
    }
  }

  function cancelDeviceRename() {
    if (currentDevice) setDeviceName(currentDevice.name);
    setRenamingDevice(false);
  }

  async function removeDevice(device: Device) {
    setBusy(true);
    try {
      if (device.id === deviceId && pushState) {
        const registration = await navigator.serviceWorker.getRegistration(
          pushState.workerScope,
        );
        const subscription = await registration?.pushManager.getSubscription();
        await subscription?.unsubscribe();
        await registration?.unregister();
      }
      await rpc.call("removeDevice", { id: device.id });
      await refresh();
      setMessage(`${device.name} was removed.`);
    } catch (error) {
      setMessage(messageFor(error, "Could not remove the device"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(device: Device) {
    setBusy(true);
    try {
      await rpc.call("sendTestNotification", { deviceId: device.id });
      setMessage(`Test sent to ${device.name}.`);
    } catch (error) {
      setMessage(messageFor(error, "Could not send the test notification"));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const status = !supported
    ? "Web Push is unavailable in this browser"
    : permission === "denied"
      ? "Notifications are blocked by the browser"
      : currentDevice?.enabled
        ? "Web Push is enabled on this browser"
        : currentDevice
          ? "This browser is registered but disabled"
          : "This browser is not registered";
  const devices = [...(pushState?.devices ?? [])].sort((left, right) => {
    if (left.id === deviceId) return -1;
    if (right.id === deviceId) return 1;
    return 0;
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Web Push notifications</CardTitle>
          <CardDescription>
            Receive notifications when a VesnALIA agent finishes or fails, even after
            VesnALIA is closed. Delivery goes directly from your VesnALIA server to each
            enabled browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="text-sm font-medium text-foreground">{status}</p>
            <p className="text-sm text-muted-foreground">
              Permission: {supported ? permission : "unavailable"}
            </p>
          </div>

          {currentDevice ? (
            renamingDevice ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label="Device name"
                  value={deviceName}
                  maxLength={80}
                  autoFocus
                  onChange={(event) =>
                    setDeviceName(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveDeviceName();
                    if (event.key === "Escape") cancelDeviceRename();
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => void saveDeviceName()}
                    disabled={busy || !deviceName.trim()}
                    className="shrink-0"
                  >
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    onClick={cancelDeviceRename}
                    disabled={busy}
                    className="shrink-0"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {currentDevice.name}
                    </p>
                    <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      This browser
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {currentDevice.enabled
                      ? "Receiving notifications"
                      : "Notifications are disabled"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label="Rename"
                  disabled={busy}
                  onClick={() => setRenamingDevice(true)}
                >
                  <Icon name="Edit" className="!size-3.5" aria-hidden="true" />
                </Button>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Device name"
                value={deviceName}
                maxLength={80}
                onChange={(event) => setDeviceName(event.currentTarget.value)}
                placeholder="Name this browser"
              />
              <Button
                onClick={() => void registerThisBrowser()}
                disabled={!supported || !pushState || !preparedWorker || busy}
                className="shrink-0"
              >
                {permission === "default"
                  ? "Allow notifications"
                  : "Enable and test"}
              </Button>
            </div>
          )}

          {currentDevice ? (
            <div className="space-y-3 border-t border-border pt-4">
              <PreferenceToggle
                checked={currentDevice.notifyIdle}
                label="alia agent finished"
                description="Notify when a visible VesnALIA chat returns to idle."
                disabled={busy}
                onChange={(notifyIdle) =>
                  void updateDevice(deviceId, { notifyIdle })
                }
              />
              <PreferenceToggle
                checked={currentDevice.notifyFailed}
                label="alia agent failed"
                description="Notify when a visible VesnALIA chat enters an error state."
                disabled={busy}
                onChange={(notifyFailed) =>
                  void updateDevice(deviceId, { notifyFailed })
                }
              />
              <PreferenceToggle
                checked={currentDevice.showPreview}
                label="Show details"
                description="Include a short response or error preview on this device."
                disabled={busy}
                onChange={(showPreview) =>
                  void updateDevice(deviceId, { showPreview })
                }
              />
            </div>
          ) : null}

          {message ? (
            <p className="text-sm text-muted-foreground" role="status">
              {message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {devices.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Notification devices</CardTitle>
            <CardDescription>
              Only enabled devices receive notifications. Expired browser
              subscriptions are removed automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {devices.map((device) => (
              <div
                key={device.id}
                className={`flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 ${
                  device.id === deviceId ? "bg-muted/20" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {device.name}
                    </p>
                    {device.id === deviceId ? (
                      <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        This browser
                      </span>
                    ) : null}
                  </div>
                  <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={device.enabled}
                      disabled={busy}
                      onChange={(event) =>
                        void updateDevice(device.id, {
                          enabled: event.currentTarget.checked,
                        })
                      }
                    />
                    Receive notifications
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Test ${device.name}`}
                    disabled={busy || !device.enabled}
                    onClick={() => void sendTest(device)}
                  >
                    <Icon
                      name="Beaker"
                      className="!size-3.5"
                      aria-hidden="true"
                    />
                    Test
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    aria-label={`Remove ${device.name}`}
                    disabled={busy}
                    onClick={() => void removeDevice(device)}
                  >
                    <Icon
                      name="Trash2"
                      className="!size-3.5"
                      aria-hidden="true"
                    />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PreferenceToggle({
  checked,
  label,
  description,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 size-4 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "web-push-notifications",
    component: SettingsSection,
  });
});
