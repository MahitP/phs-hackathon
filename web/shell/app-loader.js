// The app's scripts load only when they're needed (near the end of the story, on a click, or straight
// away on app.html), so the story's first load is unchanged. They are classic scripts that share globals
// (THREE r128, Chart, L, Globe, LocalMap, SkyApp), so they run in this order.
export const APP_SCRIPTS = ["vendor/three.min.js", "vendor/chart.umd.min.js", "vendor/leaflet.min.js", "app/globe.js", "app/local.js", "app/app.js"];

let loading = null;
const hooks = [];

/** run fn(app) once, when the app's scripts have loaded (now, if they already have) */
export function whenAppLoads(fn) { hooks.push(fn); if (window.SkyApp) fn(window.SkyApp); }

/** Resolves with window.SkyApp once every script has run (rejects if one fails to load). */
export function loadApp() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    let left = APP_SCRIPTS.length;
    for (const src of APP_SCRIPTS) {
      const s = document.createElement("script");
      s.src = src; s.async = false; // keep their order
      s.onload = () => {
        if (--left) return;
        if (!window.SkyApp) { reject(new Error("app did not start")); return; }
        hooks.forEach((fn) => fn(window.SkyApp));
        resolve(window.SkyApp);
      };
      s.onerror = () => reject(new Error("couldn't load " + src));
      document.head.appendChild(s);
    }
  });
  loading.catch(() => { loading = null; }); // a later click may try again
  return loading;
}
