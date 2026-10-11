// Story and live window share one document; the URL says which is showing.
// app.html (or ?live) is the live window, anything else is the story. Moving between them pushes
// history, so Back reverses the hand-off. Query flags (token, tier, debug) are carried across.
const isLiveURL = (u) => /(^|\/)app\.html$/.test(u.pathname) || u.searchParams.has("live");

function urlFor(mode) {
  const u = new URL(location.href);
  u.searchParams.delete("live"); u.searchParams.delete("t"); u.searchParams.delete("autoenter");
  u.hash = "";
  const dir = u.pathname.replace(/[^/]*$/, "");
  u.pathname = mode === "live" ? dir + "app.html" : dir + (/(^|\/)index\.html$/.test(location.pathname) ? "index.html" : "");
  return u.pathname + u.search;
}

export function createRouter() {
  let mode = isLiveURL(new URL(location.href)) ? "live" : "story";
  // the shell places the story itself on Back (at its last chapter); the browser restoring the old
  // scroll offset after popstate would undo that
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const subs = new Set();
  const notify = (opts) => subs.forEach((fn) => fn(mode, opts));

  window.addEventListener("popstate", () => {
    const m = isLiveURL(new URL(location.href)) ? "live" : "story";
    if (m !== mode) { mode = m; notify({ fromHistory: true }); }
  });
  // restored from the back/forward cache: the page may show a different URL than it left with
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    const m = isLiveURL(new URL(location.href)) ? "live" : "story";
    if (m !== mode) { mode = m; notify({ instant: true }); }
  });

  return {
    get mode() { return mode; },
    /** change mode from the page (a click): new history entry, then the hand-off */
    go(m, opts = {}) {
      if (m === mode) return;
      mode = m;
      history.pushState({ mode: m }, "", urlFor(m));
      notify(opts);
    },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    urlFor,
  };
}
