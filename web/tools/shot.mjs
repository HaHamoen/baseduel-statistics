// Open pages in headless Chrome over CDP: print console errors and page
// exceptions, evaluate an expression, save screenshots. Node 20+ and
// google-chrome.
//   node --experimental-websocket tools/shot.mjs <base> <out-dir> <path>[|name] ...
// Env: MOBILE=1 a 390-px phone with touch; DARK=1 prefers-color-scheme dark;
//      EXPR=<js> evaluated on every page and printed (a promise is awaited);
//      WAIT=<ms> (1500);
//      HOVER=<selector> moves the pointer to 70% across it (a chart's tooltip);
//      TYPE=<selector>=<text> types into a field (the search list).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const [base, outDir, ...paths] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const wait = Number(process.env.WAIT || 1500);
const mobile = !!process.env.MOBILE;
const port = 9800 + Math.floor(Math.random() * 400);
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu",
  `--remote-debugging-port=${port}`, "--window-size=1280,900",
  `--user-data-dir=/tmp/bd-stats-cdp-${port}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 60 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") problems.push("exception: " + msg.params.exceptionDetails.exception?.description);
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type))
    problems.push("console." + msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
  if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400)
    problems.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
};
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.DARK ? "dark" : "light" }] });
if (mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
}

for (const spec of paths) {
  const [path, name = path.replace(/[^a-z0-9]+/gi, "_") || "home"] = spec.split("|");
  problems.length = 0;
  await send("Page.navigate", { url: base + path });
  await sleep(wait);
  // Against the device's own width: a phone widens its layout viewport to
  // fit overflowing content, so innerWidth would grow with the bug.
  const width = await send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth", returnByValue: true });
  const [sw, iw] = [width.result.result.value, mobile ? 390 : 1280];
  if (process.env.HOVER) {
    const at = await send("Runtime.evaluate", { returnByValue: true, expression:
      `(() => { const r = document.querySelector(${JSON.stringify(process.env.HOVER)}).getBoundingClientRect();
        window.scrollTo(0, scrollY + r.top - 120); const q = document.querySelector(${JSON.stringify(process.env.HOVER)}).getBoundingClientRect();
        return [q.left + q.width * 0.7, q.top + q.height * 0.5]; })()` });
    const [mx, my] = at.result.result.value;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mx, y: my });
    await sleep(300);
  }
  if (process.env.TYPE) {
    const [sel, text] = process.env.TYPE.split("=");
    await send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(sel)}).focus()` });
    await send("Input.insertText", { text });
    await sleep(400);
  }
  let extra = "";
  if (process.env.EXPR) {
    // awaitPromise: an EXPR may click, wait for the page to update, then read.
    const r = await send("Runtime.evaluate", { expression: process.env.EXPR, returnByValue: true, awaitPromise: true });
    extra = " " + JSON.stringify(r.result.result.value);
  }
  // A hover or typing state is a viewport shot: the state is what matters.
  const state = process.env.HOVER || process.env.TYPE;
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !state });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(shot.result.data, "base64"));
  console.log(`${path}: ${problems.length ? problems.join(" | ") : "no errors"}${sw > iw ? ` | SIDEWAYS SCROLL ${sw}>${iw}` : ""}${extra}`);
}
ws.close();
chrome.kill();
