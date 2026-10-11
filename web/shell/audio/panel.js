// The sound mix panel: Music, Ambience and Effects levels, and whether the music carries on into the live
// window. One panel, opened from the mix button in the story's header or the live window's.
export function wireSoundPanel(Sound) {
  const pop = document.getElementById("sound-pop");
  if (!pop) return;
  let opener = null;

  const sync = () => {
    const s = Sound.settings;
    pop.querySelectorAll("[data-level]").forEach((el) => {
      const k = el.dataset.level;
      if (el.type === "checkbox") el.checked = !!s[k];
      else { el.value = String(Math.round((s[k] ?? 0.8) * 100)); el.setAttribute("aria-valuetext", `${el.value}%`); }
    });
  };

  function open(btn) {
    opener = btn;
    sync();
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
    pop.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
    document.querySelectorAll("[data-sound-mix]").forEach((b) => b.setAttribute("aria-expanded", String(b === btn)));
    pop.querySelector("input").focus();
  }
  function close({ refocus = true } = {}) {
    if (pop.hidden) return;
    pop.hidden = true;
    document.querySelectorAll("[data-sound-mix]").forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (refocus) opener?.focus();
  }

  document.querySelectorAll("[data-sound-mix]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!pop.hidden && opener === b) close(); else open(b);
  }));
  pop.addEventListener("input", (e) => {
    const el = e.target.closest("[data-level]");
    if (!el) return;
    const k = el.dataset.level;
    if (el.type === "checkbox") Sound.set({ [k]: el.checked });
    else { Sound.set({ [k]: +el.value / 100 }); el.setAttribute("aria-valuetext", `${el.value}%`); }
    // moving a slider with sound off is asking to hear it
    if (!Sound.on && el.type !== "checkbox") Sound.toggle(true);
  });
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest("[data-sound-mix]")) close({ refocus: false }); });
  addEventListener("resize", () => close({ refocus: false }));
}
