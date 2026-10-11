// 3D Earth for SkyWindow.
// Earth rendering adapted from TerraShift's EarthGlobe (https://github.com/Flotrpy/TerraShift,
// MIT License, Copyright (c) 2026 TerraShift): NASA-derived imagery from the three.js example
// textures, a separate cloud layer, Phong lighting and drag-with-inertia.
// SkyWindow additions: the sun is placed at the real sub-solar point (live day/night line), cloud
// opacity follows real cloud cover, a Fresnel atmosphere tints from blue to smoke-orange with haze,
// an aerosol layer appears only when the sky is actually hazy, and a beacon marks Princeton.
// three.js r128 (global THREE) + GSAP for the camera flight.
// In SkyWindow's one-page site this globe only runs inside the app: init() builds it without rendering,
// start()/stop() switch its render loop on and off, so it costs nothing while the story plays.
const Globe = (() => {
  const LAT = 40.3587, LON = -74.656;
  const TEXTURES = "vendor/textures/"; // bundled copies of threejs.org/examples/textures/planets/
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer, scene, camera, earth, earthMesh, clouds, atmosphere, aerosols, marker, ring, sun, stars, pin, pinRing;
  let pickHandler = () => {}, downX = 0, downY = 0, downT = 0;
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let focused = false, dragging = false, lastX = 0, lastY = 0, velX = 0.0012, velY = 0;
  let windSpeed = 8, hazeLevel = 0;
  const clearBlue = new THREE.Color("#5b9dff"), smoke = new THREE.Color("#ff7a2e");

  function latLon(lat, lon, r) {
    const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }

  /** Latitude/longitude where the sun is directly overhead right now (NOAA approximations). */
  function subSolarPoint(date = new Date()) {
    const doy = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5);
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
    const g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
      + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    return { lat: decl * 180 / Math.PI, lon: -15 * (hour - 12 + eq / 60) };
  }

  function atmosphereMesh() {
    return new THREE.Mesh(new THREE.SphereGeometry(1.14, 64, 64), new THREE.ShaderMaterial({
      uniforms: { glow: { value: clearBlue.clone() }, strength: { value: 1.0 } },
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 glow; uniform float strength; varying vec3 vN;
        void main(){ float i = pow(0.68 - dot(vN, vec3(0.0,0.0,1.0)), 4.0) * strength;
        gl_FragColor = vec4(glow, 1.0) * i; }`,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
  }

  /** Builds the scene. Resolves when the Earth textures are loaded; onProgress(0..1) for the splash. */
  function init(canvas, onProgress = () => {}) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    orbitView();

    let resolveReady;
    const ready = new Promise((r) => (resolveReady = r));
    const manager = new THREE.LoadingManager(() => resolveReady(true), (_url, done, total) => onProgress(done / total),
      () => resolveReady(false));
    const loader = new THREE.TextureLoader(manager);
    loader.crossOrigin = "anonymous";
    const tex = (name) => {
      const t = loader.load(TEXTURES + name);
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    };
    setTimeout(() => resolveReady(false), 10000); // never block the splash on a slow network

    scene.add(new THREE.AmbientLight(0xffffff, 0.62)); // keeps the night side readable while still showing day/night

    earth = new THREE.Group();
    earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), new THREE.MeshPhongMaterial({
      map: tex("earth_atmos_2048.jpg"),
      specularMap: tex("earth_specular_2048.jpg"),
      normalMap: tex("earth_normal_2048.jpg"),
      normalScale: new THREE.Vector2(0.85, 0.85),
      specular: new THREE.Color(0x1c2a36),
      shininess: 9,
    }));
    earth.add(earthMesh);
    clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 96), new THREE.MeshLambertMaterial({
      map: tex("earth_clouds_1024.png"), transparent: true, opacity: 0.5, depthWrite: false,
    }));
    earth.add(clouds);

    // the sun rides with the Earth so the lit half always matches the real time of day
    sun = new THREE.DirectionalLight(0xffffff, 1.35);
    earth.add(sun);
    placeSun();
    setInterval(placeSun, 60000);

    // Princeton beacon
    const home = latLon(LAT, LON, 1.0);
    marker = new THREE.Mesh(new THREE.SphereGeometry(0.009, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    marker.position.copy(home.clone().multiplyScalar(1.003));
    ring = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.022, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(home.clone().multiplyScalar(1.004));
    ring.lookAt(home.clone().multiplyScalar(2));
    earth.add(marker, ring);

    // explore pin: dropped wherever the user taps the globe
    pin = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    pinRing = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    pin.visible = pinRing.visible = false;
    earth.add(pin, pinRing);

    // aerosol layer: invisible on a clean day, thickens and turns orange with smoke haze
    const n = 2200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(1.02 + Math.random() * 0.06);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    aerosols = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.008, color: smoke, transparent: true, opacity: 0, depthWrite: false }));
    earth.add(aerosols);
    scene.add(earth);

    atmosphere = atmosphereMesh();
    scene.add(atmosphere);

    const sp = new Float32Array(1200 * 3);
    for (let i = 0; i < 1200; i++) {
      const v = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(25 + Math.random() * 20);
      sp.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.06, color: 0xffffff, transparent: true, opacity: 0.55 }));
    scene.add(stars);

    earth.rotation.y = Math.PI / 2 - (LON + 180) * Math.PI / 180 + 0.9; // start with the Atlantic in view

    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true; lastX = downX = e.clientX; lastY = downY = e.clientY; downT = performance.now();
      gsap.killTweensOf(rot); canvas.style.cursor = "grabbing";
    });
    addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false; canvas.style.cursor = "grab";
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved < 6 && performance.now() - downT < 500) pick(e);
    });
    addEventListener("pointermove", (e) => {
      if (!dragging) {
        // hover feedback: crosshair over the planet
        if (e.target === canvas) canvas.style.cursor = hitEarth(e) ? "crosshair" : "grab";
        return;
      }
      velX = (e.clientX - lastX) * 0.0025 / camera.zoom; velY = (e.clientY - lastY) * 0.0018 / camera.zoom; // finer when zoomed in
      earth.rotation.y += velX;
      earth.rotation.x = Math.max(-1, Math.min(1, earth.rotation.x + velY));
      lastX = e.clientX; lastY = e.clientY;
    });
    // zoom: mouse wheel / trackpad, and two-finger pinch on phones
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    const touches = new Map();
    let pinchDist = 0;
    canvas.addEventListener("pointerdown", (e) => { touches.set(e.pointerId, e); });
    addEventListener("pointermove", (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, e);
      if (touches.size === 2) {
        const [a, b] = [...touches.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinchDist) zoomBy(d / pinchDist);
        pinchDist = d;
        dragging = false; // a pinch is not a drag
      }
    });
    const lift = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinchDist = 0; };
    addEventListener("pointerup", lift);
    addEventListener("pointercancel", lift);

    addEventListener("resize", resize);
    resize();
    return ready;
  }

  let running = false;
  /** Render every frame (the globe is on screen). */
  function start() { if (renderer && !running) { running = true; renderer.setAnimationLoop(tick); } }
  /** Stop rendering (the globe is hidden or the app is closed). */
  function stop() { if (renderer && running) { running = false; renderer.setAnimationLoop(null); } }
  /** Compile the shaders now, so the first frame on screen doesn't stall. */
  function compile() { if (renderer) renderer.compile(scene, camera); }

  const rot = { x: 0, y: 0 }; // tween proxy for flights

  function zoomBy(f) {
    camera.zoom = Math.max(0.7, Math.min(6, camera.zoom * f));
    camera.updateProjectionMatrix();
  }

  /** Dive toward the surface (camera zoom) - used for the hand-off from globe to the city map. */
  function plunge(duration = 1.4) {
    gsap.to(camera, { zoom: 5, duration, ease: "power2.in", onUpdate: () => camera.updateProjectionMatrix() });
  }
  function resetZoom() { gsap.killTweensOf(camera); camera.zoom = 1; camera.updateProjectionMatrix(); }

  function hitEarth(e) {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(earthMesh)[0];
  }

  function pick(e) {
    const hit = hitEarth(e);
    if (!hit) return;
    const p = earth.worldToLocal(hit.point.clone()).normalize();
    const lat = 90 - Math.acos(p.y) * 180 / Math.PI;
    let lon = Math.atan2(p.z, -p.x) * 180 / Math.PI - 180;
    if (lon < -180) lon += 360;
    dropPin(lat, lon);
    pickHandler(lat, lon);
  }

  function dropPin(lat, lon, color = "#ffffff") {
    const at = latLon(lat, lon, 1.0);
    pin.position.copy(at.clone().multiplyScalar(1.004));
    pinRing.position.copy(at.clone().multiplyScalar(1.005));
    pinRing.lookAt(at.clone().multiplyScalar(2));
    pin.material.color.set(color); pinRing.material.color.set(color);
    pin.visible = pinRing.visible = true;
    gsap.fromTo(pin.scale, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1, duration: 0.5, ease: "back.out(3)" });
  }

  function hidePin() { pin.visible = pinRing.visible = false; }

  /** Rotate the globe so (lat, lon) faces the camera. */
  function flyTo(lat, lon, duration = 1.6, dist = null) {
    const targetY = Math.PI / 2 - (lon + 180) * Math.PI / 180;
    gsap.killTweensOf(rot); // a new destination always wins over an unfinished flight
    rot.y = earth.rotation.y; rot.x = earth.rotation.x;
    const wrapped = rot.y + ((((targetY - rot.y) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    velX = velY = 0;
    // rotation.y brings the longitude to the front, rotation.x = latitude tilts it to the exact centre
    gsap.to(rot, { y: wrapped, x: lat * Math.PI / 180, duration, ease: "power3.inOut",
      onUpdate: () => { earth.rotation.y = rot.y; earth.rotation.x = rot.x; } });
    if (dist) setDistance(dist, duration);
  }

  // Camera always sits on the axis looking straight at the globe, so a focused region is never
  // seen at an angle. To leave room for the panel we shift the *rendered image* (view offset).
  function setDistance(z, duration = 1.6) {
    gsap.to(camera.position, { x: 0, y: 0, z, duration, ease: "power3.inOut", onUpdate: () => camera.lookAt(0, 0, 0) });
  }
  let shift = 0; // px the globe is pushed right
  function setShift(px) {
    shift = px;
    if (px) camera.setViewOffset(innerWidth, innerHeight, -px, 0, innerWidth, innerHeight);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function panelShift() { return innerWidth > 900 ? Math.min(640, innerWidth * 0.46) / 2 : 0; }

  // live air-quality dots for world cities (size + color = EPA category)
  let cityGroup = null, citiesOn = false, labelBox = null, cityLabels = [];
  function setCities(list) {
    if (cityGroup) { earth.remove(cityGroup); cityGroup.traverse((o) => o.geometry && o.geometry.dispose()); }
    cityGroup = new THREE.Group();
    cityGroup.visible = citiesOn;
    // name + AQI labels that follow the dots (only the ones facing the camera are shown); they live in the
    // app's layer, right above the globe, so they can never show over the story or the map
    if (!labelBox) { labelBox = document.createElement("div"); labelBox.id = "city-labels"; labelBox.hidden = !citiesOn; renderer.domElement.after(labelBox); }
    labelBox.innerHTML = "";
    cityLabels = list.map((c) => {
      const el = document.createElement("div");
      el.className = "city-label mono";
      el.innerHTML = `${c.name.replace(" (PHS)", "")} <b style="color:${c.category.color}">${c.us_aqi}</b>`;
      labelBox.appendChild(el);
      return { el, pos: latLon(c.lat, c.lon, 1.01) };
    });
    for (const c of list) {
      const at = latLon(c.lat, c.lon, 1.0);
      const r = 0.006 + Math.max(0, c.category.level) * 0.0025;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), new THREE.MeshBasicMaterial({ color: c.category.color }));
      dot.position.copy(at.clone().multiplyScalar(1.004));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(r * 2.4, 12, 12), new THREE.MeshBasicMaterial({
        color: c.category.color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.copy(dot.position);
      cityGroup.add(dot, halo);
    }
    earth.add(cityGroup);
  }
  /** City dots and labels belong to EARTH only. */
  function showCities(on) { citiesOn = on; if (cityGroup) cityGroup.visible = on; if (labelBox) labelBox.hidden = !on; }
  const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Vector3();
  function placeLabels() {
    if (!citiesOn || !cityLabels.length) return;
    camera.getWorldPosition(_c);
    for (const l of cityLabels) {
      _v.copy(l.pos); earth.localToWorld(_v);
      _n.copy(_v).normalize();
      const facing = _n.dot(_c.clone().sub(_v).normalize()) > 0.25; // hide labels on the far side / near the rim
      _v.project(camera);
      if (!facing || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) { l.el.style.display = "none"; continue; }
      l.el.style.display = "";
      l.el.style.transform = `translate(${(_v.x + 1) / 2 * innerWidth + 8}px, ${(1 - _v.y) / 2 * innerHeight - 7}px)`;
    }
  }

  function placeSun() {
    const s = subSolarPoint();
    sun.position.copy(latLon(s.lat, s.lon, 10));
  }

  // orbit (hero) view: on wide screens push the globe right so the headline has room
  function orbitView() {
    camera.position.set(0, 0, innerWidth > 900 ? 6.2 : 7.2); camera.lookAt(0, 0, 0);
    setShift(innerWidth > 900 ? innerWidth * 0.2 : 0);
  }

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    if (!focused && camera.position.z > 5) orbitView(); else setShift(panelShift());
  }

  function tick(t) {
    const s = t / 1000;
    if (!reduceMotion) clouds.rotation.y += 0.0002 + windSpeed * 0.00002;
    if (!dragging && !reduceMotion) {
      earth.rotation.y += velX;
      earth.rotation.x = Math.max(-1, Math.min(1, earth.rotation.x + velY));
      velX += ((focused ? 0 : 0.0012) - velX) * (focused ? 0.06 : 0.02);
      velY += (0 - velY) * 0.06;
    }
    pinRing.scale.setScalar(1 + ((s + 1) % 2) / 2 * 2);
    pinRing.material.opacity = 1 - ((s + 1) % 2) / 2;
    if (!reduceMotion) aerosols.rotation.y += 0.00003 * (2 + windSpeed);
    const pulse = (s % 2) / 2;
    ring.scale.setScalar(1 + pulse * 2.5);
    ring.material.opacity = 1 - pulse;
    stars.rotation.y = s * 0.002;
    renderer.render(scene, camera);
    placeLabels();
  }

  /** Fly from orbit down to a view over Princeton. */
  function focusHome(duration = 2.6) {
    focused = true;
    gsap.to({ s: shift }, { s: panelShift(), duration, ease: "power3.inOut", onUpdate() { setShift(this.targets()[0].s); } });
    flyTo(LAT, LON, duration, innerWidth > 900 ? 2.4 : 3.2);
  }

  /** Jump straight to the view over Princeton that focusHome() ends on (the app opened from the story). */
  function snapHome() {
    focused = true;
    gsap.killTweensOf(rot); gsap.killTweensOf(camera.position);
    velX = velY = 0;
    earth.rotation.y = Math.PI / 2 - (LON + 180) * Math.PI / 180; earth.rotation.x = LAT * Math.PI / 180;
    camera.position.set(0, 0, innerWidth > 900 ? 2.4 : 3.2); camera.lookAt(0, 0, 0);
    setShift(panelShift());
  }

  function release() {
    focused = false;
    velX = 0.0012; velY = 0;
    gsap.to({ s: shift }, { s: innerWidth > 900 ? innerWidth * 0.2 : 0, duration: 2, onUpdate() { setShift(this.targets()[0].s); } });
    setDistance(innerWidth > 900 ? 6.2 : 7.2, 2);
  }

  /** haze 0..1 tints the atmosphere and fades in the aerosol layer; cloud % drives cloud opacity. */
  function setSky({ haze = 0, wind = 8, night = false, cloud = null }) {
    hazeLevel = Math.max(0, Math.min(1, haze));
    windSpeed = wind || 0;
    const c = clearBlue.clone().lerp(smoke, hazeLevel);
    if (night) c.multiplyScalar(0.7);
    gsap.to(atmosphere.material.uniforms.glow.value, { r: c.r, g: c.g, b: c.b, duration: 1.5 });
    gsap.to(atmosphere.material.uniforms.strength, { value: 1 + hazeLevel * 0.9, duration: 1.5 });
    gsap.to(aerosols.material, { opacity: hazeLevel < 0.05 ? 0 : 0.15 + hazeLevel * 0.55, duration: 1.5 });
    if (cloud != null) gsap.to(clouds.material, { opacity: 0.25 + Math.min(100, cloud) / 100 * 0.5, duration: 1.5 });
  }

  function setVerdictColor(hex) {
    marker.material.color.set(hex);
    ring.material.color.set(hex);
  }

  return { init, start, stop, compile, snapHome, focusHome, release, setSky, setVerdictColor, flyTo, setDistance, dropPin, hidePin, setCities, showCities, plunge, resetZoom,
    onPick: (cb) => (pickHandler = cb), HOME: { lat: LAT, lon: LON } };
})();
