// These are host DOM hooks, not a public project-title slot. Keep this adapter isolated.
const selector = '[data-sidebar-project-id] [data-sidebar="group-label"] > span:first-child > span[title]';
export function mountProjectTitleLinks(root: Document, navigate: (projectId: string) => void) {
  const cleanups = new Map<HTMLElement, () => void>();
  const selectionCleanup = new Map<HTMLElement, () => void>();
  function updateSelection() {
    const projectId = root.querySelector('[data-project-page-id]')?.getAttribute('data-project-page-id');
    for (const element of cleanups.keys()) {
      const row = element.closest('[data-sidebar-project-id]');
      const header = element.closest<HTMLElement>('[data-sidebar="group-label"]');
      const selected = !!projectId && row?.getAttribute('data-sidebar-project-id') === projectId;
      if (selected && header && !selectionCleanup.has(element)) {
        const previous = element.getAttribute('aria-current');
        element.setAttribute('aria-current', 'page');
        header.setAttribute('data-project-page-current', '');
        selectionCleanup.set(element, () => {
          if (previous === null) element.removeAttribute('aria-current'); else element.setAttribute('aria-current', previous);
          header.removeAttribute('data-project-page-current');
        });
      } else if (!selected && selectionCleanup.has(element)) {
        selectionCleanup.get(element)!();
        selectionCleanup.delete(element);
      }
    }
  }
  function scan() {
    for (const [element, cleanup] of cleanups) {
      if (!element.isConnected || !element.matches(selector)) {
        selectionCleanup.get(element)?.(); selectionCleanup.delete(element);
        cleanup(); cleanups.delete(element);
      }
    }
    root.querySelectorAll<HTMLElement>(selector).forEach(element => {
      if (cleanups.has(element)) return;
      const projectRow = element.closest('[data-sidebar-project-id]');
      // Nested thread sections also have labels: only the outer project's header qualifies.
      if (projectRow?.querySelector('[data-sidebar="group-label"]') !== element.closest('[data-sidebar="group-label"]')) return;
      const original = new Map(["role", "tabindex", "data-project-page-link"].map(key => [key, element.getAttribute(key)]));
      element.setAttribute("role", "link");
      element.setAttribute("tabindex", "0");
      element.setAttribute("data-project-page-link", "");
      const activate = (event: MouseEvent | KeyboardEvent) => {
        if (event.defaultPrevented) return;
        const projectId = element.closest('[data-sidebar-project-id]')?.getAttribute('data-sidebar-project-id');
        if (!projectId) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          root.defaultView?.open(`/plugins/project-page/home/${encodeURIComponent(projectId)}`, "_blank", "noopener,noreferrer");
        } else {
          const inDrawer = element.closest('[role="dialog"][aria-label="Sidebar"]') !== null;
          navigate(projectId);
          if (inDrawer) root.querySelector<HTMLElement>('[data-sidebar="trigger"][aria-expanded="true"]')?.click();
        }
      };
      const click = (event: MouseEvent) => { if (event.button === 0) activate(event); };
      const keydown = (event: KeyboardEvent) => {
        // Keep the parent sortable row's keyboard sensor from treating Enter as a drag.
        if (event.key === "Enter") activate(event);
      };
      element.addEventListener("click", click);
      element.addEventListener("keydown", keydown);
      cleanups.set(element, () => {
        element.removeEventListener("click", click);
        element.removeEventListener("keydown", keydown);
        for (const [key, value] of original) {
          if (value === null) element.removeAttribute(key); else element.setAttribute(key, value);
        }
      });
    });
    updateSelection();
  }
  scan();
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      if (record.attributeName === "data-project-page-id") return true;
      if (record.target instanceof Element && record.target.closest('[data-sidebar-project-id], [data-project-page-id]')) return true;
      return [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(node => node instanceof Element &&
        (node.matches('[data-sidebar-project-id], [data-project-page-id]') || node.querySelector('[data-sidebar-project-id], [data-project-page-id]')));
    });
    if (relevant) scan();
  });
  observer.observe(root.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["title", "data-sidebar-project-id", "data-project-page-id"] });
  return () => {
    observer.disconnect();
    for (const cleanup of selectionCleanup.values()) cleanup();
    selectionCleanup.clear();
    for (const cleanup of cleanups.values()) cleanup();
    cleanups.clear();
  };
}
