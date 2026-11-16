// Small, consistent stroke icons for the panel and its labeled sample UI.
export function GlassIcon({ name }: { name: "down" | "up" | "check" | "more" }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "down" && <path d="M12 4v16m-6-6 6 6 6-6" />}
    {name === "up" && <path d="M12 20V4m-6 6 6-6 6 6" />}
    {name === "check" && <path d="m5 12 4 4L19 6" />}
    {name === "more" && <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>}
  </svg>;
}
