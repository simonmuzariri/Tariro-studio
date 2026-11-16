// Evaluate an expression in the Electron MAIN process through the Node inspector (port 9334).
const l = await (await fetch('http://127.0.0.1:9334/json/list')).json();
const ws = new WebSocket(l[0].webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
let id=0; const send=(m,p)=>new Promise(r=>{const i=++id;ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===i)r(x)});ws.send(JSON.stringify({id:i,method:m,params:p}))});
const r = await send('Runtime.evaluate',{expression:process.argv[2],returnByValue:true,awaitPromise:true,includeCommandLineAPI:true});
console.log(JSON.stringify(r.result?.result?.value ?? r.result));
ws.close();
