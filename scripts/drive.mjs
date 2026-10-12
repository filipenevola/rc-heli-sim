#!/usr/bin/env node
// Drives the game in headless Chrome over the DevTools protocol, in real time.
// Usage: node scripts/drive.mjs <url> <step>... where each step is either
//   wait:<js expression>      poll (1 Hz) until truthy, up to --timeout seconds (default 120)
//   eval:<js expression>      run once and print the result
//   shot:<file.png>           save a screenshot
//   offline:on|off            emulate no network (service-worker / offline checks)
//   touch:<x>,<y>,<dx>,<dy>[,<ms>]  press at (x,y) CSS px, drag by (dx,dy) over ms (default 600), hold; touchend:<x>,<y> lifts
// Exits 1 on any uncaught exception in the page, a timeout, or a step that throws.
const args = process.argv.slice(2);
const timeoutIdx = args.indexOf('--timeout');
const timeout = timeoutIdx >= 0 ? Number(args.splice(timeoutIdx, 2)[1]) : 120;
const [url, ...steps] = args;
if (!url) { console.error('usage: drive.mjs <url> [wait:expr|eval:expr]...'); process.exit(2); }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const { spawn } = await import('node:child_process');
// DRIVE_SIZE=390x844 DRIVE_MOBILE=1 emulates a phone (touch events, coarse pointer, mobile UA).
const size = (process.env.DRIVE_SIZE ?? '900x600').split('x').map(Number);
const mobile = process.env.DRIVE_MOBILE === '1';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu-sandbox', '--use-angle=metal', '--hide-scrollbars', `--window-size=${size[0]},${size[1]}`, '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = (code) => { try { chrome.kill(); } catch {} process.exit(code); };
process.on('SIGINT', () => cleanup(130));
let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    target = await r.json();
  } catch { await new Promise((r) => setTimeout(r, 200)); }
}
if (!target) { console.error('chrome did not start'); cleanup(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
let failed = false;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') {
    failed = true;
    console.error('PAGE EXCEPTION:', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    console.error('PAGE console.error:', msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
if (mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmitTouchEventsForMouse', { enabled: true });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
}
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 1500));
const t0 = Date.now();
try {
  for (const step of steps) {
    const [kind, ...rest] = step.split(':');
    const expr = rest.join(':');
    if (kind === 'eval') {
      console.log('eval', expr, '=>', JSON.stringify(await evaluate(expr)));
    } else if (kind === 'touch') {
      const [x, y, dx, dy, ms = 600] = expr.split(',').map(Number);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, ms / steps));
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps, id: 1 }] });
      }
      console.log('touch held at', x + dx, y + dy);
    } else if (kind === 'touchend') {
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      console.log('touch released');
    } else if (kind === 'offline') {
      await send('Network.enable');
      const off = expr === 'on';
      await send('Network.emulateNetworkConditions', { offline: off, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      console.log('network', off ? 'offline' : 'online');
    } else if (kind === 'shot') {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(expr, Buffer.from(r.result.data, 'base64'));
      console.log('shot', expr);
    } else if (kind === 'wait') {
      let ok = false;
      while (Date.now() - t0 < timeout * 1000) {
        if (await evaluate(`!!(${expr})`)) { ok = true; break; }
        await new Promise((r) => setTimeout(r, 1000));
      }
      console.log(ok ? 'ok  ' : 'TIMEOUT', expr, `(${Math.round((Date.now() - t0) / 1000)} s)`);
      if (!ok) failed = true;
    }
    if (failed) break;
  }
} catch (e) {
  console.error('STEP FAILED:', e.message);
  failed = true;
}
cleanup(failed ? 1 : 0);
