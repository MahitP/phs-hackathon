// Post-processing chain, assembled per device tier:
//   render → ambient occlusion (GTAO) → god rays → depth of field → bloom → tone map → SMAA → cloud curtain → grain
// The cloud curtain (an fbm noise band that sweeps up the screen as the camera drops through a cloud deck)
// hides the hand-off between the three worlds, the same trick edolus uses.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";

const NOISE = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
`;
const VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const CurtainShader = {
  uniforms: { tDiffuse: { value: null }, uTop: { value: -1 }, uColor: { value: new THREE.Color("#8d97a4") }, uTime: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTop, uTime, uAspect; uniform vec3 uColor; varying vec2 vUv;
    ${NOISE}
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 p = vec2(vUv.x * uAspect, vUv.y);
      float n = fbm(p * 2.2 + vec2(uTime * 0.03, -uTime * 0.05));
      float n2 = fbm(p * 6.0 - vec2(uTime * 0.07, uTime * 0.02));
      float h = vUv.y + (n - 0.5) * 0.6 + (n2 - 0.5) * 0.14;
      float bottom = uTop - 2.4;
      float a = smoothstep(uTop + 0.07, uTop - 0.07, h) * smoothstep(bottom - 0.07, bottom + 0.07, h);
      vec3 cloud = uColor * (0.8 + 0.34 * n) + vec3(0.07) * (n2 - 0.5);
      gl_FragColor = vec4(mix(base.rgb, cloud, a), 1.0);
    }`,
};

const GrainShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.03 }, uVignette: { value: 0.3 } },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette; varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5; float r = dot(d, d);
      vec2 off = d * r * 0.006;
      vec3 col = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      col += (rand(vUv * 1000.0 + fract(uTime * 7.0) * 61.0) - 0.5) * uGrain;
      col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Screen-space light shafts: march from each pixel toward the light, gathering bright samples.
const GodRayShader = {
  uniforms: { tDiffuse: { value: null }, uLight: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 }, uDecay: { value: 0.965 }, uDensity: { value: 0.85 }, uThreshold: { value: 0.9 }, uTint: { value: new THREE.Color(1, 0.9, 0.75) }, uFlare: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uLight; uniform float uStrength, uDecay, uDensity, uThreshold, uFlare, uAspect; uniform vec3 uTint; varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 delta = (vUv - uLight) * uDensity / 48.0;
      // start each pixel's march at a different sub-step (interleaved gradient noise), so small bright
      // highlights smear into soft shafts instead of a comb of thin copies
      float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec2 uv = vUv + delta * j; float illum = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < 48; i++) {
        uv -= delta;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        acc += s * max(dot(s, vec3(0.2126, 0.7152, 0.0722)) - uThreshold, 0.0) * illum;
        illum *= uDecay;
      }
      // lens flare: ghosts along the line from the light through the centre, plus a soft halo
      vec3 flare = vec3(0.0);
      if (uFlare > 0.001) {
        vec2 toC = vec2(0.5) - uLight;
        for (int k = 0; k < 4; k++) {
          float f = float(k);
          vec2 dd = (vUv - (uLight + toC * (0.9 + f * 0.62))) * vec2(uAspect, 1.0);
          float rad = 0.018 + 0.022 * f;
          flare += smoothstep(rad, rad * 0.5, length(dd)) * mix(vec3(0.45, 0.65, 1.0), vec3(1.0, 0.65, 0.35), f / 3.0) * (0.05 + 0.025 * f);
        }
        vec2 dl = (vUv - uLight) * vec2(uAspect, 1.0);
        flare += exp(-length(dl) * 16.0) * vec3(1.0, 0.88, 0.72) * 0.45;
        flare *= uFlare;
      }
      gl_FragColor = vec4(base.rgb + acc * uTint * uStrength / 48.0 + flare, base.a);
    }`,
};

// Multisampling only where it matters: the scene is drawn into its own 4x MSAA target and resolved once.
// (MSAA on the composer's targets would make every post pass write and resolve 4 samples per pixel.)
class MSAARenderPass extends Pass {
  constructor(scene, camera, samples) {
    super();
    this.scene = scene; this.camera = camera; this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.copy = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.copy);
  }
  setSize(w, h) { this.target.setSize(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    this.copy.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.target.dispose(); this.copy.dispose(); this.quad.dispose(); }
}

export function createPost(renderer, tier, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = tier === "high" ? new MSAARenderPass(scene, camera, 4) : new RenderPass(scene, camera);
  const gtao = tier !== "low" ? new GTAOPass(scene, camera, size.x, size.y) : null;
  const godrays = tier !== "low" ? new ShaderPass(GodRayShader) : null;
  const bokeh = tier === "high" ? new BokehPass(scene, camera, { focus: 1, aperture: 0, maxblur: 0 }) : null;
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.6, 0.55, 0.82);
  const smaa = tier !== "high" ? new SMAAPass(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio()) : null;
  const curtain = new ShaderPass(CurtainShader);
  const grain = new ShaderPass(GrainShader);

  composer.addPass(renderPass);
  if (gtao) {
    gtao.blendIntensity = 1; composer.addPass(gtao); gtao.enabled = false; if (tier === "mid") gtao.setSize(size.x / 2, size.y / 2);
    // only solid surfaces cast AO: also leave out sprites and see-through effect meshes (glows, beams, haze, dust)
    gtao.overrideVisibility = function () {
      const cache = this._visibilityCache;
      this.scene.traverse((o) => {
        cache.set(o, o.visible);
        if (o.isPoints || o.isLine || o.isSprite || (o.material && o.material.transparent && !o.material.depthWrite) || o.userData.noAO) o.visible = false;
      });
    };
  }
  if (godrays) { composer.addPass(godrays); godrays.enabled = false; }
  if (bokeh) { composer.addPass(bokeh); bokeh.enabled = false; }
  if (tier !== "low") composer.addPass(bloom);
  composer.addPass(new OutputPass());
  if (smaa) composer.addPass(smaa);
  composer.addPass(curtain);
  if (tier === "high") composer.addPass(grain);
  curtain.enabled = false;

  const _v = new THREE.Vector3();
  let current = null, aoScale = 1, cssW = size.x, cssH = size.y;
  // ambient occlusion resolution: mid always renders it at half CSS size; high at full device size unless
  // the render governor halves it (aoScale) to keep a heavy scene at 60 fps
  const sizeAO = () => {
    if (!gtao) return;
    if (tier === "mid") gtao.setSize(cssW / 2, cssH / 2);
    else if (aoScale !== 1) gtao.setSize(cssW * renderer.getPixelRatio() * aoScale, cssH * renderer.getPixelRatio() * aoScale);
  };

  return {
    composer, renderPass, bloom, curtain, grain, gtao, bokeh, godrays,
    setSize(w, h) {
      cssW = w; cssH = h;
      composer.setSize(w, h); bloom.resolution.set(w, h); curtain.uniforms.uAspect.value = w / h;
      if (godrays) godrays.uniforms.uAspect.value = w / h;
      sizeAO();
    },
    /** 1 = full resolution, 0.5 = half (high tier only; the governor's first step) */
    setAOScale(k) { aoScale = k; if (tier === "high" && gtao) { if (k === 1) gtao.setSize(cssW * renderer.getPixelRatio(), cssH * renderer.getPixelRatio()); else sizeAO(); } },
    /** point every scene-aware pass at the active world */
    setWorld(w) {
      current = w;
      renderPass.scene = w.scene; renderPass.camera = w.camera;
      if (gtao) { gtao.scene = w.scene; gtao.camera = w.camera; if (w.ao) gtao.updateGtaoMaterial(w.ao); }
      if (bokeh) { bokeh.scene = w.scene; bokeh.camera = w.camera; }
    },
    /** per-frame effects that depend on story time */
    tickWorld(T) {
      const w = current;
      if (!w) return;
      if (gtao) gtao.enabled = !!w.ao && (!w.aoOn || w.aoOn(T));
      if (bokeh) {
        const d = w.dof ? w.dof(T) : null;
        bokeh.enabled = !!d;
        if (d) { bokeh.uniforms.focus.value = d.focus; bokeh.uniforms.aperture.value = d.aperture; bokeh.uniforms.maxblur.value = d.maxblur; }
      }
      if (godrays) {
        const g = w.godrays ? w.godrays(T) : null;
        let on = false;
        if (g && g.strength > 0.01) {
          _v.copy(g.pos).project(w.camera);
          // fade out as the light leaves the frame: far off-screen, the march is too sparse to look like light
          const off = Math.max(Math.abs(_v.x), Math.abs(_v.y)), k = 1 - Math.min(1, Math.max(0, (off - 1.05) / 0.5));
          if (_v.z < 1 && k > 0.01) {
            on = true;
            godrays.uniforms.uLight.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
            godrays.uniforms.uStrength.value = g.strength * k;
            if (g.threshold !== undefined) godrays.uniforms.uThreshold.value = g.threshold;
            if (g.tint) godrays.uniforms.uTint.value.set(g.tint);
            godrays.uniforms.uFlare.value = (g.flare ?? 0) * k;
          }
        }
        godrays.enabled = on;
      }
    },
    /** cover 0..1 sweeps the cloud band from below the screen to above it; fully covered around 0.5–0.66 */
    setCurtain(cover, color, time) {
      curtain.enabled = cover > 0.001 && cover < 0.999;
      curtain.uniforms.uTop.value = -0.45 + cover * 3.7;
      if (color) curtain.uniforms.uColor.value.set(color).convertLinearToSRGB(); // this pass runs after OutputPass, in display space
      curtain.uniforms.uTime.value = time;
    },
    tick(time) { grain.uniforms.uTime.value = time; },
  };
}
