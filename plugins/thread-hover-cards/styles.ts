export const HOVER_CARD_CSS = String.raw`
.alia-thread-hover-card {
  position: fixed;
  z-index: 50;
  width: min(20rem, calc(100vw - 1rem));
  max-height: calc(100vh - 1rem);
  overflow: hidden;
  padding: 0.75rem;
  border: 1px solid transparent;
  border-color:
    color-mix(in srgb, var(--foreground) 4%, transparent);
  border-radius: var(--radius-lg, 0.5rem);
  background: var(--popover);
  background: color-mix(in srgb, var(--popover) 82%, transparent);
  color: var(--popover-foreground);
  box-shadow:
    0 0.75rem 2.5rem
      color-mix(in srgb, var(--foreground) 12%, transparent),
    inset 0 1px 0
      color-mix(in srgb, var(--background) 34%, transparent);
  backdrop-filter: blur(18px) saturate(1.25);
  -webkit-backdrop-filter: blur(18px) saturate(1.25);
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1.35;
  pointer-events: auto;
  user-select: text;
}

.alia-thread-hover-card.is-visible {
  animation: alia-thread-hover-card-in 120ms ease-out both;
}

.alia-thread-hover-card__header,
.alia-thread-hover-card__provider,
.alia-thread-hover-card__provider-identity,
.alia-thread-hover-card__times,
.alia-thread-hover-card__context,
.alia-thread-hover-card__project,
.alia-thread-hover-card__host,
.alia-thread-hover-card__local,
.alia-thread-hover-card__pr,
.alia-thread-hover-card__access,
.alia-thread-hover-card__meta {
  display: flex;
  min-width: 0;
  align-items: center;
}

.alia-thread-hover-card__header {
  gap: 0.5rem;
  color: var(--muted-foreground);
  font-size: 0.6875rem;
  font-weight: 400;
}

.alia-thread-hover-card__icon {
  width: 0.875rem;
  height: 0.875rem;
  flex: none;
  color: var(--muted-foreground);
}

.alia-thread-hover-card__runtime,
.alia-thread-hover-card__loading,
.alia-thread-hover-card__meta-label {
  color: var(--muted-foreground);
}

.alia-thread-hover-card__runtime {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.1875rem;
  font-variant-numeric: tabular-nums;
}

.alia-thread-hover-card__provider {
  flex: 1 1 auto;
  gap: 0.25rem;
  color: var(--muted-foreground);
}

.alia-thread-hover-card__provider-identity {
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-start;
  gap: 0.25rem;
  overflow: hidden;
}

.alia-thread-hover-card__provider-model,
.alia-thread-hover-card__reasoning,
.alia-thread-hover-card__access {
  font-size: 0.75rem;
  line-height: 1.25;
}

.alia-thread-hover-card__reasoning,
.alia-thread-hover-card__access {
  flex: none;
  color: var(
    --subtle-foreground,
    color-mix(in srgb, var(--muted-foreground) 76%, transparent)
  );
  white-space: nowrap;
}

.alia-thread-hover-card__times {
  flex: none;
  gap: 0.375rem;
  margin-left: auto;
  white-space: nowrap;
}

.alia-thread-hover-card__time-icon {
  width: 0.75rem;
  height: 0.75rem;
  color: color-mix(in srgb, var(--muted-foreground) 74%, transparent);
}

.alia-thread-hover-card__time-icon[data-tone="working"] {
  color: color-mix(in srgb, var(--muted-foreground) 62%, transparent);
}

.alia-thread-hover-card__time-icon[data-tone="danger"] {
  color: var(--destructive);
}

.alia-thread-hover-card__time-icon[data-tone="warning"] {
  color: var(--warning-text, var(--warning));
}

.alia-thread-hover-card__time-icon[data-tone="success"] {
  color: var(--success);
}

.alia-thread-hover-card__summary,
.alia-thread-hover-card__message,
.alia-thread-hover-card__meta,
.alia-thread-hover-card__loading {
  margin: 0;
}

.alia-thread-hover-card__summary {
  position: relative;
  min-width: 0;
  margin-top: 0.625rem;
  padding-block: 0.1875rem;
}

.alia-thread-hover-card__message {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--foreground) 88%, transparent);
  font-size: 0.78125rem;
  font-weight: 350;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

@supports ((background-clip: text) or (-webkit-background-clip: text)) {
  .alia-thread-hover-card__summary[data-working="true"]
    .alia-thread-hover-card__message {
    background: linear-gradient(
      105deg,
      color-mix(in srgb, var(--foreground) 84%, transparent) 0%,
      color-mix(in srgb, var(--foreground) 84%, transparent) 40%,
      var(--foreground) 50%,
      color-mix(in srgb, var(--foreground) 84%, transparent) 60%,
      color-mix(in srgb, var(--foreground) 84%, transparent) 100%
    );
    background-position: 130% 0;
    background-size: 220% 100%;
    background-clip: text;
    color: transparent;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: alia-thread-hover-card-message-shimmer 3.4s ease-in-out infinite;
  }

  .alia-thread-hover-card__summary[data-working="true"]
    .alia-thread-hover-card__inline-code {
    color: color-mix(in srgb, var(--foreground) 88%, transparent);
    -webkit-text-fill-color: currentColor;
  }
}

.alia-thread-hover-card__provider-icon {
  width: 1rem;
  height: 1rem;
  color: var(--muted-foreground);
  object-fit: contain;
}

.alia-thread-hover-card__provider-model {
  color: var(--muted-foreground);
  font-weight: 400;
}

.alia-thread-hover-card__provider-model.alia-thread-hover-card__truncate {
  flex: 0 1 auto;
  color: var(--muted-foreground);
}

.alia-thread-hover-card__context {
  width: 100%;
  flex-wrap: nowrap;
  gap: 0.375rem;
  margin-top: 0.5rem;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 0.65625rem;
  white-space: nowrap;
}

.alia-thread-hover-card__project,
.alia-thread-hover-card__host {
  gap: 0.25rem;
  overflow: hidden;
}

.alia-thread-hover-card__project {
  max-width: 38%;
  flex: 0 1 auto;
}

.alia-thread-hover-card__context[data-has-host="false"]
  .alia-thread-hover-card__project {
  max-width: 100%;
  flex: 1 1 auto;
}

.alia-thread-hover-card__host {
  flex: 1 1 4rem;
  min-width: 0;
}

.alia-thread-hover-card__project-name,
.alia-thread-hover-card__host-name,
.alia-thread-hover-card__local-path {
  min-width: 0;
  overflow: hidden;
  color: var(--muted-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alia-thread-hover-card__project-name,
.alia-thread-hover-card__host-name,
.alia-thread-hover-card__local-path {
  flex: 1 1 auto;
}

.alia-thread-hover-card__local {
  width: 100%;
  flex-wrap: nowrap;
  gap: 0.375rem;
  margin-top: 0.3125rem;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 0.6875rem;
  white-space: nowrap;
}

.alia-thread-hover-card__meta {
  gap: 0.375rem;
}

.alia-thread-hover-card__meta-icon {
  width: 0.75rem;
  height: 0.75rem;
  color: color-mix(in srgb, var(--muted-foreground) 78%, transparent);
}

.alia-thread-hover-card__meta-label {
  flex: none;
}

.alia-thread-hover-card__truncate {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alia-thread-hover-card__pr {
  flex: none;
  align-items: center;
  overflow: visible;
}

.alia-thread-hover-card__access {
  gap: 0.1875rem;
  margin-left: 0.25rem;
}

.alia-thread-hover-card__permission-icon {
  width: 0.75rem;
  height: 0.75rem;
  color: currentColor;
}

.alia-thread-hover-card__access[data-permission-mode="accept-edits"],
.alia-thread-hover-card__access[data-permission-mode="workspace-write"],
.alia-thread-hover-card__access[data-permission-mode="auto"] {
  color: color-mix(in srgb, var(--muted-foreground) 72%, transparent);
}

.alia-thread-hover-card__access[data-permission-mode="full"] {
  color: color-mix(
    in srgb,
    var(--warning-text, var(--warning)) 78%,
    var(--muted-foreground)
  );
}

.alia-thread-hover-card__pr-link {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.1875rem;
  border-radius: 0.25rem;
  color: var(--foreground);
  outline: none;
  text-decoration: none;
}

.alia-thread-hover-card__pr-number {
  flex: none;
}

.alia-thread-hover-card__inline-code {
  padding: 0.025rem 0.175rem;
  border-radius: 0.2rem;
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
}

.alia-thread-hover-card__inline-link {
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 30%, transparent);
  text-underline-offset: 0.1rem;
}

.alia-thread-hover-card__inline-strong {
  font-weight: 550;
}

.alia-thread-hover-card__inline-emphasis {
  font-style: italic;
}

.alia-thread-hover-card__inline-strike {
  color: var(--muted-foreground);
}

.alia-thread-hover-card__pr-link:hover {
  text-decoration: underline;
  text-underline-offset: 0.125rem;
}

.alia-thread-hover-card__pr-link:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.alia-thread-hover-card__pr-status {
  flex: none;
  padding: 0.03125rem 0.25rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted-foreground) 7%, transparent);
  color: var(--muted-foreground);
  font-size: 0.5625rem;
  font-weight: 500;
  line-height: 1.35;
}

.alia-thread-hover-card__pr-status[data-tone="success"] {
  border-color: color-mix(in oklab, var(--success) 18%, transparent);
  background: color-mix(in oklab, var(--success) 9%, transparent);
  color: color-mix(in oklab, var(--success) 80%, var(--foreground));
}

.alia-thread-hover-card__pr-status[data-tone="danger"] {
  border-color:
    color-mix(in oklab, var(--destructive-text, var(--destructive)) 18%, transparent);
  background:
    color-mix(in oklab, var(--destructive-text, var(--destructive)) 8%, transparent);
  color: var(--destructive-text, var(--destructive));
}

.alia-thread-hover-card__pr-status[data-tone="merged"] {
  border-color: color-mix(in oklab, var(--pr-merged) 18%, transparent);
  background: color-mix(in oklab, var(--pr-merged) 9%, transparent);
  color: var(--pr-merged);
}

.alia-thread-hover-card__link-icon {
  flex: none;
  width: 0.75rem;
  height: 0.75rem;
  color: color-mix(in srgb, var(--muted-foreground) 82%, transparent);
}

.alia-thread-hover-card__loading {
  padding: 0.125rem 0;
}

.alia-thread-hover-card__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@keyframes alia-thread-hover-card-in {
  from {
    opacity: 0;
    transform: translateX(-0.2rem) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes alia-thread-hover-card-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes alia-thread-hover-card-message-shimmer {
  0%,
  32% {
    background-position: 130% 0;
  }

  100% {
    background-position: -130% 0;
  }
}

.alia-thread-hover-card__status-icon[data-animated="true"],
.alia-thread-hover-card__time-icon[data-animated="true"] {
  animation: alia-thread-hover-card-spin 1s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .alia-thread-hover-card.is-visible,
  .alia-thread-hover-card__status-icon[data-animated="true"],
  .alia-thread-hover-card__time-icon[data-animated="true"],
  .alia-thread-hover-card__summary[data-working="true"]
    .alia-thread-hover-card__message {
    animation: none;
  }
}

@supports not (
  (backdrop-filter: blur(1px)) or
    (-webkit-backdrop-filter: blur(1px))
) {
  .alia-thread-hover-card {
    background: var(--popover);
  }
}
`;

/**
 * The section card reuses the thread card's shell and header rhythm; only the
 * parts with no thread-card equivalent — the rollup and the thread list — get
 * their own rules.
 */
export const SECTION_CARD_CSS = String.raw`
/* Aggregates are short; the card hugs them instead of reserving thread-card width. */
/* Counts are short; the card hugs them rather than reserving thread-card width. */
.alia-thread-hover-card[data-alia-card="section"] {
  width: max-content;
  max-width: min(20rem, calc(100vw - 1rem));
  padding: 0.625rem 0.75rem;
  font-size: 0.6875rem;
}

/* Band 1 — the projects this section spans. */
.alia-section-hover-card__band {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.375rem;
  overflow: hidden;
  color: var(--muted-foreground);
  white-space: nowrap;
}

.alia-section-hover-card__project {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.alia-section-hover-card__sep {
  flex: none;
  opacity: 0.45;
}

.alia-section-hover-card__more {
  flex: none;
  opacity: 0.7;
}

/* Band 2 — present only when something wants action. */
.alia-section-hover-card__headline {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.875rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.alia-section-hover-card__chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.25rem;
  font-variant-numeric: tabular-nums;
  font-weight: 450;
}

.alia-section-hover-card__chip-icon {
  width: 0.6875rem;
  height: 0.6875rem;
}

/*
 * A question is a routine prompt, not an incident: VesnALIA renders its own pending
 * glyph muted and saves destructive for failures. Colouring both red would
 * stop the one that is actually broken from standing out.
 */
.alia-section-hover-card__chip--question {
  color: var(--foreground);
}

.alia-section-hover-card__chip--question .alia-section-hover-card__chip-icon {
  color: var(--subtle-foreground, var(--muted-foreground));
}

.alia-section-hover-card__chip--failed {
  color: var(--destructive-text, var(--destructive));
}

.alia-section-hover-card__chip--failed .alia-section-hover-card__chip-icon {
  color: var(--destructive-text, var(--destructive));
}

/* Band 3 — fixed positions, so the row is read rather than scanned. */
.alia-section-hover-card__counts {
  display: flex;
  align-items: baseline;
  gap: 0.875rem;
  margin-top: 0.5rem;
  padding-top: 0.4375rem;
  border-top: 1px solid color-mix(in srgb, var(--foreground) 7%, transparent);
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.alia-section-hover-card__count {
  flex: none;
}

.alia-section-hover-card__count-value {
  color: var(--foreground);
  font-weight: 500;
}

.alia-section-hover-card__count[data-zero="true"] {
  opacity: 0.4;
}

.alia-section-hover-card__empty {
  margin: 0;
  color: var(--muted-foreground);
}
`;
