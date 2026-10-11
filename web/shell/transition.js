// The hand-off between the story and the live window: one 2.2 s timeline, played forward for
// "Open the live window" and backward for Back. Camera, lens shift, grade, the plate and the verdict
// word, the rules that grow out of the window frame, the callouts and the ruler all read from the
// same timeline on the same tick, so nothing drifts.
//
//  t 0.00  history entry pushed; scroll and pointer input paused; latch click
//    0.00-0.35  the plate's secondary lines retract; the story's header empties
//    0.10-1.60  camera: last story pose -> live pose along a slight arc; lens shift frees the column
//    0.15-0.90  the white plate shrinks onto the column and melts into the wall
//    0.20-1.20  grade: film (grain, vignette) -> instrument (clean)
//    0.25-1.25  the verdict word flies from the plate to the column
//    1.10-2.00  the window's head rail, meeting rail and sill extend across the wall as the column's rules
//    1.30-2.00  callouts draw from the sensor, the glass and the sash
//    1.50-2.20  the time ruler pulls out from the left like a tape measure; the now mark lands
//    2.20  the live window takes focus
import { blendPose, clonePose } from "../live/pose.js";
import { END_T } from "../story/mode.js";

const DUR = 2.2;

/** One box per word of an element's text, as laid out (a Range per word). */
function wordBoxes(el) {
  const out = [], r = document.createRange();
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    for (const m of n.data.matchAll(/\S+/g)) {
      r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      const b = r.getBoundingClientRect();
      out.push({ text: m[0], left: b.left, top: b.top });
    }
  }
  return out;
}
const rectOf = (el, b) => ({ text: el.textContent.trim(), left: b.left, top: b.top });
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const wash = document.getElementById("lv-wash");

export function createHandoff({ stage, story, live, scroll, sound, reduced, router, room }) {
  const subs = new Set();
  const k = { cam: 0, shift: 0, grade: 0, leaders: 0, wash: 0 };
  let tl = null, from = null, running = false, dir = 0, ghosts = [], curtain = null;
  const blended = { p: [0, 0, 0], t: [0, 0, 0], fov: 38 };
  const ARC = [-0.12, 0.05, 0.1];

  const setMode = (m) => {
    root.dataset.mode = m;
    subs.forEach((fn) => fn(m));
  };

  function grade(x) {
    const g = stage.post.grain;
    if (!g) return;
    g.uniforms.uGrain.value = 0.03 * (1 - x);
    g.uniforms.uVignette.value = 0.3 + (0.06 - 0.3) * x;
  }

  function cleanup() {
    ghosts.forEach((g) => g.remove()); ghosts = [];
    root.removeAttribute("data-handoff");
    wash.style.removeProperty("opacity");
    document.querySelectorAll(".now-panel, #now-verdict, #live-verdict, .lv-col, .lv-col > *, .lv-rule, .lv-sill, #lv-ruler, .lv-head > *, .bar")
      .forEach((e) => e.style.removeProperty("visibility"));
  }

  /** The story's plate pieces that are not the verdict word. */
  const plateBits = () => [...document.querySelectorAll(".now-panel > :not(#now-verdict)")];

  function build({ fly = true } = {}) {
    tl?.kill();
    cleanup();
    root.dataset.handoff = "on"; // both sides laid out and measurable
    live.layout({ apply: false });
    live.ui.setAssembled(true);
    const plate = document.querySelector(".now-panel"), word = $("now-verdict"), target = $("live-verdict"), col = $("lv-col");
    const pr = plate.getBoundingClientRect(), cr = col.getBoundingClientRect();
    const wr = word.getBoundingClientRect(), tr = target.getBoundingClientRect();

    // the plate: a white box that shrinks onto the column and fades into the wall
    const ghost = document.createElement("div"); ghost.className = "ho-plate";
    Object.assign(ghost.style, { left: pr.left + "px", top: pr.top + "px", width: pr.width + "px", height: pr.height + "px" });
    // the verdict, copied word by word so it can fly above everything. Same width axis and weight on both
    // sides, so each word is a pure translate + uniform scale; the plate wraps it onto two lines and the
    // column doesn't, so the words regroup on the way.
    const from = wordBoxes(word), to = wordBoxes(target);
    const fs = parseFloat(getComputedStyle(word).fontSize), ft = parseFloat(getComputedStyle(target).fontSize);
    const s = ft / fs, cs = getComputedStyle(word);
    const pairs = from.length === to.length && from.length ? from.map((b, i) => [b, to[i]]) : [[rectOf(word, wr), rectOf(target, tr)]];
    const words = pairs.map(([a]) => {
      const g = document.createElement("span"); g.className = "ho-word"; g.textContent = a.text;
      Object.assign(g.style, { left: a.left + "px", top: a.top + "px", fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        fontStretch: cs.fontStretch, letterSpacing: cs.letterSpacing, color: cs.color, lineHeight: "normal" });
      return g;
    });
    document.body.append(ghost, ...words); ghosts.push(ghost, ...words);
    if (!fly) [ghost, ...words].forEach((g) => (g.style.display = "none")); // from mid-story there is no plate to fly
    plate.style.visibility = "hidden"; word.style.visibility = "hidden"; target.style.visibility = "hidden";

    const rules = [...document.querySelectorAll(".lv-rule")];
    const colItems = [...document.querySelectorAll(".lv-when, .lv-reason, .lv-b > :not(.lv-said):not(audio)"), $("lv-sill")];
    const headBits = [...document.querySelectorAll(".lv-head > *")];

    // callbacks from a timeline that has since been replaced or killed are ignored
    const me = tl = gsap.timeline({ paused: true, defaults: { overwrite: "auto" },
      onUpdate: () => {
        stage.setShift(live.shiftTarget.x * k.shift, live.shiftTarget.y * k.shift); grade(k.grade); live.ui.leaders?.setDrawn(k.leaders);
        wash.style.opacity = k.wash.toFixed(3);
      },
      onComplete: () => { if (tl === me) finish("live"); }, onReverseComplete: () => { if (tl === me) finish("story"); } });
    tl.fromTo(plateBits(), { opacity: 1, y: 0 }, { opacity: 0, y: -8, duration: 0.3, stagger: 0.03, ease: "power2.in" }, 0)
      .fromTo(".bar", { opacity: 1 }, { opacity: 0, duration: 0.35, ease: "power1.out" }, 0)
      .fromTo(k, { cam: 0 }, { cam: 1, duration: 1.5, ease: "power2.inOut" }, 0.1)
      .fromTo(k, { shift: 0 }, { shift: 1, duration: 1.4, ease: "power2.inOut" }, 0.1)
      .fromTo(ghost, { left: pr.left, top: pr.top, width: pr.width, height: pr.height, backgroundColor: "rgba(242,243,240,1)", boxShadow: "0 0 0 2px rgba(205,209,207,1)" },
        { left: cr.left - 24, top: cr.top - 20, width: cr.width + 48, height: cr.height + 40, backgroundColor: "rgba(242,243,240,0)", boxShadow: "0 0 0 2px rgba(205,209,207,0)", duration: 0.75, ease: "power3.inOut" }, 0.15)
      .fromTo(k, { grade: 0 }, { grade: 1, duration: 1.0, ease: "none" }, 0.2)
      .fromTo(k, { wash: 0 }, { wash: 1, duration: 0.9, ease: "power1.inOut" }, 0.5)
      .fromTo(headBits, { opacity: 0 }, { opacity: 1, duration: 0.35, stagger: 0.04, ease: "power1.out" }, 1.0)
      .fromTo(rules, { scaleX: 0 }, { scaleX: 1, duration: 0.7, stagger: 0.08, ease: "power3.out" }, 1.1)
      .fromTo(colItems, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.55, stagger: 0.05, ease: "power2.out" }, 1.25)
      .fromTo(k, { leaders: 0 }, { leaders: 1, duration: 0.7, ease: "power1.inOut" }, 1.3)
      .fromTo("#lv-ruler", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "power4.out" }, 1.5)
      .call(() => { if (dir > 0) sound.cue?.("tape", { to: "ui", gain: 0.7 }); }, null, 1.95) // the ruler locks out
      .set({}, {}, DUR);
    words.forEach((g, i) => {
      const [a, b] = pairs[i];
      tl.fromTo(g, { x: 0, y: 0, scale: 1 }, { x: b.left - a.left, y: b.top - a.top, scale: s, duration: 1.0, ease: "expo.inOut" }, 0.25 + i * 0.04);
    });
  }

  function finish(m) {
    running = false; dir = 0;
    tl?.kill(); tl = null;
    cleanup();
    // clear inline styles the timeline left, so CSS owns the resting state
    gsap.set([...plateBits(), ".bar", ".js .copy", ".lv-head > *", ".lv-rule", ".lv-when", ".lv-reason", ".lv-b > *", "#lv-sill", "#lv-ruler"], { clearProps: "opacity,transform,clipPath" });
    stage.setShift(m === "live" ? live.shiftTarget.x : 0, m === "live" ? live.shiftTarget.y : 0);
    grade(m === "live" ? 1 : 0);
    live.ui.leaders?.setDrawn(m === "live" ? 1 : 0);
    if (m === "live") {
      scroll.lock(true);
      live.ui.setAssembled(true);
      live.ui.setActive(true);
      live.settleSash();
      setMode("live");
      live.ui.focusVerdict();
    } else {
      live.ui.setActive(false);
      setMode("story");
      scroll.lock(false);
      $("story").focus({ preventScroll: true });
    }
    live.flush();
  }

  /** a cut behind a wall-white veil: reduced motion, or a hand-off that couldn't be smooth */
  function veilCut(to) {
    const veil = $("lv-veil");
    running = true;
    gsap.to(veil, { opacity: 1, duration: 0.12, ease: "none", onComplete: () => {
      if (to === "live") { from = null; live.sashSpring.jump(room.win.raise); live.snapSky(); }
      finish(to);
      gsap.to(veil, { opacity: 0, duration: 0.15, ease: "none", delay: 0.05 });
    } });
  }

  return {
    get running() { return running; },
    onModeChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    toLive({ instant = false } = {}) {
      if (dir > 0) return;
      if (tl && dir < 0) { dir = 1; tl.play(); return; } // Back, then forward again mid-flight
      sound.cue?.("latch", { to: "ui", gain: 0.8 }); // the button press: a wooden latch
      scroll.lock(true);
      const atEnd = story.sceneT > 7.95 && root.dataset.world === "room";
      if (instant || reduced || !window.gsap) return veilCut("live");
      from = clonePose(room.pose());
      live.sashSpring.jump(room.win.raise);
      build({ fly: atEnd });
      running = true; dir = 1;
      if (!atEnd) {
        // from elsewhere in the story: a white cloud carries us to the classroom first
        gsap.to(".js .copy", { opacity: 0, duration: 0.3 });
        curtain = { t: 0 };
        // the timeline waits under the cloud and picks up at 0.85 s, once the room is behind it
        gsap.to(curtain, { t: 1, duration: 1.1, ease: "power1.inOut", onUpdate: () => {
          if (curtain.t > 0.5 && !curtain.swapped) { curtain.swapped = true; from = null; k.cam = 1; live.snapSky(); tl.progress(0.85 / DUR); } // (onUpdate applies the lens shift and grade at 0.85 s)
        }, onComplete: () => { curtain = null; tl.play(); } });
        return;
      }
      tl.play();
    },
    toStory({ instant = false } = {}) {
      if (dir < 0) return;
      live.cancelWhatIf();
      if (tl && dir > 0) { dir = -1; tl.reverse(); return; } // Back mid-flight
      if (instant || reduced || !window.gsap) {
        scroll.scrollToT(END_T, { immediate: true });
        return veilCut("story");
      }
      // from the live window: the story sits at its last pose; play the hand-off backwards
      scroll.scrollToT(END_T, { immediate: true });
      const o = [...room.rig.sample(END_T)];
      from = { p: o.slice(0, 3), t: o.slice(3, 6), fov: o[6] };
      story.frame(0, 0); // lay the plate out at T 8.5 for measuring
      build();
      running = true; dir = -1;
      tl.progress(1, true).reverse(); // jump to the end without firing its callbacks (onComplete would finish "live")
    },
    frame(dt, time) {
      // under the first half of the cloud the story keeps playing; the classroom is behind it
      if (curtain && !curtain.swapped) { story.frame(dt, time); stage.post.setCurtain(curtain.t, "#e9edf0", time); return; }
      // the camera: from where the story left it to the live pose
      let pose = live.restPose;
      if (from) pose = blendPose(from, live.restPose, k.cam, ARC, blended);
      live.frame(dt, time, pose, k.cam);
      if (curtain) stage.post.setCurtain(curtain.t, "#e9edf0", time);
    },
  };
}
