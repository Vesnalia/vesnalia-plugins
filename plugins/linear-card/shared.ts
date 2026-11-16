// Values shared by server.ts and app.tsx. Kept apart so the app bundle never
// pulls in server code.

/** Realtime channel; payload `{ threadId }` names the thread whose card changed. */
export const CARD_CHANGED = "card-changed";

/** Realtime channel; payload `{ projectIds }` is the new enabled-project list. */
export const ENABLED_PROJECTS_CHANGED = "enabled-projects-changed";
