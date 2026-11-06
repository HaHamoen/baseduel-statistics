// Save rendered pages as static HTML, for a designer to work on the real
// markup with real data: scripts removed, every style replaced by one
// relative link to style.css. Node 20+ and google-chrome.
//   node --experimental-websocket tools/snapshot.mjs <base> <out-dir> <path>|<name> ...
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const [base, outDir, ...pages] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 400);
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu",
  `--remote-debugging-port=${port}`, "--window-size=1280,900",
  `--user-data-dir=/tmp/bd-stats-snap-${port}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});

const CLEAN = `(() => {
  const doc = document.documentElement.cloneNode(true);
  doc.querySelectorAll("script, style, link[rel=stylesheet], link[rel=modulepreload]").forEach((n) => n.remove());
  const link = document.createElement("link");
  link.rel = "stylesheet"; link.href = "style.css";
  doc.querySelector("head").appendChild(link);
  return "<!doctype html>\\n" + doc.outerHTML;
})()`;

for (const spec of pages) {
  const [path, name] = spec.split("|");
  await send("Page.navigate", { url: base + path });
  await sleep(2000);
  const r = await send("Runtime.evaluate", { expression: CLEAN, returnByValue: true });
  writeFileSync(`${outDir}/${name}.html`, r.result.result.value);
  console.log(`${path} -> ${name}.html`);
}
ws.close();
chrome.kill();
