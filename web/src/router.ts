// Path routing over the History API. Pages serves index.html for any path
// that is not a file (no top-level 404.html), so /p/<name> works when shared.

import { useEffect, useState } from "preact/hooks";

export interface Route {
  path: string;
  query: URLSearchParams;
}

function current(): Route {
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  if (!replace) window.scrollTo(0, 0);
  listeners.forEach((l) => l());
}

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const update = () => setRoute(current());
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return route;
}

/** Same-site links route without a page load. */
export function installLinkHandler() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.("a");
    if (!a || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/data/")) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
}

export const playerHref = (name: string) => `/p/${encodeURIComponent(name)}`;
export const compareHref = (a: string, b?: string, q?: URLSearchParams) =>
  `/compare/${encodeURIComponent(a)}${b ? "/" + encodeURIComponent(b) : ""}${q && [...q].length ? "?" + q : ""}`;
export const matchHref = (section: "pub" | "league", id: number) =>
  section === "league" ? `/league/m/${id}` : `/m/${id}`;
