// Minimal CDP input driver used ONLY to perform UI actions (click / drag / key / eval)
// that REA 6.9.0 cannot perform against this Electron target (see REA_REPORT.md §Limitations).
// All observation evidence (screenshots, DOM, accessibility) is captured with REA tools.
// Usage: node cdp.mjs '<json array of steps>'
//   {op:"eval", expr}            -> prints result
//   {op:"clickText", text, exact?} -> clicks centre of smallest visible element whose text matches
//   {op:"clickSel", sel}         -> clicks centre of element matching CSS selector
//   {op:"click", x, y, button?}  -> raw click
//   {op:"drag", from:[x,y], to:[x,y]}
//   {op:"key", key, code?, modifiers?}
//   {op:"type", text}
//   {op:"wait", ms}
const port = process.env.CDP_PORT || 9333;
const steps = JSON.parse(process.argv[2]);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const prefix = process.env.CDP_URL_PREFIX || 'http://localhost:21679';
const page = list.find(t => t.type === 'page' && t.url.startsWith(prefix));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evalJ = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = async (type, x, y, button = 'left', clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: type === 'mouseReleased' ? 0 : 1 });
const click = async (x, y, button = 'left') => { await mouse('mouseMoved', x, y, 'none'); await mouse('mousePressed', x, y, button); await sleep(40); await mouse('mouseReleased', x, y, button); };
for (const s of steps) {
  if (s.op === 'eval') console.log(JSON.stringify(await evalJ(s.expr)));
  else if (s.op === 'wait') await sleep(s.ms);
  else if (s.op === 'click') await click(s.x, s.y, s.button);
  else if (s.op === 'clickText' || s.op === 'clickSel') {
    const finder = s.op === 'clickSel'
      ? `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(s.sel)})].find(e=>e.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`
      : `(()=>{const t=${JSON.stringify(s.text)};const all=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;const x=(e.innerText||e.textContent||'').trim();return ${s.exact === false ? 'x.includes(t)' : 'x===t'}});all.sort((a,b)=>a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height);const e=all[${s.nth || 0}];if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`;
    const pt = await evalJ(finder);
    console.log(s.op, s.text || s.sel, '->', JSON.stringify(pt));
    if (pt) await click(pt[0], pt[1], s.button);
  } else if (s.op === 'drag') {
    const [x0, y0] = s.from, [x1, y1] = s.to;
    await mouse('mouseMoved', x0, y0, 'none'); await mouse('mousePressed', x0, y0);
    for (let i = 1; i <= 15; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / 15, y: y0 + (y1 - y0) * i / 15, button: 'left', buttons: 1 }); await sleep(20); }
    await mouse('mouseReleased', x1, y1);
  } else if (s.op === 'key') {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: s.key, code: s.code || s.key, modifiers: s.modifiers || 0, windowsVirtualKeyCode: s.vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key, code: s.code || s.key, modifiers: s.modifiers || 0, windowsVirtualKeyCode: s.vk });
  } else if (s.op === 'type') await send('Input.insertText', { text: s.text });
  else if (s.op === 'category') {
    const pt = await evalJ(`(()=>{const e=[...document.querySelectorAll('.scratchCategoryMenuItem')].find(e=>e.innerText.trim()===${JSON.stringify(s.name)});if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
    console.log('category', s.name, pt); if (pt) { await click(pt[0], pt[1]); await sleep(900); }
  } else if (s.op === 'flyout') {
    console.log(JSON.stringify(await evalJ(`(()=>{const fl=document.querySelector('.blocklyFlyout');return [...fl.querySelectorAll('.blocklyBlockCanvas > g.blocklyDraggable')].map(g=>{const r=g.getBoundingClientRect();return [g.textContent.replace(/\\s+/g,' ').trim().slice(0,60),Math.round(r.x+8),Math.round(r.y+12)]}).filter(b=>b[2]>90&&b[2]<660)})()`)));
  } else if (s.op === 'workspace') {
    console.log(JSON.stringify(await evalJ(`(()=>{const c=document.querySelector('.blocklyMainBackground').closest('svg').querySelector('.blocklyBlockCanvas');return [...c.querySelectorAll(':scope > g.blocklyDraggable')].map(g=>{const r=g.getBoundingClientRect();return [g.textContent.replace(/\\s+/g,' ').trim().slice(0,80),Math.round(r.x+8),Math.round(r.y+12),Math.round(r.height)]})})()`)));
  } else if (s.op === 'resize') await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
}
ws.close();
