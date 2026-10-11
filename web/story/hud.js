// Chapter text, bound numbers, the chapter rail and the verdict word. Text lives in the HTML so it is
// readable without WebGL; here it is faded and nudged in step with story time, and headlines fade in
// word by word (opacity, a short rise and a blur that clears) when their block comes into view.
import { band, clamp } from "./util.js";
import { STRETCH, LABEL, COLOR, COLOR_ON_DARK } from "../shell/copy.js";

/** Wrap each word of a heading in spans so the words can fade in one after another. */
function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute("aria-label", el.textContent.trim());
  el.textContent = "";
  return words.map((w, i) => {
    const outer = document.createElement("span"); outer.className = "w"; outer.setAttribute("aria-hidden", "true");
    const inner = document.createElement("span"); inner.className = "wi"; inner.textContent = w;
    outer.appendChild(inner); el.appendChild(outer);
    if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
    return inner;
  });
}

export function createHUD({ scroll, reduced }) {
  const animate = !reduced && !!window.gsap;
  const blocks = [...document.querySelectorAll("[data-ch] .copy")].map((el) => {
    const sec = el.closest("[data-ch]");
    const heads = [...el.querySelectorAll(":scope > h2, :scope > h3")];
    const words = animate ? heads.flatMap(splitWords) : [];
    const body = [...el.children].filter((c) => !heads.includes(c) && c.id !== "verdict-word" && !c.hasAttribute("data-beat"));
    if (animate) { if (words.length) gsap.set(words, { opacity: 0, y: 12, filter: "blur(6px)" }); if (body.length) gsap.set(body, { opacity: 0, y: 8 }); }
    return { el, i: scroll.sections.indexOf(sec), a: +(el.dataset.in ?? 0.03), b: +(el.dataset.out ?? 0.9), shown: false, words, body };
  });
  const binds = new Map();
  document.querySelectorAll("[data-bind]").forEach((el) => {
    const k = el.dataset.bind; if (!binds.has(k)) binds.set(k, []); binds.get(k).push(el);
  });
  const railFill = document.getElementById("rail-fill"), railName = document.getElementById("rail-name");
  const railTicks = [...document.querySelectorAll("#rail [data-go]")];
  const names = scroll.sections.map((s) => s.dataset.name || "");
  const verdictEl = document.getElementById("verdict-word");
  let lastName = "", lastVerdict = undefined;

  function set(key, text) {
    const els = binds.get(key); if (!els) return;
    for (const el of els) if (el.textContent !== text) el.textContent = text;
  }

  function reveal(b) {
    if (b.words.length) { gsap.killTweensOf(b.words); gsap.to(b.words, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.7, ease: "expo.out", stagger: 0.045, onComplete: () => gsap.set(b.words, { clearProps: "filter" }) }); }
    if (b.body.length) { gsap.killTweensOf(b.body); gsap.to(b.body, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out", stagger: 0.06, delay: 0.15 }); }
  }
  function conceal(b) {
    if (b.words.length) { gsap.killTweensOf(b.words); gsap.to(b.words, { opacity: 0, y: -6, filter: "blur(4px)", duration: 0.35, ease: "power2.in" }); }
    if (b.body.length) { gsap.killTweensOf(b.body); gsap.to(b.body, { opacity: 0, y: -4, duration: 0.35, ease: "power2.in" }); }
  }

  function update(T) {
    if (!Number.isFinite(T)) return;
    for (const b of blocks) {
      const l = T - b.i;
      // the block itself fades with scroll over [a, a+0.07] and [b-0.07, b]; its words animate on entry and exit
      const o = band(l, b.a, b.a + 0.07, b.b - 0.07, b.b);
      b.el.style.opacity = o.toFixed(3);
      b.el.style.transform = `translate3d(0, ${((1 - o) * 18 * (l < b.a + 0.07 ? 1 : -1)).toFixed(1)}px, 0)`;
      b.el.style.visibility = o > 0.002 ? "visible" : "hidden";
      if (!animate) continue;
      const rising = o >= (b.prevO ?? 0);
      if (!b.shown && o > 0.35 && rising) { b.shown = true; reveal(b); }
      else if (b.shown && o < 0.5 && !rising) { b.shown = false; conceal(b); }
      b.prevO = o;
    }
    const idx = clamp(Math.floor(T), 0, names.length - 1);
    if (railFill) railFill.style.transform = `scaleX(${clamp(T / names.length).toFixed(4)})`;
    if (names[idx] !== lastName) {
      lastName = names[idx];
      document.documentElement.dataset.ch = scroll.sections[idx].dataset.ch;
      if (railName) railName.textContent = lastName;
      railTicks.forEach((t, i) => t.setAttribute("aria-current", i === idx ? "step" : "false"));
    }
  }

  /** the big verdict word for the verdict chapter (null hides it) */
  function verdict(key) {
    if (key === lastVerdict || !verdictEl) return;
    lastVerdict = key;
    if (!key) { verdictEl.dataset.on = "false"; return; }
    verdictEl.dataset.on = "true";
    verdictEl.textContent = LABEL[key];
    const dark = verdictEl.closest("[data-theme=dark]");
    verdictEl.style.color = (dark ? COLOR_ON_DARK : COLOR)[key];
    if (animate) gsap.fromTo(verdictEl, { fontStretch: "100%", opacity: 0, filter: "blur(8px)" }, { fontStretch: STRETCH[key] + "%", opacity: 1, filter: "blur(0px)", duration: 0.9, ease: "expo.out" });
    else verdictEl.style.fontStretch = STRETCH[key] + "%";
    document.querySelectorAll("[data-beat]").forEach((el) => {
      const on = el.dataset.beat === key;
      el.hidden = !on;
      if (on && animate) gsap.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out", delay: 0.2 });
    });
  }

  return { set, update, verdict, LABEL, COLOR, STRETCH };
}
