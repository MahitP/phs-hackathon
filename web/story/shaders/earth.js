// GLSL for the planet: surface (NASA day/night/elevation maps, ocean glint, cloud shadows), the cloud
// shell, a ray-marched Rayleigh + Mie atmosphere, and the sky (NASA SVS star map in celestial
// coordinates, turned by Greenwich sidereal time).

export const SURFACE_VS = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main() {
    vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const SURFACE_FS = /* glsl */ `
  uniform sampler2D dayMap, nightMap, specMap, cloudMap, elevMap;
  uniform vec3 sunDir; uniform vec2 uTexel; uniform float uBump, uCloudLuma, uCloudShift, uHasElev;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  float cloudAt(vec2 uv) {
    vec4 c = texture2D(cloudMap, vec2(fract(uv.x + uCloudShift), uv.y));
    return uCloudLuma > 0.5 ? smoothstep(0.1, 0.9, c.r) : c.a;
  }
  void main() {
    vec3 n = normalize(vN);
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-5, 0.0, 0.0)), north = cross(n, east);
    vec3 bn = n;
    if (uHasElev > 0.5) {
      float hC = texture2D(elevMap, vUv).r, hE = texture2D(elevMap, vUv + vec2(uTexel.x, 0.0)).r, hN = texture2D(elevMap, vUv + vec2(0.0, uTexel.y)).r;
      bn = normalize(n - (east * (hE - hC) + north * (hN - hC)) * uBump);
    }
    float dGeo = dot(n, sunDir), d = dot(bn, sunDir);
    float dayAmt = smoothstep(-0.1, 0.16, dGeo);
    vec3 day = texture2D(dayMap, vUv).rgb;
    float ocean = texture2D(specMap, vUv).r;
    float cloud = cloudAt(vUv);
    vec2 sunT = vec2(dot(sunDir, east), dot(sunDir, north)) * 0.0035;   // cloud shadows fall away from the sun
    float shadow = cloudAt(vUv - sunT);

    float wrap = clamp((d + 0.06) / 1.06, 0.0, 1.0);              // a softer terminator, as the atmosphere bends light past it
    vec3 lit = day * (0.015 + 1.25 * wrap) * (1.0 - 0.55 * shadow * dayAmt);
    // oceans: Fresnel sky reflection + a rough sun glint
    vec3 v = normalize(cameraPosition - vW), h = normalize(sunDir + v);
    float nh = max(dot(n, h), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 glint = vec3(1.0, 0.92, 0.78) * (pow(nh, 220.0) * 0.9 + pow(nh, 24.0) * 0.07) * (1.0 - cloud);
    vec3 sea = (glint + vec3(0.22, 0.42, 0.78) * fres * 0.4) * ocean * dayAmt;
    // city lights: warm sodium/LED mix, dimmed under clouds, off in daylight
    vec3 night = pow(texture2D(nightMap, vUv).rgb, vec3(1.3)) * vec3(1.0, 0.8, 0.55) * 3.2;
    night *= (1.0 - smoothstep(-0.18, 0.05, dGeo)) * (1.0 - 0.75 * cloud);
    // a thin warm band where the sun is on the horizon
    float twi = smoothstep(0.14, 0.0, abs(dGeo));
    vec3 col = lit + sea + night + day * vec3(1.0, 0.45, 0.2) * twi * 0.09;
    gl_FragColor = vec4(col, 1.0);
  }`;

export const CLOUD_FS = /* glsl */ `
  uniform sampler2D cloudMap; uniform vec3 sunDir; uniform float uCloudLuma, uCloudShift;
  varying vec2 vUv; varying vec3 vN;
  void main() {
    vec4 c = texture2D(cloudMap, vec2(fract(vUv.x + uCloudShift), vUv.y));
    float a = uCloudLuma > 0.5 ? smoothstep(0.1, 0.9, c.r) : c.a;
    float d = dot(normalize(vN), sunDir);
    vec3 tint = mix(vec3(1.0, 0.55, 0.32), vec3(1.0), smoothstep(-0.02, 0.28, d));  // sunset-lit cloud tops at the terminator
    vec3 col = tint * (0.012 + 1.15 * max(d, 0.0));
    gl_FragColor = vec4(col, a * (0.12 + 0.88 * smoothstep(-0.18, 0.12, d)));
  }`;

// Single-scattering atmosphere, ray-marched through the shell (16 view x 8 light samples).
// Units: planet radius = 1. The shell is exaggerated to 160 km so it reads at this scale.
export const ATMO_VS = /* glsl */ `
  varying vec3 vW;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export const ATMO_FS = /* glsl */ `
  uniform vec3 sunDir; uniform float uSun, uMie, uG;
  varying vec3 vW;
  const float RP = 1.0, RA = 1.025, HR = 0.0026, HM = 0.0007;
  const vec3 BR = vec3(17.0, 40.0, 95.0);
  const float BM = 120.0;
  vec2 hit(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c;
    if (d < 0.0) return vec2(1e5, -1e5);
    d = sqrt(d); return vec2(-b - d, -b + d);
  }
  void main() {
    vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
    vec2 a = hit(ro, rd, RA);
    if (a.x > a.y) discard;
    vec2 p = hit(ro, rd, RP);
    float t0 = max(a.x, 0.0), t1 = a.y;
    if (p.x < p.y && p.x > 0.0) t1 = min(t1, p.x);
    float seg = (t1 - t0) / 16.0;
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    float odR = 0.0, odM = 0.0;
    for (int i = 0; i < 16; i++) {
      vec3 s = ro + rd * (t0 + seg * (float(i) + 0.5));
      float hgt = length(s) - RP;
      float dR = exp(-hgt / HR) * seg, dM = exp(-hgt / HM) * seg;
      odR += dR; odM += dM;
      // the planet's shadow (soft-edged: the sun's disc and refraction blur it), times a twilight ramp that stands
      // in for multiple scattering, so the day side fades into dusk instead of switching off at the terminator
      float along = dot(s, sunDir);
      float lit = along > 0.0 ? 1.0 : smoothstep(RP - 0.01, RP, length(s - sunDir * along));
      lit *= smoothstep(-0.12, 0.42, along / length(s));
      if (lit <= 0.0) continue;
      vec2 l = hit(s, sunDir, RA);
      float segL = l.y / 8.0, oR = 0.0, oM = 0.0;
      for (int j = 0; j < 8; j++) {
        float hl = length(s + sunDir * (segL * (float(j) + 0.5))) - RP;
        oR += exp(-hl / HR) * segL; oM += exp(-hl / HM) * segL;
      }
      vec3 att = exp(-(BR * (odR + oR) + BM * uMie * 1.1 * (odM + oM)));
      sumR += dR * att * lit; sumM += dM * att * lit;
    }
    float mu = dot(rd, sunDir);
    float phR = 0.0597 * (1.0 + mu * mu);
    float g2 = uG * uG;
    float phM = 0.1194 * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * uG * mu, 1.5));
    vec3 col = uSun * (sumR * BR * phR + sumM * BM * uMie * phM);
    gl_FragColor = vec4(col, 1.0);
  }`;

export const SKY_VS = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const SKY_FS = /* glsl */ `
  uniform sampler2D map; uniform float uGmst, uExposure;
  varying vec3 vDir;
  const float PI = 3.14159265;
  void main() {
    vec3 d = normalize(vDir);
    float lat = asin(clamp(d.y, -1.0, 1.0));
    float lon = atan(d.z, -d.x) - PI;            // Earth-fixed longitude of this direction
    float ra = lon + uGmst;                      // right ascension = longitude + sidereal time
    vec2 uv = vec2(fract(0.5 - ra / (2.0 * PI)), lat / PI + 0.5);
    vec3 c = texture2D(map, uv).rgb;
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;  // hides 8-bit steps in the faint glow
    gl_FragColor = vec4(max(c * uExposure + dither * 0.0025, 0.0), 1.0);
  }`;

export const STAR_VS = /* glsl */ `
  attribute float aMag; attribute vec3 aColor; uniform float uScale;
  varying vec3 vColor; varying float vB;
  void main() {
    vColor = aColor;
    vB = clamp(pow(10.0, -0.4 * (aMag - 1.0)), 0.04, 3.0);
    gl_PointSize = clamp((6.8 - aMag) * 0.62, 1.2, 4.2) * uScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export const STAR_FS = /* glsl */ `
  varying vec3 vColor; varying float vB;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.05, r);
    gl_FragColor = vec4(vColor * vB * core * core * 1.1, 1.0);
  }`;
