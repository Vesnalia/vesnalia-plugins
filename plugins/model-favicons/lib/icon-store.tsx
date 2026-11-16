// The live override map, shared between the registered icon components and the
// settings page.
//
// VesnALIA collects `experimental_providerIcon` registrations once, when it
// interprets the plugin's app bundle, and a second registration for the same
// (kind, provider id) throws. The registered mark must therefore be a stable
// component that *reads* the current choice at render time rather than a
// component bound to one mark.
//
// The server owns the persisted map (alia.storage.kv). This module caches the
// last map the app fetched, so rendering a provider icon never waits on a
// round trip; the page and the realtime signal refresh it.

import { MARKS, isMarkId } from "./provider-marks";
import type { MarkId } from "./provider-marks";
import type { Mark } from "./marks";

/** provider id -> mark id. */
export type Overrides = Record<string, string>;

let overrides: Overrides = {};

/** Replace the cached map. Called after every fetch and on the realtime signal. */
export function setOverrides(next: Overrides): void {
  overrides = next;
}

export function getOverrides(): Overrides {
  return overrides;
}

/**
 * The mark a provider id draws.
 *
 * An explicit override wins. Otherwise the built-in default applies. A
 * provider with neither keeps VesnALIA's own logo, which is what we want: the
 * plugin must not repaint providers that already look right.
 */
export function markFor(providerId: string): MarkId | undefined {
  const override = overrides[providerId];
  if (override !== undefined && isMarkId(override)) return override;
  return undefined;
}

/**
 * A stable component for one provider id.
 *
 * The identity never changes, so VesnALIA keeps the registration, but the mark it
 * draws follows the current override.
 */
export function providerIconComponent(providerId: string, fallback: Mark): Mark {
  return function ProviderIcon({ className }: { className?: string }) {
    const markId = markFor(providerId);
    const Component = markId === undefined ? fallback : MARKS[markId];
    return <Component className={className} />;
  };
}
