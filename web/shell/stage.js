// One renderer, one post chain and one CSS2D label layer per world, shared by the story and the
// live window so the camera can move between them without a reload. Also owns the lens shift
// (camera.setViewOffset) that frees the left column in the live window without changing perspective.
import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { createPost } from "../story/fx.js";
import { viewport } from "./viewport.js";

export function pickTier(params) {
  const forced = params.get("tier");
  if (["low", "mid", "high"].includes(forced)) return forced;
  const coarse = matchMedia("(pointer: coarse)").matches, small = Math.min(viewport.w, viewport.h) < 700;
  if (coarse || small) return "low";
  return (navigator.hardwareConcurrency || 4) >= 8 ? "high" : "mid";
}

export function webglOK() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export function createStage({ canvas, labelRoot, tier }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const dpr = Math.min(devicePixelRatio, tier === "high" ? 1.75 : tier === "mid" ? 1.3 : 1);
  renderer.setPixelRatio(dpr);
  renderer.setSize(viewport.w, viewport.h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = tier !== "low";
  // (?shadow=pcf|basic: a debug switch for measuring shadow cost)
  const shadowParam = new URLSearchParams(location.search).get("shadow");
  renderer.shadowMap.type = shadowParam === "basic" ? THREE.BasicShadowMap : shadowParam === "pcf" ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

  const worlds = {}, css = {};
  let post = null, active = null;
  // lens shift in CSS px: positive x moves the picture right (the scene's centre sits right of the screen's)
  const shift = { x: 0, y: 0 };

  function addWorld(key, w) {
    worlds[key] = w;
    const r = new CSS2DRenderer(); r.setSize(viewport.w, viewport.h); r.domElement.className = "label-layer";
    r.domElement.dataset.world = key; r.domElement.style.display = "none";
    labelRoot.appendChild(r.domElement); css[key] = r;
    fitCamera(w.camera);
    if (!post) { post = createPost(renderer, tier, w.scene, w.camera); post.setSize(viewport.w, viewport.h); }
    return w;
  }

  function fitCamera(c) {
    c.aspect = viewport.w / viewport.h;
    if (Math.abs(shift.x) > 0.01 || Math.abs(shift.y) > 0.01) c.setViewOffset(viewport.w, viewport.h, -shift.x, -shift.y, viewport.w, viewport.h);
    else if (c.view) c.clearViewOffset();
    c.updateProjectionMatrix();
  }

  /** Point the post chain, exposure, bloom and label layer at a world. */
  function setActiveWorld(key) {
    if (key === active) return worlds[key];
    active = key;
    const w = worlds[key];
    post.setWorld(w);
    renderer.toneMappingExposure = w.exposure;
    [post.bloom.strength, post.bloom.radius, post.bloom.threshold] = w.bloom;
    for (const k in css) css[k].domElement.style.display = k === key ? "" : "none";
    document.documentElement.dataset.world = key;
    return w;
  }

  function setShift(x, y = 0) {
    shift.x = x; shift.y = y;
    for (const k in worlds) fitCamera(worlds[k].camera);
  }

  /** the render governor's knob: pixel ratio for the renderer and every post target, and the AO scale */
  function setQuality({ pixelRatio, ao = 1 }) {
    if (Math.abs(renderer.getPixelRatio() - pixelRatio) > 1e-3) {
      renderer.setPixelRatio(pixelRatio);
      post?.composer.setPixelRatio(pixelRatio);
      post?.setSize(viewport.w, viewport.h);
    }
    post?.setAOScale(ao);
  }

  function render(dt) {
    const w = worlds[active];
    post.composer.render(dt);
    css[active].render(w.scene, w.camera);
  }

  const resizers = new Set();
  window.addEventListener("resize", () => {
    renderer.setSize(viewport.w, viewport.h);
    post?.setSize(viewport.w, viewport.h);
    for (const k in worlds) { fitCamera(worlds[k].camera); css[k].setSize(viewport.w, viewport.h); }
    resizers.forEach((fn) => fn());
  });

  return {
    renderer, worlds, css, tier, addWorld, setActiveWorld, setShift, render, fitCamera, setQuality,
    get post() { return post; }, get active() { return active; }, get shift() { return shift; },
    onResize(fn) { resizers.add(fn); return () => resizers.delete(fn); },
  };
}
