// Scroll → story time.
// Every chapter is a real <section data-ch>. Story time T = chapter index + how far through that
// section we are (0..1), so a taller section simply plays slower (edolus calls these stretch bands).
// Lenis smooths the native scroll; after the visitor stops near a hero pose we glide onto it.
import { clamp, easeInOut } from "./util.js";

export function createScroll({ reduced, snaps = [], onSnap = () => {} }) {
  const sections = [...document.querySelectorAll("[data-ch]")];
  const n = sections.length;
  let tops = [], heights = [];
  const lenis = reduced ? null : new window.Lenis({ lerp: 0.075, wheelMultiplier: 0.85, touchMultiplier: 1.3, smoothWheel: true });

  function measure() {
    tops = sections.map((s) => s.offsetTop);
    heights = sections.map((s) => s.offsetHeight);
  }

  const y = () => (lenis ? lenis.animatedScroll : window.scrollY);
  function tAt(px) {
    for (let i = 0; i < n; i++) if (px < tops[i] + heights[i] || i === n - 1) return i + clamp((px - tops[i]) / Math.max(1, heights[i]));
    return n;
  }
  function pxAt(T) {
    const i = clamp(Math.floor(T), 0, n - 1);
    return tops[i] + (T - i) * heights[i];
  }

  let lastY = 0, idle = 0, snapped = true, snapping = false;
  function update(dt) {
    const cur = y();
    if (Math.abs(cur - lastY) > 0.6) { idle = 0; snapped = false; } else idle += dt;
    lastY = cur;
    if (!lenis || snapped || snapping || idle < 0.26) return;
    snapped = true;
    const T = tAt(cur);
    let best = null, bestD = 0.055;
    for (const s of snaps) { const d = Math.abs(s - T); if (d < bestD) { bestD = d; best = s; } }
    if (best === null) return;
    const target = pxAt(best);
    if (Math.abs(target - cur) < 3) return;
    snapping = true;
    onSnap(best);
    lenis.scrollTo(target, { duration: 0.9, easing: easeInOut, onComplete: () => (snapping = false) });
    setTimeout(() => (snapping = false), 1100);
  }

  function scrollToT(T, { immediate = false, duration = 2.2 } = {}) {
    const px = pxAt(T);
    if (lenis) lenis.scrollTo(px, { immediate, duration, easing: easeInOut, force: true });
    else window.scrollTo({ top: px, behavior: immediate ? "auto" : "smooth" });
  }

  measure();
  window.addEventListener("resize", measure);
  return {
    lenis, sections, n, measure, update, scrollToT, pxAt,
    get T() { return tAt(y()); },
    lock(on) { if (!lenis) { document.documentElement.style.overflow = on ? "hidden" : ""; return; } on ? lenis.stop() : lenis.start(); },
  };
}
