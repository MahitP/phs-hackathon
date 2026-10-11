// Drive a real Chrome over the DevTools protocol: load SkyWindow, run steps, take screenshots,
// record frames, and fail on console errors. No dependencies (Node 22+ has fetch and WebSocket).
//
//   node scripts/cdp.mjs <url> [--out dir] [--size 1440x900] [--steps steps.json] [--headed] [--reduced] [--dpr 2] [--unthrottled]
//
// steps.json: [{ "wait": 2 }, { "eval": "js" }, { "shot": "name" }, { "record": "name", "seconds": 3, "fps": 30 },
//              { "click": "#selector" }, { "key": "ArrowUp" }, { "drag": [x0, y0, x1, y1, ms] }]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = args.find((a) => /^https?:/.test(a));
const out = opt("--out", "shots");
const [W, H] = opt("--size", "1440x900").split("x").map(Number);
const steps = args.includes("--steps") ? JSON.parse(readFileSync(opt("--steps"), "utf8")) : [{ wait: 8 }, { shot: "page" }];
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(out, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "skywindow-cdp-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [
  ...(args.includes("--headed") ? [] : ["--headless=new"]), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check",
  "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
  ...(args.includes("--unthrottled") ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []), // frame time = real render cost
  "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--autoplay-policy=no-user-gesture-required", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map(), errors = [], logs = [];
function send(method, params = {}) {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((res, rej) => pending.set(i, { res, rej, method }));
}

async function main() {
  let target;
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = list.find((t) => t.type === "page"); if (target) break; } catch {}
    await sleep(250);
  }
  if (!target) throw new Error("Chrome did not start");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(p.method + ": " + m.error.message)) : p.res(m.result); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      logs.push(`[${m.params.type}] ${text}`);
      if (m.params.type === "error") errors.push(text);
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    // (a 404 from api/now is the page checking for a Pi in showcase mode: expected)
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon|\/api\/now$/.test(m.params.entry.url || "")) errors.push(`${m.params.entry.text} ${m.params.entry.url || ""}`);
  });
  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: +opt("--dpr", 1), mobile: W < 700 });
  if (args.includes("--reduced")) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Page.navigate", { url });

  for (const s of steps) {
    if (s.wait) await sleep(s.wait * 1000);
    if (s.until) { // poll an expression until it's truthy (up to 60 s)
      for (let i = 0; i < 240; i++) { const r = await send("Runtime.evaluate", { expression: s.until, returnByValue: true }); if (r.result?.value) break; await sleep(250); }
    }
    if (s.eval) {
      const r = await send("Runtime.evaluate", { expression: s.eval, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) errors.push("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      else if (s.print) console.log(s.print + ":", JSON.stringify(r.result.value));
    }
    if (s.click) await send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(s.click)}).click()` });
    if (s.key) for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: s.key, code: s.key, windowsVirtualKeyCode: { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Escape: 27 }[s.key] || 0 });
    if (s.mouse) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.mouse[0], y: s.mouse[1] });
    if (s.drag) {
      const [x0, y0, x1, y1, ms = 600] = s.drag, n = Math.max(2, Math.round(ms / 16));
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0 });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= n; i++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n, button: "left", buttons: 1 }); await sleep(ms / n); }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", buttons: 0, clickCount: 1 });
    }
    if (s.shot) {
      const r = await send("Page.captureScreenshot", { format: s.format || "jpeg", quality: 88 });
      writeFileSync(join(out, `${s.shot}.${s.format || "jpg"}`), Buffer.from(r.data, "base64"));
      console.log("shot", join(out, `${s.shot}.${s.format || "jpg"}`));
    }
    if (s.record) {
      // screencast frames -> numbered jpgs (ffmpeg turns them into a video)
      const dir = join(out, s.record); mkdirSync(dir, { recursive: true });
      let n = 0; const t0 = Date.now(), stamps = [];
      const onFrame = async (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method !== "Page.screencastFrame") return;
        writeFileSync(join(dir, `f${String(n++).padStart(5, "0")}.jpg`), Buffer.from(m.params.data, "base64"));
        stamps.push(m.params.metadata.timestamp);
        send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
      };
      ws.addEventListener("message", onFrame);
      await send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
      if (s.during) for (const d of s.during) { if (d.wait) await sleep(d.wait * 1000); if (d.eval) await send("Runtime.evaluate", { expression: d.eval }); if (d.drag) { const [x0, y0, x1, y1, ms = 600] = d.drag, k = Math.max(2, Math.round(ms / 16)); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0 }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", buttons: 1, clickCount: 1 }); for (let i = 1; i <= k; i++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + (x1 - x0) * i / k, y: y0 + (y1 - y0) * i / k, button: "left", buttons: 1 }); await sleep(ms / k); } await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", buttons: 0, clickCount: 1 }); } }
      const left = s.seconds * 1000 - (Date.now() - t0); if (left > 0) await sleep(left);
      await send("Page.stopScreencast");
      ws.removeEventListener("message", onFrame);
      writeFileSync(join(dir, "stamps.json"), JSON.stringify(stamps));
      console.log("recorded", n, "frames to", dir, `(${(n / s.seconds).toFixed(1)} fps)`);
    }
  }
  if (logs.length && args.includes("--logs")) console.log(logs.join("\n"));
  if (errors.length) { console.log("CONSOLE ERRORS:\n" + errors.join("\n")); process.exitCode = 1; } else console.log("no console errors");
}
main().catch((e) => { console.error(e); process.exitCode = 2; }).finally(() => { try { ws?.close(); } catch {} chrome.kill("SIGTERM"); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 800); });
