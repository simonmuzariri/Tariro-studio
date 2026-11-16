// Resize the PictoBlox OS window via CDP Browser.setWindowBounds (browser-level target)
const v = await (await fetch('http://127.0.0.1:9333/json/version')).json();
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
let id=0; const send=(m,p)=>new Promise(r=>{const i=++id;ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===i)r(x)});ws.send(JSON.stringify({id:i,method:m,params:p}))});
const w = await send('Browser.getWindowForTarget',{targetId:list[0].id}); console.log(JSON.stringify(w));
console.log(JSON.stringify(await send('Browser.setWindowBounds',{windowId:w.result.windowId,bounds:{windowState:'normal',width:+process.argv[2],height:+process.argv[3]}})));
ws.close();
