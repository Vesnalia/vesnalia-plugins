import { useEffect, useState } from "react";

/** VesnALIA's bundled list; thread-tree draws its own GitHub folder, so only this one gets ours. */
const ALIA_THREAD_LIST = '[data-sidebar="content"] > [data-alia-plugin="thread-list"]';

/** A host element kept right above VesnALIA's own thread list, or null while that list isn't shown. */
export function useAliaThreadListAnchor(pluginId: string): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const element = document.createElement("div");
    element.setAttribute("data-alia-plugin-root", "");
    element.setAttribute("data-alia-plugin", pluginId);
    element.setAttribute("data-github-folder-anchor", "");
    let frame = 0;

    const place = () => {
      frame = 0;
      const list = document.querySelector(ALIA_THREAD_LIST);
      if (!list) {
        if (element.isConnected) element.remove();
        setHost(null);
        return;
      }
      if (element.nextElementSibling !== list) list.before(element);
      setHost(element);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(place);
    };

    place();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      element.remove();
    };
  }, [pluginId]);

  return host;
}
