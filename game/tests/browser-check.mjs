// Browser check for Strait Shadow. It serves the game folder on localhost, drives headless Chrome over its debugging
// port, plays staged games through the page's test hook (?test=1), checks keyboard and touch in the real loop, collects
// page errors, and saves screenshots to game/shots.
//   node game/tests/browser-check.mjs desktop   1280x800: title, play, win, lose, pause, help, camera, plain look, then the "missions" part (about 9 minutes)
//   node game/tests/browser-check.mjs missions  1280x800: the three missions, map, periscope, noisemaker, torpedo wire, the scene after the end (about 3 minutes)
//   node game/tests/browser-check.mjs phone     500x900: touch layout, control sizes, map and periscope, touch camera; then play, map, periscope, title and result card at 390x844 and 844x390, and the signature panel, Time and View there (about 4 minutes)
//   node game/tests/browser-check.mjs live      no test hook: real keyboard and touch input (about 1 minute)
//   node game/tests/browser-check.mjs edge      no storage, damaged saved settings, blocked fonts or 3D library, bad seed (about 2 minutes)
//   node game/tests/browser-check.mjs perf      rough frame rate with the real graphics card, the phone tabletop included (about 2 minutes)
//   node game/tests/browser-check.mjs stagec    1280x800: mission list, stars and locks, sound, Hunted, Strait Shadow, Free Patrol, a sonobuoy, map labels and drag, bearing history, hints (about 4 minutes)
//   node game/tests/browser-check.mjs staged    1280x800: contact classification, hearing bar, fire confirm, neutral ships, time compression, outside camera, ship detail, close-up pictures (about 4 minutes)
//   node game/tests/browser-check.mjs stageh    the phone tabletop at 844x390 and 932x430 (?table=1): the plot as the main screen, the course drag, zoom, picking a contact, the row of buttons, the depth column, the menu, the damage panel, the small 3D window, the real loop, and the upright version (about 2 minutes)
//   node game/tests/browser-check.mjs stagei    1280x800, then the phone tabletop: the Solution box and card, held values and Auto, the torpedo settings, Swim-out, Next torpedo, Retarget, Reject and the seeker view (about 3 minutes; it also runs with desktop and with stageh)
//   node game/tests/browser-check.mjs stagej    1280x800, then the phone tabletop: Y and the Weapon row, the Attack and Tubes rows, a swap and its cancel, refused launches, a launch on the plot with its datum, the ship's defences, the 3D pictures (about 3 minutes)
//   node game/tests/browser-check.mjs stagef    1280x800 and the phone: every mission open from the start; sea life as sonar contacts, the Biologic class, the fire confirm, the map, shrimp beds, the outside camera, detail by distance, sounds (about 3 minutes)
// Several can be given at once, separated by commas (desktop,phone,live,edge); with no name, everything except perf runs (about 25 minutes).
// Headless Chrome needs the command sandbox off. The game rules themselves are tested in sim.test.mjs, without a browser.
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const GAME = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');   // the game folder, as a full path
const SHOTS = GAME + '/shots', PROFILE = GAME + '/tmp/chrome-profile';
const HTTP = 8765, DBG = 9333, URL0 = 'http://127.0.0.1:' + HTTP + '/strait-shadow.html';
const only = process.argv[2] || 'all', want = name => only === 'all' || only.split(',').includes(name);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const kids = [];
let failed = 0;
const note = (ok, name, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); if (!ok) failed++; };
function cleanup() { for (const k of kids) { try { k.kill('SIGKILL'); } catch (e) {} } }
process.on('exit', cleanup);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { console.log('FAIL stopped by ' + sig); process.exit(3); });
// never hang: a stuck step ends the whole run and its browser
const watchdog = setTimeout(() => { console.log('FAIL the check ran out of time and was stopped'); process.exit(4); }, 45 * 60 * 1000);

mkdirSync(SHOTS, { recursive: true }); mkdirSync(GAME + '/tmp', { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });
kids.push(spawn('python3', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: GAME, stdio: 'ignore' }));
kids.push(spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=' + DBG, '--user-data-dir=' + PROFILE,
  '--window-size=1280,800', ...(only === 'perf' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions', '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' }));

async function connect() {
  let info = null;
  for (let i = 0; i < 80 && !info; i++) { try { const l = await (await fetch('http://127.0.0.1:' + DBG + '/json/list')).json(); info = l.find(t => t.type === 'page') || null; } catch (e) {} if (!info) await sleep(250); }
  if (!info) throw new Error('Chrome did not start');
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('socket')); });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.rej(new Error(m.method + ' ' + JSON.stringify(m.error))); else p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
    else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errors.push('console ' + m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 400));
    else if (m.method === 'Log.entryAdded' && (m.params.entry.level === 'error' || m.params.entry.level === 'warning')) errors.push('log ' + m.params.entry.level + ': ' + m.params.entry.text.slice(0, 300) + ' ' + (m.params.entry.url || ''));
  };
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  return { send, errors, id: info.id, close: () => ws.close() };
}

const c = await connect();
const ev = async expr => {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page error in [' + expr.slice(0, 80) + ']: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
};
const frames = n => ev('new Promise(r=>{let n=' + (n || 3) + ';const f=()=>{ if(--n<=0) r(1); else requestAnimationFrame(f); }; requestAnimationFrame(f);})');
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' did not finish in ' + ms / 1000 + ' s')), ms))]);
const shot = async name => { await within(frames(3), 15000, 'drawing frames'); const r = await within(c.send('Page.captureScreenshot', { format: 'png' }), 30000, 'screenshot ' + name); writeFileSync(SHOTS + '/' + name + '.png', Buffer.from(r.data, 'base64')); console.log('     shot ' + SHOTS + '/' + name + '.png'); };
let touchOn = false;
async function size(w, h, phone) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!phone });
  // only when it changes: in one browser session, touch switched on, off and on again stops delivering touches to the page
  if (!!phone !== touchOn) { touchOn = !!phone; await c.send('Emulation.setTouchEmulationEnabled', { enabled: touchOn, maxTouchPoints: 5 }); }
}
async function front() {
  try { const l = await (await fetch('http://127.0.0.1:' + DBG + '/json/list')).json(); for (const t of l) if (t.type === 'page' && t.id !== c.id) { console.log('     closing a tab the browser opened by itself: ' + t.url); await fetch('http://127.0.0.1:' + DBG + '/json/close/' + t.id); } } catch (e) {}
  await c.send('Page.bringToFront');
}
async function open(query) {
  await front();
  await c.send('Page.navigate', { url: URL0 + query });
  for (let i = 0; i < 80; i++) { if (await ev('document.readyState==="complete"&&!!window.THREE&&!!window.StraitSim')) break; await sleep(250); }
  if (await ev('document.visibilityState') !== 'visible') { await front(); await sleep(300); }
  note(await ev('document.visibilityState') === 'visible', 'the game tab is the visible tab');
  await frames(4); await sleep(1600); await frames(2);
}
// helpers that live in the page for staging the screenshots: steer at the frigate, point the camera at something
const HELPERS = `
window.__h={
  wrap:a=>Math.atan2(Math.sin(a),Math.cos(a)),
  info(){ const G=__G, st=G.sim.state, p=st.player, s=st.ships[0], h=st.helos[0]||{x:1e7,z:1e7,phase:'none',alt:0}; return {mission:st.mission,t:+st.t.toFixed(1),over:st.over,result:st.result,reason:st.reason,d:Math.round(Math.hypot(s.x-p.x,s.z-p.z)),hd:Math.round(Math.hypot(h.x-p.x,h.z-p.z)),helo:h.phase,alt:Math.round(h.alt),level:st.enemy.level,lost:st.dmg.lost,depth:+p.depth.toFixed(1),speed:+p.speed.toFixed(1),tubes:p.tubes,hits:st.stats.hits,taken:st.stats.taken,drops:st.stats.drops,torps:st.torps.length,chute:st.torps.some(t=>t.phase==='chute'),shipHp:s.hp,out:s.out}; },
  // steer at the frigate (or away from it) until a condition holds
  drive(sec,stop,away){ const G=__G, st=G.sim.state, p=st.player, s=st.ships[0]; let n=0;
    while(n<sec*30&&!st.over&&!stop(st,p,s)){ const b=Math.atan2(-(s.z-p.z),s.x-p.x)+(away?Math.PI:0); G.input.rudder=Math.max(-1,Math.min(1,-this.wrap(b-p.h)*3)); G.stepFrames(1); n++; }
    G.input.rudder=0; return this.info(); },
  look(wx,wz,el,r){ const G=__G, st=G.sim.state, p=st.player; G.cam.az=Math.atan2(-(wx-p.x),-(wz-p.z))-p.h+Math.PI/2; if(el!==undefined) G.cam.el=el; if(r) G.cam.r=r; G.cam.elGoal=null; },
  lookShip(el,r,off){ const s=__G.sim.state.ships[0]; this.look(s.x,s.z,el,r); __G.cam.az+=off||0; },
  lookHelo(el,r,off){ const h=__G.sim.state.helos[0]; this.look(h.x,h.z,el,r); __G.cam.az+=off||0; },
  mark(kind){ return __G.sim.state.marks.find(m=>m.kind===kind); },
  cl:(v,a,b)=>Math.max(a,Math.min(b,v)),
  // the loudest contact of a kind; a ship known to be neutral is never chosen
  best(kind){ let b=null; for(const c of __G.sim.state.contacts) if(c.kind===kind&&c.cls!=='merchant'&&c.cls!=='fishing'&&(!b||c.sig>b.sig)) b=c; return b; },
  steerH(h,max){ const p=__G.sim.state.player, m=max||1; __G.input.rudder=this.cl(-this.wrap(h-p.h)*3,-m,m); },
  // steer the torpedo that is on the wire back onto the line from the boat to the sonar contact (as guide() in sim.test.mjs)
  guide(c){ const st=__G.sim.state, p=st.player, ship=c||this.best('ship'), t=st.torps.find(t=>t.id===p.wireId); if(!t||!ship){ __G.input.wire=0; return; }
    const want=ship.brg+this.cl(this.wrap(ship.brg-Math.atan2(-(t.z-p.z),t.x-p.x))*4,-0.7,0.7); __G.input.wire=this.cl(-this.wrap(want-t.h)*4,-1,1); },
  // the frigate to go for, as pick() in sim.test.mjs: the loudest contact classified as one, failing that the loudest unknown that could still be one
  pickF(){ let known=null, unk=null; for(const c of __G.sim.state.contacts){ if(c.kind!=='ship') continue; if(c.cls){ if(c.cls==='frigate'&&(!known||c.sig>known.sig)) known=c; } else if((!c.blades||c.blades===5)&&(!c.shaft||c.shaft>90)&&(!unk||c.sig>unk.sig)) unk=c; } return known||unk; },
  // the scripted First Blood player of sim.test.mjs (attacker): makes the frigate the target, closes quietly on a zigzag so that fire control gets a range, fires a pair
  // aimed by a solution of Fair or better (Short enable, Snake search), holds the wire, steers only a torpedo that is searching, clears the firing point, runs from torpedoes
  hunter(){ const H=this, mem={shots:0,clearUntil:-1,side:1,pulse:false,hold:false,lastTorp:0,legT:0,zig:1,closeT:-1};
    return function(){ const st=__G.sim.state, p=st.player, inp=__G.input, ship=H.pickF(), torp=H.best('torp'), wired=st.torps.some(t=>t.side===0&&t.wire);
      const k=ship?st.tracks.find(q=>q.id===ship.id):null, q=k?k.sol:null, wt=st.torps.find(t=>t.id===p.wireId);
      inp.rudder=0; inp.throttle=0; inp.depthCmd=20; inp.fire=false; inp.ping=false; inp.silent=false; inp.decoy=false; inp.mast=false; inp.wire=0;
      inp.launch=0; inp.enable=1; inp.runDepth=0; inp.search=1; if(ship) __G.game.sel=ship.id; if(wt&&wt.phase==='search') H.guide(ship);
      if(torp){ H.steerH(torp.brg+Math.PI); inp.throttle=4; inp.depthCmd=160; if(torp.id!==mem.lastTorp){ mem.lastTorp=torp.id; inp.decoy=true; } mem.hold=false; return; }
      if(mem.hold){ if(wired&&ship){ H.steerH(ship.brg,0.7); inp.throttle=1; inp.depthCmd=60; return; } mem.hold=false; mem.clearUntil=st.t+40; mem.side=-mem.side; }
      if(st.t<mem.clearUntil){ if(ship) H.steerH(ship.brg+mem.side*Math.PI*0.6); inp.throttle=2; inp.depthCmd=130; return; }
      if(!ship){ inp.throttle=2; inp.depthCmd=60; return; }
      if(st.t-mem.legT>40){ mem.legT=st.t; mem.zig=-mem.zig; }
      const near=ship.sig>=0.3; if(near&&mem.closeT<0) mem.closeT=st.t;
      const good=!!q&&q.fit&&q.r!==null&&q.g>=2&&q.r<1800&&st.t-k.turnT>20, late=!!q&&q.fit&&q.g>=1&&ship.sig>=0.42&&mem.closeT>=0&&st.t-mem.closeT>240;
      H.steerH(ship.brg+(near?mem.zig*0.8:0));
      if(ship.sig<0.1){ inp.throttle=3; inp.depthCmd=90; } else if(ship.sig<0.27){ inp.throttle=2; inp.depthCmd=60; } else { inp.throttle=1; inp.depthCmd=60; inp.silent=p.readyT>=2; }
      if(ship.cls==='frigate'&&(good||late)&&p.readyT>0){ mem.pulse=!mem.pulse; inp.fire=mem.pulse; inp.silent=false; if(st.stats.fired>mem.shots){ mem.shots=st.stats.fired; if(mem.shots%2===0) mem.hold=true; } }
    }; },
  // let that player play the game now running until a condition holds
  play(sec,stop){ const G=__G, st=G.sim.state; if(this.planSim!==G.sim){ this.plan=this.hunter(); this.planSim=G.sim; } let n=0; while(n<sec*30&&!st.over&&!(stop&&stop(st,st.player,st.ships[0]))){ this.plan(); G.stepFrames(1); n++; } G.input.silent=false; return this.info(); },
  // count what the simulation reports, by kind, for the game now running
  watch(){ const sim=__G.sim, step=sim.step, seen=this.seen={}; sim.step=function(dt,inp){ const r=step(dt,inp); for(const e of sim.events) seen[e.type]=(seen[e.type]||0)+1; return r; }; },
  steer(x,z){ const p=__G.sim.state.player, off=this.wrap(Math.atan2(-(z-p.z),x-p.x)-p.h); __G.input.rudder=Math.max(-1,Math.min(1,-off*3)); return off; },
  // play the current step of the exercise the way the scripted trainee in sim.test.mjs does, until the step changes
  coachStep(sec,stop){ const G=__G, st=G.sim.state, p=st.player, inp=G.input, k0=st.coach.key; let n=0, pulse=false;
    while(n<sec*30&&!st.over&&st.coach.key===k0&&!(stop&&stop(st,p))){
      inp.throttle=2; inp.rudder=0; inp.depthCmd=20;
      if(k0==='steer'){ const w=this.mark('waypoint'); this.steer(w.x,w.z); inp.throttle=3; }
      else if(k0==='dive') inp.depthCmd=st.layer+15;
      else if(k0==='scope'){ inp.depthCmd=9; inp.throttle=1; if(p.depth<=11&&!G.game.scope) G.setScope(true); }
      else if(k0==='decoy'){ inp.depthCmd=9; pulse=!pulse; inp.decoy=pulse; }
      else{ const hk=this.mark('hulk'), d=Math.hypot(hk.x-p.x,hk.z-p.z), off=this.steer(hk.x,hk.z); inp.throttle=d>1000?3:1; if(d<1200&&Math.abs(off)<0.04&&!st.torps.length){ pulse=!pulse; inp.fire=pulse; } }
      G.stepFrames(1); n++; }
    inp.rudder=0; return {key:st.coach.key,step:st.coach.step,t:+st.t.toFixed(1),depth:+p.depth.toFixed(1),over:st.over,result:st.result,torps:st.torps.length}; },
  rect(id){ const r=document.getElementById(id).getBoundingClientRect(); return {id,w:Math.round(r.width),h:Math.round(r.height),l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom)}; },
  // pairs of these elements that are both on screen and overlap
  overlaps(ids){ const R=ids.map(id=>document.getElementById(id).getBoundingClientRect()), bad=[]; for(let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++){ const a=R[i], b=R[j]; if(a.width&&b.width&&a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1) bad.push(ids[i]+'/'+ids[j]); } return bad; },
  // the circle left free for the map and the periscope, and whether it is clear of these elements
  circle(ids){ const f=__G.free, out=[]; for(const id of ids){ const r=document.getElementById(id).getBoundingClientRect(); if(!r.width) continue; const dx=Math.max(r.left-f.cx,0,f.cx-r.right), dy=Math.max(r.top-f.cy,0,f.cy-r.bottom); if(Math.hypot(dx,dy)<f.r-1) out.push(id); } return {cx:f.cx,cy:f.cy,r:Math.round(f.r),w:innerWidth,h:innerHeight,covered:out}; },
  // the share of the screen these elements cover together (sampled on a grid), and which of them a box on the screen touches
  cover(ids){ const R=ids.map(id=>document.getElementById(id).getBoundingClientRect()).filter(r=>r.width>0); let n=0, tot=0; for(let y=4;y<innerHeight;y+=8) for(let x=4;x<innerWidth;x+=8){ tot++; if(R.some(r=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)) n++; } return +(n/tot).toFixed(3); },
  boxHit(b,ids){ return ids.filter(id=>{ const r=document.getElementById(id).getBoundingClientRect(); return r.width>0&&b[0]<r.right&&r.left<b[2]&&b[1]<r.bottom&&r.top<b[3]; }); },
  // a card fits the screen, scrolling inside itself if it must, and its main button can be brought into view
  card(id,btn){ const c=document.querySelector('#'+id+' .card'), r=c.getBoundingClientRect(), s=document.getElementById(btn); s.scrollIntoView({block:'nearest'}); const q=s.getBoundingClientRect();
    const out={shown:!document.getElementById(id).hidden,inside:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,scrolls:c.scrollHeight>c.clientHeight+1,button:q.top>=0&&q.bottom<=innerHeight+1&&q.height>=44&&q.width>=44,
      small:Array.from(c.querySelectorAll('button')).filter(b=>{ const k=b.getBoundingClientRect(); return k.width>0&&(k.height<44||k.width<44); }).map(b=>b.id||b.textContent)}; c.scrollTop=0; return out; },
  // how much of the map canvas has something drawn on it (the background is one flat colour)
  mapInk(){ const c=document.getElementById('mapc'), g=c.getContext('2d'), d=g.getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=16) if(d[i]>40) n++; return n; }
};1`;
// the note that the model is illustrative is on the title screen and can be read without scrolling
// Start is in view before any scrolling, inside the card, and nothing is left hidden behind it at the end of the scroll
const START_SEEN = '(function(){ const c=document.querySelector("#title .card"), s=document.getElementById("b-start"), d=document.getElementById("pick"); c.scrollTop=0; const r=c.getBoundingClientRect(), q=s.getBoundingClientRect(); c.scrollTop=c.scrollHeight; const e=d.getBoundingClientRect(), q2=s.getBoundingClientRect(); c.scrollTop=0; return {first:q.top>=r.top&&q.bottom<=Math.min(r.bottom,innerHeight)+1&&q.height>=44,end:e.bottom<=q2.top+1&&e.top>=r.top}; })()';
const NOTE_SEEN = '(function(){ const n=document.querySelector("#title .note"), r=n.getBoundingClientRect(); return /Illustrative model\\. Interior layout is not public\\./.test(n.textContent)&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth; })()';
const brg = 'Math.atan2(-(Z-p.z),X-p.x)';   // bearing from the boat to a point, in the simulation's own angle

async function desktop() {
  await size(1280, 800, false);
  await open('?test=1&seed=7');
  note(await ev('typeof __G==="object"&&typeof __G.stepFrames==="function"&&typeof __G.createSim==="function"&&!!__G.sim&&!!__G.input'), 'test hook is present');
  note(await ev('__G.table.phone===false&&__G.table.on===false&&!document.body.classList.contains("table")&&getComputedStyle(document.getElementById("tbar")).display==="none"'), 'the phone tabletop is off on a desktop screen');
  note(await ev('__G.plainLook') === false, 'sea and sky shaders run (not the plain look)');
  note(await ev('!document.getElementById("title").hidden&&document.getElementById("hud").hidden'), 'title screen shows first');
  note(await ev(NOTE_SEEN), 'the title shows the note "Illustrative model. Interior layout is not public." without scrolling');
  await ev(HELPERS);
  const t0 = await ev('__G.sim.state.t'); await sleep(700); note(await ev('__G.sim.state.t') === t0, 'the clock does not run by itself in test mode');
  await shot('01-title-1280');

  await ev('__G.start(7)'); await ev('__G.stepFrames(90)'); await sleep(600);
  note(await ev('!document.getElementById("hud").hidden&&document.getElementById("title").hidden'), 'Start shows the instruments', await ev('__h.info()'));
  const pips = await ev('({tubes:document.querySelectorAll("#tubes i").length,ready:document.querySelectorAll("#tubes i:not(.empty)").length,decoys:document.querySelectorAll("#decoys i:not(.gone)").length,simTubes:__G.sim.state.player.readyT+__G.sim.state.player.readyM,simDecoys:__G.sim.state.player.decoys,gv:document.querySelector("#gauges .gv").textContent,gvShown:document.querySelector("#gauges .gv").getBoundingClientRect().height>0})');
  note(pips.tubes === 8 && pips.ready === 8 && pips.simTubes === 8 && pips.decoys === 4 && pips.simDecoys === 4, 'the instruments show 8 tubes and 4 noisemakers, as the simulation has', pips);
  note(/game values/i.test(pips.gv) && pips.gvShown, 'the gauges carry a "game values" caption', pips.gv);
  const helpText = await ev('document.getElementById("help").textContent');
  note(helpText.split('All numbers are game values, not real specifications.').length === 2, 'help says once that all numbers are game values');
  await shot('02-start-under-water-1280');

  // hard right rudder for 5 s: the boat must turn to starboard (compass heading goes up from north)
  const h0 = await ev('document.getElementById("g-hdg").textContent');
  await ev('__G.input.rudder=1; __G.input.throttle=3; __G.stepFrames(150); __G.input.rudder=0; 1'); await frames(3);
  const h1 = await ev('document.getElementById("g-hdg").textContent');
  note(+h1 > +h0 && +h1 < 180, 'right rudder turns the boat to starboard', h0 + ' to ' + h1);
  await shot('03-turned-under-water-1280');

  // go deep to see the seabed
  await ev('__G.input.depthCmd=200; __G.input.throttle=2; __G.stepFrames(30*75); __G.cam.el=0.22; __G.cam.elGoal=null; 1'); await sleep(500);
  console.log('     deep', JSON.stringify(await ev('__h.info()')), 'under keel', await ev('__G.sim.state.player.under.toFixed(1)'));
  await shot('04-deep-seabed-1280');

  // a new game: close on the frigate quietly at 60 m, then come to the surface with it ahead
  await ev('__G.start(7); __G.input.depthCmd=60; __G.input.throttle=2; 1'); await frames(2);
  console.log('     closing', JSON.stringify(await ev('__h.drive(500,(st,p,s)=>Math.hypot(s.x-p.x,s.z-p.z)<800)')));
  await ev('__G.input.depthCmd=0; __G.input.throttle=1; 1');
  console.log('     surfacing', JSON.stringify(await ev('__h.drive(60,(st,p,s)=>p.depth<0.3)')));
  await ev('__h.lookShip(0.1,95)'); await sleep(700);
  await shot('05-surfaced-frigate-ahead-1280');
  await ev('__h.lookHelo(0.16,80,0.35)'); await sleep(500);
  await shot('06-surfaced-toward-helicopter-1280');

  // fire a pair and watch for the hit
  await ev('__G.input.fire=true; __h.drive(1/30,()=>false); 1'); await sleep(250);
  await ev('__h.lookShip(0.09,70,0.3)'); await shot('07-torpedo-away-1280');
  await ev('__h.drive(3,()=>false); __G.input.fire=true; __h.drive(1/30,()=>false); 1');
  note(await ev('__G.sim.state.stats.fired') === 2, 'two torpedoes fired', await ev('__h.info()'));
  // a new game played by the scripted player of sim.test.mjs up to its first hit, in short steps near the end so the strike is drawn where it
  // happens. For the two pictures only, the boat is then put on the surface beside the frigate (staged; this game is not played on).
  await ev('__G.start(7)'); await frames(2);
  let info = null;
  for (let i = 0; i < 4000; i++) {
    info = await ev('(function(){ const st=__G.sim.state, s=st.ships[0], h0=st.stats.hits, close=()=>st.torps.some(t=>t.side===0&&Math.hypot(t.x-s.x,t.z-s.z)<300), near=close(); const i=__h.play(near?0.1:2,()=>st.stats.hits>h0||(!near&&close())); i.newHit=i.hits>h0; return i; })()');
    if (info.newHit || info.over) break;
    await frames(1);
  }
  note(info.newHit === true, 'the scripted player steers a torpedo on its wire into the frigate', info);
  if (info.newHit) {
    await ev('(function(){ const st=__G.sim.state, p=st.player, s=st.ships[0]; p.x=s.x+Math.sin(s.h)*260+Math.cos(s.h)*40; p.z=s.z+Math.cos(s.h)*260-Math.sin(s.h)*40; p.depth=0; __G.stepFrames(2); __h.lookShip(0.1,80,0.3); })()');
    await sleep(450); await shot('08-hit-water-column-staged-1280'); await sleep(900); await shot('09-hit-a-second-later-staged-1280');
  }
  // the same game again, untouched, played to the end
  await ev('__G.start(7)'); await frames(2);
  for (let i = 0; i < 400 && !(info = await ev('__h.play(5)')).over; i++);
  note(info.over && info.result === 'win', 'the scripted player puts the frigate out of action and the mission is won', info);
  await ev('__h.lookShip(0.1,95)'); await sleep(6500);
  note(await ev('!document.getElementById("result").hidden&&document.getElementById("r-title").textContent==="Mission complete"'), 'the win card shows', await ev('document.getElementById("result").innerText.replace(/\\n+/g," | ")'));
  await shot('10-win-card-1280');
  // staged close-up (the boat is moved beside the stopped frigate after the game has ended) to look at the list and the smoke
  await ev('(function(){ const st=__G.sim.state, p=st.player, s=st.ships[0]; document.getElementById("result").hidden=true; p.x=s.x+Math.sin(s.h)*170+Math.cos(s.h)*20; p.z=s.z+Math.cos(s.h)*170-Math.sin(s.h)*20; p.depth=0; __G.stepFrames(2); __h.lookShip(0.13,60); })()');
  await sleep(9000); await shot('11-frigate-out-of-action-staged-1280');
  await ev('document.getElementById("result").hidden=false; 1');

  // a losing game: ping, then sit still near the surface until the helicopter's torpedoes finish the boat
  await ev('__G.start(703)'); await frames(2);
  let heloShot = false, dropShot = false;
  for (let i = 0; i < 2000; i++) {
    info = await ev('(function(){ const G=__G, st=G.sim.state; G.input.throttle=2; G.input.depthCmd=40; for(let k=0;k<15&&!st.over;k++){ G.input.ping=st.player.pingCd<=0; G.stepFrames(1); } return __h.info(); })()');
    if (!heloShot && info.hd < 100 && info.alt > 10 && info.helo === 'dip') { heloShot = true; await ev('document.getElementById("alert").style.visibility="hidden"; __h.lookHelo(0.2,230)'); await sleep(500); await shot('12-helicopter-dipping-alert-line-hidden-1280'); await ev('document.getElementById("alert").style.visibility=""; 1'); await ev('__h.lookHelo(-0.12,45)'); await sleep(500); await shot('13-dipping-sonar-under-water-1280'); }
    if (!dropShot && info.chute) { dropShot = true; await ev('document.getElementById("alert").style.visibility="hidden"; __h.lookHelo(0.2,230)'); await sleep(300); await shot('14-torpedo-drop-alert-line-hidden-1280'); await ev('document.getElementById("alert").style.visibility=""; 1'); console.log('     drop', JSON.stringify(info), await ev('document.getElementById("alert").textContent')); }
    if (info.over) break;
  }
  note(info.over && info.result === 'lose', 'a boat that keeps pinging and does not evade loses', info);
  await sleep(4200);
  console.log('     result card: ' + await ev('document.getElementById("result").innerText.replace(/\\n+/g," | ")'));
  note(await ev('!document.getElementById("result").hidden') && (!info.lost || await ev('document.getElementById("r-title").textContent') === 'Boat lost (simulated)'), 'the lose card shows');
  await shot('15-lose-card-1280');

  // pause and help
  await ev('__G.start(7); __G.stepFrames(30); document.getElementById("b-pause").click(); 1'); await shot('16-pause-1280');
  await ev('document.getElementById("b-help2").click(); 1');
  note(await ev('!document.getElementById("help").hidden&&document.getElementById("pause").hidden'), 'help opened from the pause menu replaces it');
  await shot('17-help-1280');
  await ev('document.getElementById("b-help-close").click(); 1');
  note(await ev('document.getElementById("help").hidden&&!document.getElementById("pause").hidden'), 'closing help returns to the pause menu');
  await ev('document.getElementById("b-resume").click(); 1');
  note(await ev('document.getElementById("pause").hidden&&document.getElementById("help").hidden&&!__G.game.paused'), 'pause and help close again');
  await ev('document.getElementById("b-help").click(); 1');
  note(await ev('!document.getElementById("help").hidden&&__G.game.paused'), 'help during play holds the game');
  await ev('document.getElementById("b-help-close").click(); 1');
  note(await ev('document.getElementById("help").hidden&&!__G.game.paused'), 'closing help resumes play');

  // camera: dragging with the mouse turns the view, the wheel zooms
  const camNow = () => ev('({az:__G.cam.az,el:__G.cam.el,r:__G.cam.r})');
  const mouse = (type, x, y) => c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const cam0 = await camNow();
  await mouse('mousePressed', 640, 400); await mouse('mouseMoved', 700, 380); await mouse('mouseMoved', 800, 350); await mouse('mouseReleased', 800, 350); await frames(2);
  const cam1 = await camNow();
  note(Math.abs(cam1.az - cam0.az) > 0.5 && cam1.el !== cam0.el, 'dragging with the mouse turns the camera', { from: cam0, to: cam1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: 400 }); await frames(2);
  const cam2 = await camNow();
  note(cam2.r > cam1.r * 1.2, 'the mouse wheel zooms out', cam1.r.toFixed(0) + ' to ' + cam2.r.toFixed(0));

  // restart, quit to title, difficulty and sound
  await ev('__G.stepFrames(90); document.getElementById("b-pause").click(); document.getElementById("b-restart").click(); 1');
  note(await ev('__G.game.running&&!__G.game.paused&&__G.sim.state.t===0&&document.getElementById("pause").hidden'), 'Restart starts the mission again');
  await ev('document.getElementById("b-pause").click(); document.getElementById("b-quit").click(); 1');
  note(await ev('!__G.game.running&&!document.getElementById("title").hidden&&document.getElementById("hud").hidden&&document.getElementById("pause").hidden'), 'Quit to title shows the title screen');
  await ev('document.querySelector("#pick button[data-d=hard]").click(); document.getElementById("b-start").click(); 1');
  note(await ev('__G.game.difficulty==="hard"&&__G.game.running'), 'the difficulty buttons choose the difficulty', await ev('__G.game.difficulty'));
  const snd0 = await ev('document.getElementById("b-sound2").textContent'); await ev('document.getElementById("b-sound2").click(); 1');
  const snd1 = await ev('document.getElementById("b-sound2").textContent'); await ev('document.getElementById("b-sound2").click(); 1');
  note(snd0 !== snd1 && snd0 === await ev('document.getElementById("b-sound2").textContent'), 'the sound button switches sound off and on', snd0 + ' / ' + snd1);
  await ev('document.getElementById("b-pause").click(); document.getElementById("b-quit").click(); document.querySelector("#pick button[data-d=standard]").click(); 1');
  note(await ev('(function(){ try{ return JSON.parse(localStorage.getItem("strait-shadow")).difficulty; }catch(e){ return "none"; } })()') === 'standard', 'the chosen difficulty is remembered in the browser');

  // reduced motion: the title view holds still and a hit does not shake the camera
  for (const reduce of [false, true]) {
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
    await open('?test=1&seed=7'); await ev(HELPERS);
    const a0 = await ev('__G.cam.az'); await sleep(700); const a1 = await ev('__G.cam.az');
    await ev('__G.start(7)'); await frames(3); await sleep(3500);   // the view takes about two seconds to settle after a start
    const pos = () => ev('__G.camera.position.toArray().map(v=>+v.toFixed(4)).join(",")');
    const p0 = await pos(); await frames(2); const p1 = await pos();
    await ev('__G.effects.shake(1.5); 1'); await frames(3); const p2 = await pos();
    if (reduce) note(a0 === a1 && p1 === p2, 'reduced motion: no slow turn on the title and no camera shake', { title: [a0, a1], still: p0 === p1, shaken: p1 !== p2 });
    else note(a0 !== a1 && p0 === p1 && p1 !== p2, 'normal motion: the title view turns slowly and a hit shakes the camera', { title: [a0, a1], still: p0 === p1, shaken: p1 !== p2 });
    // the end of a game (here: the clock is run out): the picture keeps drawing behind the result card, and the view drifts unless motion is reduced
    await ev('__G.effects.shake(0); __G.sim.state.t=__G.sim.state.timeLimit-0.1; __G.stepFrames(6); 1'); await sleep(3600);
    const e0 = await ev('({az:__G.cam.az,t:__G.view.t,card:!document.getElementById("result").hidden,over:__G.sim.state.over})'); await sleep(900);
    const e1 = await ev('({az:__G.cam.az,t:__G.view.t})');
    note(e0.over && e0.card && e1.t > e0.t + 0.5 && (reduce ? e1.az === e0.az : e1.az > e0.az + 0.01), (reduce ? 'reduced motion: ' : 'normal motion: ') + 'after the end the picture keeps drawing behind the result card and the view ' + (reduce ? 'holds still' : 'drifts slowly'), { from: e0, to: e1 });
  }
  await c.send('Emulation.setEmulatedMedia', { features: [] });
  await open('?test=1&seed=7'); await ev(HELPERS); await ev('__G.start(7)'); await frames(2);

  // the plain look, forced
  await ev('__G.goPlain(); __G.input.depthCmd=0; __G.input.throttle=3; __G.stepFrames(30*35); __G.cam.el=0.2; __G.cam.elGoal=null; 1'); await sleep(2500);
  note(await ev('__G.plainLook') === true, 'plain look can be forced');
  const plainShade = await ev('__G.shade');
  note(plainShade.lit === 0 && plainShade.miss === 0 && !plainShade.cast, 'the plain look drops the sky map and the cast shade with the rest of the shader work', plainShade);
  await shot('18-plain-look-surface-1280');
  await ev('__G.input.depthCmd=25; __G.stepFrames(30*30); 1'); await sleep(1500);
  await shot('19-plain-look-under-water-1280');
  // a kind of ship first built after the plain look took over: the cargo ship of The Strait
  const had = await ev('Object.keys(__G.shade.kinds)');
  await ev('__G.start(16,"strait"); __G.stepFrames(30); 1'); await frames(6);
  const late = await ev('(function(){ const s=__G.shade; return {kinds:Object.keys(s.kinds),std:s.std,lit:s.lit,miss:s.miss}; })()');
  note(!had.includes('cargo') && late.kinds.includes('cargo') && late.std > plainShade.std && late.lit === 0 && late.miss === 0, 'a kind of ship first built after the plain look took over is plain too', { had, late });

  // a hit by a torpedo that is not the boat's: the alert line tells it plainly, and names no penalty. No ship fires a heavy torpedo yet, so one of the boat's own
  // is fired, made over into a frigate's (its side, and that frigate as its owner) and put just short of a merchant ship. The boat's own hit there costs a star.
  await ev(D_HELPERS);
  await ev('__G.start(7,"gate"); (function(){ const G=__G, st=G.sim.state, s=__h.ship("merchant"), f=__h.ship("frigate"); __h.near(s,800,30); G.stepFrames(30); G.input.fire=true; G.stepFrames(3); G.input.fire=false; G.said.length=0; const t=st.torps.find(q=>q.id===__h.strike(s)); t.side=1; t.owner=f.id; t.wire=false; let n=0; while(n<300&&st.torps.includes(t)&&!st.over){ G.stepFrames(1); n++; } })(); 1'); await frames(3);
  const fh = await ev('(function(){ const G=__G, st=G.sim.state; return {said:G.said.slice(),alert:document.getElementById("alert").textContent,over:st.over,neutral:st.stats.neutral,hits:st.stats.hits,torps:st.torps.length}; })()');
  note(fh.said.includes('A torpedo has hit a neutral merchant ship.') && !fh.said.some(m => /hit a neutral/.test(m) && /your/i.test(m)) && !fh.said.some(m => /costs a star|ends the mission|Points are lost/.test(m)) && !fh.over && fh.neutral === 0 && fh.hits === 0,
    "a torpedo that is not the boat's hits a merchant ship: the alert line says a torpedo hit it, not the captain's, with no penalty named and none counted", fh);
}

async function phone() {
  await size(500, 900, true);
  await open('?test=1&seed=7&unlock=1&table=0');   // table=0: these are the checks of the full 3D phone layout, which the tabletop (stageh) reaches with its 3D button
  await ev(HELPERS);
  note(await ev('document.body.classList.contains("touch")'), 'touch layout is on at phone size');
  note(await ev('__G.plainLook') === false, 'phone size: shaders run');
  await shot('20-title-500');
  await ev('document.getElementById("b-how").click(); 1'); await shot('21-help-500');
  note(await ev('(function(){ const c=document.querySelector("#help .card"), r=c.getBoundingClientRect(); return r.left>=0&&r.right<=innerWidth+1&&(c.scrollHeight<=c.clientHeight+1||getComputedStyle(c).overflowY!=="visible"); })()'), 'help card fits or scrolls at phone size');
  await ev('document.getElementById("b-help-close").click(); __G.start(7); __G.stepFrames(60); 1'); await sleep(600);
  await shot('22-play-under-water-500');
  // every touch control is at least 44 px and inside the screen
  const boxes = await ev(JSON.stringify(TOUCH) + '.map(id=>__h.rect(id))');
  note(boxes.every(b => b.w >= 44 && b.h >= 44 && b.l >= 0 && b.t >= 0 && b.r <= 500 && b.b <= 900), 'touch controls are at least 44 px and on screen', boxes.map(b => b.id + ' ' + b.w + 'x' + b.h).join(', '));
  const overlap = await ev('__h.overlaps(' + JSON.stringify(TOUCH.concat(PANELS)) + ')');
  note(overlap.length === 0, 'touch controls and panels do not overlap each other', overlap);
  await ev('__G.input.depthCmd=0; __G.input.throttle=2; 1'); await ev('__h.drive(45,(st,p)=>p.depth<0.3)'); await ev('__h.lookShip(0.12,135)'); await sleep(700);
  await shot('23-play-surfaced-500');
  await ev('document.getElementById("t-pause").click(); 1'); await shot('24-pause-500');
  await ev('document.getElementById("b-resume").click(); __G.effects.say("Torpedo in the water, bearing 140! Go deep and stay quiet.",2,30); 1'); await shot('25-alert-500');
  await phoneViews();
  await stagedPhone();
  if (want('stagef')) await stagefPhone();
  await stagegPhone();
  // one finger on the sea turns the view; two fingers pinch to zoom
  const touch = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1 })) });
  const camNow = () => ev('({az:__G.cam.az,r:__G.cam.r})');
  const t0 = await camNow();
  await touch('touchStart', [[250, 450]]); await touch('touchMove', [[300, 440]]); await touch('touchMove', [[380, 430]]); await touch('touchEnd', []); await frames(2);
  const t1 = await camNow();
  note(Math.abs(t1.az - t0.az) > 0.4, 'touch: dragging on the sea turns the camera', t0.az.toFixed(2) + ' to ' + t1.az.toFixed(2));
  await touch('touchStart', [[200, 450]]); await touch('touchStart', [[200, 450], [300, 450]]); await touch('touchMove', [[220, 450], [280, 450]]); await touch('touchMove', [[235, 450], [265, 450]]); await touch('touchEnd', []); await frames(2);
  const t2 = await camNow();
  note(t2.r > t1.r * 1.5, 'touch: pinching in zooms out', t1.r.toFixed(0) + ' to ' + t2.r.toFixed(0));
}

// the touch controls and the panels that must stay clear of each other
const TOUCH = ['t-fire', 't-ping', 't-silent', 't-pause', 't-time', 't-view', 't-map', 't-scope', 't-mast', 't-wl', 't-wr', 't-decoy', 'pad', 'dslide'];
// Help and Sound are on the pause card, upright and sideways, so both phone shapes have the same buttons
const TOUCH_SIDE = TOUCH;
const PANELS = ['brief', 'gauges', 'status', 'ring', 'alert'];
// the most of the screen that panels and controls may cover, by phone shape
const COVER_MAX = { '390x844': 0.6, '844x390': 0.4 };
// map, periscope and the exercise prompt at phone size, then two other phone shapes; no touch gestures here (see the note on order at the end)
async function phoneViews() {
  // First Blood, seed 7: close on the frigate under water, then look at the map
  await ev('__G.start(7); __G.input.depthCmd=60; __G.input.throttle=2; 1'); await frames(2);
  console.log('     closing', JSON.stringify(await ev('__h.drive(400,(st,p,s)=>Math.hypot(s.x-p.x,s.z-p.z)<1500)')));
  await ev('document.getElementById("t-map").click(); __G.effects.say("Torpedo in the water, bearing 140! Go deep and stay quiet. Release a noisemaker.",2,30); 1'); await frames(6);
  let v = await ev('({map:__G.game.map,shown:!document.getElementById("mapc").hidden&&!document.getElementById("mapbar").hidden,wide:document.body.classList.contains("wide"),bar:__h.rect("mapbar"),ink:__h.mapInk(),circle:__h.circle(' + JSON.stringify(TOUCH.concat(['brief', 'gauges', 'mapbar', 'alert'])) + '),over:__h.overlaps(' + JSON.stringify(TOUCH.concat(['brief', 'gauges', 'mapbar', 'alert'])) + ')})');
  note(v.map && v.shown && v.wide && v.ink > 300, 'phone: the Map button opens the map and something is drawn on it', { ink: v.ink });
  note(v.circle.covered.length === 0 && v.circle.r >= 110 && v.over.length === 0 && v.bar.l >= 0 && v.bar.r <= 500, 'phone: the map circle is clear of the controls and the map bar is on screen', v);
  await shot('60-map-500');
  const sp0 = await ev('__G.map.span'); await ev('document.getElementById("m-in").click(); 1'); await frames(3);
  const sp1 = await ev('__G.map.span'); note(sp0 >= 2000 && sp1 === sp0 / 2, 'phone: the map + button zooms in one step', [sp0, sp1]);
  // two fingers on the map zoom it (staged pointer events, because a real two-finger gesture must be the last touch of the run)
  const pe = (type, id, x, y) => 'document.getElementById("mapc").dispatchEvent(new PointerEvent("' + type + '",{pointerId:' + id + ',clientX:' + x + ',clientY:' + y + ',bubbles:true}));';
  await ev(pe('pointerdown', 11, 200, 400) + pe('pointerdown', 12, 300, 400) + pe('pointermove', 11, 216, 400) + pe('pointermove', 12, 284, 400) + pe('pointerup', 11, 216, 400) + pe('pointerup', 12, 284, 400) + '1');
  note(await ev('__G.map.span') === sp1 * 2, 'phone: pinching in on the map zooms out one step', await ev('__G.map.span'));
  await ev('document.getElementById("m-close").click(); 1'); await frames(2);
  note(await ev('!__G.game.map&&document.getElementById("mapc").hidden&&!document.body.classList.contains("wide")'), 'phone: Close leaves the map');
  // periscope: too deep first, then at periscope depth with the frigate in the glass
  await ev('__G.effects.say("",2,0.02); 1'); await frames(4);
  await ev('document.getElementById("t-scope").click(); 1'); await frames(2);
  note(await ev('!__G.game.scope') && /Too deep/.test(await ev('document.getElementById("alert").textContent')), 'phone: the periscope is refused when the boat is too deep', await ev('document.getElementById("alert").textContent'));
  await ev('__G.input.depthCmd=9; __G.input.throttle=1; 1'); console.log('     to periscope depth', JSON.stringify(await ev('__h.drive(120,(st,p)=>p.depth<9.6)')));
  await ev('document.getElementById("t-scope").click(); __h.drive(4,()=>false); 1'); await frames(6);
  v = await ev('(function(){ const st=__G.sim.state, p=st.player, s=st.ships[0]; return {scope:__G.game.scope,shown:!document.getElementById("scope").hidden,mast:p.mast,seen:s.seenT>st.t,brg:document.getElementById("s-brg").textContent,tgt:document.getElementById("s-tgt").textContent,expo:+p.expo.toFixed(2),tag:document.getElementById("s-tag").textContent,subHidden:true,circle:__h.circle(' + JSON.stringify(TOUCH.concat(['brief', 'gauges', 'alert'])) + ')}; })()');
  note(v.scope && v.shown && v.mast && v.seen && /Frigate/.test(v.tgt) && /range \d+ m/.test(v.tgt), 'phone: the periscope shows the frigate with an exact range', v);
  note(v.circle.covered.length === 0 && v.circle.r >= 110, 'phone: the periscope circle is clear of the controls', v.circle);
  await shot('61-periscope-500');
  await ev('document.getElementById("t-scope").click(); 1'); await frames(2);
  note(await ev('!__G.game.scope&&document.getElementById("scope").hidden&&!__G.input.mast'), 'phone: Scope again lowers the periscope and the mast');
  // holding Wire R gives a starboard wire order for as long as it is held (staged pointer events on the button)
  await ev('document.getElementById("t-wr").dispatchEvent(new PointerEvent("pointerdown",{pointerId:21,bubbles:true,cancelable:true})); __G.control(1/30); 1');
  const wr1 = await ev('__G.input.wire'); await ev('document.getElementById("t-wr").dispatchEvent(new PointerEvent("pointerup",{pointerId:21,bubbles:true})); __G.control(1/30); 1');
  note(wr1 === 1 && await ev('__G.input.wire') === 0, 'phone: holding Wire R orders the torpedo to starboard, letting go stops', [wr1, await ev('__G.input.wire')]);
  // the exercise prompt names the touch controls
  await ev('__G.start(1,"shakedown"); __G.stepFrames(30); 1'); await frames(3);
  const hint = await ev('document.getElementById("alert").textContent'), hintOver = await ev('__h.overlaps(' + JSON.stringify(TOUCH.concat(PANELS)) + ')');
  note(/left pad/.test(hint) && !/A and D/.test(hint) && hintOver.length === 0, 'phone: the first exercise prompt names the touch controls and overlaps nothing', [hint, hintOver]);
  await shot('62-shakedown-prompt-500');
  // two real phone shapes, upright and sideways: play, map, periscope, pause, title and result card
  const HUD = ['brief', 'gauges', 'status', 'ring', 'alert', 'pad', 'dslide', 'acts'];
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const side = h < 520, ids = side ? TOUCH_SIDE : TOUCH, at = w + 'x' + h, nm = part => (side ? '64-' + part + '-sideways-' : '63-' + part + '-') + at;
    await size(w, h, true); await frames(4); await sleep(500);
    await ev('__G.start(7); __G.input.depthCmd=60; __G.input.throttle=2; __h.drive(400,(st,p,s)=>Math.hypot(s.x-p.x,s.z-p.z)<1500); __G.effects.say("Torpedo in the water, bearing 140! Go deep and stay quiet.",2,30); 1'); await frames(6); await sleep(400);
    const b = await ev(JSON.stringify(ids) + '.map(id=>__h.rect(id))'), o = await ev('__h.overlaps(' + JSON.stringify(ids.concat(PANELS)) + ')');
    note(b.every(q => q.w >= 44 && q.h >= 44 && q.l >= 0 && q.t >= 0 && q.r <= w && q.b <= h) && o.length === 0, at + ': touch controls are at least 44 px, on screen and clear of each other and the panels', { small: b.filter(q => q.w < 44 || q.h < 44 || q.l < 0 || q.t < 0 || q.r > w || q.b > h), overlap: o, brief: await ev('__h.rect("brief")'), gauges: await ev('__h.rect("gauges")') });
    // the alert line comes and goes, so it is counted in the cover but not held against the boat's place
    const cov = await ev('__h.cover(' + JSON.stringify(HUD) + ')'), boat = await ev('(function(){ const b=__G.boatBox; return {box:b.map(Math.round),hit:__h.boxHit(b,' + JSON.stringify(HUD.filter(id => id !== 'alert')) + '),alertTouches:__h.boxHit(b,["alert"]).length>0}; })()');
    note(cov <= COVER_MAX[at] && boat.hit.length === 0 && boat.box[0] >= -2 && boat.box[2] <= w + 2 && boat.box[1] >= 0 && boat.box[3] <= h, at + ': panels and controls cover ' + Math.round(cov * 100) + '% of the screen and no panel or control covers the boat', boat);
    await shot(nm('play'));
    // the map
    await ev('document.getElementById("t-map").click(); 1'); await frames(6);
    const m = await ev('({on:__G.game.map,circle:__h.circle(' + JSON.stringify(ids.concat(['brief', 'gauges', 'mapbar', 'alert', 'status'])) + '),bar:__h.rect("mapbar"),btns:["m-out","m-in","m-centre","m-close"].map(id=>__h.rect(id)),over:__h.overlaps(' + JSON.stringify(ids.concat(['brief', 'gauges', 'mapbar', 'alert'])) + '),strip:__h.boxHit(__G.map.wfBox,' + JSON.stringify(ids.concat(['brief', 'gauges', 'mapbar', 'alert'])) + '),wf:__G.map.wfBox,ink:__h.mapInk(),stripInCircle:(function(){ const f=__G.free, b=__G.map.wfBox; return Math.hypot(Math.max(b[0]-f.cx,0,f.cx-b[2]),Math.max(b[1]-f.cy,0,f.cy-b[3]))<f.r-1; })()})');
    note(m.on && m.ink > 300 && m.circle.covered.length === 0 && !m.stripInCircle && m.circle.r >= 100 && m.over.length === 0 && m.strip.length === 0 && m.wf[0] >= 0 && m.wf[2] <= w && m.wf[3] <= h && m.btns.every(q => q.w >= 44 && q.h >= 44 && q.l >= 0 && q.r <= w && q.t >= 0 && q.b <= h), at + ': the map circle (' + m.circle.r * 2 + ' px across) is clear of the controls; its buttons and the bearing history are on screen and clear too', m);
    await shot(nm('map'));
    await ev(pe('pointerdown', 31, m.circle.cx, m.circle.cy) + pe('pointermove', 31, m.circle.cx - 60, m.circle.cy - 30) + pe('pointerup', 31, m.circle.cx - 60, m.circle.cy - 30) + '1'); await frames(3);
    const pan = await ev('[Math.round(__G.map.panX),Math.round(__G.map.panZ)]');
    await ev('document.getElementById("m-centre").click(); 1'); await frames(2);
    note(pan[0] > 0 && pan[1] > 0 && await ev('__G.map.panX===0&&__G.map.panZ===0'), at + ': one finger drags the map and Centre brings it back', pan);
    await ev('document.getElementById("m-close").click(); __G.effects.say("",2,0.02); 1'); await frames(4);
    // the periscope (the boat is placed at periscope depth)
    await ev('(function(){ const p=__G.sim.state.player; p.depth=9; __G.input.depthCmd=9; __G.input.throttle=1; __G.stepFrames(20); })(); document.getElementById("t-scope").click(); __h.drive(4,()=>false); 1'); await frames(6);
    const sc = await ev('({on:__G.game.scope,shown:!document.getElementById("scope").hidden,tgt:document.getElementById("s-tgt").textContent,read:["s-brg","s-tgt","s-expo"].map(id=>__h.rect(id)),alert:document.getElementById("alert").textContent,circle:__h.circle(' + JSON.stringify(ids.concat(['brief', 'gauges', 'alert', 'status'])) + '),over:__h.overlaps(' + JSON.stringify(ids.concat(['brief', 'gauges', 's-brg', 's-tgt', 's-expo'])) + ')})');
    note(sc.on && sc.shown && /Frigate/.test(sc.tgt) && sc.circle.covered.length === 0 && sc.circle.r >= 100 && sc.over.length === 0 && sc.read.every(q => q.l >= 0 && q.r <= w && q.t >= 0 && q.b <= h), at + ': the periscope circle (' + sc.circle.r * 2 + ' px across) is clear of the controls and its readouts are on screen', sc);
    await shot(nm('periscope'));
    await ev('document.getElementById("t-scope").click(); 1'); await frames(2);
    // pause, title and result cards
    await ev('document.getElementById("t-pause").click(); 1'); await frames(3);
    let cd = await ev('__h.card("pause","b-resume")');
    note(cd.shown && cd.inside && cd.button && cd.small.length === 0 && await ev('["b-help2","b-sound2","b-quit"].every(id=>document.getElementById(id).getBoundingClientRect().width>=44)'), at + ': the pause card fits, with Resume, Restart, Help, Sound and Quit', cd);
    await ev('document.getElementById("b-quit").click(); 1'); await frames(4);
    cd = await ev('__h.card("title","b-start")'); cd.start = await ev(START_SEEN);
    note(cd.shown && cd.inside && cd.button && cd.small.length === 0 && await ev(NOTE_SEEN) && cd.start.first && cd.start.end, at + ': the title card fits the screen (scrolling inside itself if it must), its buttons are big enough, and the illustrative-model note and Start show without scrolling', cd);
    await shot(nm('title'));
    await ev('__G.start(7); 1'); await frames(2);
    const won = await ev('__h.play(900)'); await ev('__G.effects.showResult(); 1'); await frames(4);
    cd = await ev('__h.card("result","b-retry")');
    note(won.result === 'win' && cd.shown && cd.inside && cd.button && cd.small.length === 0 && /★/.test(await ev('document.getElementById("r-stars").textContent')), at + ': the result card fits the screen and shows the stars', cd);
    await shot(nm('result'));
    await ev('document.getElementById("result").hidden=true; 1');
  }
  await size(500, 900, true); await frames(4); await sleep(400);
  await ev('__G.start(7); __G.stepFrames(30); 1'); await frames(3);
}

// the Stage B parts at 1280x800: missions, map, periscope, noisemaker, torpedo wire, and the scene after the end
async function missions() {
  const key = async (code, k, vk) => { await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk }); };
  const alertText = () => ev('document.getElementById("alert").textContent');
  await size(1280, 800, false);
  await ev('1').then(() => open('?test=1&seed=7')); await ev(HELPERS);
  await ev('try{ localStorage.removeItem("strait-shadow"); }catch(e){} 1'); await open('?test=1&seed=7&unlock=1'); await ev(HELPERS);
  // the title lists the missions; the first one is chosen for a new player
  const list = await ev('Array.from(document.querySelectorAll("#mpick button")).map(b=>b.textContent+(b.getAttribute("aria-pressed")==="true"?" (chosen)":""))');
  note(list.length === 5 && /Shakedown.*\(chosen\)/.test(list[0]) && /Through the Gate/.test(list[1]) && /First Blood/.test(list[2]) && /Hunted/.test(list[3]) && /Strait Shadow/.test(list[4]), 'the title lists five missions and starts a new player on Shakedown', list);
  await ev('document.querySelector("#mpick button[data-m=gate]").click(); 1');
  note(await ev('__G.game.mission==="gate"&&__G.sim.state.mission==="gate"&&/exit zone/i.test(document.getElementById("m-brief").textContent)&&JSON.parse(localStorage.getItem("strait-shadow")).mission==="gate"'), 'choosing a mission shows its brief and is remembered', await ev('document.getElementById("m-brief").textContent'));
  await shot('50-title-mission-chosen-1280');
  await ev('document.querySelector("#mpick button[data-m=shakedown]").click(); document.getElementById("b-start").click(); 1'); await frames(3);

  // --- Shakedown: follow the five prompts ---
  note(await ev('__G.sim.state.mission==="shakedown"&&document.getElementById("h-threat").textContent==="Exercise"') && /Steer for the marker/.test(await alertText()) && /A and D/.test(await alertText()), 'Shakedown starts with its first prompt, worded for the keyboard', await alertText());
  await ev('__G.stepFrames(45); 1'); await frames(3);
  console.log('     brief panel: ' + await ev('document.getElementById("brief").innerText.replace(/\\n+/g," | ")'));
  await shot('51-shakedown-first-prompt-1280');
  let r = await ev('__h.coachStep(200)'); note(r.key === 'dive', 'exercise step 1: passing the marker buoy moves on to the dive', r);
  r = await ev('__h.coachStep(200)'); await frames(3);
  note(r.key === 'scope' && /below it/.test(await ev('document.getElementById("h-layer").textContent')), 'exercise step 2: below the layer, and the instruments say so', [r, await ev('document.getElementById("h-layer").textContent')]);
  r = await ev('__h.coachStep(300)'); await frames(3);
  note(r.key === 'decoy' && await ev('__G.game.scope&&!document.getElementById("scope").hidden&&__G.sim.state.player.mast'), 'exercise step 3: at periscope depth the periscope opens and the mast is up', r);
  // look at the hulk through the periscope
  await ev('(function(){ const st=__G.sim.state, p=st.player, s=st.ships[0], X=s.x, Z=s.z; __G.scope.rel=__h.wrap(p.h-' + brg + '); __G.input.throttle=1; __G.input.depthCmd=9; __G.stepFrames(60); __G.scope.rel=__h.wrap(st.player.h-Math.atan2(-(s.z-st.player.z),s.x-st.player.x)); __G.stepFrames(1); })()'); await frames(4); await sleep(400);
  let sc = await ev('({brg:document.getElementById("s-brg").textContent,tgt:document.getElementById("s-tgt").textContent,tag:document.getElementById("s-tag").textContent,subVisible:__G.camera.fov,circle:__h.circle(["brief","gauges","status","ring","keys","alert"])})');
  note(/Target hulk/.test(sc.tgt) && /range \d+ m/.test(sc.tgt) && /Bearing \d{3}/.test(sc.brg) && sc.circle.covered.length === 0, 'the periscope names the hulk and its range, and its circle is clear of the panels', sc);
  await shot('52-periscope-hulk-1280');
  // dragging turns the periscope; the wheel does not zoom it
  const mouse = (type, x, y) => c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const rel0 = await ev('__G.scope.rel'), r0 = await ev('__G.cam.r');
  await mouse('mousePressed', 640, 400); await mouse('mouseMoved', 600, 400); await mouse('mouseMoved', 540, 400); await mouse('mouseReleased', 540, 400);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: 400 }); await frames(2);
  note(Math.abs(await ev('__G.scope.rel') - rel0) > 0.2 && await ev('__G.cam.r') === r0, 'dragging turns the periscope and the wheel leaves the outside view alone', [rel0, await ev('__G.scope.rel')]);
  await key('KeyV', 'v', 86); await ev('__G.stepFrames(2); 1'); await frames(2);
  note(await ev('!__G.game.scope&&document.getElementById("scope").hidden&&!__G.input.mast&&__G.camera.fov===40'), 'V lowers the periscope and the mast, and the outside view returns');
  // noisemaker
  await key('KeyX', 'x', 88); await ev('__G.stepFrames(2); 1'); await frames(3);
  r = await ev('({key:__G.sim.state.coach.key,left:document.querySelectorAll("#decoys i:not(.gone)").length,inWater:__G.sim.state.decoys.length})');
  note(r.key === 'shoot' && r.left === 3 && r.inWater === 1, 'exercise step 4: X releases a noisemaker and one pip goes out', [r, await alertText()]);
  await ev('(function(){ const d=__G.sim.state.decoys[0]; __G.stepFrames(50); __h.look(d.x,d.z,-0.04,60); __G.cam.az+=1.25; })()'); await sleep(500);
  await shot('53-noisemaker-in-the-water-1280');
  // torpedo on its wire: fire at the hulk, steer the torpedo with the real key, see it on the map
  r = await ev('__h.coachStep(400,st=>st.torps.length>0)'); await ev('__G.input.rudder=0; __G.input.throttle=1; __G.stepFrames(60); 1'); await frames(3);
  note(r.torps === 1 && await ev('document.getElementById("w-state").textContent') === 'Guiding', 'exercise step 5: a torpedo is away and the instruments say it is being guided', [r, await ev('document.getElementById("w-state").textContent')]);
  const th0 = await ev('__G.sim.state.torps[0].h');
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Period', key: '.', windowsVirtualKeyCode: 190 });
  await ev('__G.control(1/30); 1'); const wireIn = await ev('__G.input.wire'); await ev('__G.stepFrames(45); 1');
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Period', key: '.', windowsVirtualKeyCode: 190 });
  await ev('__G.control(1/30); 1'); const th1 = await ev('__G.sim.state.torps[0]?__G.sim.state.torps[0].h:null');
  note(wireIn === 1 && await ev('__G.input.wire') === 0 && th1 !== null && th1 < th0 - 0.2, 'holding the . key steers the torpedo to starboard through its wire', { wire: wireIn, from: th0, to: th1 });
  await key('KeyM', 'm', 77); await frames(4);
  let mp = await ev('({map:__G.game.map,shown:!document.getElementById("mapc").hidden,info:document.getElementById("m-info").textContent,ink:__h.mapInk(),span:__G.map.span,circle:__h.circle(["brief","gauges","status","ring","keys","mapbar","alert"])})');
  note(mp.map && mp.shown && mp.ink > 500 && mp.circle.covered.length === 0 && /Layer at \d+ m/.test(mp.info), 'M opens the map; it is drawn, clear of the panels, and gives the layer depth', mp);
  await shot('54-map-torpedo-on-the-wire-1280');
  await ev('__G.mapZoom(1); __G.mapZoom(1); 1'); const zs0 = await ev('__G.map.span'); await ev('document.getElementById("m-in").click(); 1'); await frames(4);
  const zs1 = await ev('__G.map.span');
  await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 420, deltaX: 0, deltaY: 300 }); await frames(3);
  note(zs1 === zs0 / 2 && await ev('__G.map.span') === zs0, 'the + button zooms the map in one step and the wheel zooms it out one step', [zs0, zs1, await ev('__G.map.span')]);
  await key('Escape', 'Escape', 27); await frames(2);
  note(await ev('!__G.game.map&&document.getElementById("mapc").hidden&&document.getElementById("pause").hidden&&!__G.game.paused'), 'Esc closes the map without pausing');
  // steer the same torpedo back with the other key, then let the exercise finish
  for (let i = 0; i < 40 && !r.over; i++) r = await ev('__h.coachStep(30)');
  note(r.over && r.result === 'win', 'the exercise is completed with a hit on the hulk', r);
  await ev('__h.lookShip(0.1,95)'); await sleep(5600);
  let card = await ev('document.getElementById("result").innerText.replace(/\\n+/g," | ")');
  note(await ev('!document.getElementById("result").hidden&&document.getElementById("r-title").textContent==="Exercise complete"&&!document.getElementById("b-next").hidden') && /Steps done \| 5 of 5/.test(card), 'the exercise card shows, with a Next mission button', card);
  // the sea carries on behind the card
  const a0 = await ev('({az:__G.cam.az,t:__G.view.t,x:__G.sim.state.player.x,z:__G.sim.state.player.z})'); await ev('__G.stepFrames(90); 1'); await sleep(900);
  const a1 = await ev('({az:__G.cam.az,t:__G.view.t,x:__G.sim.state.player.x,z:__G.sim.state.player.z,simT:__G.sim.state.t})');
  note(a1.az > a0.az + 0.01 && a1.t > a0.t + 0.5 && Math.hypot(a1.x - a0.x, a1.z - a0.z) > 0.5, 'after the end the picture keeps moving behind the card: the view drifts and the boat coasts on', { from: a0, to: a1 });
  await shot('55-exercise-complete-1280');

  // --- Through the Gate ---
  await ev('document.getElementById("b-next").click(); 1'); await frames(3);
  note(await ev('__G.game.mission==="gate"&&__G.game.running&&__G.sim.state.t===0&&document.getElementById("result").hidden') && /map/i.test(await alertText()), 'Next mission starts Through the Gate', await alertText());
  await ev('__G.stepFrames(30); __G.setMap(true); 1'); await frames(4);
  console.log('     gate: ' + await ev('document.getElementById("brief").innerText.replace(/\\n+/g," | ")'));
  await shot('56-gate-map-at-the-start-1280');
  // go north under the layer for four minutes, listening
  await ev('(function(){ const G=__G, st=G.sim.state, ex=__h.mark("exit"); G.setMap(false); G.input.depthCmd=Math.min(st.layer+45,150); G.input.throttle=2; for(let i=0;i<30*240&&!st.over;i++){ __h.steer(ex.x,ex.z); G.stepFrames(1); } G.input.rudder=0; G.setMap(true); })()'); await frames(4);
  r = await ev('({t:__G.sim.state.t,over:__G.sim.state.over,heard:__G.sim.state.heard.length,tracks:__G.sim.state.tracks.map(k=>({grade:k.sol.g,range:k.sol.r===null?null:Math.round(k.sol.r),lines:k.lines.length,age:k.age})),level:__G.sim.state.enemy.level,nav:document.getElementById("h-nav").textContent})');
  note(r.tracks.length >= 1 && r.tracks[0].lines >= 5 && /Exit zone \d{3}/.test(r.nav) && /tracked \d+ of 45 s/.test(r.nav), 'Gate: after four minutes the map holds bearing lines to the frigate and the instruments point to the exit', r);
  await shot('57-gate-map-bearing-lines-1280');
  // staged ending: the boat is placed in the exit zone
  await ev('(function(){ const G=__G, st=G.sim.state, ex=__h.mark("exit"); G.setMap(false); st.player.x=ex.x; st.player.z=ex.z; G.stepFrames(5); })()'); await sleep(5600);
  card = await ev('document.getElementById("result").innerText.replace(/\\n+/g," | ")');
  note(await ev('__G.sim.state.result') === 'win' && /Time tracked \| \d+ s \(limit 45 s\)/.test(card) && await ev('!document.getElementById("b-next").hidden'), 'Gate (boat placed in the exit zone): the card gives the time tracked', card);

  // --- First Blood: bearings firm into a position; the periscope; the mast is a risk ---
  await ev('document.getElementById("b-next").click(); 1'); await frames(3);
  note(await ev('__G.game.mission==="firstblood"&&__G.game.running') && /north/.test(await alertText()), 'Next mission starts First Blood', await alertText());
  await ev('__G.start(7); 1');
  // listen while crossing the line of sight: bearings from different places cross at the contact
  const trackNow = () => ev('(function(){ const st=__G.sim.state, p=st.player, s=st.ships[0], k=st.tracks[0]; return k?{t:Math.round(st.t),grade:k.sol.g,lines:k.lines.length,estRange:k.sol.r===null?null:Math.round(k.sol.r),trueRange:Math.round(Math.hypot(s.x-p.x,s.z-p.z)),miss:k.sol.fit?Math.round(Math.hypot(k.x-s.x,k.z-s.z)):null,err:k.sol.r===null?null:Math.round(k.sol.rs)}:{t:Math.round(st.t),none:true}; })()');
  await ev('(function(){ const G=__G, st=G.sim.state; G.input.depthCmd=30; G.input.throttle=2; G.stepFrames(30*40); })()');
  const tk0 = await trackNow();
  await ev('(function(){ const G=__G, st=G.sim.state, p=st.player, s=st.ships[0]; G.input.depthCmd=30; G.input.throttle=2; for(let i=0;i<30*200&&!st.over;i++){ const b=Math.atan2(-(s.z-p.z),s.x-p.x)+1.05*(Math.floor(st.t/70)%2?1:-1); G.input.rudder=Math.max(-1,Math.min(1,-__h.wrap(b-p.h)*3)); G.stepFrames(1); } G.input.rudder=0; G.setMap(true); })()'); await frames(4);
  const tk1 = await trackNow();
  note(!tk0.none && !tk1.none && tk0.grade <= 1 && tk1.grade >= 2 && tk1.miss !== null && tk1.miss < 0.3 * tk1.trueRange && tk1.lines >= 10, 'First Blood: bearings taken on a steady course give no range; bearings taken from a zigzag firm up into a solution graded Fair or better', { early: tk0, later: tk1 });
  console.log('     contact line: ' + await ev('document.getElementById("contact").textContent'));
  await shot('58-map-position-from-bearings-1280');
  await ev('__G.setMap(false); __G.input.depthCmd=9; __G.input.throttle=1; 1');
  console.log('     to periscope depth', JSON.stringify(await ev('__h.drive(150,(st,p)=>p.depth<9.6)')));
  await key('KeyV', 'v', 86); await ev('__h.drive(4,()=>false); 1'); await frames(4);
  sc = await ev('(function(){ const st=__G.sim.state, p=st.player, s=st.ships[0]; return {scope:__G.game.scope,seen:s.seenT>st.t,tgt:document.getElementById("s-tgt").textContent,brg:document.getElementById("s-brg").textContent,expo:+p.expo.toFixed(3),tag:document.getElementById("s-tag").textContent,contact:document.getElementById("contact").textContent,d:Math.round(Math.hypot(s.x-p.x,s.z-p.z))}; })()');
  note(sc.scope && sc.seen && /Frigate/.test(sc.tgt) && /range \d+ m/.test(sc.contact), 'V raises the periscope; the frigate is in the glass and the contact line gives an exact range', sc);
  await shot('59-periscope-frigate-1280');
  // leaving the mast up is a risk: exposure builds until the simulation reports the mast as seen
  await ev('__h.watch(); 1');
  const ex = await ev('(function(){ const st=__G.sim.state, p=st.player, l0=st.enemy.level; let n=0; while(n<30*240&&!st.over&&!__h.seen.mastSeen){ __h.drive(1/30,()=>false); n++; } return {waited:+(n/30).toFixed(1),seen:__h.seen.mastSeen||0,expo:+p.expo.toFixed(2),levelBefore:l0,level:st.enemy.level,alert:document.getElementById("alert").textContent,over:st.over}; })()');
  note(ex.seen === 1 && ex.level >= 2 && /mast has been seen/.test(ex.alert), 'a mast left up is seen: the alarm is raised and the player is told why', { first: sc.expo, then: ex });
  // going deep with the periscope up: the simulation lowers the mast and the periscope view closes
  await ev('__G.input.depthCmd=60; __G.input.throttle=3; 1'); await ev('__h.drive(60,(st,p)=>p.depth>14,true)'); await frames(3);
  note(await ev('!__G.game.scope&&document.getElementById("scope").hidden&&!__G.sim.state.player.mast&&!__G.input.mast'), 'going deep lowers the mast and closes the periscope', await alertText());
  // R raises the mast alone when shallow, and is refused when deep
  await key('KeyR', 'r', 82); await frames(2);
  note(await ev('!__G.input.mast&&!__G.game.mastUp'), 'R is refused when the boat is too deep', await alertText());
}

// things missing or broken: no storage, damaged saved settings, the 3D library or the fonts not loading, a bad seed
async function edge() {
  await size(1280, 800, false);
  const winRun = '__h.play(900)';   // the scripted player of sim.test.mjs plays First Blood to the end
  // 1. the browser refuses to store anything (as in some private windows)
  const blocker = (await c.send('Page.addScriptToEvaluateOnNewDocument', { source: 'for(const m of ["getItem","setItem","removeItem"]) Storage.prototype[m]=function(){ throw new DOMException("blocked","SecurityError"); };' })).identifier;
  await open('?test=1&seed=7&mission=firstblood'); await ev(HELPERS);
  note(await ev('(function(){ try{ localStorage.getItem("x"); return false; }catch(e){ return true; } })()'), 'storage is really refused for this step');
  note(await ev('__G.game.mission') === 'firstblood', 'a mission named in the address is chosen', await ev('__G.game.mission'));
  await ev('document.querySelector("#pick button[data-d=relaxed]").click(); document.getElementById("b-sound").click(); document.getElementById("b-start").click(); 1'); await frames(2);
  let info = await ev(winRun);
  note(info.over && info.result === 'win', 'without storage: the mission can be played and won', info);
  await sleep(6500);
  note(await ev('!document.getElementById("result").hidden'), 'without storage: the result card still shows', await ev('document.getElementById("result").innerText.replace(/\\n+/g," | ")'));
  note(await ev('/★/.test(document.getElementById("r-stars").textContent)&&__G.saved.storage===false&&__G.saved.stars.firstblood>=1'), 'without storage: the stars are shown and kept for this visit, and nothing is saved', await ev('__G.saved'));
  await ev('document.getElementById("b-title").click(); 1'); await frames(3);
  note(await ev('/★/.test(document.querySelector("#mpick button[data-m=firstblood]").textContent)&&!document.querySelector("#mpick button[data-m=hunted]").disabled'), 'without storage: the title shows the star for this visit, and every mission is open', await ev('Array.from(document.querySelectorAll("#mpick button")).map(b=>b.textContent)'));
  await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocker });
  // 2. damaged saved settings
  for (const [bad, name] of [['{"difficulty":"nonsense","sound":"yes","mission":"constructor","best":{"firstblood":"abc"}}', 'wrong values'], ['{"difficulty":"__proto__","mission":7}', 'wrong kinds of value'], ['{broken', 'not readable at all'], ['[1,2,3]', 'the wrong shape'], ['null', 'empty']]) {
    await open('?test=1&seed=7');
    await ev('localStorage.setItem("strait-shadow",' + JSON.stringify(bad) + '); 1');
    await open('?test=1&seed=7'); await ev(HELPERS);
    const ok = await ev('__G.game.difficulty==="standard"&&__G.game.mission==="shakedown"&&__G.sim.state.mission==="shakedown"&&__G.game.soundPref===true&&!document.getElementById("title").hidden');
    await ev('__G.start(7); __G.stepFrames(30); 1'); await frames(2);
    note(ok && await ev('__G.game.running&&__G.sim.state.t>0.9'), 'saved settings that are ' + name + ' are ignored and the game starts with its defaults', await ev('JSON.stringify(__G.game.best)'));
  }
  await ev('localStorage.setItem("strait-shadow",\'{"difficulty":"standard","sound":true,"best":{"firstblood":"abc"}}\'); 1');
  await open('?test=1&seed=7'); await ev(HELPERS); await ev('__G.start(7)'); await frames(2);
  info = await ev(winRun); await sleep(6500);
  const card = await ev('document.getElementById("result").innerText.replace(/\\n+/g," | ")');
  note(info.result === 'win' && /Best time \| \d+:\d\d/.test(card) && !/NaN|undefined|abc/.test(card), 'a damaged best time is replaced by a real one', card);
  await ev('localStorage.setItem("strait-shadow",\'{"mission":"strait","stars":{"shakedown":9,"gate":"3","nonsense":2},"patrol":"lots","hints":[1]}\'); 1');
  await open('?test=1&seed=7'); await ev(HELPERS);
  const sv = await ev('({mission:__G.game.mission,sim:__G.sim.state.mission,stars:__G.saved.stars,patrol:__G.saved.patrol,locked:document.querySelector("#mpick button[data-m=strait]").disabled})');
  note(sv.mission === 'strait' && sv.sim === 'strait' && Object.keys(sv.stars).length === 0 && sv.patrol === 0 && !sv.locked, 'saved data with impossible stars: the stars are ignored, and the mission it names is open and chosen', sv);
  await ev('localStorage.removeItem("strait-shadow"); 1');
  // 3. a mission name in the address that is not a mission; a seed that is not a number
  for (const q of ['nonsense', 'constructor', '__proto__', '']) { await open('?test=1&seed=7&mission=' + q); const m = await ev('({game:__G.game.mission,sim:__G.sim.state.mission,chosen:document.querySelectorAll("#mpick button[aria-pressed=true]").length})'); note(m.game === 'shakedown' && m.sim === 'shakedown' && m.chosen === 1, 'mission "' + q + '" in the address is ignored', m); }
  for (const q of ['abc', '-5', '0', '1e99']) { await open('?test=1&seed=' + q); const sd = await ev('__G.game.seed'); note(Number.isInteger(sd) && sd > 0 && sd < 2147483648, 'seed "' + q + '" in the address gives a usable seed', sd); }
  // 4. the fonts do not load: the game still runs
  await c.send('Network.enable');
  await c.send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
  await open('?test=1&seed=7'); await ev('__G.start(7); __G.stepFrames(30); 1'); await frames(2);
  note(await ev('__G.game.running&&!document.getElementById("hud").hidden&&document.getElementById("fallback").hidden'), 'with the fonts blocked the game still runs');
  await shot('40-fonts-blocked-1280');
  // 5. the 3D library does not load: a plain message, not a blank page
  await c.send('Network.setBlockedURLs', { urls: ['*cdnjs.cloudflare.com*'] });
  await c.send('Page.navigate', { url: URL0 + '?seed=7' }); await sleep(2500);
  note(await ev('!window.THREE&&!document.getElementById("fallback").hidden&&document.getElementById("title").hidden&&document.getElementById("hud").hidden'), 'with the 3D library blocked a plain message shows', await ev('document.getElementById("fallback").innerText'));
  await within(c.send('Page.captureScreenshot', { format: 'png' }), 30000, 'screenshot').then(r => { writeFileSync(SHOTS + '/41-3d-library-blocked-1280.png', Buffer.from(r.data, 'base64')); console.log('     shot ' + SHOTS + '/41-3d-library-blocked-1280.png'); });
  await c.send('Network.setBlockedURLs', { urls: [] });
  // the blocked addresses are reported by the browser itself; they are expected here
  for (let i = c.errors.length - 1; i >= 0; i--) if (/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(c.errors[i])) c.errors.splice(i, 1);
}

// rough frame rate with the real graphics card (run as "perf"); the numbers are for this computer only
async function perf() {
  const fps = async sec => ev('new Promise(r=>{ let n=0, worst=0, last=0; const t0=performance.now(); const f=t=>{ if(last) worst=Math.max(worst,t-last); last=t; n++; if(t-t0<' + sec * 1000 + ') requestAnimationFrame(f); else r({fps:+(n*1000/(t-t0)).toFixed(1),worstFrameMs:+worst.toFixed(1)}); }; requestAnimationFrame(f); })');
  // the same count with the game running at its real pace under the frames (the other figures are for a still game)
  const fpsLive = async sec => ev('new Promise(r=>{ let n=0, worst=0, last=0; const t0=performance.now(); const f=t=>{ if(last){ worst=Math.max(worst,t-last); __G.run(Math.min(0.1,(t-last)/1000)); } last=t; n++; if(t-t0<' + sec * 1000 + ') requestAnimationFrame(f); else r({fps:+(n*1000/(t-t0)).toFixed(1),worstFrameMs:+worst.toFixed(1)}); }; requestAnimationFrame(f); })');
  for (const [w, h, phone, name] of [[1280, 800, false, '1280x800'], [500, 900, true, '500x900'], [390, 844, true, '390x844']]) {
    await size(w, h, phone);
    await open('?test=1&seed=7' + (phone ? '&table=0' : '')); await ev(HELPERS);
    console.log('     ' + name + ' graphics: ' + await ev('(function(){ const c=document.createElement("canvas"), g=c.getContext("webgl"), x=g&&g.getExtension("WEBGL_debug_renderer_info"); return x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):"unknown"; })()') + ', plain look ' + await ev('__G.plainLook'));
    await ev('__G.start(7)'); await frames(3); await sleep(800);
    console.log('     ' + name + ' under water, quiet scene: ' + JSON.stringify(await fps(4)) + ' ' + JSON.stringify(await ev('__G.drawn')));
    await ev('__G.input.depthCmd=60; __G.input.throttle=2; __h.drive(500,(st,p,s)=>Math.hypot(s.x-p.x,s.z-p.z)<800); __G.input.depthCmd=0; __G.input.throttle=4; __h.drive(60,(st,p)=>p.depth<0.3); __h.lookShip(0.1,95); 1');
    // a busy moment: frigate and helicopter in view, flank-speed wake, a torpedo away, water columns, smoke and a ping ring
    await ev('(function(){ const G=__G, p=G.sim.state.player, s=G.sim.state.ships[0]; G.input.fire=true; G.stepFrames(30); G.effects.blast(40,G.waterY-3,-30,1); G.effects.splash(60,-10,300,30,5); G.effects.blast(-30,G.waterY-3,40,1); G.effects.pingRing(p.x,p.z,0,900,3,0x9fe8ff,0); })()');
    const busy = await fps(4);
    console.log('     ' + name + ' surfaced, busy scene: ' + JSON.stringify(busy) + ' ' + JSON.stringify(await ev('__G.drawn')));
    note(busy.fps >= 30, name + ': the busy scene draws at 30 frames a second or better on this computer', busy);
    // the two Stage B views, opened on the same scene
    await ev('__G.setMap(true)'); await frames(4);
    const mapF = await fps(3), mapOn = await ev('__G.game.map');
    await ev('__G.setMap(false); __G.setScope(true)'); await frames(4);
    const scopeF = await fps(3), scopeOn = await ev('__G.game.scope');
    note(mapOn && scopeOn && mapF.fps >= 30 && scopeF.fps >= 30, name + ': the map and the periscope view also draw at 30 frames a second or better', { map: mapF, periscope: scopeF });
    // a late Free Patrol wave: several frigates, their helicopters and torpedoes at once, the boat on the surface at flank speed
    await ev('__G.setScope(false); __G.start(9,"patrol"); (function(){ const st=__G.sim.state; for(let w=0;w<3;w++){ st.ships.filter(q=>q.kind==="frigate"&&!q.out).forEach(s=>{ s.hp=0; s.out=true; s.outT=0; st.stats.out++; }); for(let i=0;i<80&&!st.ships.some(q=>q.kind==="frigate"&&!q.out);i++) __G.stepFrames(30); } __G.input.depthCmd=0; __G.input.throttle=4; __G.stepFrames(30*30); const s=st.ships.find(q=>q.kind==="frigate"&&!q.out)||st.ships[0]; __h.look(s.x,s.z,0.12,160); })(); 1'); await frames(4);
    const late = await fps(4), lateN = await ev('({wave:__G.sim.state.wave,ships:__G.sim.state.ships.length,helos:__G.sim.state.helos.length,torpedoes:__G.sim.state.torps.length,over:__G.sim.state.over})');
    console.log('     ' + name + ' late Free Patrol wave: ' + JSON.stringify(late) + ' ' + JSON.stringify(lateN) + ' ' + JSON.stringify(await ev('__G.drawn')));
    note(late.fps >= 30, name + ': a late Free Patrol wave draws at 30 frames a second or better', late);
    // the heaviest picture the game can make: that wave's ships brought together close to the camera, so they are all drawn in full detail with wakes and bow spray, one of them burning, seen through the outside camera, with the game running
    await ev('(function(){ const G=__G, st=G.sim.state, p=st.player, fr=st.ships.filter(q=>q.kind==="frigate"&&!q.out), all=fr.concat(st.ships.filter(q=>q.neutral&&!q.out)).slice(0,5), a=p.h; all.forEach((s,i)=>{ const f=320+60*(i%2), q=(i-(all.length-1)/2)*120; s.x=p.x+Math.cos(a)*f+Math.sin(a)*q; s.z=p.z-Math.sin(a)*f+Math.cos(a)*q; s.h=a+1.2; s.known=true; s.ident=1; }); if(all[1]){ all[1].out=true; all[1].hp=0; } G.game.jump=true; G.stepFrames(60); if(all[1]) G.effects.burn(all[1].id,50); const s=all[Math.floor(all.length/2)]||st.ships[0]; G.eyeSet(2,s.id); G.eye.az=2.5; G.eye.el=0.12; G.eye.r=300; })(); 1'); await frames(6); await sleep(2500);
    const close = await fpsLive(5), closeN = await ev('({over:__G.sim.state.over,ships:__G.lod.length,detailed:__G.lod.filter(q=>q.detail).length,wakes:__G.wakes,torpedoes:__G.sim.state.torps.length,eye:__G.eye.mode})');
    console.log('     ' + name + ' Free Patrol wave close up, game running: ' + JSON.stringify(close) + ' ' + JSON.stringify(closeN) + ' ' + JSON.stringify(await ev('__G.drawn')));
    note(close.fps >= 30 && closeN.detailed >= 2, name + ': a Free Patrol wave close up (detailed ships, wakes, fire and smoke, game running) draws at 30 frames a second or better', close);
    // the counter above stops at the screen's 60 a second, so the same picture is also timed with nothing holding it back, at 1 and at 2 device pixels per CSS pixel (a phone screen)
    const ms = { x1: await ev('__G.bench(150)'), x2: await ev('__G.bench(150,2)') };
    console.log('     ' + name + ' that picture, drawn as fast as it will go: ' + ms.x1 + ' ms a frame, ' + ms.x2 + ' ms at twice the pixel density');
    note(ms.x1 < 16 && ms.x2 < 33, name + ': drawn as fast as it will go, that picture takes under 16 ms (under 33 ms at twice the pixel density)', ms);
    await ev('__G.eyeSet(0); 1');
  }
  // the phone tabletop: the plot drawn every frame with the small 3D window on, at one and at two device pixels per CSS pixel (the game never draws finer than two)
  for (const [w, h, dsf] of [[844, 390, 1], [932, 430, 1], [844, 390, 2], [932, 430, 2]]) {
    const name = w + 'x' + h + (dsf > 1 ? ' at twice the pixel density' : '');
    await size(w, h, true); await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: true });
    await open('?test=1&seed=7&table=1'); await ev(HELPERS);
    await ev('__G.start(7)'); await frames(3); await sleep(800);
    // a busy plot: contacts tracked, a course ordered, a torpedo on its wire, a noisemaker and a ping
    await ev('(function(){ const G=__G; G.input.throttle=2; G.stepFrames(900); G.input.ping=true; G.stepFrames(60); G.input.fire=true; G.stepFrames(5); G.input.decoy=true; G.stepFrames(150); })(); 1'); await frames(4);
    const what = await ev('({table:__G.table.on,window:__G.table.view,tracks:__G.sim.state.tracks.length,torpedoes:__G.sim.state.torps.length,over:__G.sim.state.over,plot:[document.getElementById("mapc").width,document.getElementById("mapc").height]})');
    const still = await fps(4), live = await fpsLive(5), ms = await ev('__G.benchFrame(150)');
    console.log('     ' + name + ' tabletop, small 3D window on: still ' + JSON.stringify(still) + ', game running ' + JSON.stringify(live) + ', one whole frame drawn as fast as it will go ' + ms + ' ms ' + JSON.stringify(what));
    note(what.table && what.window[0] >= 150 && what.tracks > 0 && still.fps >= 55 && live.fps >= 55 && ms < 16, name + ': the tabletop with its 3D window draws at about 60 frames a second, and one whole frame takes under 16 ms', { still, live, ms });
    // Stage I: the same plot with a target chosen, its Solution card open and the seeker view showing a torpedo on its wire
    await ev('(function(){ const G=__G, st=G.sim.state, k=st.tracks.find(q=>!q.out)||st.tracks[0]; G.input.fire=true; G.stepFrames(40); G.game.sel=k.id; G.stepFrames(2); G.setCard(true); G.stepFrames(4); })(); 1'); await frames(4);
    const fcOn = await ev('({card:__G.fc.open,box:!document.getElementById("fc").hidden&&document.getElementById("fc").getBoundingClientRect().height>100,seeker:!document.getElementById("wpn").hidden&&!document.getElementById("wp-seek").hidden,wired:__G.sim.state.torps.filter(q=>q.wire).length,over:__G.sim.state.over})');
    const still2 = await fps(4), live2 = await fpsLive(5), ms2 = await ev('__G.benchFrame(150)');
    console.log('     ' + name + ' tabletop, Solution card and seeker view open: still ' + JSON.stringify(still2) + ', game running ' + JSON.stringify(live2) + ', one whole frame drawn as fast as it will go ' + ms2 + ' ms ' + JSON.stringify(fcOn));
    note(fcOn.card && fcOn.box && fcOn.seeker && fcOn.wired > 0 && still2.fps >= 55 && live2.fps >= 55 && ms2 < 16, name + ': with the Solution card and the seeker view open the tabletop still draws at about 60 frames a second', { still: still2, live: live2, ms: ms2 });
  }
  // Stage J: a two-missile salvo against an alert frigate at 844x390, measured while the ship's defence missiles, its gun and at least two chaff clouds are in the air.
  // First the phone tabletop (the plot zoomed out to hold the ship, the small 3D window on), then the full 3D view from beside the ship; each at one and at two device pixels per CSS pixel.
  for (const [dsf, table] of [[1, 1], [2, 1], [1, 0], [2, 0]]) {
    const name = '844x390 ' + (table ? 'tabletop' : '3D view beside the ship') + (dsf > 1 ? ' at twice the pixel density' : '') + ', missile salvo';
    await size(844, 390, true); await c.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: dsf, mobile: true });
    await open('?test=1&seed=7&table=' + table); await ev(HELPERS); await ev(J_HELPERS);
    await ev('__G.start(7,"firstblood"); 1'); await frames(3); await sleep(600);
    const staged = await ev('__j.stage(5200,2)');
    await ev('__G.setWeapon(1); __G.mapZoom(1); __j.watch(); __j.fire(); __G.stepFrames(80); __j.fire(); 1');
    // on to the busiest moment: both missiles seen, two chaff clouds up, a defence missile away
    await ev('__j.until(40,st=>st.clouds.length>=2&&st.shots.length>0); ' + (table ? '' : '(function(){ const m=__G.sim.state.missiles[0]; if(m) __j.eyeFrom(m.x,m.z,0.1,260,0.3); })(); ') + '1'); await frames(4);
    const a = await ev('({i:__j.info(),seen:Object.assign({},__j.seen)})');
    const live = await fpsLive(4);
    const b = await ev('({i:__j.info(),seen:Object.assign({},__j.seen),fx:__G.fxJ,drawn:__G.map.j.slice()})'), ms = await ev('__G.benchFrame(150)'), ms3 = table ? null : await ev('__G.bench(150,' + dsf + ')');
    const during = { missiles: [a.i.missiles.length, b.i.missiles.length], defenceMissilesInFlight: [a.i.shots, b.i.shots], chaffClouds: [a.i.clouds, b.i.clouds], defenceMissilesFiredMeanwhile: (b.seen.samFire || 0) - (a.seen.samFire || 0), gunBurstsMeanwhile: (b.seen.gunFire || 0) - (a.seen.gunFire || 0), drawn3D: b.fx };
    console.log('     ' + name + ': game running ' + JSON.stringify(live) + ', one whole frame drawn as fast as it will go ' + ms + ' ms' + (ms3 === null ? '' : ', the 3D picture alone ' + ms3 + ' ms') + ' ' + JSON.stringify(during));
    note(!!staged && a.i.missiles.length === 2 && a.i.clouds >= 2 && a.i.shots >= 1 && b.i.missiles.length >= 1 && b.i.clouds >= 2 && (a.seen.samFire || 0) >= 1 && live.fps >= 55 && ms < 16,
      name + ': with two missiles in flight, defence fire and two or more chaff clouds, the game draws at about 60 frames a second and one whole frame takes under 16 ms', { live, ms, during });
  }
}

// the real loop (no test hook): keyboard, then touch, read back from the instruments
const txt = id => ev('document.getElementById("' + id + '").textContent');
async function liveKeys() {
  const key = async (type, code, k, vk) => c.send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk });   // no native key code: on a Mac, 68 there opens the browser's own help tab
  await size(1280, 800, false);
  // count every sound engine the page creates, from before its own scripts run
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__audioMade=0; for(const n of ["AudioContext","webkitAudioContext"]){ const A=window[n]; if(A) window[n]=function(){ window.__audioMade++; return new A(...arguments); }; }' });
  await open('?seed=7&mission=firstblood');
  note(await ev('typeof window.__G') === 'undefined', 'no test hook without ?test=1');
  note(await ev('window.__audioMade') === 0, 'no sound is set up before the first tap or key press', await ev('window.__audioMade'));
  await ev('document.getElementById("b-sound").click(); document.getElementById("b-sound").click(); document.getElementById("b-how").click(); document.getElementById("b-help-close").click(); 1');
  note(await ev('window.__audioMade') === 1, 'the first tap sets sound up (a title button counts)', await ev('window.__audioMade'));
  await ev('document.getElementById("b-start").click(); 1'); await sleep(1500);
  note(await ev('window.__audioMade') === 1, 'sound is set up only once: Start does not set it up again', await ev('window.__audioMade'));
  const c0 = await txt('h-clock'), h0 = await txt('g-hdg');
  await key('keyDown', 'KeyD', 'd', 68); await sleep(5000); await key('keyUp', 'KeyD', 'd', 68);
  const h1 = await txt('g-hdg'), c1 = await txt('h-clock');
  note(c0 !== c1, 'live: the clock runs', c0 + ' then ' + c1);
  note(+h1 > +h0, 'live: holding D turns to starboard', h0 + ' to ' + h1);
  await key('keyDown', 'KeyW', 'w', 87); await key('keyUp', 'KeyW', 'w', 87); await sleep(500);
  note(await txt('g-thr') === 'Half', 'live: W raises the throttle one step', await txt('g-thr'));
  await key('keyDown', 'KeyE', 'e', 69); await sleep(2500); await key('keyUp', 'KeyE', 'e', 69);
  const ord = await txt('g-order'); note(/ordered (\d+) m/.test(ord) && +ord.match(/(\d+)/)[1] > 20, 'live: holding E orders a deeper depth', ord);
  // if a contact ahead is not classified yet, the first press only warns and the second fires
  await key('keyDown', 'Space', ' ', 32); await key('keyUp', 'Space', ' ', 32); await sleep(700);
  const warn1 = await txt('alert');
  if (/Press Fire again/.test(warn1)) { note(await ev('document.querySelectorAll("#tubes i.empty").length') === 0, 'live: with an unclassified contact ahead the first Space only warns', warn1); await key('keyDown', 'Space', ' ', 32); await key('keyUp', 'Space', ' ', 32); }
  await sleep(1500);
  note(await ev('document.querySelectorAll("#tubes i.empty").length') === 1, 'live: Space fires one torpedo', await txt('alert'));
  note(await ev('scrollY') === 0, 'live: Space does not scroll the page');
  await key('keyDown', 'KeyC', 'c', 67); await key('keyUp', 'KeyC', 'c', 67); await sleep(800);
  note(/held at Slow/.test(await txt('g-thr')), 'live: C switches silent running on', await txt('g-thr'));
  await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await sleep(400);
  const cp = await txt('h-clock'); await sleep(1500);
  note(await ev('!document.getElementById("pause").hidden') && cp === await txt('h-clock'), 'live: Esc pauses and the clock stops');
  await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await sleep(300);
  note(await ev('document.getElementById("pause").hidden'), 'live: Esc resumes');
  // ping (not allowed while silent, so silent running comes off first)
  await key('keyDown', 'KeyP', 'p', 80); await key('keyUp', 'KeyP', 'p', 80); await sleep(500);
  note(/silent running/i.test(await txt('alert')) && !/range \d+ m/.test(await txt('contact')), 'live: P is refused during silent running', await txt('alert'));
  await key('keyDown', 'KeyC', 'c', 67); await key('keyUp', 'KeyC', 'c', 67); await sleep(300);
  await key('keyDown', 'KeyP', 'p', 80); await key('keyUp', 'KeyP', 'p', 80); await sleep(900);
  note(/range \d+ m/.test(await txt('contact')), 'live: P pings and gives an exact range', await txt('contact'));
  await shot('30-live-keyboard-1280');
  // help and pause together: the game never runs behind the help card, and the pause card never shows while playing
  const shown = id => ev('!document.getElementById("' + id + '").hidden');
  const runs = async () => { const a = await txt('h-clock'); await sleep(1300); return a !== await txt('h-clock'); };
  await key('keyDown', 'KeyH', 'h', 72); await key('keyUp', 'KeyH', 'h', 72); await sleep(300);
  note(await shown('help') && !(await shown('pause')) && !(await runs()), 'live: H opens help and holds the game');
  await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await sleep(300);
  note(!(await shown('help')) && !(await shown('pause')) && await runs(), 'live: Esc closes help and play carries on');
  await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await sleep(200);
  await key('keyDown', 'KeyH', 'h', 72); await key('keyUp', 'KeyH', 'h', 72); await sleep(300);
  note(await shown('help') && !(await shown('pause')) && !(await runs()), 'live: H from the pause menu shows help in its place');
  await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await sleep(300);
  note(!(await shown('help')) && await shown('pause') && !(await runs()), 'live: Esc closes help and returns to the pause menu, still paused');
  await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await sleep(300);
  note(!(await shown('help')) && !(await shown('pause')) && await runs(), 'live: Esc then resumes play');
  // the Stage B keys
  const tap = async (code, k, vk) => { await key('keyDown', code, k, vk); await key('keyUp', code, k, vk); };
  await tap('KeyX', 'x', 88); await sleep(600);
  note(await ev('document.querySelectorAll("#decoys i.gone").length') === 1, 'live: X releases one noisemaker', await txt('alert'));
  await tap('KeyV', 'v', 86); await sleep(400);
  note(!(await shown('scope')) && await ev('document.getElementById("t-scope").getAttribute("aria-pressed")') === 'false', 'live: V is refused below periscope depth', await txt('alert'));
  await tap('KeyM', 'm', 77); await sleep(500);
  note(await shown('mapc') && await shown('mapbar') && await runs(), 'live: M opens the map and the game carries on (Standard)', await txt('m-info'));
  await shot('32-live-keyboard-map-1280');
  await tap('Escape', 'Escape', 27); await sleep(300);
  note(!(await shown('mapc')) && !(await shown('pause')) && await runs(), 'live: Esc closes the map and does not pause');
  // Relaxed: the game waits while the map is open
  await open('?seed=7&mission=gate');
  await ev('document.querySelector("#pick button[data-d=relaxed]").click(); document.getElementById("b-start").click(); 1'); await sleep(1200);
  note(await txt('h-mission') !== '' && await runs(), 'live: Through the Gate starts from the address and its clock runs', await txt('h-mission'));
  await tap('KeyM', 'm', 77); await sleep(500);
  note(await shown('mapc') && !(await runs()) && /game held/.test(await txt('m-info')), 'live: on Relaxed the game is held while the map is open', await txt('m-info'));
  await tap('KeyM', 'm', 77); await sleep(300);
  note(!(await shown('mapc')) && await runs(), 'live: closing the map lets the game run again');
  await ev('document.getElementById("b-pause").click(); document.getElementById("b-quit").click(); document.querySelector("#pick button[data-d=standard]").click(); 1');
}
async function liveTouch() {
  await size(500, 900, true);
  await open('?seed=7&mission=firstblood&table=0');   // the full 3D phone layout; the tabletop's real loop is checked in stageh
  // held upright the page first asks for the phone to be turned; "Play upright anyway" goes on (without this the card lies over the controls)
  await ev('(function(){ const r=document.getElementById("rotate"); if(r&&!r.hidden) document.getElementById("b-upright").click(); })(); 1'); await sleep(200);
  await ev('document.getElementById("b-start").click(); 1'); await sleep(1200);
  const rect = id => ev('(function(){ const r=document.getElementById("' + id + '").getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,t:r.top,l:r.left}; })()');
  const touch = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id || 1 })) });
  const pad = await rect('pad'), th0 = await txt('g-thr'), hd0 = await txt('g-hdg');
  await touch('touchStart', [{ x: pad.x, y: pad.y }]); await sleep(150);
  await touch('touchMove', [{ x: pad.x + pad.w * 0.3, y: pad.y - pad.h * 0.45 }]); await sleep(5000);
  const th1 = await txt('g-thr'), hd1 = await txt('g-hdg');
  await touch('touchEnd', []); await sleep(300);
  note(th0 === 'Slow' && th1 === 'Full', 'touch: sliding up on the pad raises the throttle', th0 + ' to ' + th1);
  note(+hd1 > +hd0, 'touch: sliding right on the pad turns to starboard', hd0 + ' to ' + hd1);
  const ds = await rect('dslide');
  await touch('touchStart', [{ x: ds.x, y: ds.t + ds.h * 0.75 }]); await sleep(200); await touch('touchEnd', []); await sleep(600);
  const ord2 = await txt('g-order'); note(/(\d+) m/.test(ord2) && +ord2.match(/(\d+)/)[1] > 60, 'touch: the depth gauge sets a deeper order', ord2);
  // back to Slow (a wire is cut above Half speed), wait for the boat to slow down, then fire
  await touch('touchStart', [{ x: pad.x, y: pad.y }]); await sleep(100); await touch('touchMove', [{ x: pad.x, y: pad.y + pad.h * 0.42 }]); await sleep(200); await touch('touchEnd', []);
  for (let i = 0; i < 40 && +(await txt('g-speed')).replace(/\D+/g, '') > 8; i++) await sleep(500);
  note(await txt('g-thr') === 'Slow' && await ev('document.getElementById("t-wr").classList.contains("off")'), 'touch: the pad sets Slow again; with no torpedo out the Wire buttons are dimmed', await txt('g-thr') + ', ' + await txt('g-speed'));
  const fire = await rect('t-fire');
  await touch('touchStart', [{ x: fire.x, y: fire.y }]); await sleep(60); await touch('touchEnd', []); await sleep(700);
  // if a contact ahead is not classified yet, the first press only warns and the second fires
  const warn2 = await txt('alert');
  if (/Press Fire again/.test(warn2)) { note(await ev('document.querySelectorAll("#tubes i.empty").length') === 0, 'touch: with an unclassified contact ahead the first Fire press only warns', warn2); await touch('touchStart', [{ x: fire.x, y: fire.y }]); await sleep(60); await touch('touchEnd', []); }
  await sleep(1200);
  note(await ev('document.querySelectorAll("#tubes i.empty").length') === 1, 'touch: Fire button fires one torpedo', await txt('alert'));
  const press1 = async id => { const b = await rect(id); await touch('touchStart', [{ x: b.x, y: b.y }]); await sleep(60); await touch('touchEnd', []); };
  note(await txt('w-state') === 'Guiding' && await ev('!document.getElementById("t-wr").classList.contains("off")'), 'touch: with a torpedo on its wire the Wire buttons light up', await txt('w-state'));
  await press1('t-decoy'); await sleep(600);
  note(await ev('document.querySelectorAll("#decoys i.gone").length') === 1, 'touch: Decoy button releases one noisemaker', await txt('alert'));
  await press1('t-map'); await sleep(600);
  note(await ev('!document.getElementById("mapc").hidden&&document.body.classList.contains("wide")'), 'touch: Map button opens the map');
  await press1('m-close'); await sleep(400);
  note(await ev('document.getElementById("mapc").hidden&&!document.body.classList.contains("wide")'), 'touch: Close on the map bar leaves the map');
  // View rides with the torpedo that is still running (or says there is nothing to look at); a second round of presses brings the view home
  await press1('t-view'); await sleep(500);
  const vw = [await ev('document.getElementById("t-view").getAttribute("aria-pressed")'), await txt('alert')];
  note(vw[0] === 'true' || /Camera/.test(vw[1]), 'touch: the View button answers', vw);
  for (let i = 0; i < 6 && await ev('document.getElementById("t-view").getAttribute("aria-pressed")') === 'true'; i++) { await press1('t-view'); await sleep(300); }
  // Time sets 2x, unless the boat is being hunted at that moment, when it says why not
  await press1('t-time'); await sleep(500);
  const tm = [await txt('t-time'), await txt('alert')];
  note(tm[0] === '2x' || /Time compression is off/.test(tm[1]) || tm[0] === '1x', 'touch: the Time button answers', tm);
  await shot('31-live-touch-500');
  await ev('try{ sessionStorage.removeItem("ss-upright"); }catch(e){} 1');   // the later phone checks start from the card again
}

// Stage C at 1280x800: the mission list with stars and locks, the three new missions, sound, the map (labels, zoom, drag, bearing history), a sonobuoy, hints
async function stagec() {
  const alertText = () => ev('document.getElementById("alert").textContent');
  const mouse = (type, x, y, o) => c.send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, o || {}));
  await size(1280, 800, false);
  await ev('1').then(() => open('?test=1&seed=7')); await ev('try{ localStorage.removeItem("strait-shadow"); }catch(e){} 1');
  await open('?test=1&seed=7'); await ev(HELPERS);
  // --- mission list and stars: every mission is open from the start ---
  let list = await ev('Array.from(document.querySelectorAll("#mpick button")).map(b=>b.textContent+(b.disabled?" [off]":"")+(b.getAttribute("aria-pressed")==="true"?" (chosen)":""))');
  note(list.length === 5 && /Shakedown.*\(chosen\)/.test(list[0]) && list.every(t => /☆☆☆/.test(t) && !/off|locked/i.test(t)), 'a new player sees five missions, all open from the start, with no stars yet', list);
  note(await ev('!document.getElementById("b-patrol").disabled&&/Free Patrol/.test(document.getElementById("b-patrol").textContent)&&/^Stars: /.test(document.getElementById("m-goals").textContent)'), 'Free Patrol has its own button, open from the start, and the brief lists what earns the stars', await ev('document.getElementById("m-goals").textContent'));
  const au0 = await ev('__G.audio');
  note(au0.made === false && au0.unlocked === false && au0.pref === true, 'no sound object exists before the first tap or key press', au0);
  await shot('70-title-new-player-1280');
  // a saved game from before stars existed opens what had been won; stars and the patrol best are shown
  await ev('localStorage.setItem("strait-shadow",JSON.stringify({mission:"gate",difficulty:"standard",sound:true,best:{"shakedown/standard":120,"gate/standard":300}})); 1');
  await open('?test=1&seed=7'); await ev(HELPERS);
  list = await ev('Array.from(document.querySelectorAll("#mpick button")).map(b=>b.textContent+(b.disabled?" [off]":"")+(b.getAttribute("aria-pressed")==="true"?" (chosen)":""))');
  note(/★☆☆/.test(list[0]) && /★☆☆.*chosen/.test(list[1]) && list.slice(2).every(t => /☆☆☆/.test(t)) && list.every(t => !/off|locked/i.test(t)), 'an older save keeps its progress: won missions get one star, and every mission stays open', list);
  await ev('localStorage.setItem("strait-shadow",JSON.stringify({mission:"strait",difficulty:"standard",sound:true,stars:{shakedown:3,gate:2,firstblood:1,hunted:9,strait:"x"},patrol:700,hints:{contact:1}})); 1');
  await open('?test=1&seed=7'); await ev(HELPERS);
  list = await ev('Array.from(document.querySelectorAll("#mpick button")).map(b=>b.textContent+(b.disabled?" [off]":"")+(b.getAttribute("aria-pressed")==="true"?" (chosen)":""))');
  note(/★★★/.test(list[0]) && /★★☆/.test(list[1]) && /★☆☆/.test(list[2]) && /☆☆☆/.test(list[3]) && /☆☆☆.*chosen/.test(list[4]) && list.every(t => !/off|locked/i.test(t)) && /best 700/.test(await ev('document.getElementById("b-patrol").textContent')), 'saved stars and the patrol best show on the title; a bad star count is ignored and the saved mission, open like the rest, is chosen', [list, await ev('__G.game.mission')]);
  await shot('71-title-stars-1280');
  // the first click unlocks sound, and the sound button is remembered
  await ev('document.getElementById("b-patrol").click(); 1'); await frames(2);
  note(await ev('__G.game.mission==="patrol"&&__G.sim.state.mission==="patrol"&&/Start patrol/.test(document.getElementById("b-start").textContent)&&/open-ended/i.test(document.getElementById("m-brief").textContent)'), 'choosing Free Patrol shows its brief', await ev('document.getElementById("m-brief").textContent'));
  { const r = await ev('__h.rect("b-start")'); await mouse('mousePressed', r.l + 20, r.t + 20); await mouse('mouseReleased', r.l + 20, r.t + 20); await frames(4); await sleep(300); }
  let au = await ev('__G.audio');
  note(au.unlocked && au.made && au.on && await ev('__G.game.running&&__G.sim.state.mission==="patrol"'), 'the first click starts the game and switches sound on', au);
  await ev('__G.stepFrames(90); 1'); await frames(30); await sleep(400);
  au = await ev('__G.audio');
  note(au.state === 'running' ? au.hum > 0.01 && au.master > 0.3 : true, 'the engine hum is playing while the boat moves (when the browser lets sound run)', au);
  note(/Score 0 · wave 1/.test(await ev('document.getElementById("h-clock").textContent')), 'Free Patrol shows the score and the wave instead of a clock', await ev('document.getElementById("h-clock").textContent'));
  const plays0 = au.plays; await ev('__G.input.ping=true; __G.stepFrames(2); 1'); await frames(3);
  const plays1 = (await ev('__G.audio')).plays;
  await ev('document.getElementById("b-mute").click(); 1'); await frames(8); await sleep(400);
  au = await ev('__G.audio');
  note(plays1 > plays0 && !au.on && !au.pref && au.master < 0.05 && await ev('document.getElementById("b-mute").textContent==="Sound off"&&JSON.parse(localStorage.getItem("strait-shadow")).sound===false'), 'a ping makes a sound; the Sound button mutes everything and is saved', { plays0, plays1, au });
  await ev('__G.stepFrames(400); __G.input.ping=true; __G.stepFrames(2); 1'); await frames(2);
  note((await ev('__G.audio')).plays === plays1, 'nothing is played while sound is off');
  await open('?test=1&seed=7'); await ev(HELPERS);
  note(await ev('__G.game.soundPref===false&&document.getElementById("b-sound").textContent==="Sound off"'), 'the sound choice is still off after a reload');
  await ev('document.getElementById("b-sound").click(); 1');

  // --- Hunted: starts tracked; an idle boat is lost; the result card shows stars ---
  await ev('__G.start(3,"hunted"); __G.stepFrames(3); 1'); await frames(3);
  let v = await ev('({level:__G.sim.state.enemy.level,helos:__G.sim.state.helos.length,chip:document.getElementById("h-threat").textContent,obj:document.getElementById("h-obj").textContent,clock:document.getElementById("h-clock").textContent,alert:document.getElementById("alert").textContent})');
  note(v.level >= 3 && v.helos === 2 && /Tracked|Under attack/.test(v.chip) && /left/.test(v.clock), 'Hunted starts with the boat already tracked and two helicopters', v);
  await ev('__G.input.throttle=1; __G.input.depthCmd=20; __G.stepFrames(30*40); __h.lookHelo(0.2,120); 1'); await frames(4);
  await shot('72-hunted-1280');
  await ev('for(let i=0;i<400&&!__G.sim.state.over;i++) __G.stepFrames(60); 1'); await frames(3);
  await ev('__G.effects.showResult(); 1'); await frames(3);
  v = await ev('({over:__G.sim.state.over,result:__G.sim.state.result,title:document.getElementById("r-title").textContent,stars:document.getElementById("r-stars").textContent,lines:Array.from(document.querySelectorAll("#r-lines li")).map(l=>(l.className==="ok"?"+":"-")+l.textContent),rows:Array.from(document.querySelectorAll("#r-stats dt")).map(d=>d.textContent+"="+d.nextSibling.textContent)})');
  note(v.over && v.result === 'lose' && /Boat lost \(simulated\)/.test(v.title) && v.stars === '☆☆☆' && v.lines.length === 3 && v.rows.some(r => /^Time=/.test(r)) && v.rows.some(r => /^Stealth=Tracked/.test(r)) && v.rows.some(r => /^Hits=/.test(r)), 'an idle boat is lost in Hunted; the result card shows time, stealth, hits and no stars', v);
  await shot('73-result-lost-1280');

  // --- Strait Shadow: the high-value ship and its escorts, the route on the map ---
  await ev('document.getElementById("result").hidden=true; __G.start(5,"strait"); 1'); await frames(3);
  v = await ev('(function(){ const st=__G.sim.state; return {kinds:st.ships.map(s=>s.kind),helos:st.helos.length,route:!!st.marks.find(m=>m.kind==="route"),obj:st.objective}; })()');
  note(v.kinds.filter(k => k !== 'merchant' && k !== 'fishing').join() === 'cargo,frigate,frigate' && v.kinds.some(k => k === 'merchant' || k === 'fishing') && v.route, 'Strait Shadow has a high-value ship, two frigates, neutral traffic and a marked route', v);
  await ev('__G.setMap(true); 1'); await frames(6);
  v = await ev('__G.map.rects.map(r=>r[4])');
  note(v.includes('Expected route'), 'the map names the expected route', v);
  await shot('74-strait-map-1280');
  // bring the boat alongside the high-value ship to look at it (a staged picture, not a played approach)
  await ev('__G.setMap(false); (function(){ const st=__G.sim.state, p=st.player, s=st.ships[0]; p.x=s.x+Math.sin(s.h)*330+Math.cos(s.h)*60; p.z=s.z+Math.cos(s.h)*330-Math.sin(s.h)*60; p.h=s.h; p.depth=0; __G.input.depthCmd=0; __G.input.throttle=2; })(); __G.stepFrames(4); __G.game.jump=true; __h.lookShip(0.09,150,0.25); 1'); await frames(6); await sleep(500);
  note((await ev('__G.drawn3')).ships === await ev('__G.sim.state.ships.length'), 'every ship in the mission is drawn', [await ev('__G.drawn3'), await ev('__G.sim.state.ships.map(s=>s.kind)')]);
  await shot('75-strait-high-value-ship-1280');
  // two hits put it out of action, the objective changes to the escape, and getting clear wins with stars
  await ev('(function(){ const st=__G.sim.state, s=st.ships[0], p=st.player; p.x=s.x+Math.sin(s.h)*650; p.z=s.z+Math.cos(s.h)*650; p.h=Math.atan2(-(s.z-p.z),s.x-p.x); for(let i=0;i<300&&st.phase===0&&!st.over;i++){ __G.input.rudder=Math.max(-1,Math.min(1,-__h.wrap(Math.atan2(-(s.z-st.player.z),s.x-st.player.x)-st.player.h)*3)); __G.input.fire=(i%45===1); __G.stepFrames(10); } __G.input.rudder=0; })(); 1'); await frames(4);
  v = await ev('({phase:__G.sim.state.phase,out:__G.sim.state.ships[0].out,obj:document.getElementById("h-obj").textContent,nav:document.getElementById("h-nav").textContent,over:__G.sim.state.over,reason:__G.sim.state.reason})');
  note(v.phase === 1 && v.out && /clear of the frigates/.test(v.obj) && /nearest frigate/.test(v.nav), 'two hits stop the high-value ship; the objective and the instruments change to the escape', v);
  await ev('__h.lookShip(0.1,170,0.2); 1'); await frames(30); await sleep(300); await shot('76-strait-ship-out-of-action-1280');
  // stage the end of the escape: far from both frigates with no track held
  await ev('(function(){ const st=__G.sim.state, p=st.player; p.x+=9000; p.z+=9000; st.enemy.base=0; st.enemy.cues=0; st.torps.length=0; __G.stepFrames(6); })(); 1'); await frames(3);
  await ev('__G.effects.showResult(); 1'); await frames(3);
  v = await ev('({result:__G.sim.state.result,reason:__G.sim.state.reason,title:document.getElementById("r-title").textContent,stars:document.getElementById("r-stars").textContent,lines:Array.from(document.querySelectorAll("#r-lines li")).map(l=>(l.className==="ok"?"+":"-")+l.textContent),next:!document.getElementById("b-next").hidden,saved:JSON.parse(localStorage.getItem("strait-shadow")).stars})');
  note(v.result === 'win' && /Mission complete/.test(v.title) && /★/.test(v.stars) && v.lines[0][0] === '+' && !v.next && v.saved.strait >= 1, 'getting clear wins Strait Shadow: stars are shown and saved, and there is no next mission after the last one', v);
  await shot('77-result-stars-1280');

  // --- Free Patrol: the score rises with each frigate put out of action; a ship long out of action leaves the picture ---
  await ev('document.getElementById("result").hidden=true; __G.start(11,"patrol"); 1'); await frames(3);
  v = await ev('(function(){ const st=__G.sim.state, G=__G; const log=[]; for(let w=0;w<2;w++){ const s=st.ships.find(q=>q.kind==="frigate"&&!q.out); if(!s) break; const before=st.score; s.hp=0; s.out=true; s.outT=0; st.stats.out++; G.stepFrames(3); log.push([before,st.score,st.wave]); for(let i=0;i<60&&!st.ships.some(q=>q.kind==="frigate"&&!q.out);i++) G.stepFrames(30); } return {log:log,score:st.score,wave:st.wave,ships:st.ships.length,clock:0}; })()'); await frames(3);
  note(v.log.length === 2 && v.log[0][1] > v.log[0][0] && v.log[1][1] > v.log[1][0] && v.wave >= 2 && /Score \d+ · wave \d/.test(await ev('document.getElementById("h-clock").textContent')), 'Free Patrol: each frigate put out of action adds to the score, and the next wave arrives', [v, await ev('document.getElementById("h-clock").textContent')]);
  await shot('78-patrol-score-1280');
  v = await ev('(function(){ const st=__G.sim.state, p=st.player, n0=st.ships.length; const far=st.ships.filter(s=>s.out); far.forEach(s=>{ s.x=p.x+6000; s.outT=999; }); __G.stepFrames(3); return {n0:n0,n1:st.ships.length,out:far.length}; })()'); await frames(4);
  note(v.n1 < v.n0 && (await ev('__G.drawn3')).ships === v.n1, 'a ship long out of action and far away leaves the game and the picture (one whose helicopter is still in the air stays until it is back)', [v, await ev('__G.drawn3')]);
  // two sections flooded: the boat goes down
  await ev('(function(){ const st=__G.sim.state, d=st.dmg; d.on=true; d.sec[1].water=1; d.sec[2].water=1; for(let i=0;i<600&&!st.over;i++) __G.stepFrames(30); })(); 1'); await frames(3);
  await ev('if(__G.sim.state.over) __G.effects.showResult(); 1'); await frames(3);
  v = await ev('({over:__G.sim.state.over,lost:__G.sim.state.dmg.lost,title:document.getElementById("r-title").textContent,rows:Array.from(document.querySelectorAll("#r-stats dt")).map(d=>d.textContent+"="+d.nextSibling.textContent),best:JSON.parse(localStorage.getItem("strait-shadow")).patrol,btn:document.getElementById("b-patrol").textContent})');
  note(v.over && v.lost && /Boat lost/.test(v.title) && v.rows.some(r => /^Score=\d+/.test(r)) && v.rows.some(r => /^Best score=/.test(r)) && v.best >= 700 && /best \d+/.test(v.btn), 'Free Patrol ends when the boat is lost; the card shows the score and the best score is saved', v);
  await shot('79-result-patrol-1280');
  await ev('document.getElementById("result").hidden=true; 1');
}
// a sonobuoy seen from the boat and on the map; the map's labels, zoom, drag and bearing history; first-time hints
async function stagecMap() {
  await size(1280, 800, false);
  await open('?test=1&seed=7&unlock=1'); await ev(HELPERS);
  // First Blood, seed 16, creeping along near the surface: a helicopter drops a sonobuoy as it starts to winch its dipping sonar back in.
  // Where that happens depends on the helicopters' flight paths, so the boat is then put 60 m from the buoy (staged, not played).
  await ev('__G.start(16,"firstblood"); __G.input.throttle=1; __G.input.depthCmd=12; __h.watch(); 1');
  const fell = await ev('(function(){ const G=__G, st=G.sim.state, p=st.player; let n=0; while(n<30*400&&!st.over&&!st.buoys.length){ G.stepFrames(1); n++; } const b=st.buoys[0]; if(!b) return null; const a=p.h+0.6; p.x=b.x-Math.cos(a)*60; p.z=b.z+Math.sin(a)*60; G.game.jump=true; G.stepFrames(45); return {t:+st.t.toFixed(1),known:b.known,from:Math.round(Math.hypot(b.x-p.x,b.z-p.z))}; })()'); await frames(3);
  console.log('     the first sonobuoy fell at ' + JSON.stringify(fell));
  const nearBuoy = '__G.buoys.filter(q=>q.known).sort((x,y)=>x.d-y.d)[0]';
  const clearOf = q => ev('(function(){ const b=' + JSON.stringify(q) + '; return ["brief","gauges","status","ring","dslide","keys","alert"].every(id=>{ const r=document.getElementById(id).getBoundingClientRect(); return !r.width||b.sx<r.left-4||b.sx>r.right+4||b.sy<r.top-4||b.sy>r.bottom+4; }); })()');
  // first from further back: the helicopter that dropped it still hovers above, winching its dipping sonar back up (the dark line)
  let b = await ev('(function(){ const a=' + nearBuoy + '; if(!a) return null; __G.effects.say("",2,0.02); __h.look(a.x,a.z,0.14,130); return a; })()');
  note(!!b && b.d < 150 && (await ev('__h.seen.buoy')) >= 1, 'a helicopter drops a sonobuoy, and the boat, put 60 m from it, has it on its plot (First Blood, seed 16)', b);
  await frames(8); await sleep(500);
  b = await ev(nearBuoy);
  const hv = await ev('(function(){ const G=__G, h=G.sim.state.helos.filter(q=>q.cable>0.7)[0]; if(!h) return null; const v=new THREE.Vector3(h.x-G.view.ox,G.waterY+h.alt,h.z-G.view.oz).project(G.camera); return {sx:(v.x+1)/2*innerWidth,sy:(1-v.y)/2*innerHeight,front:v.z<1,cable:h.cable,over:Math.hypot(h.x-(' + b.x + '),h.z-(' + b.z + '))}; })()');
  note(!!hv && hv.front && hv.over < 5 && hv.sy > 20 && hv.sy < b.sy - 40 && Math.abs(hv.sx - b.sx) < 30 && b.drawn && b.front && b.sy < 780 && await clearOf(b) && await clearOf(hv), 'the helicopter that dropped it is seen hovering above the sonobuoy, winching in its dipping sonar', { helicopter: hv, buoy: b });
  await shot('80-sonobuoy-helicopter-1280');
  // then, once the helicopter has gone, the buoy by itself from closer in
  await ev('__G.stepFrames(330); __G.effects.say("",2,0.02); __h.look(' + b.x + ',' + b.z + ',0.22,80); 1'); await frames(8); await sleep(500);
  b = await ev(nearBuoy);
  note(b.drawn && b.front && b.sx > 20 && b.sx < 1260 && b.sy > 20 && b.sy < 780 && await clearOf(b) && await ev('__G.camera.position.y>__G.waterY+2&&__G.sim.state.helos.every(h=>h.cable<=0.7)'), 'the sonobuoy is drawn by itself, in front of the camera (which is above the water) and clear of the panels', b);
  await shot('80-sonobuoy-1280');
  { const r = await within(c.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, b.sx - 160), y: Math.max(0, b.sy - 110), width: 320, height: 200, scale: 3 } }), 30000, 'close-up'); writeFileSync(SHOTS + '/81-sonobuoy-close-up.png', Buffer.from(r.data, 'base64')); console.log('     shot ' + SHOTS + '/81-sonobuoy-close-up.png'); }
  await ev('__G.setMap(true); 1'); await frames(6);
  let m = await ev('({labels:__G.map.rects.map(r=>r[4]),span:__G.map.span})');
  note(m.labels.includes('sonobuoy'), 'the map marks the sonobuoy the boat heard splash', m);
  await shot('82-sonobuoy-map-1280');
  await ev('__G.setMap(false); 1');

  // --- the map: labels never overlap, the opening zoom follows how close things are, dragging moves it, Centre brings it back ---
  const overlapsOf = 'const R=__G.map.rects, bad=[]; for(let i=0;i<R.length;i++) for(let j=i+1;j<R.length;j++){ const a=R[i], b=R[j]; if(a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3]) bad.push(a[4]+" / "+b[4]); }';
  let worst = [], count = 0;
  for (const [seed, mission] of [[7, 'gate'], [3, 'gate'], [12, 'gate'], [7, 'firstblood'], [5, 'strait'], [9, 'patrol']]) {
    await ev('__G.start(' + seed + ',"' + mission + '"); __G.input.depthCmd=70; __G.input.throttle=2; 1');
    for (const t of [20, 160, 320]) {
      await ev('(function(){ const st=__G.sim.state; while(st.t<' + t + '&&!st.over) __G.stepFrames(30); if(!st.over) __G.setMap(true); })(); 1'); await frames(4);
      for (const z of [0, -1, 1, 1, 1]) {
        const r = await ev('(function(){ if(' + z + ') __G.mapZoom(' + z + '); })(); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{ ' + overlapsOf + ' r({bad:bad,n:R.length,span:__G.map.span}); }))))');
        count += r.n; if (r.bad.length) worst.push(mission + ' seed ' + seed + ' t ' + t + ' span ' + r.span + ': ' + r.bad.join('; '));
      }
      await ev('__G.setMap(false); __G.map.manual=false; 1');
    }
  }
  note(worst.length === 0 && count > 300, 'map labels never overlap each other: 6 games, 3 moments, 5 zoom levels (' + count + ' labels placed)', worst.slice(0, 6));
  // the Gate map, where the first version was cluttered
  await ev('__G.start(7,"gate"); __G.input.depthCmd=70; __G.input.throttle=2; 1'); await frames(2);
  console.log('     gate', JSON.stringify(await ev('(function(){ const st=__G.sim.state, s=st.ships[0], p=st.player; let n=0; while(n<400*30&&!st.over&&Math.hypot(s.x-p.x,s.z-p.z)>1400){ __G.stepFrames(1); n++; } return {t:st.t,d:Math.hypot(s.x-p.x,s.z-p.z),over:st.over,tracks:st.tracks.length,heard:st.heard.length}; })()')));
  await ev('__G.setMap(true); 1'); await frames(6);
  m = await ev('(function(){ ' + overlapsOf + ' return {span:__G.map.span,info:document.getElementById("m-info").textContent,labels:R.map(r=>r[4]),bad:bad,ink:__h.mapInk(),under:R.filter(r=>__h.boxHit(r,["brief","gauges","status","ring","dslide","keys","mapbar","alert"]).length).map(r=>r[4])}; })()');
  note(m.span <= 2000 && /rings every 500 m/.test(m.info) && m.bad.length === 0 && m.under.length === 0, 'with the frigate close, the map opens zoomed in, with rings every 500 m, no overlapping labels and no label under a panel', m);
  await shot('83-map-gate-close-1280');
  // drag with the mouse: the chart moves and the boat is no longer in the middle; Centre puts it back
  const mouse = (type, x, y, btn) => c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: btn, clickCount: 1 });
  await mouse('mousePressed', 640, 420, 1); await mouse('mouseMoved', 600, 400, 1); await mouse('mouseMoved', 500, 340, 1); await mouse('mouseReleased', 500, 340, 0); await frames(4);
  m = await ev('({panX:Math.round(__G.map.panX),panZ:Math.round(__G.map.panZ),info:document.getElementById("m-info").textContent})');
  note(m.panX > 100 && m.panZ > 50 && /moved/.test(m.info), 'dragging the map moves it', m);
  await shot('84-map-dragged-1280');
  await ev('document.getElementById("m-centre").click(); 1'); await frames(3);
  note(await ev('__G.map.panX===0&&__G.map.panZ===0'), 'Centre brings the map back to the boat');
  // the bearing history: a strip on the map with a trace for each sound heard
  m = await ev('(function(){ const M=__G.map, b=M.wfBox, c=document.getElementById("mapc"), g=c.getContext("2d"), k=c.width/innerWidth, d=g.getImageData(Math.round((b[0]+6)*k),Math.round((b[1]+18)*k),Math.round((b[2]-b[0]-12)*k),Math.round(60*k)).data; let amber=0; for(let i=0;i<d.length;i+=4) if(d[i]>200&&d[i+1]>140&&d[i+2]<120) amber++; return {rows:M.wf.length,withSound:M.wf.filter(r=>r.c.length).length,amber:amber,box:b}; })()');
  note(m.rows >= 30 && m.withSound >= 10 && m.amber >= 20, 'the bearing history strip on the map holds a trace of the frigate', m);
  note(await ev('document.getElementById("mapc").hidden===false&&!document.getElementById("wf")'), 'the bearing history is part of the map screen, not the main view');
  await ev('__G.setMap(false); 1');
  // far from everything the map opens wide
  await ev('__G.start(7,"gate"); __G.stepFrames(30); __G.setMap(true); 1'); await frames(4);
  note(await ev('__G.map.span') >= 4000, 'with nothing close, the map opens zoomed out', await ev('__G.map.span'));
  await ev('__G.setMap(false); 1');

  // --- first-time hints: once each, saved, and never over a more urgent message ---
  await ev('try{ localStorage.removeItem("strait-shadow"); }catch(e){} 1');
  await open('?test=1&seed=7&hints=1&unlock=1'); await ev(HELPERS);
  await ev('__G.start(7,"firstblood"); __G.effects.say("",0,0.01); 1'); await frames(4);
  await ev('__G.input.throttle=2; __G.input.depthCmd=60; __h.drive(400,(st,p,s)=>st.t>6&&!!__h.best("ship")); __G.effects.say("",0,0.01); 1'); await sleep(200); await frames(6);
  const h1 = await alertTextOf();
  note(/Sonar contact/.test(h1) && /Press M/.test(h1), 'the first sonar contact brings a hint that names the map key', h1);
  await shot('85-hint-1280');
  await sleep(3400); await frames(4);
  note(await ev('__G.saved.hints.contact===1&&JSON.parse(localStorage.getItem("strait-shadow")).hints.contact===1'), 'a hint that stayed on screen is remembered');
  await ev('__G.effects.say("Torpedo in the water!",2,30); 1'); await frames(30); await sleep(300);
  note(/Torpedo in the water/.test(await alertTextOf()), 'a hint never replaces a more urgent message', await alertTextOf());
  await ev('__G.start(7,"firstblood"); __G.effects.say("",0,0.01); __G.input.throttle=2; __G.input.depthCmd=60; __h.drive(400,(st,p,s)=>st.t>6&&!!__h.best("ship")); __G.effects.say("",0,0.01); 1'); await sleep(200); await frames(6);
  note(!/Sonar contact/.test(await alertTextOf()), 'the same hint is not shown a second time', await alertTextOf());
  await ev('__G.start(1,"shakedown"); __G.stepFrames(200); 1'); await frames(4);
  note(/Steer for the marker/.test(await alertTextOf()), 'the exercise keeps its own prompts, with no hints on top', await alertTextOf());
}
// more page helpers for the Stage D checks: listen to one ship, read the status panel, stage a close-up
const D_HELPERS = `
Object.assign(window.__h,{
  ship(kind){ return __G.sim.state.ships.find(q=>q.kind===kind); },
  con(id){ return __G.sim.state.contacts.find(q=>q.id===id&&(q.kind==='ship'||q.kind==='hulk')); },
  aim(s){ const p=__G.sim.state.player; p.h=Math.atan2(-(s.z-p.z),s.x-p.x); },
  // put the boat near a ship, bow on, slow and quiet (a staged picture, not a played approach)
  near(s,d,depth){ const G=__G, p=G.sim.state.player; p.x=s.x-d*0.78; p.z=s.z+d*0.62; this.aim(s); p.depth=depth; p.speed=2; G.input.depthCmd=depth; G.input.throttle=1; G.input.rudder=0; G.game.jump=true; },
  // listen to one ship until a condition on its sonar contact holds
  hear(id,sec,cond){ const st=__G.sim.state; let n=0, c=this.con(id); while(n<sec*30&&!st.over&&!(c&&cond(c))){ __G.stepFrames(1); n++; c=this.con(id); } return c?{t:+st.t.toFixed(1),cls:c.cls,shaft:c.shaft,blades:c.blades,ident:+c.ident.toFixed(2),sig:+c.sig.toFixed(2)}:null; },
  panel(){ const g=id=>document.getElementById(id); return {cls:g('sg-cls').textContent,kind:g('sg-cls').className,txt:g('sg-txt').textContent,fill:parseInt(g('sg-fill').style.width)||0,hear:g('h-tag').textContent,hearFill:parseInt(g('h-fill').style.width)||0,alert:g('alert').textContent,clock:g('h-clock').textContent,time:g('t-time').textContent,view:g('t-view').getAttribute('aria-pressed'),
    fits:(function(){ const t=g('sg-txt'), a=t.getBoundingClientRect(), b=g('status').getBoundingClientRect(); return !a.width||(a.right<=b.right-4&&t.scrollWidth<=t.clientWidth+1); })()}; },
  // put the boat's newest torpedo just off a ship's beam, running at it
  strike(s){ const t=__G.sim.state.torps.filter(t=>t.side===0).pop(); if(!t) return 0; const a=s.h+Math.PI/2; t.x=s.x+Math.cos(a)*90; t.z=s.z-Math.sin(a)*90; t.h=Math.atan2(-(s.z-t.z),s.x-t.x); t.depth=8;
    t.run=Math.max(t.run,StraitSim.V.attack.arm+1); t.speed=StraitSim.V.torp.speed; t.aimed=false; t.deep=false; return t.id; },      // Stage I: past its arming run, up to its run speed, and no longer turning to a gyro course
  // a staged close-up: the boat is put off to one side and the outside camera looks at one ship
  closeup(o){ const G=__G; G.start(o.seed||16,o.m||'firstblood'); const st=G.sim.state, p=st.player, s=st.ships.find(q=>q.kind===(o.k||'frigate'))||st.ships[0];
    this.sub=s; this.shot=o; if(!o.far){ p.x=s.x-500; p.z=s.z+400; } p.depth=40; G.input.depthCmd=40; G.input.throttle=0; p.speed=0; s.known=true; s.ident=1;   // far: the boat stays where the mission put it, out of the frigate's hearing
    if(o.out){ s.out=true; s.hp=0; s.speed=0; }
    G.game.jump=true; G.eyeSet(2,o.helo?st.helos[0].id:s.id); const E=G.eye; E.az=o.sun?Math.atan2(-70,-90)-s.h+Math.PI/2:o.az; E.el=o.el; E.r=o.r; G.effects.say('',2,0.02); return s.id; },   // sun: the camera looks towards the sun, down its path on the water
  roll(){ const o=this.shot, s=this.sub; __G.stepFrames(12); if(o.out){ s.out=true; s.speed=0; } if(o.burn) __G.effects.burn(s.id,o.burn); },
  seen(){ const s=this.sub; return {lod:__G.lod.find(q=>q.id===s.id),drawn:__G.drawn,wakes:__G.wakes,eye:__G.eye.mode}; }
});1`;
// the most one close-up picture of a single ship may cost to draw
const TRI_MAX = 150000, CALL_MAX = 140;

// the Stage D parts at 1280x800: contact classification, the hearing bar, the fire confirm, neutral ships, time compression,
// the outside camera, ship detail by distance, and close-up pictures of the ships, the sea and the smoke
async function staged() {
  await size(1280, 800, false);
  await open('?test=1&seed=7&unlock=1'); await ev(HELPERS); await ev(D_HELPERS);
  const panel = async () => { await frames(4); return ev('__h.panel()'); };
  const alertNow = () => ev('document.getElementById("alert").textContent');
  let v;

  // --- classification: a contact starts Unknown; listening gives the shaft rate, then the blade count, then the class ---
  await ev('__G.start(7); (function(){ const s=__G.sim.state.ships[0]; __h.near(s,1900,40); __G.game.sel=s.id; __G.stepFrames(45); })(); 1');
  const fid = await ev('__G.sim.state.ships[0].id');
  const c0 = await ev('__h.hear(' + fid + ',120,c=>true)'), p0 = await panel();
  const c1 = await ev('__h.hear(' + fid + ',400,c=>c.shaft>0)'), p1 = await panel();
  await shot('d01-classify-shaft-rate-1280');
  const c2 = await ev('__h.hear(' + fid + ',400,c=>c.blades>0)'), p2 = await panel();
  await shot('d02-classify-blade-count-1280');
  const c3 = await ev('__h.hear(' + fid + ',400,c=>!!c.cls)'), p3 = await panel();
  await shot('d03-classified-frigate-1280');
  note(c0 && c3 && !c0.cls && p0.cls === 'Unknown' && /Listening/.test(p0.txt) && p1.cls === 'Unknown' && /^Shaft \d+ rpm · blades \?$/.test(p1.txt) && p2.cls === 'Unknown' && /^Shaft \d+ rpm · 5 blades$/.test(p2.txt)
    && p3.cls === 'Frigate' && p3.kind === 'hostile' && /^Shaft \d+ rpm · 5 blades$/.test(p3.txt) && p0.fill < p1.fill && p1.fill < p2.fill && p2.fill < p3.fill && c1.t < c2.t && c2.t < c3.t && /Contact classified: Frigate\./.test(p3.alert) && p1.fits && p2.fits && p3.fits,
    'the sound signature panel goes from Unknown to the shaft rate, then the blade count, then the class, and its text fits the panel', { heard: [c0, c1, c2, c3], panel: [p0, p1, p2, p3].map(p => [p.cls, p.txt, p.fill, p.fits]), alert: p3.alert });
  // with the frigate classified, Fire fires at once
  v = await ev('(function(){ const G=__G, st=G.sim.state; __h.aim(st.ships[0]); const w=G.fireWarn(); G.act("fire"); G.stepFrames(3); return {warn:w,fired:st.stats.fired}; })()');
  note(v.warn === '' && v.fired === 1, 'with a classified frigate ahead, one Fire press fires', v);

  // --- the hearing bar: far when the boat is stopped, poor at flank speed ---
  await ev('__G.start(7); __G.input.throttle=0; __G.input.depthCmd=40; __G.stepFrames(30*90); 1'); const h0 = await panel(), hs0 = await ev('__G.sim.state.player.hear');
  await ev('__G.input.throttle=4; __G.stepFrames(30*50); 1'); const h1 = await panel(), hs1 = await ev('__G.sim.state.player.hear');
  note(h0.hear === 'Far' && h1.hear === 'Poor' && h0.hearFill > h1.hearFill + 40 && hs0 > hs1 * 3, 'the hearing bar reads Far when the boat is stopped and Poor at flank speed', { stopped: [h0.hear, h0.hearFill, +hs0.toFixed(2)], flank: [h1.hear, h1.hearFill, +hs1.toFixed(2)] });

  // --- firing on a contact that is not classified asks first ---
  await ev('__G.start(7); (function(){ const s=__G.sim.state.ships[0]; __h.near(s,1900,40); __G.stepFrames(45); __h.aim(s); })(); 1');
  v = await ev('(function(){ const G=__G, st=G.sim.state, o={warn:G.fireWarn()}; G.act("fire"); G.stepFrames(3); o.fired1=st.stats.fired; o.alert1=document.getElementById("alert").textContent; G.act("fire"); G.stepFrames(3); o.fired2=st.stats.fired; return o; })()');
  note(/not classified/.test(v.warn) && v.fired1 === 0 && /not classified\. Press Fire again/.test(v.alert1) && v.fired2 === 1, 'with an unclassified contact ahead the first Fire press only warns and the second fires', v);
  await ev('__G.start(7); (function(){ const s=__G.sim.state.ships[0]; __h.near(s,1900,40); __G.stepFrames(45); __h.aim(s); __G.act("fire"); })(); 1'); await sleep(4300);
  v = await ev('(function(){ const G=__G, st=G.sim.state; G.act("fire"); G.stepFrames(3); const a=st.stats.fired; G.act("fire"); G.stepFrames(3); return [a,st.stats.fired]; })()');
  note(v[0] === 0 && v[1] === 1, 'more than four seconds later the warning has lapsed: the next press warns again and the one after fires', v);

  // --- a neutral ship: classified as neutral, warned about, and a hit is penalised ---
  await ev('__G.start(7,"gate"); (function(){ const s=__h.ship("merchant"); __h.near(s,800,30); __G.game.sel=s.id; __G.stepFrames(45); })(); 1');
  const nid = await ev('__h.ship("merchant").id');
  const n1 = await ev('__h.hear(' + nid + ',400,c=>!!c.cls)'), np = await panel();
  await shot('d04-neutral-merchant-classified-1280');
  await ev('__G.setMap(true); 1'); await frames(6); const labels = await ev('__G.map.rects.map(r=>r[4])'); await ev('__G.setMap(false); 1'); await frames(3);
  note(n1 && n1.cls === 'merchant' && np.cls === 'Merchant · neutral' && np.kind === 'neutral' && /^Shaft \d+ rpm · 5 blades$/.test(np.txt) && /Contact classified: Merchant, a neutral\. Hold fire\./.test(np.alert) && np.fits && labels.some(l => /^Merchant \(neutral\)/.test(l)),
    'a merchant ship is classified as neutral on the signature panel, the alert line and the map', { heard: n1, panel: [np.cls, np.kind, np.txt], alert: np.alert, labels: labels.filter(l => /neutral|Frigate|Unknown/.test(l)) });
  v = await ev('(function(){ const G=__G, st=G.sim.state, s=__h.ship("merchant"); __h.aim(s); const o={warnTarget:G.fireWarn()}; G.game.sel=0; G.stepFrames(1); o.warn=G.fireWarn(); G.act("fire"); G.stepFrames(3); o.fired1=st.stats.fired; G.act("fire"); G.stepFrames(3); o.fired2=st.stats.fired; __h.strike(s); let n=0; while(n<600&&!st.stats.neutral&&!st.over){ G.stepFrames(1); n++; } o.neutral=st.stats.neutral; o.over=st.over; o.alert=document.getElementById("alert").textContent; return o; })()');
  note(/Hold fire: the target is a neutral merchant ship/.test(v.warnTarget) && /Hold fire: the merchant ship ahead is neutral/.test(v.warn) && v.fired1 === 0 && v.fired2 === 1 && v.neutral === 1 && !v.over && /Your torpedo hit a neutral merchant ship\. That costs a star\./.test(v.alert),
    'Fire warns that the target is neutral, and with nothing selected that the ship ahead is; a hit on it is counted and costs a star (the torpedo is placed just short of the ship)', v);
  // on Hard the same hit ends the mission, and the result card says why
  await ev('document.querySelector("[data-d=hard]").click(); __G.start(7,"gate"); (function(){ const G=__G, st=G.sim.state, s=__h.ship("merchant"); __h.near(s,800,30); G.stepFrames(30); G.input.fire=true; G.stepFrames(3); __h.strike(s); let n=0; while(n<600&&!st.over){ G.stepFrames(1); n++; } })(); 1'); await frames(3);
  await ev('if(__G.sim.state.over) __G.effects.showResult(); 1'); await frames(4);
  v = await ev('({over:__G.sim.state.over,result:__G.sim.state.result,reason:__G.sim.state.reason,title:document.getElementById("r-title").textContent,card:document.getElementById("result").innerText.replace(/\\s*\\n\\s*/g," | "),rows:Array.from(document.querySelectorAll("#r-stats dt")).map(d=>d.textContent+"="+d.nextSibling.textContent)})');
  note(v.over && v.result === 'lose' && /neutral ship/.test(v.reason) && /neutral ship/.test(v.card) && !/star lost/.test(v.card) && v.rows.includes('Neutral ships hit=1'), 'on Hard a torpedo into a neutral ship ends the mission, and the result card says so', v);
  await shot('d05-neutral-hit-result-1280');
  await ev('document.getElementById("result").hidden=true; document.querySelector("[data-d=standard]").click(); 1');

  // --- time compression: 1x, 2x, 4x; the same game either way; back to 1x on anything new; refused while tracked ---
  await ev('__G.start(21,"shakedown"); 1'); await frames(2);
  v = await ev('(function(){ const G=__G, o=[], b=document.getElementById("t-time"); for(let i=0;i<3;i++){ G.act("time"); o.push([G.game.warp,b.textContent,b.getAttribute("aria-pressed")]); } G.setWarp(4,true); return o; })()');
  const clock4 = (await panel()).clock;
  note(JSON.stringify(v) === '[[2,"2x","true"],[4,"4x","true"],[1,"1x","false"]]' && /time 4x/.test(clock4), 'the time key steps through 2x, 4x and back to 1x, and the clock line shows the rate', [v, clock4]);
  v = await ev(`(function(){ const G=__G, snap=()=>{ const st=G.sim.state, p=st.player; return JSON.stringify([st.t.toFixed(3),p.x.toFixed(3),p.z.toFixed(3),p.h.toFixed(4),p.depth.toFixed(3),p.speed.toFixed(3),st.contacts.length,st.ships.map(s=>s.x.toFixed(2)+'/'+s.z.toFixed(2))]); };
    const go=()=>{ G.start(21,'shakedown'); G.input.throttle=3; G.input.rudder=0.3; G.input.depthCmd=35; };
    go(); let steps=0, calls=0, drops=-1; for(let i=0;i<600;i++){ if(G.game.warp!==4){ G.setWarp(4,true); drops++; if(G.game.warp!==4) break; } steps+=G.run(1/60); calls++; }
    const a=snap(), ta=G.sim.state.t; go(); const t0=G.sim.state.t; G.stepFrames(steps); const b=snap();
    return {steps:steps,calls:calls,drops:drops,gameSeconds:+(ta-t0).toFixed(2),screenSeconds:calls/60,same:a===b}; })()`);
  note(v.same && v.calls === 600 && v.gameSeconds >= 36 && v.gameSeconds <= 40.1, 'at 4x ten seconds of frames move the game on about forty seconds, and leave it exactly where the same number of plain steps does', v);
  v = await ev(`(function(){ const G=__G, T=['alert','contact','wave','shipFire','drop','splash','playerHit','ground','mastSeen','heloLaunch','hit','over','homing','ping','buoy'];
    G.start(7); G.input.throttle=3; G.input.depthCmd=30; G.setWarp(4,true); const st=G.sim.state, p=st.player, s=st.ships[0], sim=G.sim, step=sim.step; let n=0, last=[];
    sim.step=function(dt,inp){ const r=step(dt,inp); last=sim.events.map(e=>e.type); return r; };   // the page empties the list once it has played it
    while(n<60000&&G.game.warp===4&&!st.over){ G.input.rudder=Math.max(-1,Math.min(1,-__h.wrap(Math.atan2(-(s.z-p.z),s.x-p.x)-p.h)*3)); G.run(1/60); n++; }
    return {warp:G.game.warp,button:document.getElementById('t-time').textContent,gameSeconds:+st.t.toFixed(1),lastStepReported:last,threat:last.some(e=>T.indexOf(e)>=0),level:st.enemy.level,torpedoHeard:st.contacts.some(c=>c.kind==='torp')}; })()`);
  note(v.warp === 1 && v.button === '1x' && v.gameSeconds > 5 && (v.threat || v.level >= 3 || v.torpedoHeard), 'running at the frigate at 4x, time drops back to 1x by itself the moment something new is reported', v);
  v = await ev('(function(){ const G=__G; G.start(7); G.sim.state.enemy.level=3; G.act("time"); return {warp:G.game.warp,alert:document.getElementById("alert").textContent}; })()');
  note(v.warp === 1 && /Time compression is off while they are tracking you/.test(v.alert), 'time compression is refused while the boat is being tracked', v);

  // --- the outside camera: nothing to see, then the torpedo, the ship it hits, and home again ---
  await ev('__G.start(7); (function(){ const s=__G.sim.state.ships[0]; __h.near(s,1900,40); __G.stepFrames(45); __h.aim(s); __G.act("view"); })(); 1');
  v = await ev('({mode:__G.eye.mode,alert:document.getElementById("alert").textContent})');
  note(v.mode === 0 && /nothing else to look at yet/.test(v.alert), 'the camera key says so when there is nothing else to look at', v);
  await ev('__G.input.fire=true; __G.stepFrames(90); __G.act("view"); 1'); await frames(8);
  v = await ev('(function(){ const G=__G, st=G.sim.state, p=st.player, t=st.torps.find(t=>t.side===0), f=G.focus, c=G.camera.position; return {mode:G.eye.mode,id:G.eye.id,torp:t?t.id:0,off:t?[Math.round(t.x-p.x),Math.round(t.z-p.z)]:[0,0],focus:[Math.round(f.x),Math.round(f.z)],camFromFocus:Math.round(Math.hypot(c.x-f.x,c.z-f.z)),under:c.y<G.waterY,alert:document.getElementById("alert").textContent,button:document.getElementById("t-view").getAttribute("aria-pressed")}; })()');
  note(v.mode === 1 && v.id === v.torp && Math.hypot(v.focus[0] - v.off[0], v.focus[1] - v.off[1]) < 25 && Math.hypot(v.focus[0], v.focus[1]) > 20 && v.camFromFocus < 60 && v.under && /riding with your torpedo/.test(v.alert) && v.button === 'true', 'the camera key rides with the torpedo: the view is centred on it, under water', v);
  await shot('d06-torpedo-camera-1280');
  v = await ev('(function(){ const G=__G, st=G.sim.state, s=st.ships[0]; __h.strike(s); let n=0; while(n<300&&!st.stats.hits){ G.stepFrames(1); n++; } return {hits:st.stats.hits,mode:G.eye.mode,id:G.eye.id,ship:s.id,hold:+G.eye.hold.toFixed(1)}; })()'); await frames(10); await sleep(700);
  note(v.hits === 1 && v.mode === 2 && v.id === v.ship && v.hold > 4, 'when the torpedo it rides hits, the camera stays on the ship for a few seconds (the torpedo is placed just short of the ship)', v);
  await shot('d07-hit-seen-from-the-camera-1280');
  await sleep(6200); await frames(3);
  v = await ev('({mode:__G.eye.mode,focus:[__G.focus.x,__G.focus.z],button:document.getElementById("t-view").getAttribute("aria-pressed")})');
  note(v.mode === 0 && v.focus[0] === 0 && v.focus[1] === 0 && v.button === 'false', 'then the camera comes home to the boat by itself', v);
  // the camera key visits an identified ship and comes back; the periscope takes the view back
  v = await ev('(function(){ const G=__G, st=G.sim.state, A=()=>document.getElementById("alert").textContent, o={}; st.ships[0].known=true; st.ships[0].ident=1; G.act("view"); o.first=[G.eye.mode,G.eye.id,A()]; let n=1; while(G.eye.mode&&n<8){ G.act("view"); n++; } o.home=[G.eye.mode,n,A()]; G.act("view"); const p=st.player; p.depth=9; G.input.depthCmd=9; G.stepFrames(3); o.before=G.eye.mode; G.setScope(true); o.scope=[G.eye.mode,G.game.scope]; G.act("view"); o.refused=A(); G.setScope(false); return o; })()');
  note(v.first[0] === 2 && v.first[1] === fid && /Camera: the frigate\./.test(v.first[2]) && v.home[0] === 0 && /Camera: your boat\./.test(v.home[2]) && v.before === 2 && v.scope[0] === 0 && v.scope[1] === true && /Lower the periscope/.test(v.refused), 'the camera key visits an identified ship and comes back to the boat; raising the periscope takes the view back', v);

  // --- ship detail by distance: full detail through the periscope and close up, the simple model far away ---
  await ev('__G.start(16); (function(){ const G=__G, st=G.sim.state, p=st.player, s=st.ships[0]; __h.near(s,650,9); G.game.sel=s.id; G.stepFrames(20); G.setScope(true); __h.drive(5,()=>false); G.scope.rel=0; })(); 1'); await frames(8); await sleep(500);
  v = await ev('({lod:__G.lod.find(q=>q.id===__G.sim.state.ships[0].id),drawn:__G.drawn,target:document.getElementById("s-tgt").textContent,scope:__G.game.scope})');
  note(v.scope && v.lod && v.lod.detail && /Frigate/.test(v.target) && v.drawn.triangles < TRI_MAX && v.drawn.calls < CALL_MAX, 'through the periscope the frigate is drawn in full detail, within the drawing budget', v);
  await shot('d08-periscope-frigate-1280');
  await ev('__G.setScope(false); (function(){ const G=__G, st=G.sim.state, p=st.player, s=st.ships[0]; p.x=s.x-2600; p.z=s.z; p.depth=0; G.input.depthCmd=0; G.game.jump=true; G.stepFrames(4); __h.lookShip(0.1,120); })(); 1'); await frames(6);
  v = await ev('({lod:__G.lod.find(q=>q.id===__G.sim.state.ships[0].id),drawn:__G.drawn})');
  note(v.lod && !v.lod.detail, 'a frigate 2.6 km away is drawn with the simple model', v);

  // --- close-up pictures through the outside camera, with the instruments hidden (staged, not played) ---
  await ev('document.getElementById("hud").style.visibility="hidden"; 1');
  const SCENES = [
    ['d09-frigate-side-150m-1280', { az: 1.571, el: 0.05, r: 150 }], ['d10-frigate-three-quarter-150m-1280', { az: 2.35, el: 0.1, r: 150 }],
    ['d11-frigate-flight-deck-1280', { m: 'gate', far: 1, az: 0.35, el: 0.42, r: 135 }], ['d12-frigate-superstructure-1280', { az: 0.9, el: 0.2, r: 60 }], ['d12b-frigate-bridge-1280', { az: 2.0, el: 0.1, r: 70 }],
    ['d13-seahawk-on-deck-1280', { m: 'gate', far: 1, az: 0.8, el: 0.2, r: 24, helo: 1 }], ['d13b-seahawk-on-deck-side-1280', { m: 'gate', far: 1, az: 1.571, el: 0.03, r: 20, helo: 1 }],
    ['d13c-seahawk-on-deck-from-astern-1280', { m: 'gate', far: 1, az: -1.2, el: 0.35, r: 22, helo: 1 }],
    ['d16-high-value-ship-1280', { m: 'strait', k: 'cargo', az: 2.3, el: 0.12, r: 190 }], ['d17-merchant-ship-1280', { m: 'gate', k: 'merchant', az: 2.3, el: 0.12, r: 150 }], ['d18-fishing-boat-1280', { m: 'gate', k: 'fishing', az: 2.3, el: 0.14, r: 42 }],
    ['d19-burning-frigate-1280', { m: 'patrol', az: 2.3, el: 0.1, r: 210, out: 1, burn: 60 }], ['d20-smoke-column-from-afar-1280', { m: 'patrol', az: 1.8, el: 0.05, r: 520, out: 1, burn: 60 }],
    ['d21-sun-glint-and-haze-1280', { az: 0, el: 0.07, r: 230, sun: 1 }]
  ];
  const seen = [];
  for (const [name, o] of SCENES) {
    await ev('__h.closeup(' + JSON.stringify(o) + ')');
    for (let i = 0; i < 45; i++) { await ev('__h.roll()'); await frames(1); }
    if (o.burn) { await sleep(5000); await frames(2); }
    const q = await ev('__h.seen()'); q.name = name; q.close = o.r <= 210; q.burn = !!o.burn; seen.push(q);
    await shot(name);
  }
  note(seen.every(q => q.eye === 2 && q.lod && (!q.close || q.lod.detail || q.name.indexOf('fishing') >= 0) && q.drawn.triangles < TRI_MAX && q.drawn.calls < CALL_MAX), 'every close-up shows the detailed ship and stays within the drawing budget (' + TRI_MAX + ' triangles, ' + CALL_MAX + ' draw calls)', seen.map(q => q.name.slice(4, 26) + ' ' + q.drawn.triangles + ' tri ' + q.drawn.calls + ' calls' + (q.lod && q.lod.detail ? ' detail' : '')));
  note(seen.filter(q => q.burn).every(q => q.wakes.fires >= 1 && q.wakes.smoke) && seen.filter(q => !q.burn).every(q => q.wakes.fires === 0) && seen.every(q => q.wakes.on && q.wakes.ships >= 1), 'a ship out of action burns and smokes, the others do not, and every ship has its wake', seen.map(q => q.name.slice(4, 18) + ' ' + JSON.stringify(q.wakes)));
  note(seen.filter(q => !q.burn).every(q => q.wakes.trail >= 25 && q.wakes.spray >= 5), 'every ship under way trails a full-length wake from the first look and throws white water at the stern', seen.filter(q => !q.burn).map(q => q.name.slice(4, 18) + ' trail ' + q.wakes.trail + ' spray ' + q.wakes.spray));
  // --- Stage E: how the ships are shaded (the last close-up is still on the screen) ---
  v = await ev('__G.shade');
  note(v.env && v.miss === 0 && v.std >= 6 && v.lit === v.std && !v.lite && v.cast && v.bakes >= 1 && v.sub > 0 && ['frigate', 'cargo', 'merchant', 'fishing'].every(k => v.kinds[k] && v.kinds[k].cell > 0 && v.kinds[k].side >= 512 && v.kinds[k].cast),
    'the paint takes its light from a sky map made in the page; every kind of ship has its own shade map and weathering picture; the nearest ship casts shade on itself', v);
  // --- Stage E: the space the sim keeps a low helicopter out of covers the drawn ships ---
  v = await ev('(function(){ const V=StraitSim.V, o={low:+(V.helo.deckY+2.6).toFixed(2),discAhead:+(V.helo.deckX+V.helo.rotor).toFixed(1),hangar:V.tops.frigate.x0}; for(const k in V.tops) o[k]=Object.assign(__G.tops(k),{tableTop:V.tops[k].top}); return o; })()');
  note(['frigate', 'cargo', 'merchant', 'fishing', 'hulk'].every(k => v[k].top <= v[k].tableTop && v[k].out < v.low) && v.frigate.inDisc === 0 && v.discAhead < v.hangar,
    'no ship model stands higher than the sim says, none reaches rotor height (' + v.low + ' m) outside the space a low helicopter is kept out of, and a rotor turning on the flight deck is clear of the hangar', v);
  // the Seahawk in flight, then over its dipping sonar (Hunted): step on until one is on its way out, then until one has its sonar down
  await ev('__G.start(16,"hunted"); 1');
  const heloShots = async (id, list) => {
    for (const [name, az, el, r] of list) {
      await ev('(function(){ const G=__G; G.eyeSet(2,' + id + '); const E=G.eye; E.az=' + az + '; E.el=' + el + '; E.r=' + r + '; G.effects.say("",2,0.02); })()'); await frames(8); await sleep(300);
      await shot(name);
    }
  };
  let fly = 0; for (let i = 0; i < 900 && !fly; i++) fly = await ev('(function(){ const st=__G.sim.state; if(st.over) return -1; __G.stepFrames(6); const h=st.helos.find(h=>h.phase==="transit"&&h.alt>20&&!(h.cable>0.1)&&Math.hypot(h.vx,h.vz)>30); return h?h.id:0; })()');
  v = fly > 0 ? await ev('(function(){ const V=StraitSim.V, B=V.tops.frigate, st=__G.sim.state, h=st.helos.find(h=>h.id===' + fly + '), s=st.ships.find(q=>q.kind==="frigate"), c=Math.cos(s.h), n=Math.sin(s.h), dx=h.x-s.x, dz=h.z-s.z, x=dx*c-dz*n, z=dx*n+dz*c; __G.eyeSet(2,h.id); return {phase:h.phase,alt:Math.round(h.alt),speed:Math.round(Math.hypot(h.vx,h.vz)),eye:__G.eye.mode,fromShip:[+x.toFixed(1),+z.toFixed(1)],rotorClear:+(Math.max(B.x0-x,x-B.x1,Math.abs(z)-B.hw)-V.helo.rotor).toFixed(1),mastTop:B.top}; })()') : null;
  note(fly > 0 && v && v.eye === 2 && v.alt > 20 && v.speed > 30 && (v.alt > v.mastTop || v.rotorClear > 0), 'a helicopter on its way out can be watched through the outside camera; lower than the mast, its rotor is clear of the ship it passes', v);
  if (fly > 0) {
    await heloShots(fly, [['d14d-seahawk-passing-its-frigate-from-above-1280', 0.3, 1.3, 90]]);
    await ev('__G.stepFrames(240); 1');                                                          // eight seconds on, clear of the ship
    await heloShots(fly, [['d14-seahawk-close-1280', 0.95, 0.1, 22], ['d14b-seahawk-in-flight-from-ahead-1280', 2.4, 0.15, 20], ['d14c-seahawk-in-flight-from-below-1280', -1.0, -0.12, 20]]);
  }
  let hid = 0; for (let i = 0; i < 500 && !hid; i++) hid = await ev('(function(){ const st=__G.sim.state; if(st.over) return -1; __G.stepFrames(30); const h=st.helos.find(h=>h.cable>14&&h.alt>15); return h?h.id:0; })()');
  if (hid > 0) await heloShots(hid, [['d15-seahawk-dipping-sonar-1280', 1.571, 0.02, 62], ['d15b-seahawk-dipping-close-1280', 0.95, 0.1, 22]]);
  v = await ev('(function(){ const h=__G.sim.state.helos.find(h=>h.id===' + hid + '); return h?{phase:h.phase,alt:Math.round(h.alt),cable:Math.round(h.cable),eye:__G.eye.mode}:null; })()');
  note(hid > 0 && v && v.cable > 10 && v.eye === 2, 'a helicopter in the air with its dipping sonar down can be watched through the outside camera', v);
  // deep water is murkier than shallow water: the same boat at 20 m and at 150 m
  await ev('document.getElementById("hud").style.visibility=""; 1');
  const fog = [];
  for (const d of [20, 150]) {
    await ev('__G.start(16); (function(){ const G=__G, p=G.sim.state.player; p.x+=2500; p.depth=Math.min(' + d + ',G.sim.seabed(p.x,p.z)-12); G.input.depthCmd=p.depth; G.game.jump=true; G.stepFrames(6); })(); 1'); await frames(8); await sleep(500);
    fog.push(await ev('({depth:Math.round(__G.sim.state.player.depth),density:+__G.murk.density.toFixed(5),light:+__G.murk.light.toFixed(2)})'));
    await shot((d === 20 ? 'd22' : 'd23') + '-under-water-' + d + 'm-1280');
  }
  note(fog[1].depth > fog[0].depth + 60 && fog[1].density > fog[0].density * 1.2 && fog[1].light < fog[0].light, 'deep water is murkier and darker than shallow water', fog);
}

// Stage D at phone size, upright and sideways: the sound signature panel, the Time and View buttons, and the detailed frigate (no touch gestures here)
async function stagedPhone() {
  await ev(D_HELPERS);
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const side = h < 520, at = w + 'x' + h, nm = part => (side ? 'd25-' + part + '-sideways-' : 'd24-' + part + '-') + at;
    await size(w, h, true); await frames(4); await sleep(500);
    await ev('__G.start(7); (function(){ const s=__G.sim.state.ships[0]; __h.near(s,1900,40); __G.game.sel=s.id; __G.stepFrames(45); __h.hear(s.id,400,c=>c.blades>0); })(); 1'); await frames(6);
    const pn = await ev('__h.panel()'), sig = await ev('__h.rect("sig")'), stat = await ev('__h.rect("status")'), hear = await ev('__h.rect("h-fill")');
    if (!side) note(sig.w > 0 && sig.l >= stat.l && sig.r <= stat.r && sig.t >= stat.t && sig.b <= stat.b + 1 && stat.r <= w && stat.b <= h && pn.cls === 'Unknown' && /^Shaft \d+ rpm · 5 blades$/.test(pn.txt) && pn.fits && hear.t >= stat.t && hear.b <= stat.b, at + ': the sound signature panel and the hearing bar show inside the status panel', { sig, stat, panel: [pn.cls, pn.txt, pn.hear] });
    else note(sig.w === 0 && stat.l >= 0 && stat.r <= w && stat.b <= h && hear.t >= stat.t && hear.b <= stat.b + 1, at + ': held sideways the signature panel is left out to keep the sea clear; the hearing bar stays in the status panel', { sig, stat, hear });
    if (!side) {
      const hs = await ev(`(function(){ const c=document.getElementById('contact'), q=()=>Math.round(document.getElementById('status').getBoundingClientRect().bottom), was=c.textContent, out=[q()];
        for(const t of ['Unknown contact bearing 349, strong, about 1200 m. To starboard.','High-value ship bearing 049, in range, about 1200 m. To starboard.','No sonar contact.']){ c.textContent=t; out.push(q()); }
        c.textContent=was; const b=document.getElementById('t-decoy'); return {bottoms:out,badge:getComputedStyle(b,'::after').content,n:b.dataset.n,decoys:__G.sim.state.player.decoys,pipsShown:document.getElementById('decoys').getBoundingClientRect().width>0}; })()`);
      note(hs.bottoms.every(b => b === hs.bottoms[0]) && hs.n === String(hs.decoys) && hs.badge.indexOf(hs.n) >= 0 && !hs.pipsShown, at + ': the status panel keeps its height whatever the contact line says, and the Decoy button carries the decoy count', hs);
    }
    await shot(nm('classify'));
    if (!side) {
      // a mission with a longer brief pushes the status panel further down: the picture moves down with it, so the boat stays clear
      const clear = [];
      for (const m of ['shakedown', 'gate', 'firstblood', 'hunted', 'strait', 'patrol']) {
        await ev('__G.start(16,"' + m + '"); 1'); await frames(4);
        for (let i = 0; i < 12; i++) { await ev('__G.stepFrames(30)'); await frames(1); }
        await frames(4);
        clear.push(await ev('(function(){ const b=__G.boatBox; return {m:"' + m + '",status:Math.round(document.getElementById("status").getBoundingClientRect().bottom),box:b.map(Math.round),hit:__h.boxHit(b,["brief","gauges","status","ring","pad","dslide","acts"])}; })()'));
        if (m === 'gate') await shot('d24-long-brief-' + at);
      }
      note(clear.every(q => q.hit.length === 0 && q.box[1] >= 0 && q.box[3] <= h), at + ': in every mission, twelve seconds in, no panel or control covers the boat', clear.map(q => q.m + ' status ' + q.status + ' boat ' + q.box[1] + '-' + q.box[3] + (q.hit.length ? ' HIT ' + q.hit : '')));
      await ev('__G.start(7); (function(){ const s=__G.sim.state.ships[0]; __h.near(s,1900,40); __G.game.sel=s.id; __G.stepFrames(45); __h.hear(s.id,400,c=>c.blades>0); })(); 1'); await frames(6);
    }
    // the detailed frigate through the outside camera
    await ev('(function(){ const G=__G, s=G.sim.state.ships[0]; s.known=true; s.ident=1; document.getElementById("t-view").click(); G.eye.az=2.35; G.eye.el=0.1; G.eye.r=' + (side ? 150 : 250) + '; G.effects.say("",2,0.02); })(); 1');
    for (let i = 0; i < 20; i++) { await ev('__G.stepFrames(12)'); await frames(1); }
    const fr = await ev('({mode:__G.eye.mode,button:document.getElementById("t-view").getAttribute("aria-pressed"),lod:__G.lod.find(q=>q.id===__G.sim.state.ships[0].id),drawn:__G.drawn})');
    note(fr.mode === 2 && fr.button === 'true' && fr.lod && fr.lod.detail && fr.drawn.triangles < TRI_MAX, at + ': the View button shows the identified frigate in full detail', fr);
    if (!side) { const sh = await ev('__G.shade'); note(sh.env && sh.miss === 0 && sh.lit === sh.std && sh.lite && !sh.cast && sh.bakes === 0 && sh.kinds.frigate && !sh.kinds.frigate.cast && sh.kinds.frigate.side <= 1024, at + ': the phone keeps the sky map, the shade map and the weathering picture, in the smaller size, and leaves the cast shade out', sh); }
    await shot(nm('frigate'));
    await ev('__G.eyeSet(0); document.getElementById("t-time").click(); 1'); await frames(2);
    const tm = await ev('[__G.game.warp,document.getElementById("t-time").textContent,document.getElementById("h-clock").textContent]');
    note(tm[0] === 2 && tm[1] === '2x', at + ': the Time button sets 2x', tm);
    // a straining wire turns both Wire buttons red (the phone layouts leave the wire's own line out)
    await ev('__G.input.fire=true; __G.stepFrames(3); __G.sim.state.player.hardT=0.6; 1'); await frames(4);
    const wr = await ev('[document.getElementById("t-wl").className,document.getElementById("t-wr").className,document.getElementById("w-state").textContent,__G.sim.state.torps.length]');
    note(wr[0] === 'strain' && wr[1] === 'strain' && wr[2] === 'Straining', at + ': a straining wire turns both Wire buttons red', wr);
  }
  await size(500, 900, true); await frames(4); await sleep(400);
  await ev('__G.start(7); __G.stepFrames(30); 1'); await frames(3);
}

// helpers that live in the page for the sea-life checks
const F_HELPERS = `
Object.assign(window.__h,{
  pod(kind){ return __G.sim.state.bios.find(q=>q.kind===kind); },
  // put a pod at a distance and an angle off the bow, calling; given a depth, it stays there
  podAt(kind,d,off,depth){ const st=__G.sim.state, p=st.player, b=this.pod(kind), a=p.h+(off||0); b.x=b.hx=b.tx=p.x+Math.cos(a)*d; b.z=b.hz=b.tz=p.z-Math.sin(a)*d; b.call=true; b.callT=900; if(depth!==undefined){ b.depth=b.want=depth; b.airT=900; } return b.id; },
  bcon(id){ return __G.sim.state.contacts.find(q=>q.id===id&&q.kind==='bio'); },
  // listen to one pod, with its contact selected, until a condition on that contact holds
  bhear(id,sec,cond){ const st=__G.sim.state; let n=0, c=this.bcon(id); while(n<sec*30&&!st.over&&!(c&&cond(c))){ __G.game.sel=id; __G.stepFrames(1); n++; c=this.bcon(id); } __G.game.sel=id; return c?{t:+st.t.toFixed(1),cls:c.cls,bio:c.bio,ident:+c.ident.toFixed(2),sig:+c.sig.toFixed(2)}:null; },
  // how many pixels of a canvas are in the colour kept for sea life
  lilac(id){ const c=document.getElementById(id), d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=0;i<d.length;i+=4) if(d[i+3]>90&&Math.abs(d[i]-205)<22&&Math.abs(d[i+1]-188)<22&&Math.abs(d[i+2]-245)<22) n++; return n; },
  // what the picture shows of one pod just now
  life(id){ const L=__G.life, q=L.pods.find(q=>q.id===id)||{}, e=__G.eye; return {kind:q.kind,n:q.n,d:q.d,lod:q.lod,depth:q.depth,scared:q.scared,whales:L.whales,tails:L.tails,whalesLo:L.whalesLo,dolphins:L.dolphins,dolphinsLo:L.dolphinsLo,fish:L.fish,fishMax:L.fishMax,spouts:L.spouts,splashes:L.splashes,drops:L.drops,eye:e.mode,top:!!e.top,above:__G.camera.position.y>__G.waterY,tri:__G.drawn.triangles,calls:__G.drawn.calls}; },
  // how many of a pod are clear of the water in a leap
  inAir(id){ const b=__G.sim.state.bios.find(q=>q.id===id); let n=0; for(let i=0;i<b.n;i++) if(__G.lifeAt(id,i).d<-0.6) n++; return n; },
  // the outside camera on one pod, for a staged picture (the pod is marked as classified)
  watch3(kind,depth){ const b=this.pod(kind); b.known=true; b.ident=1; if(depth!==undefined){ b.depth=b.want=depth; b.airT=900; } __G.eyeSet(3,b.id); __G.effects.say('',2,0.02); return b.id; },
  // fire one torpedo straight at whales 600 m ahead and let it run: with no ship in front of it, its seeker takes the pod for a target
  amongWhales(){ const G=__G, st=G.sim.state; this.podAt('whale',600,0,20); const b=this.pod('whale'); G.input.throttle=2; G.input.depthCmd=20; G.stepFrames(40); this.aim(b); G.input.fire=true; G.stepFrames(3); G.input.fire=false;
    let n=0; while(n<1500&&!st.stats.bio&&!st.over){ G.stepFrames(1); n++; }
    return {fired:st.stats.fired,bio:st.stats.bio,over:st.over,result:st.result,reason:st.reason,frames:n,hit:!!b.hit,known:b.known,scared:b.scareT>0,torps:st.torps.filter(t=>t.side===0).length,alert:document.getElementById('alert').textContent}; }
});1`;

// the Stage F parts at 1280x800: every mission open from the start; sea life as sonar contacts (Unknown, then Biologic), the fire confirm,
// the map, shrimp beds, the outside camera on dolphins, whales and fish, detail by distance, the sounds and the mute, and a torpedo among whales
async function stagef() {
  const mouse = (type, x, y) => c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const panel = async () => { await frames(4); return ev('__h.panel()'); };
  const roll = async (n, per) => { for (let i = 0; i < n; i++) { await ev('__G.stepFrames(' + (per || 12) + ')'); await frames(1); } };
  const life = id => ev('__h.life(' + id + ')');
  const missionList = () => ev('Array.from(document.querySelectorAll("#mpick button")).map(b=>({t:b.textContent,off:b.disabled||b.getAttribute("aria-disabled")==="true",cls:b.className}))');
  const open5 = l => l.length === 5 && l.every(b => !b.off && !/lock/i.test(b.t + ' ' + b.cls));
  let v;
  await size(1280, 800, false);
  await open('?test=1&seed=7'); await ev('try{ localStorage.removeItem("strait-shadow"); }catch(e){} 1');
  // the old unlock switch in the address still loads the game, and changes nothing
  await open('?test=1&seed=7&unlock=1');
  const listU = await missionList();
  await open('?test=1&seed=7'); await ev(HELPERS); await ev(D_HELPERS); await ev(F_HELPERS);

  // --- every mission is open from the start: nothing saved, and no unlock in the address ---
  const list = await missionList(), words = await ev('document.getElementById("title").innerText');
  note(open5(list) && list.every(b => /☆☆☆/.test(b.t)) && !/\b(un)?lock/i.test(words) && await ev('!document.getElementById("b-patrol").disabled&&!/unlock/.test(location.search)'),
    'with nothing won and no unlock in the address, all five missions and Free Patrol are open, and nothing on the title says locked', list.map(b => b.t));
  note(open5(listU) && JSON.stringify(listU) === JSON.stringify(list), 'the old ?unlock=1 address still works and shows the same list', listU.map(b => b.t));
  // the last mission can be chosen and started straight away
  await ev('document.querySelectorAll("#mpick button")[4].click(); 1'); await frames(3);
  const pick = await ev('({mission:__G.game.mission,start:document.getElementById("b-start").textContent,chosen:document.querySelectorAll("#mpick button")[4].getAttribute("aria-pressed")})');
  await shot('f06-title-all-missions-open-1280');
  { const r = await ev('__h.rect("b-start")'); await mouse('mousePressed', r.l + 20, r.t + 20); await mouse('mouseReleased', r.l + 20, r.t + 20); await frames(4); await sleep(300); }
  const au = await ev('(function(){ const a=__G.audio; return {unlocked:a.unlocked,made:a.made,on:a.on,state:a.state}; })()');
  note(pick.mission === 'strait' && pick.chosen === 'true' && await ev('__G.game.running&&__G.sim.state.mission==="strait"') && au.unlocked && au.made && au.on, 'a new player can choose the last mission, Strait Shadow, and start it at once (the click also switches sound on)', { pick, au });

  // --- sea life is in every mission ---
  v = await ev(`__G.allMissions.map(m=>{ __G.start(7,m); const b=__G.sim.state.bios, n=k=>b.filter(q=>q.kind===k).length; return {m:m,whale:n('whale'),dolphin:n('dolphin'),fish:n('fish'),n:b.length}; })`);
  note(v.length === 6 && v.every(q => q.m === 'patrol' ? q.n >= 2 : q.whale >= 1 && q.dolphin >= 1 && q.fish >= 1), 'every mission has sea life: whales, dolphins and fish in each named mission, at least two pods in Free Patrol', v.map(q => q.m + ' ' + q.whale + '/' + q.dolphin + '/' + q.fish).join(', '));

  // --- a pod of dolphins is a sonar contact like any other: Unknown first, then Biologic ---
  await ev('__G.start(11,"shakedown"); 1');
  const did = await ev('__h.podAt("dolphin",650,-0.25)');
  const b0 = await ev('__h.bhear(' + did + ',40,c=>true)'), q0 = await panel(), ring0 = await ev('__h.lilac("ring")');
  const b1 = await ev('__h.bhear(' + did + ',200,c=>c.ident>=0.35)'), q1 = await panel();
  await shot('f08-biologic-still-unknown-1280');
  const b2 = await ev('__h.bhear(' + did + ',300,c=>!!c.cls)'), q2 = await panel(), ring1 = await ev('__h.lilac("ring")');
  await shot('f04-classified-biologic-1280');
  note(b0 && b1 && b2 && !b0.cls && !b1.cls && b2.cls === 'bio' && q0.cls === 'Unknown' && q1.cls === 'Unknown' && q1.txt === 'No shaft rate · irregular transients' && q2.cls === 'Biologic · dolphins' && q2.kind === 'bio' && q2.txt === 'No shaft rate · clicks, whistles'
    && q0.fill < q2.fill && b1.t < b2.t && /Contact classified: Biologic \(dolphins\)\. No shaft rate, only clicks, whistles\. Hold fire\./.test(q2.alert) && q1.fits && q2.fits && ring0 === 0 && ring1 > 0,
    'a pod of dolphins starts as an Unknown contact; listening finds no shaft rate, then classifies it as Biologic, in its own colour on the sonar ring', { heard: [b0, b1, b2], panel: [q0, q1, q2].map(p => [p.cls, p.kind, p.txt, p.fill, p.fits]), alert: q2.alert, ring: [ring0, ring1] });
  // firing with sea life ahead asks first (the picture is taken after one press; the warning is then left to lapse)
  await ev('(function(){ const G=__G, b=__h.pod("dolphin"); __h.aim(b); G.stepFrames(31); __h.aim(b); G.stepFrames(31); __h.aim(b); G.act("fire"); G.stepFrames(3); })(); 1');
  await shot('f09-fire-warning-sea-life-1280'); await sleep(4300);
  v = await ev(`(function(){ const G=__G, st=G.sim.state, b=__h.pod('dolphin'); __h.aim(b); G.stepFrames(31); __h.aim(b); const o={fired0:st.stats.fired,warn:G.fireWarn()}; G.act('fire'); G.stepFrames(3); o.fired1=st.stats.fired; o.alert1=document.getElementById('alert').textContent; G.act('fire'); G.stepFrames(3); o.fired2=st.stats.fired; return o; })()`);
  note(v.fired0 === 0 && /^Hold fire: the target is sea life \(dolphins\)\. Press Fire again to shoot anyway\.$/.test(v.warn) && v.fired1 === 0 && v.alert1 === v.warn && v.fired2 === 1, 'with sea life as the selected target the first Fire press only warns, and the second fires', v);

  // --- the map: each kind of sea life has the Biologic marker and label; the shoals carry their shrimp beds ---
  await ev('__G.start(11,"shakedown"); 1');
  const ids = await ev('[__h.podAt("dolphin",650,-0.25),__h.podAt("whale",900,0.7,30),__h.podAt("fish",420,-1.1)]');
  const heard3 = []; for (const id of ids) heard3.push(await ev('__h.bhear(' + id + ',300,c=>!!c.cls)'));
  await ev('__G.setMap(true); __G.stepFrames(40); 1'); await frames(8);
  v = await ev('({labels:__G.map.rects.map(r=>r[4]),lilac:__h.lilac("mapc"),tracks:__G.sim.state.btracks.map(k=>k.cls+"/"+k.bio).sort(),shoals:__G.sim.state.bed.shoals.length})');
  await shot('f05-map-biologic-markers-and-shrimp-beds-1280');
  note(heard3.every(h => h && h.cls === 'bio') && ['dolphins', 'whales', 'fish'].every(k => v.labels.some(l => l.indexOf('Biologic: ' + k) === 0)) && v.lilac > 60 && v.tracks.join() === 'bio/dolphin,bio/fish,bio/whale',
    'listening classifies whales, dolphins and fish alike, and the map marks each as Biologic in the sea-life colour', { heard: heard3, labels: v.labels.filter(l => /Biologic|shrimp|Unknown/.test(l)), lilac: v.lilac, tracks: v.tracks });
  note(v.shoals > 0 && v.labels.filter(l => /^shoal \d+ m · shrimp$/.test(l)).length > 0, 'the map labels the shoals as shrimp beds', v.labels.filter(l => /shoal/.test(l)));
  // --- over a shrimp bed the boat hears much less, and the instruments say so ---
  await ev('__G.setMap(false); __G.effects.say("",2,0.02); 1'); await frames(4); await sleep(120); await frames(2);
  v = await ev(`(function(){ const G=__G, st=G.sim.state, p=st.player, s=st.bed.shoals[0]; G.input.throttle=1; G.input.depthCmd=15; G.stepFrames(120); const off={mask:+p.mask.toFixed(2),hear:+p.hear.toFixed(2)}; p.x=s.x; p.z=s.z; G.game.jump=true; G.stepFrames(120); return {off:off,on:{mask:+p.mask.toFixed(2),hear:+p.hear.toFixed(2)}}; })()`);
  await frames(8);
  const sp = await ev('({tag:document.getElementById("h-tag").textContent,layer:document.getElementById("h-layer").textContent,alert:document.getElementById("alert").textContent})');
  await shot('f10-over-a-shrimp-bed-1280');
  await ev('__G.setMap(true); 1'); await frames(6); const mi = await ev('document.getElementById("m-info").textContent'); await ev('__G.setMap(false); 1'); await frames(2);
  note(v.off.mask === 0 && v.on.mask >= 0.9 && v.on.hear < v.off.hear * 0.7 && sp.tag === 'Shrimp' && /over a shrimp bed/.test(sp.layer) && /^Snapping shrimp below/.test(sp.alert) && /over a shrimp bed: sonar masked/.test(mi),
    'over a shrimp bed the boat hears much less, and the hearing bar, the layer line, the alert and the map all say so', { sim: v, hud: sp, map: mi });

  // --- the sounds of sea life go through the game's sound, and the Sound button silences them ---
  await ev('__G.start(11,"shakedown"); 1');
  await ev('(function(){ const G=__G; __h.podAt("whale",500,0.6,30); __h.podAt("dolphin",400,-0.5); for(const k in G.audio.last) delete G.audio.last[k]; G.stepFrames(75); })(); 1'); await frames(12); await sleep(200);
  const s1 = await ev('({heard:Object.keys(__G.audio.last).sort(),plays:__G.audio.plays,on:__G.audio.on,bio:__G.sim.state.contacts.filter(c=>c.kind==="bio").length})');
  await ev('(function(){ const G=__G, p=G.sim.state.player, s=G.sim.state.bed.shoals[0]; p.x=s.x; p.z=s.z; G.game.jump=true; __h.podAt("whale",300,0.6,30); __h.podAt("dolphin",250,-0.5); G.stepFrames(45); })(); 1'); await frames(12); await sleep(200);
  const s2 = await ev('({heard:Object.keys(__G.audio.last).sort(),plays:__G.audio.plays,mask:+__G.sim.state.player.mask.toFixed(2),bio:__G.sim.state.contacts.filter(c=>c.kind==="bio").length})');
  await ev('document.getElementById("b-mute").click(); for(const k in __G.audio.last) delete __G.audio.last[k]; __G.stepFrames(90); 1'); await frames(30); await sleep(300); await frames(10);
  const s3 = await ev('({heard:Object.keys(__G.audio.last).sort(),plays:__G.audio.plays,on:__G.audio.on,master:__G.audio.master,bio:__G.sim.state.contacts.filter(c=>c.kind==="bio").length})');
  await ev('document.getElementById("b-mute").click(); __G.stepFrames(45); 1'); await frames(20); await sleep(200);
  const s4 = await ev('({heard:Object.keys(__G.audio.last).sort(),plays:__G.audio.plays,on:__G.audio.on})');
  note(s1.on && s1.bio >= 2 && s1.heard.includes('whale') && s1.heard.includes('dolphin') && !s1.heard.includes('shrimp') && s2.mask >= 0.9 && s2.heard.includes('shrimp') && s2.plays > s1.plays,
    'whale song and dolphin clicks play while their contacts are heard, and the shrimp crackle plays over a shrimp bed', { s1, s2 });
  note(!s3.on && s3.bio >= 2 && s3.heard.length === 0 && s3.plays === s2.plays && s3.master < 0.05 && s4.on && s4.plays > s3.plays && s4.heard.includes('shrimp'),
    'with Sound off none of the sea-life sounds is played; switched back on, they play again', { s3, s4 });

  // --- the outside camera visits sea life that has been classified ---
  await ev('__G.start(11,"shakedown"); 1');
  const d2 = await ev('__h.podAt("dolphin",420,-0.3)'), dh = await ev('__h.bhear(' + d2 + ',300,c=>!!c.cls)');
  await ev('__G.effects.say("",2,0.02); 1'); await frames(4); await sleep(120); await frames(2);
  const cams = await ev(`(function(){ const o=[]; for(let i=0;i<8&&__G.eye.mode!==3;i++){ __G.act('view'); o.push(__G.eye.mode+' '+document.getElementById('alert').textContent); } return o; })()`);
  await roll(20);
  let up = 0; for (let i = 0; i < 200 && up < 2; i++) { await ev('__G.stepFrames(3)'); await frames(1); up = await ev('__h.inAir(' + d2 + ')'); }
  const dl = await life(d2);
  await shot('f02-dolphin-pod-surfacing-1280');
  note(dh && dh.cls === 'bio' && dl.eye === 3 && /^3 Camera: the dolphins\.$/.test(cams[cams.length - 1] || '') && await ev('document.getElementById("t-view").getAttribute("aria-pressed")') === 'true' && dl.lod === 'hi' && dl.dolphins === dl.n && dl.dolphinsLo === 0 && dl.above && dl.splashes > 0 && dl.drops > 0 && up >= 2 && dl.tri < TRI_MAX && dl.calls < CALL_MAX,
    'the camera key reaches the classified dolphins: the whole pod is drawn in detail from above the water, leaping, with splashes', { cams, inAir: up, seen: dl });
  await ev('__G.eye.r=300; 1'); await roll(3); const dl2 = await life(d2);
  note(dl2.lod === 'lo' && dl2.dolphins === 0 && dl2.dolphinsLo === dl2.n, 'from further off the dolphins are drawn in the plainer shape', dl2);

  // --- a whale close up, under water; plainer shapes further off; nothing at all far away ---
  await ev('__G.start(7,"gate"); 1');
  const wid = await ev('__h.watch3("whale",24)');
  await roll(10);
  const w1 = await life(wid); await shot('f01-whale-close-up-under-water-1280');
  await ev('__G.eye.r=250; 1'); await roll(3); const w2 = await life(wid);
  await ev('__G.eye.r=470; 1'); await roll(3); const w3 = await life(wid);
  note(w1.eye === 3 && !w1.above && w1.lod === 'hi' && w1.whales === w1.n && w1.tails === w1.n && w1.whalesLo === 0 && w1.tri < TRI_MAX && w1.calls < CALL_MAX && w2.lod === 'lo' && w2.whales === 0 && w2.whalesLo === w2.n && w3.lod === '' && w3.whales + w3.whalesLo === 0,
    'whales under water: each drawn in detail with its own beating tail close up, in the plainer shape further off, and not at all far away', { close: w1, further: w2, far: w3 });
  // up for air: the camera goes above the water, the backs show, and one of them blows
  await ev('(function(){ const b=__h.pod("whale"); b.depth=3; b.want=2.5; b.airT=60; b.blowT=1.5; })(); 1');
  const sp0 = (await life(wid)).spouts; let w4 = null;
  for (let i = 0; i < 150; i++) { await ev('__G.stepFrames(4)'); await frames(1); w4 = await life(wid); if (w4.spouts > sp0) break; }
  await roll(4, 4);
  await shot('f07-whale-blow-at-the-surface-1280');
  note(w4.top && w4.above && w4.spouts > sp0 && w4.drops >= 20 && w4.lod === 'hi' && w4.whales === w4.n, 'when the whales come up for air the camera goes above the water, their backs show, and one of them blows a puff of spray', w4);

  // --- a school of fish under water: all of it close up, half of it further off, none far away ---
  const fid = await ev('__h.watch3("fish")');
  await roll(10);
  const f1 = await life(fid); await shot('f03-fish-school-1280');
  await ev('__G.eye.r=220; 1'); await roll(3); const f2 = await life(fid);
  await ev('__G.eye.r=420; 1'); await roll(3); const f3 = await life(fid);
  note(f1.eye === 3 && !f1.above && f1.lod === 'hi' && f1.fish === f1.fishMax && f1.fishMax >= 100 && f1.tri < TRI_MAX && f1.calls < CALL_MAX && f2.fish === f1.fishMax >> 1 && f3.fish === 0,
    'a school of fish is drawn under water as one batch: all of it close up, half of it further off, none far away', { close: f1, further: f2, far: f3 });

  // --- a torpedo that goes off among whales is counted, scatters the pod and costs a star; on Hard it ends the mission ---
  await ev('__G.eyeSet(0); __G.start(7,"gate"); 1');
  v = await ev('__h.amongWhales()'); await frames(3);
  note(v.fired === 1 && v.bio === 1 && !v.over && v.hit && v.scared && v.torps === 0 && /^Your torpedo went off among the whales, and the pod has scattered\. That costs a star\.$/.test(v.alert),
    'a torpedo that goes off among whales is counted, the pod scatters, and the alert says it costs a star (fired straight at whales 600 m ahead)', v);
  await ev('document.querySelector("[data-d=hard]").click(); __G.start(7,"gate"); 1');
  v = await ev('__h.amongWhales()'); await frames(3);
  await ev('if(__G.sim.state.over) __G.effects.showResult(); 1'); await frames(4);
  const card = await ev('({title:document.getElementById("r-title").textContent,card:document.getElementById("result").innerText.replace(/\\s*\\n\\s*/g," | "),rows:Array.from(document.querySelectorAll("#r-stats dt")).map(d=>d.textContent+"="+d.nextSibling.textContent)})');
  note(v.bio === 1 && v.over && v.result === 'lose' && /sea life/.test(v.reason) && /sea life/.test(card.card) && !/star lost/.test(card.card) && card.rows.includes('Torpedoes among sea life=1'), 'on Hard that torpedo ends the mission, and the result card says so', { sim: v, card });
  await shot('f11-sea-life-hit-result-1280');
  await ev('document.getElementById("result").hidden=true; document.querySelector("[data-d=standard]").click(); 1');

  // --- the plain look (no shader patches) still draws sea life ---
  await ev('__G.start(7,"gate"); __G.goPlain(); 1');
  const pw = await ev('__h.watch3("whale",24)'); await roll(8); const p1 = await life(pw); await shot('f12-plain-look-whale-1280');
  const pd = await ev('__h.watch3("dolphin")'); await roll(8); const p2 = await life(pd);
  const pf = await ev('__h.watch3("fish")'); await roll(8); const p3 = await life(pf);
  note(await ev('__G.plainLook') === true && p1.whales === p1.n && p1.tails === p1.n && p2.dolphins === p2.n && p3.fish === p3.fishMax, 'in the plain look the whales, the dolphins and the fish are still drawn', { whales: [p1.whales, p1.n], dolphins: [p2.dolphins, p2.n], fish: [p3.fish, p3.fishMax] });
  await ev('__G.eyeSet(0); 1');
}

// sea life on the phone, 390x844 and 844x390: the signature panel with a Biologic contact, the map and the outside camera
async function stagefPhone() {
  await ev(D_HELPERS); await ev(F_HELPERS);
  const roll = async (n, per) => { for (let i = 0; i < n; i++) { await ev('__G.stepFrames(' + (per || 12) + ')'); await frames(1); } };
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const side = h < 520, at = w + 'x' + h, nm = part => (side ? 'f21-' + part + '-sideways-' : 'f20-' + part + '-') + at;
    await size(w, h, true); await frames(4); await sleep(500);
    await ev('__G.eyeSet(0); __G.start(11,"shakedown"); 1');
    const id = await ev('__h.podAt("dolphin",520,-0.25)'), b = await ev('__h.bhear(' + id + ',300,c=>!!c.cls)'); await frames(6);
    const pn = await ev('__h.panel()'), sig = await ev('__h.rect("sig")'), stat = await ev('__h.rect("status")'), line = await ev('document.getElementById("contact").textContent'), ring = await ev('__h.lilac("ring")');
    if (!side) note(b && b.cls === 'bio' && pn.cls === 'Biologic · dolphins' && pn.kind === 'bio' && pn.txt === 'No shaft rate · clicks, whistles' && pn.fits && sig.w > 0 && sig.l >= stat.l && sig.r <= stat.r && sig.t >= stat.t && sig.b <= stat.b + 1 && stat.r <= w && stat.b <= h && ring > 0,
      at + ': the signature panel shows the Biologic contact inside the status panel, and its text is not cut', { sig, stat, panel: [pn.cls, pn.txt, pn.fits], ring });
    else note(b && b.cls === 'bio' && sig.w === 0 && /^Biologic \(dolphins\) bearing \d\d\d/.test(line) && stat.l >= 0 && stat.r <= w && stat.b <= h && ring > 0, at + ': held sideways the contact line names the Biologic contact, and the sonar ring shows it in its own colour', { line, stat, ring });
    await shot(nm('classified-biologic'));
    await ev('__G.setMap(true); __G.stepFrames(40); 1'); await frames(8);
    const mp = await ev('({labels:__G.map.rects.map(r=>r[4]),lilac:__h.lilac("mapc")})');
    note(mp.labels.some(l => l.indexOf('Biologic: dolphins') === 0) && mp.lilac > 20, at + ': the map marks the dolphins as Biologic', { labels: mp.labels.filter(l => /Biologic|shrimp/.test(l)), lilac: mp.lilac });
    await shot(nm('map-biologic'));
    await ev('__G.setMap(false); __G.effects.say("",2,0.02); 1'); await frames(4); await sleep(120); await frames(2);
    // the View button reaches the pod, and the phone draws it
    const cams = await ev(`(function(){ const o=[]; for(let i=0;i<8&&__G.eye.mode!==3;i++){ document.getElementById('t-view').click(); o.push(__G.eye.mode+' '+document.getElementById('alert').textContent); } return o; })()`);
    await roll(20);
    let up = 0; for (let i = 0; i < 200 && up < 2; i++) { await ev('__G.stepFrames(3)'); await frames(1); up = await ev('__h.inAir(' + id + ')'); }
    const dl = await ev('__h.life(' + id + ')');
    note(dl.eye === 3 && /^3 Camera: the dolphins\.$/.test(cams[cams.length - 1] || '') && dl.lod === 'hi' && dl.dolphins === dl.n && dl.above && dl.splashes > 0 && dl.tri < TRI_MAX, at + ': the View button reaches the dolphins, drawn in detail with splashes', { cams, seen: dl });
    await ev('__G.effects.say("",2,0.02); 1');
    await shot(nm('dolphins'));
    if (!side) {
      // whales and a school of fish under water, on the phone
      await ev('__G.start(7,"gate"); 1');
      const wid = await ev('__h.watch3("whale",24)'); await roll(10); const w1 = await ev('__h.life(' + wid + ')'); await shot(nm('whale'));
      const fid = await ev('__h.watch3("fish")'); await roll(10); const f1 = await ev('__h.life(' + fid + ')'); await shot(nm('fish-school'));
      note(w1.lod === 'hi' && w1.whales === w1.n && w1.tails === w1.n && !w1.above && f1.fish === f1.fishMax && f1.fishMax >= 100 && f1.fishMax < 260 && w1.tri < TRI_MAX && f1.tri < TRI_MAX, at + ': whales and a school of fish are drawn under water, the school with fewer fish than on a desktop', { whales: w1, fish: f1 });
    }
    await ev('__G.eyeSet(0); 1');
  }
  await size(500, 900, true); await frames(4); await sleep(400);
  await ev('__G.eyeSet(0); __G.start(7); __G.stepFrames(30); 1'); await frames(3);
}


// ---------- Stage G: damage, flooding, fire, the emergency blow ----------
const G_PANELS = ['brief', 'gauges', 'status', 'ring', 'alert', 'keys'];
// a torpedo hit in the Control room, staged: holed, burning, two hurt, smoke drifting aft
const G_HIT = '(function(){ const st=__G.sim.state, d=st.dmg; d.on=true; d.sec[3].water=0.8; d.sec[3].hurt=3; const s=d.sec[1]; s.breach=0.4; s.water=0.22; s.fire=0.4; s.hurt=2; s.smoke=0.5; d.sec[2].smoke=0.3; st.stats.injured=2; st.stats.taken=1; __G.stepFrames(20); return 1; })()';
const G_STATE = '(function(){ const st=__G.sim.state, d=st.dmg; return {t:+st.t.toFixed(1),depth:+st.player.depth.toFixed(1),on:d.on,blow:d.blow,team:d.team,work:d.work,lost:d.lost,over:st.over,sec:d.sec.map(s=>({w:+s.water.toFixed(2),b:+s.breach.toFixed(2),f:+s.fire.toFixed(2),h:s.hurt,sealed:s.sealed})),open:__G.dmgOpen,tag:document.getElementById("dm-tag").textContent,line:document.getElementById("dm-line").textContent}; })()';
const gKey = async (code, k, vk) => { await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk }); await frames(2); };
async function stageg() {
  await size(1280, 800, false);
  await open('?test=1&seed=7'); await ev(HELPERS);
  await ev('__G.start(7); __G.input.depthCmd=60; __G.input.throttle=2; (function(){ const p=__G.sim.state.player; p.depth=60; })(); __G.stepFrames(30); 1');
  await ev(G_HIT); await frames(6); await sleep(300);
  let v = await ev(G_STATE);
  const cell = await ev('(function(){ const c=document.querySelectorAll("#dsil .c")[1]; return {cls:c.className,w:c.children[0].style.height,u:c.children[3].textContent}; })()');
  let o = await ev('__h.overlaps(' + JSON.stringify(G_PANELS) + ')');
  note(v.tag === 'Fire' && /Fire in the Control room/.test(v.line) && /Flooding in the Control room: go shallower/.test(v.line) && /2 injured/.test(v.line) && /fire/.test(cell.cls) && parseInt(cell.w) > 10 && cell.u === '2' && !v.open && o.length === 0,
    '1280x800: the damage picture shows water, fire and the injured in the Control room, and the line under it says what is wrong in plain words', { v, cell, o });
  await shot('g01-damage-closed-1280');
  await gKey('KeyG', 'g', 71);
  v = await ev(G_STATE);
  const pn = await ev('({dp:__h.rect("dpanel"),rows:Array.from(document.querySelectorAll("#dp-rows li")).map(li=>li.textContent),sys:document.getElementById("dp-sys").textContent,crush:document.getElementById("dp-crush").textContent,sealShown:!document.querySelectorAll("#dp-rows button")[1].hidden,over:__h.overlaps(' + JSON.stringify(G_PANELS.concat(['dpanel'])) + ')})');
  note(v.open && pn.dp.w > 200 && pn.dp.t >= 0 && pn.dp.b <= 800 && pn.rows.length === 4 && /Control room/.test(pn.rows[1]) && /2 of 9 hurt/.test(pn.rows[1]) && pn.sealShown && /Crush depth \d+ m/.test(pn.crush) && pn.over.length === 0,
    '1280x800: G opens the damage panel: four sections with water, fire and hurt, a Seal button on the burning one, the crush depth; it overlaps no other panel', pn);
  // keys 1-4 send the team; the same key again hands the choice back
  await gKey('Digit3', '3', 51); await ev('__G.stepFrames(3)');
  const t3 = await ev('[__G.input.team,__G.sim.state.dmg.team]');
  await gKey('Digit3', '3', 51); await ev('__G.stepFrames(3)');
  const t0 = await ev('[__G.input.team,__G.sim.state.dmg.team]');
  note(t3[0] === 2 && t3[1] === 2 && t0[0] === -1 && t0[1] === -1, 'key 3 sends the damage-control team to the Battery; 3 again lets it choose the worst trouble', { t3, t0 });
  // a click on a section of the big picture sends the team there
  await ev('document.querySelectorAll("#dsil2 .c")[1].click(); __G.stepFrames(3); 1'); await frames(4);
  v = await ev(G_STATE);
  const teamCell = await ev('document.querySelectorAll("#dsil .c")[1].className');
  note(v.team === 1 && /team/.test(teamCell), 'a click on the Control room sends the team there, and the marker shows it', { team: v.team, teamCell });
  await shot('g02-damage-panel-open-1280');
  // Seal: the first press asks, the second shuts the section; its fire dies for want of air and the crew inside are hurt
  await ev('(function(){ const b=document.querySelectorAll("#dp-rows button")[1]; b.click(); b.click(); __G.stepFrames(3); })(); 1');
  v = await ev(G_STATE);
  note(v.sec[1].sealed && v.sec[1].h === 9, 'Seal, pressed twice, shuts the burning section and everyone in it is hurt', v.sec[1]);
  await gKey('KeyG', 'g', 71);
  note(!(await ev('__G.dmgOpen')) && await ev('document.getElementById("dpanel").hidden'), 'G again closes the damage panel');

  // a flooding boat: air streams out of the two holed sections at their places along the hull
  await ev('__G.start(7); __G.input.depthCmd=40; __G.input.throttle=1; (function(){ const p=__G.sim.state.player; p.depth=40; })(); __G.stepFrames(30); 1'); await sleep(2500);
  const b0 = await ev('__G.fxLive');
  await ev('(function(){ const st=__G.sim.state, d=st.dmg, p=st.player; d.on=true; d.sec[0].breach=0.7; d.sec[0].water=0.2; d.sec[2].breach=0.5; d.sec[2].water=0.15; st.stats.taken=2; __G.input.depthCmd=p.depth; })(); __G.cam.el=0.05; __G.cam.r=70; __G.cam.az=Math.PI/2; __G.cam.elGoal=null; 1');
  await sleep(2500);
  const b1 = await ev('__G.fxLive');
  v = await ev(G_STATE);
  note(b1 > b0 + 80 && /Flooding in the Torpedo room/.test(v.line), 'a holed boat streams air bubbles from its breaches', { before: b0, after: b1, line: v.line });
  await shot('g03-flooding-bubbles-1280');

  // the emergency blow: B twice within two seconds; the boat rises fast and breaks the surface bow first
  await ev('__G.start(7); __G.input.depthCmd=110; __G.input.throttle=1; (function(){ const st=__G.sim.state, d=st.dmg, p=st.player; p.depth=110; d.on=true; d.sec[0].breach=0.5; d.sec[0].water=0.5; d.sec[1].water=0.3; st.stats.taken=1; })(); __G.stepFrames(10); 1');
  await gKey('KeyB', 'b', 66);
  const armed = await ev('[__G.sim.state.dmg.blow,document.getElementById("alert").textContent]');
  await gKey('KeyB', 'b', 66); await ev('__G.stepFrames(2)'); await frames(2);
  v = await ev(G_STATE);
  note(armed[0] === 0 && /press B again/.test(armed[1]) && v.blow === 1 && /Blowing ballast/.test(v.line), 'B asks once; B again within two seconds starts the emergency blow', { armed, blow: v.blow, line: v.line });
  await ev('(function(){ const st=__G.sim.state; for(let i=0;i<900&&st.player.depth>30;i++) __G.stepFrames(1); })(); __G.cam.el=0.08; __G.cam.r=95; __G.cam.az=Math.PI/2+0.5; __G.cam.elGoal=null; 1');
  for (let i = 0; i < 20; i++) { await ev('__G.stepFrames(1)'); await frames(1); }
  const rising = await ev('[__G.fxLive,+__G.sim.state.player.depth.toFixed(1)]');
  await shot('g04-blow-rising-1280');
  let leap = 0;
  for (let i = 0; i < 400 && leap === 0; i++) { await ev('__G.stepFrames(1)'); await frames(1); leap = await ev('__G.leap'); }
  // the picture is taken while the bow is still up: the rear lasts about two and a half seconds of drawing time, and a slow headless frame can be a tenth of a second
  const leaps = []; for (let i = 0; i < 60 && leaps.length < 60; i++) { await ev('__G.stepFrames(1)'); await frames(1); const l = await ev('__G.leap'); leaps.push(+l.toFixed(2)); if (l < 0.72) break; }
  console.log('     leap while surfacing', leaps.join(' '));
  v = await ev(G_STATE);
  note(leap > 0 && v.depth < 4 && rising[0] > 150, 'the blow brings the boat up in a cloud of air, and it breaks the surface bow first', { leap, depth: v.depth, rising });
  await shot('g05-blow-surfacing-1280');
  // a fire aboard with the boat on the surface: smoke from the fin
  await ev('(function(){ const d=__G.sim.state.dmg; d.sec[1].fire=0.5; d.sec[1].sealUsed=true; })(); __G.cam.el=0.12; __G.cam.r=80; __G.cam.elGoal=null; 1');
  for (let i = 0; i < 80; i++) { await ev('__G.stepFrames(1)'); await frames(1); }
  v = await ev(G_STATE);
  note(v.depth < 4 && v.sec[1].f > 0 && /Fire in the Control room/.test(v.line) && await ev('__G.wakes.smoke'), 'a fire aboard a surfaced boat: smoke rises from the fin', { depth: v.depth, fire: v.sec[1].f, line: v.line });
  await shot('g06-fin-smoke-1280');

  // two sections flooded: the boat is lost, and the card says so without a picture of anyone hurt
  await ev('__G.start(7); (function(){ const st=__G.sim.state, d=st.dmg; st.player.depth=60; d.on=true; d.sec[1].water=1; d.sec[2].water=1; d.sec[1].hurt=3; st.stats.injured=3; for(let i=0;i<300&&!st.over;i++) __G.stepFrames(10); })(); __G.effects.showResult(); 1'); await frames(4);
  v = await ev('({over:__G.sim.state.over,title:document.getElementById("r-title").textContent,reason:document.getElementById("r-reason").textContent,rows:Array.from(document.querySelectorAll("#r-stats dt")).map(d=>d.textContent+"="+d.nextSibling.textContent)})');
  note(v.over && v.title === 'Boat lost (simulated)' && /No one is hurt: this is a simulation\./.test(v.reason) && v.rows.some(r => /^Crew injured=\d+ of 28$/.test(r)) && v.rows.some(r => /^Most water aboard=\d+% of the boat$/.test(r)) && !v.rows.some(r => /Hull left/.test(r)),
    'flooded in two sections the boat is lost; the card gives the injured as a number and the most water aboard', v);
  await shot('g07-lost-flooded-1280');
  await ev('document.getElementById("result").hidden=true; 1');
}
async function stagegPhone() {
  const w = 390, h = 844, at = '390x844', HUD = ['brief', 'gauges', 'status', 'ring', 'pad', 'dslide', 'acts', 'dpanel'];
  await size(w, h, true); await frames(4); await sleep(500);
  await ev('__G.start(7); __G.input.depthCmd=60; __G.input.throttle=2; (function(){ const p=__G.sim.state.player; p.depth=60; })(); __G.stepFrames(30); 1');
  await ev(G_HIT); await frames(6); await sleep(400);
  const boat = () => ev('(function(){ const b=__G.boatBox; return {box:b.map(Math.round),hit:__h.boxHit(b,' + JSON.stringify(HUD) + ')}; })()');
  let o = await ev('__h.overlaps(' + JSON.stringify(TOUCH.concat(PANELS)) + ')'), bx = await boat(), v = await ev(G_STATE);
  const wd = await ev('__h.rect("dmgw")');
  note(o.length === 0 && bx.hit.length === 0 && bx.box[0] >= -2 && bx.box[2] <= w + 2 && v.tag === 'Fire' && wd.w >= 44 && wd.h >= 44 && await ev('getComputedStyle(document.getElementById("t-blow")).display==="none"'),
    at + ': the damage picture sits in the gauges; nothing overlaps and no panel covers the boat (upright, Blow is on the damage panel)', { o, bx, wd, tag: v.tag });
  await shot('g08-damage-closed-390');
  // a tap on the damage picture opens the full panel in the status panel's place
  await ev('document.getElementById("dmgw").click(); 1'); await frames(6); await sleep(300);
  v = await ev(G_STATE); o = await ev('__h.overlaps(' + JSON.stringify(TOUCH.concat(['brief', 'gauges', 'ring', 'alert', 'dpanel'])) + ')'); bx = await boat();
  const pn = await ev('({dp:__h.rect("dpanel"),status:getComputedStyle(document.getElementById("status")).display,small:Array.from(document.querySelectorAll("#dpanel button")).filter(b=>{ const k=b.getBoundingClientRect(); return k.width>0&&(k.height<44||k.width<44); }).map(b=>(b.id||b.textContent)+" "+Math.round(b.getBoundingClientRect().width)+"x"+Math.round(b.getBoundingClientRect().height))})');
  note(v.open && pn.status === 'none' && pn.dp.l >= 0 && pn.dp.r <= w && pn.dp.b <= h && pn.small.length === 0 && o.length === 0 && bx.hit.length === 0 && bx.box[0] >= -2 && bx.box[2] <= w + 2,
    at + ': a tap opens the damage panel in place of the status panel; its buttons are at least 44 px, it overlaps nothing and does not cover the boat', { pn, o, bx });
  await shot('g09-damage-panel-open-390');
  await ev('document.querySelectorAll("#dsil2 .c")[3].click(); __G.stepFrames(3); 1');
  const team = await ev('__G.sim.state.dmg.team');
  await ev('document.getElementById("dp-blow").click(); 1'); const armed = await ev('document.getElementById("alert").textContent');
  await ev('document.getElementById("dp-blow").click(); __G.stepFrames(3); 1'); const blow = await ev('__G.sim.state.dmg.blow');
  await ev('document.getElementById("dp-close").click(); 1'); await frames(3);
  note(team === 3 && /press Blow again/.test(armed) && blow === 1 && !(await ev('__G.dmgOpen')) && await ev('getComputedStyle(document.getElementById("status")).display!=="none"'),
    at + ': on the panel a tap on a section sends the team, Blow twice starts the blow, and Close brings the status panel back', { team, armed, blow });
  // sideways: the Blow button joins the row of buttons, and the open panel stays clear of the boat
  { const w = 844, h = 390, at = '844x390';
    await size(w, h, true); await frames(4); await sleep(500);
    await ev('__G.start(7); __G.input.depthCmd=60; __G.input.throttle=2; (function(){ const p=__G.sim.state.player; p.depth=60; })(); __G.stepFrames(30); 1');
    await ev(G_HIT); await frames(6); await sleep(400);
    const ids = TOUCH.concat(['t-blow']), b = await ev(JSON.stringify(ids) + '.map(id=>__h.rect(id))'), o = await ev('__h.overlaps(' + JSON.stringify(ids.concat(PANELS)) + ')');
    note(b.every(q => q.w >= 44 && q.h >= 44 && q.l >= 0 && q.t >= 0 && q.r <= w && q.b <= h) && o.length === 0, at + ': with damage aboard the Blow button joins the row; every touch control is at least 44 px, on screen and clear of the panels', { small: b.filter(q => q.w < 44 || q.h < 44 || q.r > w || q.b > h), o });
    await shot('g10-damage-closed-sideways-844');
    await ev('document.getElementById("dmgw").click(); 1'); await frames(6); await sleep(300);
    const o2 = await ev('__h.overlaps(' + JSON.stringify(ids.concat(['brief', 'gauges', 'status', 'ring', 'alert', 'dpanel'])) + ')'), bx = await boat(), dp = await ev('__h.rect("dpanel")'), more = await ev('[__h.rect("pad"),__h.rect("alert")]');
    note(await ev('__G.dmgOpen') && o2.length === 0 && bx.hit.length === 0 && dp.b <= h && dp.r <= w, at + ': the open damage panel overlaps no control and does not cover the boat', { o2, bx, dp, more });
    await shot('g11-damage-panel-open-sideways-844');
    await ev('document.getElementById("dp-close").click(); 1'); }
  await size(500, 900, true); await frames(4); await sleep(400);
  await ev('__G.start(7); __G.stepFrames(30); 1'); await frames(3);
}

// Stage H: the phone "tabletop". The plot is the main screen, the boat is steered by dragging a course line, and the 3D picture is a small window.
// Real one-finger touches drive the buttons and the drags; the pinch and the two-finger drag are sent as pointer events inside the page, because a real
// two-finger touch makes headless Chrome drop the touches that follow it (see the note on order at the end).
const H_SOLID = ['tbar', 'acts', 'tb-up', 'dslide', 'tb-down', 'mapbar', 'tb-inset', 'alert', 'tb-con', 'wpn', 'tset'];
// every button on the table that can be pressed now, with its size: the damage picture in the bar is one button, and the depth gauge is dragged
const H_TARGETS = '(function(){ const out=[]; for(const el of document.querySelectorAll("#hud button,#hud [role=button],#dslide")){ const r=el.getBoundingClientRect(); if(r.width>0&&r.height>0&&getComputedStyle(el).visibility!=="hidden") out.push({id:el.id||el.textContent,w:Math.round(r.width),h:Math.round(r.height),l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),hit:el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}); } return out; })()';
const H_STATE = '(function(){ const t=__G.table, st=__G.sim.state, p=st.player, s=document.getElementById("scene").getBoundingClientRect(); return {on:t.on,phone:t.phone,cls:document.body.className,map:!document.getElementById("mapc").hidden,scene:[Math.round(s.left),Math.round(s.top),Math.round(s.width),Math.round(s.height)],view:t.view,inset:t.inset,btn:document.getElementById("t-map").textContent,boat:t.boat.map(Math.round),free:[__G.free.cx,__G.free.cy,Math.round(__G.free.r)],hdg:(450-p.h*180/Math.PI)%360,course:t.course===null?null:(450-t.course*180/Math.PI)%360,span:__G.map.span,pan:[Math.round(__G.map.panX),Math.round(__G.map.panZ)],sel:__G.game.sel,depthCmd:__G.input.depthCmd,throttle:__G.input.throttle,silent:__G.input.silent,decoys:p.decoys,tubes:p.readyT,pingCd:+p.pingCd.toFixed(1),torps:st.torps.filter(q=>q.side===0).length,wire:p.wireId,speed:+p.speed.toFixed(1),warp:__G.game.warp,menu:t.menu,obj:t.obj,wf:t.wf,dmg:__G.dmgOpen,paused:__G.game.paused,running:__G.game.running}; })()';
const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
async function stageh() {
  const touch = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id || 1 })) });
  const rect = id => ev('(function(){ const r=document.getElementById("' + id + '").getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,t:r.top,l:r.left}; })()');
  const tapAt = async (x, y) => { await touch('touchStart', [{ x, y }]); await sleep(60); await touch('touchEnd', []); await sleep(140); };
  const tap = async id => { const b = await rect(id); await tapAt(b.x, b.y); };
  const st = () => ev(H_STATE);
  const shown = id => ev('(function(){ const el=document.getElementById("' + id + '"), r=el.getBoundingClientRect(); return r.width>0&&r.height>0; })()');
  // a drag from beside the boat out along a compass bearing: the finger stays down until end() is called
  const dragTo = async (boat, brg, len) => { const a = brg * Math.PI / 180, ux = Math.sin(a), uy = -Math.cos(a); await touch('touchStart', [{ x: boat[0] + ux * 22, y: boat[1] + uy * 22 }]); await sleep(60);
    for (const f of [0.45, 0.7, 1]) { await touch('touchMove', [{ x: boat[0] + ux * len * f, y: boat[1] + uy * len * f }]); await sleep(50); } };
  // pointer events made inside the page, for the two-finger gestures
  const ptr = (type, id, x, y) => ev('document.getElementById("mapc").dispatchEvent(new PointerEvent("' + type + '",{pointerId:' + id + ',pointerType:"touch",clientX:' + x + ',clientY:' + y + ',bubbles:true,cancelable:true})); 1');

  // which screens get the table: a phone does, a tablet does not (the desktop check is in the desktop part)
  await size(844, 390, true); await open('?test=1&seed=7');
  const det = { phone: await ev('({table:__G.table.phone,coarse:matchMedia("(pointer:coarse)").matches,screen:[screen.width,screen.height]})') };
  await size(1024, 768, true); await open('?test=1&seed=7');
  det.tablet = await ev('({table:__G.table.phone,coarse:matchMedia("(pointer:coarse)").matches,screen:[screen.width,screen.height]})');
  await ev('__G.start(7); __G.stepFrames(10); 1'); await frames(3);
  det.tabletPlay = await ev('({cls:document.body.className,pad:document.getElementById("pad").getBoundingClientRect().width>0,gauges:document.getElementById("gauges").getBoundingClientRect().width>0,bar:document.getElementById("tbar").getBoundingClientRect().width,scene:document.getElementById("scene").getBoundingClientRect().width})');
  await size(844, 390, true); await open('?test=1&seed=7&table=0'); det.off = await ev('__G.table.phone');
  note(det.phone.table === true && det.tablet.table === false && det.off === false && !/\btable\b/.test(det.tabletPlay.cls) && det.tabletPlay.pad && det.tabletPlay.gauges && det.tabletPlay.bar === 0 && det.tabletPlay.scene === 1024,
    'tabletop: on by itself on a phone-sized touch screen; off on a tablet-sized one, which plays in the 3D layout as before; and ?table=0 switches it off', det);

  for (const [w, h, at, first] of [[844, 390, '844x390', true], [932, 430, '932x430', false]]) {
    const n = first ? '844' : '932';
    await size(w, h, true); await open('?test=1&seed=7&table=1'); await ev(HELPERS);
    await ev('__G.start(7); __G.stepFrames(60); 1'); await frames(6); await sleep(500);
    let s = await st();
    const hid = await ev('["ring","pad","gauges","status","brief","keys"].filter(id=>document.getElementById(id).getBoundingClientRect().width>0)');
    note(s.on && s.map && /\btable\b/.test(s.cls) && s.btn === '3D' && hid.length === 0 && s.view[0] === s.inset[2] && s.view[1] === s.inset[3] && s.scene[0] === s.inset[0] && s.scene[1] === s.inset[1] && s.scene[2] === s.inset[2] && s.scene[3] === s.inset[3] && s.inset[2] >= 150 && s.inset[3] >= 90,
      at + ': the table shows: the plot fills the screen, the 3D picture is the small window, and the pad, ring and floating panels are put away', { s, hid });
    await shot(first ? 'h10-table-844' : 'h11-table-932');
    // nothing overlaps, everything is on the screen, every tap target is at least 40 px, and nothing covers the boat
    const clear = async (what, extra) => {
      const ids = H_SOLID.concat(extra || []), o = await ev('__h.overlaps(' + JSON.stringify(ids) + ')'), tg = await ev(H_TARGETS), q = await st(), cov = await ev('__h.boxHit([' + [q.boat[0] - 12, q.boat[1] - 12, q.boat[0] + 12, q.boat[1] + 12].join(',') + '],' + JSON.stringify(ids) + ')');
      const small = tg.filter(b => b.w < 40 || b.h < 40), off = tg.filter(b => b.l < 0 || b.t < 0 || b.r > w || b.b > h || !b.hit);
      note(o.length === 0 && small.length === 0 && off.length === 0 && cov.length === 0 && tg.length >= 12, at + ': ' + what + ': nothing overlaps, every tap target is at least 40 px, on the screen and not covered, and nothing covers the boat', { o, small, off, cov, n: tg.length, sizes: tg.map(b => b.id + ' ' + b.w + 'x' + b.h).join(', ') });
    };
    await clear('the table');
    await tap('tb-menu'); await tap('tm-time'); const tw = [(await st()).warp, await txt('tm-time')]; await ev('__G.setWarp(1,true); 1'); await tap('tb-menu');
    note(tw[0] === 2 && tw[1] === 'Time 2\u00d7' && !(await st()).menu, at + ': Time in the menu speeds the clock up', tw);

    // a drag orders a course, and the boat turns onto it
    const want = (s.hdg + 300) % 360;
    await dragTo(s.boat, want, 100); await frames(4);
    const mid = await ev('({drag:__G.table.drag,label:__G.map.rects.map(r=>r[4]).filter(t=>/^Course /.test(t))})');
    if (first) await shot('h12-course-drag-844');
    await touch('touchEnd', []); await sleep(150);
    s = await st();
    note(mid.drag === true && mid.label.length === 1 && s.course !== null && angDiff(s.course, want) < 3 && /Course \d{3} ordered/.test(await txt('alert')), at + ': a drag on the plot draws the course line and orders that heading', { want: Math.round(want), mid, course: s.course, alert: await txt('alert') });
    await ev('__G.input.throttle=2; for(let i=0;i<2400;i++){ __G.stepFrames(1); const p=__G.sim.state.player; if(Math.abs(__h.wrap(__G.table.course-p.h))<0.02) break; } 1'); await frames(3);
    const turned = await st();
    note(angDiff(turned.hdg, want) < 5 && angDiff(turned.hdg, s.hdg) > 40, at + ': the boat turns onto the ordered course, to within 5 degrees', { from: Math.round(s.hdg), ordered: Math.round(want), now: +turned.hdg.toFixed(1) });

    // zoom: the buttons, then a pinch; two fingers move the chart and Centre brings it back
    const z0 = (await st()).span; await tap('m-in'); const z1 = (await st()).span; await tap('m-out'); const z2 = (await st()).span;
    const c0 = turned.boat;
    await ptr('pointerdown', 21, c0[0] - 30, c0[1] - 60); await ptr('pointerdown', 22, c0[0] + 30, c0[1] - 60);
    await ptr('pointermove', 21, c0[0] - 70, c0[1] - 60); await ptr('pointermove', 22, c0[0] + 70, c0[1] - 60);
    const z3 = (await st()).span;
    await ptr('pointermove', 21, c0[0] - 30, c0[1] - 20); await ptr('pointermove', 22, c0[0] + 110, c0[1] - 20);
    await ptr('pointerup', 21, c0[0] - 30, c0[1] - 20); await ptr('pointerup', 22, c0[0] + 110, c0[1] - 20); await frames(3);
    const moved = await st();
    await tap('m-centre'); const back = await st();
    note(z1 < z0 && z2 === z0 && z3 < z2 && (moved.pan[0] !== 0 || moved.pan[1] !== 0) && back.pan[0] === 0 && back.pan[1] === 0 && angDiff(moved.course, turned.course) < 0.01,
      at + ': + and - zoom, a pinch zooms, two fingers move the chart without ordering a course, and Centre brings it back', { z0, z1, z2, z3, pan: moved.pan });
    await ev('__G.mapZoom(1); 1');

    // a tap on a contact picks it and fills the strip above the buttons; a tap on open water puts the strip away
    await ev('__G.input.throttle=1; for(let i=0;i<3000&&!__G.sim.state.tracks.length;i++) __G.stepFrames(1); __G.stepFrames(30); 1'); await frames(4);
    const hit = await ev('(function(){ const h=__G.table.hits[0], b=__G.table.boat; if(!h) return null; return {id:h.id,firm:h.firm,x:h.firm?h.x:b[0]+Math.cos(h.brg)*60,y:h.firm?h.y:b[1]-Math.sin(h.brg)*60,ox:b[0]-Math.cos(h.brg)*50,oy:b[1]+Math.sin(h.brg)*50}; })()');
    if (hit) await tapAt(hit.x, hit.y); await frames(4);
    s = await st(); const strip = await txt('tb-con');
    note(!!hit && s.sel === hit.id && await shown('tb-con') && /^(Unknown|Frigate|Merchant|Fishing boat|High-value ship|Biologic)/.test(strip) && /Bearing \d{3}/.test(strip) && /Range/.test(strip) && !/RSS|hull|flag/i.test(strip) && s.course !== null,
      at + ': a tap on a contact picks it and the strip gives its class, bearing and range as sonar knows them', { hit, strip });
    await clear('with a contact picked');
    if (first) await shot('h13-contact-picked-844');
    if (hit) await tapAt(hit.ox, hit.oy); await frames(3);
    note((await st()).sel === 0 && !(await shown('tb-con')), at + ': a tap on open water puts the strip away');
    if (hit) await tapAt(hit.x, hit.y);

    // the row of buttons: speed, Silent, Decoy, Ping, Fire; the Wire buttons come with a torpedo on its wire
    await tap('tb-fast'); const sp1 = [(await st()).throttle, await txt('tb-thr')]; await tap('tb-slow'); const sp2 = [(await st()).throttle, await txt('tb-thr')];
    note(sp1[0] === 2 && sp1[1] === 'Half' && sp2[0] === 1 && sp2[1] === 'Slow', at + ': the speed stepper sets the throttle and names it', { sp1, sp2 });
    await tap('t-silent'); const sil1 = (await st()).silent; await tap('t-silent'); const sil2 = (await st()).silent;
    await tap('t-decoy'); await ev('__G.stepFrames(3); 1'); const dec = (await st()).decoys;
    await tap('t-ping'); await ev('__G.stepFrames(3); 1'); const ping = (await st()).pingCd;
    const wireOff = !(await shown('t-wl')) && !(await shown('t-wr'));
    await tap('t-fire'); if (await ev('__G.game.confirmT>0')) await tap('t-fire');   // an unclassified contact ahead: the first press warns
    await ev('__G.stepFrames(3); 1'); await frames(3); s = await st();
    note(sil1 === true && sil2 === false && dec === 3 && ping > 0 && s.torps === 1 && s.tubes === 5 && wireOff && await shown('t-wl') && await shown('t-wr') && await ev('document.getElementById("t-fire").dataset.n') === '5' && await ev('document.getElementById("t-decoy").dataset.n') === '3',
      at + ': Silent, Decoy, Ping and Fire work, the counts show on the buttons, and the Wire buttons appear with the torpedo', { sil1, sil2, dec, ping, torps: s.torps, tubes: s.tubes, wireOff });
    await ev('__G.input.throttle=2; __G.stepFrames(240); 1'); await frames(4);
    await clear('with a torpedo on its wire');
    if (first) await shot('h16-torpedo-in-the-water-844');
    // with the wire live, a course that needs a long hard turn is drawn in red and says so
    s = await st();
    const hard = (s.hdg + 150) % 360;
    await dragTo(s.boat, hard, 90); await frames(4);
    const warn = await ev('({cuts:__G.table.cuts(' + ((90 - hard) * Math.PI / 180) + '),label:__G.map.rects.map(r=>r[4]).filter(t=>/^Course /.test(t)),easy:__G.table.cuts(__G.sim.state.player.h+0.2)})');
    if (first) await shot('h16b-course-would-cut-the-wire-844');
    await ev('document.getElementById("mapc").dispatchEvent(new PointerEvent("pointercancel",{pointerId:1,bubbles:true})); 1'); await touch('touchCancel', []); await sleep(120);
    note(s.wire > 0 && s.speed > 3 && warn.cuts === true && warn.easy === false && /hard turn will cut the wire/.test(warn.label[0] || '') && angDiff((await st()).course, s.course) < 0.01,
      at + ': with a torpedo on its wire, the course line warns that a hard turn will cut it (a small turn does not), and a cancelled drag orders nothing', { warn, speed: s.speed });

    // depth: the step buttons, then a drag on the gauge
    const d0 = (await st()).depthCmd; await tap('tb-down'); const d1 = (await st()).depthCmd; await tap('tb-up'); await tap('tb-up'); const d2 = (await st()).depthCmd;
    const ds = await rect('dslide'); await touch('touchStart', [{ x: ds.x, y: ds.t + ds.h * 0.8 }]); await sleep(80); await touch('touchEnd', []); await sleep(120);
    const d3 = (await st()).depthCmd;
    note(d1 === Math.floor(d0 / 10) * 10 + 10 && d2 === d1 - 20 && d3 > 110 && await txt('tb-depth') !== '' && /^\d+ m$/.test(await ev('document.querySelector("#dslide .cap").textContent')), at + ': Deeper and Shallower order a depth 10 m at a time, and the gauge can be dragged', { d0, d1, d2, d3 });
    await ev('__G.input.depthCmd=60; 1');

    // the menu
    await tap('tb-menu'); await frames(3); const m1 = (await st()).menu && await shown('tmenu');
    if (first) await shot('h14-menu-open-844');
    const mt = await ev(H_TARGETS), mo = await ev('__h.overlaps(["tmenu","tbar","acts","dslide","tb-up","tb-down"])');
    await tap('tm-time'); const tm = [(await st()).warp, await txt('tm-time'), await txt('alert')];
    await tap('tm-wf'); const wf1 = (await st()).wf; await tap('tm-wf'); const wf2 = (await st()).wf;
    await tap('tm-mast'); const mast = await txt('alert');
    await tap('tb-menu'); await frames(2); const m2 = (await st()).menu || await shown('tmenu');
    await tap('tb-menu'); await tapAt(turned.boat[0], turned.boat[1] + 70); const m3 = (await st()).menu;
    note(m1 && !m2 && !m3 && mo.length === 0 && mt.filter(b => /^tm-/.test(b.id)).length === 8 && mt.every(b => b.w >= 40 && b.h >= 40 && b.hit) && tm[1] === 'Time ' + tm[0] + '\u00d7' && wf1 === true && wf2 === false && /mast|Mast/.test(mast),
      at + ': the menu opens and closes (its button, or a touch on the plot); its eight buttons are at least 40 px, and Bearings and Mast answer', { m1, m2, m3, mo, tm, mast });
    await ev('__G.setWarp(1,true); __G.setMast(false); 1');
    // the objective card
    await tap('tb-obj'); await frames(2); const ob = [(await st()).obj, await shown('brief'), await txt('h-obj')]; await tap('tb-obj'); await frames(2);
    note(ob[0] && ob[1] && ob[2].length > 10 && !(await st()).obj && !(await shown('brief')), at + ': a tap on the mission name opens the objective card, and another closes it', ob);

    // the small window goes to full 3D, which is the sideways phone layout; Plot comes back to the table
    await tap('tb-inset'); await frames(6); await sleep(300);
    const full = await st(), fo = await ev('__h.overlaps(' + JSON.stringify(TOUCH.concat(['brief', 'gauges', 'ring', 'alert'])) + ')');
    if (first) await shot('h17-full-3d-with-plot-button-844');
    await tap('t-map'); await frames(6); await sleep(300);
    const again = await st();
    note(!full.on && !full.map && !/\btable\b/.test(full.cls) && full.btn === 'Plot' && full.scene[2] === w && full.scene[3] === h && full.view[0] === w && full.view[1] === h && fo.length === 0 && again.on && again.btn === '3D' && again.view[0] === again.inset[2] && again.scene[2] === again.inset[2],
      at + ': a tap on the small window goes to full 3D with a Plot button, and Plot comes back to the table', { full: { on: full.on, btn: full.btn, scene: full.scene, view: full.view }, fo, again: { on: again.on, btn: again.btn, scene: again.scene } });
    // the periscope is a full-screen view too, and it comes back to the table
    await ev('__G.input.depthCmd=9; for(let i=0;i<1500&&__G.sim.state.player.depth>10.5;i++) __G.stepFrames(1); 1');
    await tap('t-scope'); await frames(4); const sc = await ev('({scope:__G.game.scope,table:__G.table.on,view:__G.table.view})'); await tap('t-scope'); await frames(4);
    note(sc.scope && !sc.table && sc.view[0] === w && (await st()).on, at + ': Scope opens the periscope over the whole screen, and closing it comes back to the table', sc);

    // the damage panel
    await ev(G_HIT); await frames(4);
    await tap('tb-dmg'); await frames(4); s = await st();
    const dp = await ev('({dp:__h.rect("dpanel"),o:__h.overlaps(["dpanel","tbar","acts","dslide","tb-up","tb-down","alert"]),tag:document.getElementById("tb-dtag").textContent,mini:Array.from(document.querySelectorAll("#dsil3 .c")).map(c=>c.className)})');
    const dt = (await ev(H_TARGETS)).filter(b => !/^(m-|tb-inset)/.test(b.id)), dcov = await ev('__h.boxHit([' + [s.boat[0] - 12, s.boat[1] - 12, s.boat[0] + 12, s.boat[1] + 12].join(',') + '],["dpanel","alert"])');
    if (first) await shot('h15-damage-panel-open-844');
    await ev('document.querySelectorAll("#dsil2 .c")[3].click(); __G.stepFrames(3); 1'); const team = await ev('__G.sim.state.dmg.team');
    await tap('dp-close'); await frames(2);
    note(s.dmg && dp.o.length === 0 && dp.dp.b <= h && dp.dp.r <= w && dp.dp.l >= 0 && dcov.length === 0 && dt.every(b => b.w >= 40 && b.h >= 40 && b.hit) && dt.filter(b => /^dp-/.test(b.id)).length === 2 && dp.tag === 'Fire' && /fire/.test(dp.mini[1]) && team === 3 && !(await st()).dmg,
      at + ': a tap on the damage picture opens the damage panel; it stays clear of the bar, the buttons, the depth column and the boat, its buttons are at least 40 px and in reach, and a section can be given the team', { dp, dcov, team, small: dt.filter(b => b.w < 40 || b.h < 40 || !b.hit) });

    // Quit asks first, then goes to the title, where the 3D picture fills the screen again
    await tap('tb-menu'); await tap('tm-quit'); const q1 = [await txt('tm-quit'), (await st()).running]; await tap('tm-quit'); await frames(4);
    const q2 = await ev('({running:__G.game.running,title:!document.getElementById("title").hidden,table:__G.table.on,cls:document.body.className,view:__G.table.view})');
    note(q1[0] === 'Quit?' && q1[1] === true && !q2.running && q2.title && !q2.table && !/\btable\b/.test(q2.cls) && q2.view[0] === w && q2.view[1] === h, at + ': Quit in the menu asks first, then goes back to the title screen', { q1, q2 });
    // the help card has the tabletop section
    await ev('document.getElementById("b-how").click(); 1'); await frames(2);
    const ht = await ev('(function(){ const r=document.querySelector("#h-table h3").getBoundingClientRect(); return [Math.round(r.top),Math.round(r.bottom)]; })()');
    note(await shown('h-table') && /Drag a finger across the plot/.test(await txt('h-table')) && ht[0] >= 0 && ht[1] < h, at + ': the help card opens at its Tabletop controls section', ht);
    if (first) await shot('h21-help-tabletop-844');
    await ev('document.getElementById("b-help-close").click(); 1');
  }

  // the exercise: its prompts name the tabletop's controls, sit at the top of the plot and stay off the boat; a course dragged onto the buoy does the first step
  { const w = 844, h = 390, at = '844x390';
    await size(w, h, true); await open('?test=1&seed=7&table=1&mission=shakedown'); await ev(HELPERS);
    await ev('__G.start(7,"shakedown"); __G.stepFrames(30); 1'); await frames(6); await sleep(300);
    const s = await st(), line = await txt('alert'), key0 = await ev('__G.sim.state.coach&&__G.sim.state.coach.key');
    const o = await ev('__h.overlaps(' + JSON.stringify(H_SOLID) + ')'), cov = await ev('__h.boxHit([' + [s.boat[0] - 12, s.boat[1] - 12, s.boat[0] + 12, s.boat[1] + 12].join(',') + '],' + JSON.stringify(H_SOLID) + ')'), al = await ev('__h.rect("alert")');
    await shot('h20-exercise-prompt-844');
    note(key0 === 'steer' && /Drag a finger from the boat/.test(line) && o.length === 0 && cov.length === 0 && al.t >= 54 && al.b < s.boat[1] - 20, at + ': the exercise prompt names the course drag, sits at the top of the plot and does not cover the boat', { line, o, cov, alert: [al.t, al.b], boat: s.boat });
    const buoy = await ev('(function(){ const r=__G.map.rects.find(q=>/^Marker/.test(q[4])); return r?r[4]:null; })()');
    const brg = await ev('(function(){ const st=__G.sim.state, p=st.player, m=st.marks[0]; return m?(450-Math.atan2(-(m.z-p.z),m.x-p.x)*180/Math.PI)%360:null; })()');
    if (brg !== null) { await dragTo(s.boat, brg, 90); await touch('touchEnd', []); await sleep(150); await ev('__G.input.throttle=2; for(let i=0;i<5400&&__G.sim.state.coach&&__G.sim.state.coach.key==="steer";i++) __G.stepFrames(1); 1'); await frames(3); }
    const key1 = await ev('__G.sim.state.coach&&__G.sim.state.coach.key');
    note(!!buoy && brg !== null && key1 !== 'steer', at + ': the buoy is named on the plot, and a course dragged onto it takes the boat there and moves the exercise on', { buoy, brg, key1, line: await txt('alert') });
  }

  // the pause and result cards over the tabletop, and starting again from each
  { const w = 844, h = 390, at = '844x390';
    await size(w, h, true); await open('?test=1&seed=7&table=1'); await ev(HELPERS);
    await ev('__G.start(7); __G.stepFrames(30); 1'); await frames(3);
    const s = await st(); await dragTo(s.boat, 200, 90); await touch('touchEnd', []); await sleep(150); const had = (await st()).course !== null;
    // the picked contact is lost while its read-out is open: the read-out goes away by itself, and nothing breaks
    await ev('__G.input.throttle=1; for(let i=0;i<3000&&!__G.sim.state.tracks.length;i++) __G.stepFrames(1); __G.stepFrames(30); 1'); await frames(4);
    const pick = await ev('(function(){ const h=__G.table.hits[0], b=__G.table.boat; return h?{id:h.id,x:h.firm?h.x:b[0]+Math.cos(h.brg)*60,y:h.firm?h.y:b[1]-Math.sin(h.brg)*60}:null; })()');
    if (pick) await tapAt(pick.x, pick.y); await frames(4);
    const up = await shown('tb-con') && (await st()).sel === (pick && pick.id);
    await ev('(function(){ const q=__G.sim.state; q.tracks.length=0; q.btracks.length=0; q.contacts.length=0; })(); 1'); await frames(4);
    note(up && !(await shown('tb-con')), at + ': when the picked contact is lost, its read-out goes away by itself', { pick, up, hits: await ev('__G.table.hits.length') });
    await tap('tb-menu'); await tap('tm-pause'); await frames(3);
    let cd = await ev('__h.card("pause","b-resume")'); const pz = cd.shown && cd.inside && cd.button && cd.small.length === 0; await tap('b-restart'); await frames(4);
    const fresh = await st();
    const won = await ev('__h.play(900)'); await ev('__G.effects.showResult(); 1'); await frames(4);
    cd = await ev('__h.card("result","b-retry")');
    await shot('h22-result-over-the-table-844');
    await tap('b-retry'); await frames(6); await sleep(300); const again = await st();
    note(had && pz && fresh.on && fresh.course === null && !fresh.paused && won.result === 'win' && cd.shown && cd.inside && cd.button && cd.small.length === 0 && again.running && again.on && await ev('document.getElementById("result").hidden'),
      at + ': the pause and result cards fit over the table; Restart starts again on the table with no course left over, and so does Play again', { had, pz, fresh: { on: fresh.on, course: fresh.course }, won: won.result, cd, again: { on: again.on } });
  }

  // the real loop, no test hook: a drag orders a course and the boat comes round to it by itself
  { const w = 844, h = 390;
    await size(w, h, true); await open('?seed=7&mission=firstblood&table=1');
    await ev('try{ sessionStorage.removeItem("ss-upright"); }catch(e){} 1');
    await tap('b-start'); await sleep(1200);
    await tap('tb-fast'); await sleep(200);
    const hd0 = +(await txt('tb-hdg')), want = (hd0 + 50) % 360;
    const boat = await ev('(function(){ const s=getComputedStyle(document.getElementById("hud")); return [parseFloat(s.getPropertyValue("--cx")),parseFloat(s.getPropertyValue("--cy"))]; })()');
    await dragTo(boat, want, 100); await touch('touchEnd', []); await sleep(300);
    const said = await txt('alert'), ordered = +(said.match(/Course (\d{3}) ordered/) || [0, -999])[1];
    let now = hd0; for (let i = 0; i < 80; i++) { await sleep(500); now = +(await txt('tb-hdg')); if (angDiff(now, ordered) <= 2) break; }
    await sleep(1500); now = +(await txt('tb-hdg'));
    note(await txt('tb-thr') === 'Half' && angDiff(ordered, want) <= 3 && angDiff(now, ordered) < 5 && angDiff(now, hd0) > 35, 'tabletop, real loop: a drag orders a course and the boat turns onto it and holds it, to within 5 degrees', { from: hd0, ordered, now, said });
    // in full 3D the helmsman keeps the ordered course until the thumb pad takes the boat back; after that the boat stays where the pad left it
    await tap('tb-inset'); await sleep(1500);
    const held = +(await txt('g-hdg')), pad = await rect('pad');
    await touch('touchStart', [{ x: pad.x, y: pad.y }]); await sleep(150);
    await touch('touchMove', [{ x: pad.x + pad.w * 0.4, y: pad.y }]); await sleep(4000);
    const padded = +(await txt('g-hdg')); await touch('touchEnd', []); await sleep(2500);
    const after = +(await txt('g-hdg'));
    await tap('t-map'); await sleep(400);
    const tableBack = await ev('document.body.classList.contains("table")'), onTable = +(await txt('tb-hdg'));
    note(angDiff(held, ordered) < 5 && angDiff(padded, ordered) > 12 && angDiff(after, ordered) > 12 && angDiff(after, padded) < 12 && tableBack && angDiff(onTable, after) < 4,
      'tabletop, real loop: in full 3D the ordered course is held until the thumb pad steers; the boat then stays on the pad\'s heading, back on the table too', { ordered, held, padded, after, onTable, tableBack });
    // Pause from the menu
    await tap('tb-menu'); await tap('tm-pause'); await sleep(300);
    note(await ev('!document.getElementById("pause").hidden&&document.getElementById("tmenu").hidden'), 'tabletop, real loop: Pause in the menu pauses the game');
    await tap('b-resume'); await sleep(200);
  }

  // upright: the turn-sideways card still shows, and "Play upright anyway" gives the same table, stacked
  { const w = 390, h = 844, at = '390x844';
    await size(w, h, true); await open('?seed=7&mission=firstblood&table=1'); await ev(HELPERS.replace(/__G\./g, 'window.__none.'));
    const card = await ev('!document.getElementById("rotate").hidden');
    await shot('h18-upright-turn-sideways-card-390');
    await tap('b-upright'); await sleep(300); const gone = await ev('document.getElementById("rotate").hidden');
    await tap('b-start'); await sleep(1500);
    const o = await ev('__h.overlaps(' + JSON.stringify(H_SOLID) + ')'), tg = await ev(H_TARGETS), cls = await ev('document.body.className');
    const boat = await ev('(function(){ const s=getComputedStyle(document.getElementById("hud")); return [parseFloat(s.getPropertyValue("--cx")),parseFloat(s.getPropertyValue("--cy"))]; })()');
    const cov = await ev('__h.boxHit([' + [boat[0] - 12, boat[1] - 12, boat[0] + 12, boat[1] + 12].join(',') + '],' + JSON.stringify(H_SOLID) + ')');
    const small = tg.filter(b => b.w < 40 || b.h < 40), off = tg.filter(b => b.l < 0 || b.t < 0 || b.r > w || b.b > h);
    await shot('h19-upright-table-390');
    note(card && gone && /\btable\b/.test(cls) && /\btall\b/.test(cls) && o.length === 0 && small.length === 0 && off.length === 0 && cov.length === 0 && tg.length >= 12,
      at + ': upright, the turn-sideways card shows; "Play upright anyway" gives the stacked table, with nothing overlapping and every tap target at least 40 px', { card, gone, cls, o, small, off, cov, sizes: tg.map(b => b.id + ' ' + b.w + 'x' + b.h).join(', ') });
    const hd0 = +(await txt('tb-hdg')), want = (hd0 + 310) % 360;
    await dragTo(boat, want, 90); await touch('touchEnd', []); await sleep(300);
    const said = await txt('alert');
    note(angDiff(+(said.match(/Course (\d{3}) ordered/) || [0, -999])[1], want) <= 3, at + ': upright, a drag on the plot orders a course', said);
    await ev('try{ sessionStorage.removeItem("ss-upright"); }catch(e){} 1');
  }
}

// Stage I: fire control. The Solution box (grade, range, course and speed with their errors, the held values, Auto and Restart fit, the bearing residuals),
// the torpedo settings, and the orders to a torpedo on its wire (Next, Retarget, Reject) with the seeker view. On the desktop first, then on the phone tabletop.
// The boat is driven by staged steering (it zigzags across the line of sight); everything that is checked is read from the screen or from fire control's own track.
const I_HELPERS = `
window.__i={
  k(){ const G=__G, st=G.sim.state; return st.tracks.find(k=>k.id===G.game.sel)||st.tracks[0]||null; },
  // what fire control holds on the contact, beside the truth it never sees
  sol(){ const k=this.k(); if(!k) return null; const st=__G.sim.state, p=st.player, q=k.sol, s=st.ships.find(x=>x.id===k.id), deg=a=>a===null?null:Math.round(((90-a*180/Math.PI)%360+360)%360);
    return {id:k.id,t:Math.round(st.t),grade:q.g,range:q.r===null?null:Math.round(q.r),sigma:q.r===null?null:Math.round(q.rs),course:deg(q.c),knots:q.v===null?null:+(q.v/0.5144).toFixed(1),holdC:deg(k.holdC),holdS:k.holdS===null?null:+(k.holdS/0.5144).toFixed(1),
      obs:k.obs.length,from:Math.round(k.from),turnAgo:Math.round(st.t-k.turnT),trueRange:s?Math.round(Math.hypot(s.x-p.x,s.z-p.z)):null,trueCourse:s?deg(s.h):null,over:st.over}; },
  // listen for a while: on a steady course, or zigzagging across the line of sight, until a condition holds
  listen(sec,zig,stop){ const G=__G, st=G.sim.state, p=st.player, s=st.ships[0]; G.input.depthCmd=30; G.input.throttle=2; let n=0;
    while(n<sec*30&&!st.over&&!(stop&&stop(this.k(),st))){ G.input.rudder=zig?Math.max(-1,Math.min(1,-__h.wrap(Math.atan2(-(s.z-p.z),s.x-p.x)+1.05*(Math.floor(st.t/70)%2?1:-1)-p.h)*3)):0; G.stepFrames(1); n++; }
    G.input.rudder=0; return this.sol(); },
  ink(id){ const c=document.getElementById(id); if(!c.width||!c.height) return {all:0,amber:0}; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let all=0, amber=0;
    for(let i=0;i<d.length;i+=4) if(d[i+3]>40){ all++; if(d[i]>220&&d[i+1]>150&&d[i+1]<215&&d[i+2]<120) amber++; } return {all:all,amber:amber}; },
  txt(id){ const el=document.getElementById(id), r=el.getBoundingClientRect(); return r.width>0&&r.height>0?el.textContent:null; },
  // the Solution box as it reads on the screen (null for anything not showing)
  box(){ return {who:this.txt('fc-who'),grade:this.txt('fc-grade'),range:this.txt('fc-r'),course:this.txt('fc-c'),speed:this.txt('fc-s'),note:this.txt('fc-note'),dots:this.ink('fc-res').all,rect:__h.rect('fc')}; },
  // the torpedo panel as it reads on the screen
  wpn(){ const st=__G.sim.state, p=st.player, s=st.seeker; return {shown:__h.rect('wpn').w>0,state:this.txt('wp-state'),lock:this.txt('wp-lock'),sum:this.txt('wp-sum'),fan:this.ink('wp-fan'),wire:p.wireId,phase:s?s.phase:null,
    own:st.torps.filter(t=>t.side===0).map(t=>({id:t.id,phase:t.phase,wire:t.wire,launch:t.launch,deep:t.deep,pat:t.pat,aimed:t.aimed,speed:+t.speed.toFixed(1),run:Math.round(t.run),enable:Math.round(t.enable),rej:t.rej.slice()})),
    off:['wp-next','wp-ret','wp-rej'].filter(id=>document.getElementById(id).classList.contains('off'))}; },
  set(){ return {shown:__h.rect('tset').w>0,on:Array.from(document.querySelectorAll('#tset button[aria-pressed="true"]')).filter(b=>b.getBoundingClientRect().width>0).map(b=>b.textContent),note:this.txt('ts-note'),input:[__G.input.launch,__G.input.enable,__G.input.runDepth,__G.input.search]}; },
  // the true ship is turned by hand, and time runs until fire control says so (or the time is up)
  turn(by,sec){ const G=__G, st=G.sim.state, p=st.player, s=st.ships[0], k=this.k(), h=s.h+by, t0=st.t; let n=0;
    while(n<sec*30&&!st.over&&!(k.turnT>t0)){ s.h=h; G.input.rudder=Math.max(-1,Math.min(1,-__h.wrap(Math.atan2(-(s.z-p.z),s.x-p.x)+1.05*(Math.floor(st.t/70)%2?1:-1)-p.h)*3)); G.stepFrames(1); n++; } G.input.rudder=0; return {waited:+(st.t-t0).toFixed(1),flagged:k.turnT>t0,grade:k.sol.g}; },
  // a noisemaker put 150 m ahead of the torpedo on the wire, and the torpedo locked on to it
  bait(){ const st=__G.sim.state, p=st.player, t=st.torps.find(q=>q.id===p.wireId); if(!t) return null; const dc={id:77000+st.tick,side:1,x:t.x+Math.cos(t.h)*150,z:t.z-Math.sin(t.h)*150,depth:6,life:90};
    st.decoys.push(dc); t.phase='bait'; t.bait=dc.id; t.seen.push(dc.id); __G.stepFrames(30); const s=st.seeker; return {id:dc.id,phase:t.phase,lock:s&&s.lock?{moving:s.lock.moving,mach:s.lock.mach,d:Math.round(s.lock.d)}:null}; },
  // run until every wire is cut (flank speed does it), stopping on the step that cuts
  cut(sec){ const G=__G, st=G.sim.state; G.input.throttle=4; let n=0; while(n<sec*30&&!st.over&&st.torps.some(t=>t.side===0&&t.wire)){ G.stepFrames(1); n++; } G.input.throttle=1; return {waited:+(n/30).toFixed(1),wired:st.torps.filter(t=>t.side===0&&t.wire).length,own:st.torps.filter(t=>t.side===0).length,alert:document.getElementById('alert').textContent}; },
  btn(host,text){ return Array.from(document.querySelectorAll('#'+host+' button')).find(b=>b.firstChild&&b.firstChild.textContent===text); }
};`;
const I_PANELS = ['brief', 'gauges', 'status', 'ring', 'dslide', 'alert', 'keys', 'wpn', 'tset'];
const GRADES = ['None', 'Poor', 'Fair', 'Good'];
async function stageiDesktop() {
  // every key and click first empties the page's message log, so that said() is what the game said in answer (a more urgent message may be holding the alert line)
  const key = async (code, k, vk) => { await ev('__G.said.length=0; 1'); await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk }); await ev('__G.stepFrames(3); 1'); await frames(3); };
  const said = async re => { const a = await ev('__G.said.slice()'); return a.find(m => re.test(m)) || ''; };
  const click = async id => { await ev('__G.said.length=0; 1'); const r = await ev('__h.rect("' + id + '")'); for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: (r.l + r.r) / 2, y: (r.t + r.b) / 2, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }); await ev('__G.stepFrames(3); 1'); await frames(3); };
  const alertText = () => ev('document.getElementById("alert").textContent');
  const fire = async () => { await key('Space', ' ', 32); if (await said(/Press Fire again/)) await key('Space', ' ', 32); await ev('__G.stepFrames(30); 1'); await frames(3); return said(/Torpedo away/); };
  // a fresh game with the contact heard, made the target, and a solution of at least this grade from a zigzag
  const begin = async grade => { await ev('__G.start(7,"firstblood"); (function(){ const st=__G.sim.state, id=st.ships[0].id; __i.listen(60,false,()=>st.tracks.some(k=>k.id===id)); __G.game.sel=id; __G.stepFrames(3); })(); 1'); await frames(3); return ev('__i.listen(420,true,k=>k&&k.sol.g>=' + grade + '&&k.obs.length>30)'); };
  await size(1280, 800, false);
  await open('?test=1&seed=7'); await ev(HELPERS); await ev(I_HELPERS);
  await ev('__G.start(7,"firstblood"); 1'); await frames(3);

  // --- the Solution box: a steady course gives bearings and no range; a zigzag gives a solution ---
  let s0 = await ev('__i.listen(45,false)'); await frames(4);
  let b = await ev('__i.box()');
  note(!!s0 && !!b.grade && /N selects/.test(b.who) && s0.grade <= 1 && b.grade === GRADES[s0.grade] && b.range === 'unknown' && /along the bow/.test(b.note),
    'desktop: with a contact heard, the status panel has a Solution box; after 45 s on a steady course it has bearings but no range, and says Fire would shoot along the bow', { sol: s0, box: b });
  await key('KeyN', 'n', 78);
  b = await ev('__i.box()'); const sel = await ev('__G.game.sel');
  note(sel === s0.id && /target/.test(b.who) && !!(await said(/^Target: .* Fire aims by its solution/)), 'desktop: N makes the contact the target, and the box says so', { box: b, said: await said(/^Target: /) });
  s0 = await ev('__i.listen(120,false,k=>k&&k.sol.g>=1)'); await frames(4); b = await ev('__i.box()');
  note(s0.grade === 1 && b.grade === 'Poor' && s0.grade < 3, 'desktop: on a steady course the solution is graded Poor at best: bearings alone give no range', { sol: s0, box: b });
  await shot('i01-solution-poor-desktop-1280');
  let s1 = await ev('__i.listen(420,true,k=>k&&k.sol.g>=3&&k.obs.length>30)'); await frames(4);
  b = await ev('__i.box()');
  note(s1.grade === 3 && b.grade === 'Good' && /^\d+ m ± \d+$/.test(b.range) && /^\d{3} ± \d+°$/.test(b.course) && /^\d+ kn ± \d+$/.test(b.speed) && b.dots > 60 && /Fire aims by this solution/.test(b.note) && Math.abs(s1.range - s1.trueRange) < 0.3 * s1.trueRange,
    'desktop: zigzagging across the line of sight brings the solution to Good; the box gives range, course and speed with their errors, and the strip of bearing residuals is drawn', { sol: s1, box: b });
  console.log('     contact line: ' + await txt('contact'));
  await shot('i02-solution-good-desktop-1280');
  await ev('__G.setMap(true); 1'); await frames(4);
  const lab = await ev('__G.map.rects.map(r=>r[4]).filter(t=>/Good|Fair|Poor/.test(t))');
  note(lab.length >= 1 && /· (Good|Fair) · \d+ m ± \d+/.test(lab[0]), 'desktop: the plot labels the solution with its grade and range', lab);
  await shot('i03-plot-solution-arrow-desktop-1280');
  await ev('__G.setMap(false); 1'); await frames(3);

  // --- held values, Auto, Restart fit ---
  await click('fc-cp'); let h1 = await ev('__i.sol()'), b1 = await ev('__i.box()'), a1 = await said(/held at \d{3} by hand/);
  await key('Minus', '-', 189); let h2 = await ev('__i.sol()'), b2 = await ev('__i.box()');
  await shot('i04-held-course-and-speed-desktop-1280');
  await ev('__i.listen(45,true)'); await frames(3); const h3 = await ev('__i.sol()'), b3 = await ev('__i.box()');
  note(h1.holdC !== null && / held$/.test(b1.course) && !!a1 && h2.holdS !== null && / kn held$/.test(b2.speed) && h3.holdC === h1.holdC && h3.holdS === h2.holdS && h3.obs > h2.obs && / held$/.test(b3.course),
    'desktop: + holds a course by hand and the - key holds a speed; both read "held", and they stay through 45 s of new bearings', { course: [s1.course, h1.holdC, b1.course, a1], speed: [s1.knots, h2.holdS, b2.speed], after: [h3.holdC, h3.holdS, b3.course, b3.speed] });
  await key('KeyO', 'o', 79); const h4 = await ev('__i.sol()'), b4 = await ev('__i.box()'), a4 = await said(/automatic/);
  note(h4.holdC === null && h4.holdS === null && !/held/.test(b4.course + b4.speed) && !!a4, 'desktop: O (Auto) hands course and speed back to fire control', { box: b4, alert: a4 });
  await key('KeyU', 'u', 85); const h5 = await ev('__i.sol()'), b5 = await ev('__i.box()'), a5 = await said(/Fit restarted/);
  note(h5.from >= h4.t && h5.grade < 3 && !!a5, 'desktop: U (Restart fit) drops the old bearings: the grade falls and builds again', { sol: h5, box: b5, alert: a5 });

  // --- "may have turned" (a fresh game: the long listen above has brought the frigate close) ---
  s1 = await begin(3);
  const tn = await ev('__i.turn(1.05,120)'); await frames(4); b = await ev('__i.box()');
  note(tn.flagged && /may have turned/.test(b.note), 'desktop: the target turns 60 degrees: the box flags "Target may have turned" and the fit starts again', { turn: tn, box: b });
  await shot('i05-target-may-have-turned-desktop-1280');

  // --- Settings ---
  await key('KeyI', 'i', 73); let se = await ev('__i.set()');
  note(se.shown && se.on.join() === 'Torpedo,Swim-out,Auto,Shallow,Straight' && /Seeker enables after/.test(se.note) && /Swim-out · Auto · Shallow · Straight/.test(await txt('wp-sum')), 'desktop: I opens the torpedo settings, with the defaults chosen and a line on what a launch now would do', se);
  await ev('__i.btn("tset","Deep").click(); __i.btn("tset","Snake").click(); __i.btn("tset","Long").click(); 1'); await frames(3); se = await ev('__i.set()');
  const over = await ev('__h.overlaps(' + JSON.stringify(I_PANELS) + ')');
  note(se.input.join() === '0,2,1,1' && se.on.join() === 'Torpedo,Swim-out,Long,Deep,Snake' && /Long · Deep · Snake/.test(await txt('wp-sum')) && over.length === 0, 'desktop: choosing Long, Deep and Snake sets them, the summary follows, and the pop-up overlaps no panel', { se, over });
  await shot('i06-settings-desktop-1280');
  await ev('__i.btn("tset","Shallow").click(); __i.btn("tset","Straight").click(); __i.btn("tset","Auto").click(); 1'); await key('KeyI', 'i', 73);
  await key('Digit5', '5', 53); const a6 = await said(/Launch: Impulse/); await key('Digit5', '5', 53);
  note(!(await ev('__i.set()')).shown && !!a6 && await ev('__G.input.launch') === 0, 'desktop: I closes the settings; the 5 key steps Launch to Impulse and back', a6);

  // --- a Swim-out launch aimed by the solution; a second torpedo; Next torpedo ---
  s1 = await begin(2);
  const plan = await ev('(function(){ const m=__G.sim.plan(__G.game.sel,0,0,0), p=__G.sim.state.player; return {aimed:m.aimed,lead:+__h.wrap(m.h-p.h).toFixed(3),enable:Math.round(m.enable),beyond:m.beyond}; })()');
  const f1 = await fire(); let w = await ev('__i.wpn()');
  note(w.own.length === 1 && w.own[0].launch === 0 && w.own[0].aimed && w.own[0].speed < 12 && /aimed by the solution/.test(f1) && !/loud/.test(f1) && w.shown && /enables in/.test(w.state) && plan.aimed && await txt('w-state') === 'Guiding' && !s1.over,
    'desktop: Fire with a target launches a Swim-out torpedo aimed by the solution; it leaves slowly, and the torpedo panel opens its seeker view', { sol: s1, plan, said: f1, wpn: w });
  await key('Digit5', '5', 53); await ev('__G.stepFrames(30*4); 1');
  const f2 = await fire(); w = await ev('__i.wpn()');
  note(w.own.length === 2 && w.own[1].launch === 1 && w.wire === w.own[1].id && /impulse launch is loud/.test(f2) && /^2 of 2/.test(w.state), 'desktop: a second torpedo, launched by Impulse, takes the wire orders: the newest is chosen', { said: f2, wpn: w });
  await key('KeyJ', 'j', 74); const w2 = await ev('__i.wpn()'), a7 = await said(/Wire orders/);
  note(w2.wire === w.own[0].id && /torpedo 1 of 2/.test(a7) && /^1 of 2/.test(w2.state), 'desktop: J (Next torpedo) passes the wire orders to the other torpedo', { said: a7, wpn: w2.state });
  // with no contact selected, Retarget is refused and says why
  { const keep = await ev('__G.game.sel'); await ev('__G.game.sel=0; 1'); await key('KeyK', 'k', 75); const no = await said(/Retarget refused: select a contact first/); await ev('__G.game.sel=' + keep + '; 1'); note(!!no, 'desktop: Retarget with no contact selected is refused with a message', no); }

  // --- Retarget, the seeker view on a noisemaker lock, Reject ---
  await key('KeyK', 'k', 75); const w3 = await ev('__i.wpn()'), a8 = await said(/sent to the selected contact/);
  note(w3.phase === 'transit' && /in transit/.test(w3.state) && /listens to nothing/.test(w3.lock) && !!a8, 'desktop: K (Retarget) sends the torpedo to the selected contact; it is in transit and listens to nothing on the way', { said: a8, wpn: w3 });
  await ev('(function(){ const st=__G.sim.state, t=st.torps.find(q=>q.id===st.player.wireId); for(let i=0;i<30*40&&t&&t.run<330&&!st.over;i++) __G.stepFrames(1); })(); 1');   // past the 300 m at which it arms
  const bt = await ev('__i.bait()'); await frames(4); const w4 = await ev('__i.wpn()');
  note(!!bt && !!bt.lock && !bt.lock.moving && !bt.lock.mach && /^Lock: stationary, no machinery · \d+ m$/.test(w4.lock) && /homing/.test(w4.state) && w4.fan.amber > 20 && !w4.off.includes('wp-rej') && await txt('w-state') === 'Homing',
    'desktop: the torpedo locks on to a noisemaker: the seeker view rings the lock and reads "stationary, no machinery"', { bait: bt, wpn: w4 });
  await ev('__G.setMap(true); 1'); await frames(4);
  note((await ev('__h.overlaps(' + JSON.stringify(I_PANELS.concat(['mapbar'])) + ')')).length === 0, 'desktop: with the map and the seeker view open, no panels overlap', await ev('__h.rect("wpn")'));
  await shot('i07-seeker-view-decoy-lock-desktop-1280');
  await key('KeyL', 'l', 76); const w5 = await ev('__i.wpn()'), a9 = await said(/Lock rejected/);
  const mine = w5.own.find(t => t.id === w5.wire);
  note(!!mine && mine.rej.includes(bt.id) && mine.phase !== 'bait' && /^No lock|Seeker/.test(w5.lock) && !!a9 && w5.off.includes('wp-rej'), 'desktop: L (Reject) makes it leave the noisemaker and search again; Reject then shows as unavailable', { said: a9, wpn: w5 });
  await shot('i08-reject-desktop-1280');
  await key('KeyL', 'l', 76); const a10 = await said(/Nothing to reject/);
  note(!!a10, 'desktop: Reject with no lock is refused with a message', a10);
  await ev('__G.setMap(false); 1'); await frames(3);

  // --- a cut wire: every wire order shows as unavailable, and says why ---
  await ev('__G.said.length=0; 1'); const ct = await ev('__i.cut(40)'); await frames(4); const w6 = await ev('__i.wpn()'); ct.said = await said(/Wire cut: weapon on its own/);
  await key('KeyK', 'k', 75); const a11 = await said(/No torpedo is on its wire/);
  await key('KeyJ', 'j', 74); const a12 = await said(/No torpedo is on its wire/);
  note(ct.wired === 0 && (ct.own === 0 || (!!ct.said && w6.lock === 'Wire cut: weapon on its own.' && w6.off.length === 3 && await txt('w-state') === 'Cut')) && !!a11 && !!a12,
    'desktop: flank speed cuts the wires: "Wire cut: weapon on its own", the three orders show as unavailable, and K and J are refused with a message', { cut: ct, wpn: w6, said: [a11, a12] });
  // a new game puts everything back
  await ev('__G.setSettings(true); __G.input.search=2; __G.start(7,"firstblood"); __G.stepFrames(5); 1'); await frames(3);
  const fresh = await ev('({sel:__G.game.sel,fc:__G.fc,input:[__G.input.launch,__G.input.enable,__G.input.runDepth,__G.input.search],tset:__h.rect("tset").w,seek:__h.rect("wp-seek").w})');
  note(fresh.sel === 0 && !fresh.fc.set && fresh.input.join() === '0,0,0,0' && fresh.tset === 0 && fresh.seek === 0, 'desktop: a new game starts with no target, the default torpedo settings and nothing open', fresh);
}
// the same on the phone tabletop, with real touches
async function stageiTable() {
  const touch = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id || 1 })) });
  const tapAt = async (x, y) => { await ev('__G.said.length=0; 1'); await touch('touchStart', [{ x, y }]); await sleep(60); await touch('touchEnd', []); await sleep(140); await ev('__G.stepFrames(3); 1'); await frames(3); };
  const tap = async id => { const r = await ev('__h.rect("' + id + '")'); await tapAt((r.l + r.r) / 2, (r.t + r.b) / 2); };
  const said = async re => { const a = await ev('__G.said.slice()'); return a.find(m => re.test(m)) || ''; };
  const fire = async () => { await tap('t-fire'); if (await said(/Press Fire again/)) await tap('t-fire'); await ev('__G.stepFrames(30); 1'); await frames(4); return said(/Torpedo away/); };
  const tapBtn = async (host, text) => { const r = await ev('(function(){ const r=__i.btn("' + host + '","' + text + '").getBoundingClientRect(); return [r.left+r.width/2,r.top+r.height/2]; })()'); await tapAt(r[0], r[1]); };
  const alertText = () => ev('document.getElementById("alert").textContent');
  for (const [w, h, at, first] of [[844, 390, '844x390', true], [932, 430, '932x430', false]]) {
    await size(w, h, true); await open('?test=1&seed=7&table=1'); await ev(HELPERS); await ev(I_HELPERS);
    await ev('__G.start(7,"firstblood"); 1'); await frames(3);
    const clear = async (what, least) => {
      const ids = H_SOLID, o = await ev('__h.overlaps(' + JSON.stringify(ids) + ')'), tg = await ev(H_TARGETS), bt = await ev('__G.table.boat'), cov = await ev('__h.boxHit([' + [bt[0] - 12, bt[1] - 12, bt[0] + 12, bt[1] + 12].join(',') + '],' + JSON.stringify(ids) + ')');
      const small = tg.filter(b => b.w < 40 || b.h < 40), off = tg.filter(b => b.l < 0 || b.t < 0 || b.r > w || b.b > h || !b.hit);
      note(o.length === 0 && small.length === 0 && off.length === 0 && cov.length === 0 && tg.length >= (least || 12), at + ': ' + what + ': nothing overlaps, every tap target is at least 40 px, on the screen and not covered, and nothing covers the boat', { o, small, off, cov, n: tg.length, sizes: tg.map(b => b.id + ' ' + b.w + 'x' + b.h).join(', ') });
    };
    // a tap on the contact makes it the target; a tap on the strip opens the Solution card
    await ev('__i.listen(60,false,k=>k&&k.sol.g>=1)'); await frames(4);
    const hit = await ev('(function(){ const h=__G.table.hits[0], b=__G.table.boat; if(!h) return null; return {id:h.id,x:h.firm?h.x:b[0]+Math.cos(h.brg)*60,y:h.firm?h.y:b[1]-Math.sin(h.brg)*60,ox:b[0]-Math.cos(h.brg)*50,oy:b[1]+Math.sin(h.brg)*50}; })()');
    if (hit) await tapAt(hit.x, hit.y);
    const chip = await txt('tb-cong');
    await tap('tb-conh'); let b = await ev('__i.box()'), s0 = await ev('__i.sol()'), fc = await ev('__G.fc');
    const steps = await ev('["fc-cm","fc-cp","fc-sm","fc-sp","fc-auto","fc-restart"].map(id=>__h.rect(id))');
    note(!!hit && await ev('__G.game.sel') === hit.id && /^Solution (None|Poor) ▸$/.test(chip) && fc.open && await txt('tb-cong') === 'Solution ' + GRADES[s0.grade] + ' ▾' && s0.grade <= 1 && b.range === 'unknown' && steps.every(q => q.w >= 44 && q.h >= 44) && b.rect.r <= w && b.rect.b <= h && b.rect.t >= 0,
      at + ': a tap on the contact makes it the target, the strip shows the grade, and a tap on the strip opens the Solution card with - and + of at least 44 px', { chip, box: b, sol: s0, steps: steps.map(q => q.id + ' ' + q.w + 'x' + q.h).join(', ') });
    await clear('with the Solution card open');
    if (first) await shot('i09-solution-card-poor-table-844');
    let s1 = await ev('__i.listen(420,true,k=>k&&k.sol.g>=3&&k.obs.length>30)'); await frames(4); b = await ev('__i.box()');
    note(s1.grade === 3 && /^\d+ m ± \d+$/.test(b.range) && /^\d{3} ± \d+°$/.test(b.course) && b.dots > 40 && /^Solution Good ▾$/.test(await txt('tb-cong')), at + ': after a zigzag the card reads Good, with range, course and speed and the residual strip', { sol: s1, box: b });
    await clear('with a Good solution on the card');
    if (first) await shot('i10-solution-card-good-table-844');
    // held values and Auto, by touch; a drag on the plot still only orders a course
    await tap('fc-cp'); const h1 = await ev('__i.sol()'), b1 = await ev('__i.box()');
    await tap('fc-sm'); const h2 = await ev('__i.sol()'), b2 = await ev('__i.box()');
    await tap('fc-auto'); const h3 = await ev('__i.sol()'), b3 = await ev('__i.box()');
    note(h1.holdC !== null && / held$/.test(b1.course) && h2.holdS !== null && / kn held$/.test(b2.speed) && h3.holdC === null && h3.holdS === null && !/held/.test(b3.course + b3.speed), at + ': + holds a course, - holds a speed, and Auto clears both', { held: [b1.course, b2.speed], auto: [b3.course, b3.speed] });
    {
      const bt = await ev('__G.table.boat'), k0 = await ev('__i.sol()');
      await touch('touchStart', [{ x: bt[0] - 20, y: bt[1] - 20 }]); await sleep(60); for (const f of [0.5, 1]) { await touch('touchMove', [{ x: bt[0] - 20 - 70 * f, y: bt[1] - 20 - 40 * f }]); await sleep(50); } await touch('touchEnd', []); await sleep(150); await ev('__G.stepFrames(3); 1');
      const k1 = await ev('__i.sol()'), ordered = await ev('__G.said.find(m=>/Course \\d{3} ordered/.test(m))||""');
      note(!!ordered && k1.holdC === null && k1.holdS === null && k1.id === k0.id && await ev('__G.table.course') !== null, at + ': with the card open, a drag on the plot orders own course and edits nothing in the solution', ordered);
      await ev('__G.noCourse(); 1');
    }
    // Settings: beside Fire; it takes the card's place
    await tap('t-set'); let se = await ev('__i.set()'); fc = await ev('__G.fc');
    const sb = await ev('Array.from(document.querySelectorAll("#tset button")).map(b=>{ const r=b.getBoundingClientRect(); return {id:b.textContent,w:Math.round(r.width),h:Math.round(r.height)}; }).filter(q=>q.w>0)');   // Stage J: the rows of the weapon not chosen are not shown
    note(se.shown && fc.set && !fc.open && se.on.join() === 'Torpedo,Swim-out,Auto,Shallow,Straight' && sb.length === 12 && sb.every(q => q.w >= 44 && q.h >= 44) && /Aimed by the solution/.test(se.note), at + ': Set opens the torpedo settings in place of the card; every choice is at least 44 px, and the line says a launch now would be aimed by the solution', { se, sizes: sb.map(q => q.id + ' ' + q.w + 'x' + q.h).join(', ') });
    await tapBtn('tset', 'Deep'); await tapBtn('tset', 'Circle'); se = await ev('__i.set()');
    note(se.input.join() === '0,0,1,2' && se.on.join() === 'Torpedo,Swim-out,Auto,Deep,Circle', at + ': a tap chooses Deep and Circle', se);
    await clear('with the torpedo settings open');
    if (first) await shot('i11-settings-table-844');
    await tapBtn('tset', 'Shallow'); await tapBtn('tset', 'Straight'); await tap('t-set');
    // Fire: Swim-out, aimed by the solution; the seeker view opens
    s1 = await ev('__i.listen(300,true,k=>k&&k.sol.g>=2&&k.obs.length>30)');
    const f1 = await fire(); let wp = await ev('__i.wpn()');
    note(!(await ev('__i.set()')).shown && wp.own.length === 1 && wp.own[0].launch === 0 && wp.own[0].aimed && /aimed by the solution/.test(f1) && wp.shown && /enables in/.test(wp.state), at + ': Fire launches a Swim-out torpedo aimed by the solution, and the seeker view opens on the plot', { said: f1, wpn: wp });
    await clear('with the seeker view open', 15);
    // a second torpedo; a tap on the first one on the plot gives it the wire orders; Next goes back
    await ev('__G.stepFrames(30*4); 1'); await fire();
    wp = await ev('__i.wpn()');
    const th = await ev('__G.table.thits.map(q=>({id:q.id,x:q.x,y:q.y}))'), other = th.find(q => q.id !== wp.wire);
    if (other) await tapAt(other.x, other.y);
    const wp2 = await ev('__i.wpn()'), a2 = await said(/Wire orders now go to torpedo/);
    await tap('wp-next'); const wp3 = await ev('__i.wpn()');
    note(wp.own.length === 2 && wp.wire === wp.own[1].id && !!other && wp2.wire === other.id && !!a2 && wp3.wire === wp.wire, at + ': with two torpedoes on their wires, a tap on one on the plot gives it the wire orders, and Next passes them on', { said: a2, wires: [wp.wire, wp2.wire, wp3.wire] });
    // Retarget, then the seeker view on a noisemaker lock, then Reject
    await tap('wp-ret'); const wp4 = await ev('__i.wpn()'), a4 = await said(/sent to the selected contact/);
    note(wp4.phase === 'transit' && /in transit/.test(wp4.state) && !!a4, at + ': Retarget sends the torpedo to the selected contact, in transit', { said: a4, state: wp4.state, lock: wp4.lock });
    await ev('(function(){ const st=__G.sim.state, t=st.torps.find(q=>q.id===st.player.wireId); for(let i=0;i<30*40&&t&&t.run<330&&!st.over;i++) __G.stepFrames(1); })(); 1');
    const bt = await ev('__i.bait()'); await frames(4); const wp5 = await ev('__i.wpn()');
    note(!!bt && !!bt.lock && /^Lock: stationary, no machinery · \d+ m$/.test(wp5.lock) && wp5.fan.amber > 20, at + ': on a noisemaker lock the seeker view reads "stationary, no machinery" and rings the lock', { bait: bt, wpn: wp5 });
    await clear('with the seeker view on a lock', 15);
    if (first) await shot('i12-seeker-view-decoy-lock-table-844');
    await tap('wp-rej'); const wp6 = await ev('__i.wpn()'), a6 = await said(/Lock rejected/), mine = wp6.own.find(t => t.id === wp6.wire);
    note(!!mine && mine.rej.includes(bt.id) && mine.phase !== 'bait' && !!a6, at + ': Reject makes it leave the noisemaker and search again', { said: a6, lock: wp6.lock });
    if (first) await shot('i13-reject-table-844');
    // the damage panel and the objective card take the seeker view's place while they are open
    await tap('tb-dmg'); const hid = await ev('[__G.dmgOpen,__h.rect("wpn").w]'); await tap('tb-dmg'); const back = await ev('[__G.dmgOpen,__h.rect("wpn").w]');
    note(hid[0] && hid[1] === 0 && !back[0] && back[1] > 0, at + ': the open damage panel takes the seeker view\'s place, and gives it back', { hid, back });
    // a tap on open water clears the target and closes the card
    await tap('tb-conh'); const open1 = (await ev('__G.fc')).open; if (hit) { const q = await ev('(function(){ const h=__G.table.hits[0], b=__G.table.boat; return [b[0]-Math.cos(h.brg)*50,b[1]+Math.sin(h.brg)*50]; })()'); await tapAt(q[0], q[1]); }
    const gone = await ev('({sel:__G.game.sel,fc:__G.fc,strip:__h.rect("tb-con").w})');
    note(open1 && gone.sel === 0 && !gone.fc.open && gone.strip === 0, at + ': a tap on open water clears the target and puts the card away', gone);
  }
}

// ---------- Stage J: the anti-ship missile, tube swapping and the frigate's defences ----------
// helpers that live in the page
const J_HELPERS = `
window.__j={
  // The scene of the sim tests' missile fixture: one frigate R metres due north of the boat and crossing at 8 knots, every other ship and all sea life far away.
  // Fire control is handed a log of clean fixes of that steady track, so its own fit of the log is Good. The ship is held on the track until it first sees a missile;
  // level (0 to 3), when given, is how alert the enemy is at the moment of launch.
  stage(R,level){ const G=__G, sim=G.sim, st=sim.state, p=st.player, s=st.ships.find(q=>q.kind==='frigate'), KN=0.5144, v=8*KN;
    for(const q of st.ships) if(q!==s){ q.x=60000+q.id*500; q.z=60000; q.wp=[{x:q.x+1e5,z:q.z}]; }
    for(const b of st.bios){ b.x=b.hx=b.tx=-60000; b.z=b.hz=b.tz=60000; }
    for(const h of st.helos) h.fuel=1e9;
    st.bed.shoals.length=0;
    p.x=0; p.z=0; p.h=Math.PI/2; p.depth=30; p.depthCmd=30; p.speed=4*KN; G.input.depthCmd=30; G.input.throttle=1; G.input.rudder=0; G.input.silent=false;
    // heard close by first, so that fire control opens a track and knows the class
    let k=null; s.ident=1; for(let i=0;i<90&&!(k&&k.cls==='frigate');i++){ s.x=0; s.z=-900; s.h=0; G.stepFrames(1); k=st.tracks.find(q=>q.id===s.id)||null; }
    if(!k) return null;
    const t0=st.t; let free=false;
    const hold=()=>{ if(free) return; if(st.missiles.some(m=>Object.keys(m.seen).length)){ free=true; return; } s.x=v*(st.t-t0); s.z=-R; s.h=0; s.speed=v;
      if(level!==undefined&&!st.stats.missiles){ const e=st.enemy; e.base=level; e.level=level; e.x=30000; e.z=30000; e.err=260; e.age=0; e.fixAge=99; e.cues=level?4:0; } };
    const step=sim.step; sim.step=function(dt,inp){ hold(); return step(dt,inp); };
    hold();
    const bvx=Math.cos(p.h)*p.speed, bvz=-Math.sin(p.h)*p.speed; k.obs.length=0;
    for(let a=120;a>=0;a-=3){ const ox=p.x-bvx*a, oz=p.z-bvz*a, sx=s.x-v*a, sz=s.z; k.obs.push({t:st.t-a,x:ox,z:oz,b:Math.atan2(oz-sz,sx-ox),s:0.002,k:'ping',r:Math.hypot(sx-ox,sz-oz),rs:10}); }
    k.from=-1e9; k.holdC=null; k.holdS=null; G.game.sel=s.id; G.stepFrames(40);
    return this.info(); },
  ship(){ return __G.sim.state.ships.find(q=>q.kind==='frigate'); },
  // the outside camera on the frigate, placed so that a point lies beyond the ship in the picture (a little to one side of it)
  eyeFrom(wx,wz,el,r,off){ const G=__G, s=this.ship(); G.eyeSet(2,s.id); G.eye.az=Math.atan2(s.x-wx,s.z-wz)-s.h+Math.PI/2+(off||0); G.eye.el=el; G.eye.r=r; },
  nearCloud(){ const st=__G.sim.state, s=this.ship(); let b=null, bd=1e9; for(const c of st.clouds){ const d=Math.hypot(c.x-s.x,c.z-s.z); if(d<bd){ bd=d; b=c; } } return b?{x:b.x,z:b.z,d:Math.round(bd)}:null; },
  info(){ const G=__G, st=G.sim.state, p=st.player, s=this.ship(), k=st.tracks.find(q=>q.id===s.id), g=G.sim.gate(G.game.sel);
    return {t:+st.t.toFixed(1),sel:G.game.sel,ship:s.id,range:Math.round(Math.hypot(s.x-p.x,s.z-p.z)),grade:k?k.sol.g:-1,solRange:k&&k.sol.r!==null?Math.round(k.sol.r):null,gate:g,level:st.enemy.level,weapon:G.input.weapon,attack:G.input.attack,
      readyT:p.readyT,readyM:p.readyM,rack:[p.rack.torpedo,p.rack.missile],job:p.job,swaps:p.swaps.length,tubes:p.tube.map(u=>u.s[0]+(u.q?'q':'')).join(''),depth:+p.depth.toFixed(1),silent:p.silent,
      missiles:st.missiles.map(m=>({id:m.id,phase:m.phase,alt:Math.round(m.alt),seek:m.seek,lock:m.lock,cloud:m.cloud,pop:m.pop,d:Math.round(Math.hypot(m.x-s.x,m.z-s.z))})),shots:st.shots.length,clouds:st.clouds.length,datums:st.datums.length,hp:s.hp,over:st.over}; },
  // the tube pips as they are drawn: each one's classes and how far it has filled
  pips(){ return Array.from(document.querySelectorAll('#tubes i')).map(el=>({c:el.className,p:el.style.getPropertyValue('--p')})); },
  // what the plot names at this moment (its labels), kept to those of this stage
  labels(){ return __G.map.rects.map(r=>r[4]).filter(t=>/^(datum|chaff|missile)/.test(t)); },
  // every kind of thing the simulation has reported since watch() was called, and every one of this stage's labels the plot has shown
  seen:{}, labs:{},
  watch(){ const sim=__G.sim, step=sim.step, seen=this.seen={}, ends=this.ends=[]; this.labs={}; sim.step=function(dt,inp){ const r=step(dt,inp); for(const e of sim.events){ seen[e.type]=(seen[e.type]||0)+1; if(e.type==='mEnd') ends.push(e.why); else if(e.type==='hit'&&e.weapon==='missile') ends.push('hit '+e.where); } return r; }; },
  // step the game until a condition holds (or the time is up)
  // the game run at its real pace for a while, drawn as it goes (so that trails and tracer are in the picture)
  live(ms,stop){ return new Promise(r=>{ let last=0; const t0=performance.now(), f=t=>{ if(last) __G.run(Math.min(0.1,(t-last)/1000)); last=t; if(performance.now()-t0<ms&&!(stop&&stop(__G.sim.state))) requestAnimationFrame(f); else r(1); }; requestAnimationFrame(f); }); },
  until(sec,stop){ const G=__G, st=G.sim.state; let n=0; while(n<sec*30&&!st.over&&!stop(st,st.missiles)){ G.stepFrames(1); n++; } return +(n/30).toFixed(2); },
  // a press of Fire held for one step, as a key or a button gives it
  fire(){ const G=__G; G.said.length=0; G.input.fire=true; G.stepFrames(1); G.input.fire=false; G.stepFrames(2); return G.said.slice(); },
  // which rows of the Settings pop-up are showing, and each button in them
  rows(){ return Array.from(document.querySelectorAll('#tset .srow')).filter(r=>r.getBoundingClientRect().height>0).map(r=>(r.dataset.k||r.id)+': '+Array.from(r.querySelectorAll('button')).map(b=>b.textContent+(b.getAttribute('aria-pressed')==='true'?'*':'')).join(' / ')); },
  sizes(){ return Array.from(document.querySelectorAll('#tset button')).map(b=>{ const r=b.getBoundingClientRect(); return {id:b.textContent,w:Math.round(r.width),h:Math.round(r.height),cut:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1}; }).filter(q=>q.w>0); }
};1`;
const J_PANELS = ['brief', 'gauges', 'status', 'ring', 'dslide', 'alert', 'keys', 'wpn', 'tset'];
// one flight watched on the plot: the game is stepped a third of a second at a time, the plot drawn, and its labels collected, until every missile has ended
async function jWatchPlot(maxSec, each) {
  const labs = {}, drawn = [0, 0, 0, 0, 0]; let fx = { shots: 0, tracers: 0, clouds: 0, flashes: 0, missiles: 0, flames: 0 }, n = 0;
  for (let t = 0; t < maxSec * 3; t++) {
    await ev('__G.stepFrames(10); 1'); await frames(2);
    for (const l of await ev('__j.labels()')) labs[l] = (labs[l] || 0) + 1;
    const f = await ev('__G.fxJ'); for (const q in fx) fx[q] = Math.max(fx[q], f[q] || 0);
    (await ev('__G.map.j.slice()')).forEach((v, i) => { drawn[i] = Math.max(drawn[i], v); });
    if (each) await each(t);
    if (await ev('__G.sim.state.missiles.length===0&&__G.sim.state.shots.length===0')) { if (++n > 3) break; }
  }
  // drawn: the most of each that the plot drew at one time
  return { labels: Object.keys(labs), fx, drawn: { datums: drawn[0], chaff: drawn[1], missiles: drawn[2], defenceMissiles: drawn[3], gun: drawn[4] } };
}

// Which defences answer one seeded flight changes whenever a defence value is retuned. What must hold whatever they were: each thing the simulation reports the ship did was drawn on the plot, and the ship did something.
const jAnswered = (fl, seen) => (!seen.chaff || fl.drawn.chaff >= 1) && (!seen.samFire || fl.drawn.defenceMissiles >= 1) && (!seen.gunFire || fl.drawn.gun >= 1) && ((seen.chaff || 0) + (seen.samFire || 0) + (seen.gunFire || 0)) >= 1;

async function stagejDesktop() {
  const key = async (code, k, vk) => { await ev('__G.said.length=0; 1'); await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk }); await ev('__G.stepFrames(3); 1'); await frames(3); };
  const said = async re => { const a = await ev('__G.said.slice()'); return a.find(m => re.test(m)) || ''; };
  const clickAt = async (x, y) => { await ev('__G.said.length=0; 1'); for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }); await ev('__G.stepFrames(3); 1'); await frames(3); };
  const clickBtn = async text => { const r = await ev('(function(){ const r=__i.btn("tset","' + text + '").getBoundingClientRect(); return [r.left+r.width/2,r.top+r.height/2]; })()'); await clickAt(r[0], r[1]); };
  const sum = () => txt('wp-sum');
  await size(1280, 800, false);
  await open('?test=1&seed=7'); await ev(HELPERS); await ev(I_HELPERS); await ev(J_HELPERS);
  await ev('__G.start(7,"firstblood"); 1'); await frames(3);

  // --- Y: the next shot changes between torpedo and missile ---
  const pip0 = await ev('__j.pips()'), i0 = await ev('__j.info()');
  note(i0.tubes === 'ttttttmm' && i0.readyT === 6 && i0.readyM === 2 && i0.rack.join() === '4,2' && pip0.length === 8 && pip0.filter(q => / ?m\b/.test(q.c)).length === 2 && /^Rack 4T 2M$/.test(await txt('t-res')),
    'desktop: a mission starts with 6 torpedoes and 2 missiles in the tubes and 4 and 2 in the rack, and the tube pips show which is which', { tubes: i0.tubes, rack: i0.rack, pips: pip0.map(q => q.c || 'torpedo').join(','), res: await txt('t-res') });
  await key('KeyY', 'y', 89); const y1 = await said(/Next shot/), w1 = await ev('__G.input.weapon'), sum1 = await sum();
  await key('KeyY', 'y', 89); const y2 = await said(/Next shot/), w2 = await ev('__G.input.weapon'), sum2 = await sum();
  note(w1 === 1 && /anti-ship missile/.test(y1) && /^Missile · Sea-skim$/.test(sum1) && w2 === 0 && /torpedo/.test(y2) && /Swim-out/.test(sum2), 'desktop: Y changes the next shot to a missile and back, and the summary line follows', { y1, sum1, y2, sum2 });

  // --- Settings (I): the Weapon row, the Attack row, the Tubes row ---
  await key('KeyI', 'i', 73); const r0 = await ev('__j.rows()');
  await clickBtn('Missile'); const r1 = await ev('__j.rows()'), n1 = await txt('ts-note');
  await clickBtn('Pop-up'); const r2 = await ev('__j.rows()'), a2 = await ev('__G.input.attack'), sum3 = await sum();
  const over = await ev('__h.overlaps(' + JSON.stringify(J_PANELS) + ')');
  note(r0.length === 6 && /^weapon: Torpedo\* \/ Missile$/.test(r0[0]) && /^ts-tubes: Swap a tube to Missile \/ Swap a tube to Torpedo$/.test(r0[5]) && r1.length === 4 && /^weapon: Torpedo \/ Missile\*$/.test(r1[0]) && /^attack: Sea-skim\* \/ Pop-up$/.test(r1[1]) && /^route: Direct\* \/ Dog-leg left \/ Dog-leg right$/.test(r1[2]) && /^ts-tubes/.test(r1[3]) && /Select a ship first\./.test(n1) && /Ready: 6 T, 2 M\. Rack 4 T, 2 M\./.test(n1)
    && a2 === 1 && /^attack: Sea-skim \/ Pop-up\*$/.test(r2[1]) && /^Missile · Pop-up$/.test(sum3) && over.length === 0,
    'desktop: Settings has a Weapon row; under Torpedo it shows the four torpedo rows and Tubes, under Missile the Attack and Route rows and Tubes, with a line on whether a launch would be accepted; nothing overlaps', { torpedo: r0, missile: r1, note: n1, popup: r2[1], sum: sum3, over });
  await shot('j01-settings-missile-desktop-1280');
  await clickBtn('Sea-skim');

  // --- refused launches, each with its reason ---
  await ev('__G.game.sel=0; __G.stepFrames(2); 1');
  await key('Space', ' ', 32); const no1 = await said(/./), fired1 = await ev('__G.sim.state.stats.missiles');
  const st0 = await ev('__j.stage(5200)'); await frames(3);
  const n2 = await txt('ts-note');
  await ev('(function(){ const p=__G.sim.state.player; p.depth=80; p.depthCmd=80; __G.input.depthCmd=80; __G.stepFrames(2); })(); 1'); await frames(3);
  const n3 = await txt('ts-note'), n3c = await ev('document.getElementById("ts-note").className');
  await key('Space', ' ', 32); const no2 = await said(/./), fired2 = await ev('__G.sim.state.stats.missiles');
  note(/^Select a ship first\.$/.test(no1) && fired1 === 0 && !!st0 && st0.grade >= 2 && st0.gate.ok && /A launch now would be accepted/.test(n2) && /^Too deep to launch a missile\./.test(n3) && n3c === 'warn' && /^Too deep to launch a missile\.$/.test(no2) && fired2 === 0,
    'desktop: with no ship selected, and then with the boat at 80 m, Fire launches nothing and says why; the Settings line says the same beforehand', { noTarget: no1, staged: st0, ok: n2, deepNote: n3, deep: no2 });
  await shot('j03-refused-launch-desktop-1280');
  await ev('(function(){ const p=__G.sim.state.player; p.depth=30; p.depthCmd=30; __G.input.depthCmd=30; __G.stepFrames(2); })(); 1');

  // --- a swap: one loaded torpedo tube changes to a missile; its pip fills; Cancel swap shows while it runs ---
  await clickBtn('Swap a tube to Missile'); const sw1 = await said(/Tube swap started/);
  await ev('__G.stepFrames(600); 1'); await frames(4);
  const p1 = await ev('__j.pips()'), i1 = await ev('__j.info()'), r3 = await ev('__j.rows()'), n4 = await txt('ts-note');
  note(/Tube swap started: a missile goes in\. It takes 60 s\./.test(sw1) && i1.readyT === 5 && i1.job === 0 && /swap/.test(p1[0].c) && /\bm\b/.test(p1[0].c) && parseInt(p1[0].p) >= 25 && parseInt(p1[0].p) <= 40 && r3.some(q => /^ts-cancel: Cancel swap$/.test(q)) && /Swap to missile: \d+ s left/.test(n4),
    'desktop: "Swap a tube to Missile" takes the lowest loaded torpedo tube out of use; 20 s on its pip is a third full, the Settings line counts down, and Cancel swap is offered', { said: sw1, pip: p1[0], tubes: i1.tubes, note: n4 });
  await shot('j02-swap-in-progress-desktop-1280');
  await clickBtn('Cancel swap'); const sw2 = await said(/cancel/i), i2 = await ev('__j.info()'), r4 = await ev('__j.rows()');
  note(/Swap cancelled: the torpedo stays in the tube\./.test(sw2) && i2.readyT === 6 && i2.job === -1 && !r4.some(q => /ts-cancel/.test(q)), 'desktop: cancelled in its first half, the swap leaves the torpedo in the tube, and Cancel swap goes away', { said: sw2, tubes: i2.tubes });
  await key('KeyI', 'i', 73);

  // --- a launch: the capsule, the breach and its datum, the flight on the plot, the ship's defences ---
  await ev('__G.setMap(true); __j.watch(); 1'); await frames(4);
  await key('Space', ' ', 32); if (await said(/Press Fire again/)) await key('Space', ' ', 32);
  const f1 = await said(/Missile launched/), i3 = await ev('__j.info()'); await ev('__G.stepFrames(4); 1'); await frames(3); const l1 = await ev('__j.labels()');
  const rise = await ev('__j.until(20,(st,m)=>m.length&&m[0].phase!=="capsule")'); await frames(3);
  const f2 = await ev('__G.said.find(m=>/Missile away/.test(m))||""'), l2 = await ev('__j.labels()'), i4 = await ev('__j.info()'), fxa = await ev('__G.fxJ');
  note(/Missile launched: its capsule is rising to the surface\./.test(f1) && i3.readyM === 1 && i3.missiles.length === 1 && l1.includes('missile: rising') && rise > 2 && rise < 6 && /Missile away\. They will search where it broke the surface\./.test(f2) && l2.includes('datum') && l2.includes('missile') && fxa.datums === 1 && i4.datums === 1,
    'desktop: Fire with Missile chosen launches one; the plot shows it rising, and when it breaks the surface the plot rings the launch point as a datum', { said: [f1, f2], rise, rising: l1, after: l2 });
  await shot('j04-plot-missile-and-datum-desktop-1280');
  const fl = await jWatchPlot(60), endD = await ev('({seen:__j.seen,ends:__j.ends,hp:__j.ship().hp,level:__G.sim.state.enemy.level,said:__G.said.filter(m=>/Missile|decoys/.test(m))})');
  note(fl.labels.includes('missile') && fl.labels.includes('missile: locked') && fl.drawn.missiles === 1 && fl.drawn.datums === 1 && jAnswered(fl, endD.seen) && endD.ends.length === 1 && (endD.seen.mSeen || 0) >= 1 && endD.said.some(m => /Missile (hit|shot down|decoyed|missed)/.test(m)),
    'desktop: the flight is drawn on the plot until it ends, with whatever the ship did about it (chaff, its missile defence, its gun); the ship sees it and its defences answer, and the game says how it ended', { labels: fl.labels, drawn: fl.drawn, events: endD.seen, ended: endD.ends, said: endD.said });
  await ev('__G.setMap(false); 1');

  // --- Revision 5: the Route row, a dog-leg flown on the plot, and Update missile (Z) with its refusals ---
  await ev('__G.start(7,"firstblood"); 1'); await frames(3);
  const near5 = await ev('__j.stage(3000,2)'); await ev('__G.setWeapon(1); 1'); await frames(3);
  await key('KeyI', 'i', 73); await clickBtn('Dog-leg left');
  const rs = await said(/^Route/), rr = await ev('__j.rows()'), nc = await txt('ts-note'), ncc = await ev('document.getElementById("ts-note").className'), sumR = await sum(), zr = await ev('__j.sizes()'), overR = await ev('__h.overlaps(' + JSON.stringify(J_PANELS) + ')');
  // (a new game for the second staging: each staging holds the ship on its own track until a missile is seen, and two of them would fight over it)
  await ev('__G.start(7,"firstblood"); 1'); await frames(3);
  const far5 = await ev('__j.stage(5200,2)'); await ev('__G.setWeapon(1); __G.setRoute(1); __G.setSettings(true); 1'); await frames(3); const nf = await txt('ts-note'), nfc = await ev('document.getElementById("ts-note").className');
  note(/^Route: Dog-leg left\.$/.test(rs) && rr.some(q => /^route: Direct \/ Dog-leg left\* \/ Dog-leg right$/.test(q)) && /^Missile · Sea-skim · Dog-leg left$/.test(sumR) && zr.every(q => !q.cut) && overR.length === 0
    && near5.gate.ok && /^Too close for a dog-leg: a launch now would fly direct\./.test(nc) && ncc === 'warn' && far5.gate.ok && /^A launch now would be accepted: it flies out to the left and turns in from the side\./.test(nf) && nfc === '',
    'desktop: Route is chosen in Settings; the summary line follows; with the ship 3,000 m off the line warns that a dog-leg would fly direct, and (in a new game) at 5,200 m it says the missile flies out to the left and turns in; no word is cut and nothing overlaps', { said: rs, rows: rr, sum: sumR, close: nc, far: nf, over: overR });
  await shot('j15-route-row-desktop-1280');
  await key('KeyI', 'i', 73);
  await ev('__G.setMap(true); __G.mapZoom(1); __j.watch(); 1'); await frames(4);
  await key('Space', ' ', 32); if (await said(/Press Fire again/)) await key('Space', ' ', 32);
  const fr = await said(/Missile launched/);
  await ev('__j.until(20,(st,m)=>m.length&&m[0].phase!=="capsule"); __G.stepFrames(20); 1'); await frames(3);
  const lr = await ev('__j.labels()'), mr = await ev('(function(){ const m=__G.sim.state.missiles[0]; return m?{route:m.route,leg:m.leg}:null; })()');
  await shot('j16-plot-dog-leg-desktop-1280');
  const flr = await jWatchPlot(70), endR = await ev('({seen:Object.assign({},__j.seen),ends:__j.ends.slice(),said:__G.said.filter(m=>/Missile/.test(m))})');
  note(/^Missile launched: its capsule is rising to the surface\.$/.test(fr) && !!mr && mr.route === 1 && mr.leg === 1 && lr.includes('missile: dog-leg') && (endR.seen.mTurn || 0) === 1 && endR.said.some(m => /^Missile at its waypoint: it turns in\.$/.test(m)) && endR.ends.length === 1 && flr.drawn.missiles === 1,
    'desktop: a missile set to Dog-leg left is labelled as such on the plot and drawn by its waypoint; it turns in there, the game says so, and the flight ends', { launch: fr, labels: lr, ends: endR.ends, events: endR.seen, said: endR.said });
  // the second missile: Update missile (Z), refused with its own words until the boat is at periscope depth with the mast up
  await key('KeyZ', 'z', 90); const u0 = await said(/./);
  await ev('__G.setMap(false); __G.start(7,"firstblood"); 1'); await frames(3);
  await ev('__j.stage(5200,2); __G.setWeapon(1); __G.setRoute(1); __G.setMap(true); __G.mapZoom(1); __j.watch(); 1'); await frames(3);
  await key('Space', ' ', 32); if (await said(/Press Fire again/)) await key('Space', ' ', 32);
  await ev('__j.until(20,(st,m)=>m.length&&m[0].phase!=="capsule"); __G.stepFrames(20); 1'); await frames(3);
  await key('KeyZ', 'z', 90); const u1 = await said(/./);
  await ev('(function(){ const p=__G.sim.state.player; p.depth=9; p.depthCmd=9; __G.input.depthCmd=9; __G.stepFrames(2); })(); 1');
  await key('KeyZ', 'z', 90); const u2 = await said(/./);
  await key('KeyR', 'r', 82); await ev('__G.stepFrames(50); 1'); await frames(3);
  await key('KeyZ', 'z', 90); const u3 = await said(/Missile updated/), mu = await ev('(function(){ const m=__G.sim.state.missiles[0]; return m?{route:m.route,leg:m.leg,upd:m.upd}:null; })()'), seenU = await ev('Object.assign({},__j.seen)');
  note(/^No missile in flight to update\.$/.test(u0) && /^Too deep to update a missile: come up to periscope depth\.$/.test(u1) && /^No mast is up: raise the mast to update a missile\.$/.test(u2) && /^Missile updated: it flies to where the solution now puts the ship\./.test(u3) && !!mu && mu.upd === 1 && seenU.mUpdate === 1,
    'desktop: Z with no missile in flight, then with the boat at 30 m, then at periscope depth with no mast, is refused each time with its own words; with the mast up Z updates the missile in flight', { none: u0, deep: u1, noMast: u2, updated: u3, missile: mu });
  await shot('j19-plot-missile-updated-mast-up-desktop-1280');
  await key('KeyR', 'r', 82);
  const flu = await jWatchPlot(70), endU = await ev('({seen:__j.seen,ends:__j.ends})');
  note(endU.ends.length === 1 && flu.drawn.missiles === 1, 'desktop: the updated missile flies on and its flight ends', { ends: endU.ends, events: endU.seen, labels: flu.labels });
  await ev('__G.setMap(false); 1');
}

// the 3D view of a missile attack, staged moment by moment for the pictures; the checks are that each thing is in the picture's scene when it is taken
async function stagejPictures() {
  await size(1280, 800, false);
  const begin = async (attack, level, salvo) => {
    await open('?test=1&seed=7'); await ev(HELPERS); await ev(I_HELPERS); await ev(J_HELPERS);
    await ev('__G.start(7,"firstblood"); 1'); await frames(3);
    const s = await ev('__j.stage(5200,' + level + ')'); await ev('__G.setWeapon(1); __G.setAttack(' + attack + '); __j.watch(); 1');
    const a = await ev('__j.fire()'); if (salvo) { await ev('__G.stepFrames(80); 1'); await ev('__j.fire()'); }
    return { staged: s, said: a };
  };
  // sea-skim, two missiles, an alert frigate
  let b = await begin(0, 2, true);
  await ev('__h.look(0,600,0.5,125); 1'); await frames(6);   // the camera ahead of the boat and above the water, looking back at where the missile will come up
  await ev('__j.until(20,(st,m)=>m.length&&m[0].phase!=="capsule"); 1'); await ev('__j.live(260)');
  const br = await ev('({fx:__G.fxJ,m:__j.info().missiles,cam:+(__G.camera.position.y-__G.waterY).toFixed(1)})');
  await shot('j05-missile-breach-1280');
  note(br.m.length === 2 && br.m[0].phase !== 'capsule' && br.fx.missiles >= 1 && br.fx.flashes >= 1 && br.cam > 0, '3D: the first missile breaks the surface above the boat, with its flash and spray (the camera is above the water)', br);
  await ev('__G.eyeSet(4,__G.sim.state.missiles[0].id); __j.until(20,(st,m)=>m.length&&m[0].phase==="fly"&&m[0].alt<8); 1'); await ev('__j.live(1500)');
  const sk = await ev('({eye:__G.eye.mode,fx:__G.fxJ,m:__j.info().missiles})');
  await shot('j06-missile-sea-skimming-1280');
  note(sk.eye === 4 && sk.m[0].phase === 'fly' && sk.m[0].alt <= 8 && sk.fx.flames >= 1, '3D: the camera rides with the missile as it skims the sea, its motor burning', sk);
  // the ship's answer, seen from beside the ship: decoy rockets, defence missiles, the gun
  await ev('__j.until(40,st=>st.shots.length>0); (function(){ const m=__G.sim.state.missiles[0]; __j.eyeFrom(m.x,m.z,0.1,230,0.3); })(); 1'); await ev('__j.live(900,st=>st.shots.length===0)');
  const df = await ev('({fx:__G.fxJ,i:__j.info(),seen:__j.seen})');
  await shot('j08-defence-fire-1280');
  await ev('(function(){ const s=__j.ship(), near=st=>st.clouds.some(c=>Math.hypot(c.x-s.x,c.z-s.z)<450); __j.until(40,st=>near(st)||st.missiles.length===0); const c=__j.nearCloud(); if(c) __j.eyeFrom(c.x,c.z,0.07,c.d<450?200:420,0.25); })(); 1'); await ev('__j.live(2200,st=>st.missiles.length===0)');
  const ch = await ev('({fx:__G.fxJ,i:__j.info(),seen:__j.seen,cloud:__j.nearCloud()})');
  await shot('j09-chaff-cloud-1280');
  note(ch.i.clouds >= 1 && ch.fx.clouds >= 1 && (ch.seen.chaff || 0) >= 1, '3D: the ship fires decoy rockets and a chaff cloud glitters beside it', { fx: ch.fx, clouds: ch.i.clouds, nearest: ch.cloud, events: ch.seen });
  note(df.i.shots >= 1 && df.fx.shots >= 1 && (df.seen.samFire || 0) >= 1, '3D: the ship\'s missile defence fires, and its shots are in the picture', { fx: df.fx, inFlight: df.i.shots, events: df.seen });
  // on to the end of the first missile: a hit, or a kill in the air
  const n0 = await ev('__j.ends.length');
  await ev('__G.eyeSet(2,__j.ship().id); __G.eye.r=230; __G.eye.el=0.12; __j.until(60,()=>__j.ends.length>' + n0 + '); 1'); await ev('__j.live(350)');
  const en = await ev('({fx:__G.fxJ,ends:__j.ends,seen:__j.seen,said:__G.said.filter(m=>/Missile (hit|shot down|decoyed|missed)/.test(m))})');
  await shot('j10-missile-end-1280');
  note(en.ends.length >= 1 && en.said.length >= 1, '3D: the attack ends in a hit, a kill in the air, a decoy or a miss, and the game says which', en);
  await ev('__j.until(60,(st,m)=>m.length===0&&st.shots.length===0); __G.eyeSet(0); 1');
  const fin = await ev('({ends:__j.ends,seen:__j.seen,hp:__j.ship().hp})');
  console.log('     the salvo: ' + JSON.stringify(fin));
  // pop-up: the climb
  b = await begin(1, 2, false);
  await ev('__G.eyeSet(4,__G.sim.state.missiles[0].id); __j.until(40,(st,m)=>m.length&&m[0].pop&&m[0].alt>250); 1'); await ev('__j.live(500)');
  const pu = await ev('({eye:__G.eye.mode,fx:__G.fxJ,m:__j.info().missiles})');
  await shot('j07-missile-pop-up-climb-1280');
  note(pu.eye === 4 && pu.m.length === 1 && pu.m[0].pop && pu.m[0].alt > 200, '3D: a Pop-up missile climbs before it dives on the ship', pu);
  await ev('__j.until(60,(st,m)=>m.length===0&&st.shots.length===0); __G.eyeSet(0); 1');
  console.log('     the pop-up: ' + JSON.stringify(await ev('({ends:__j.ends,seen:__j.seen})')));
}

// the phone tabletop: the SET rows, "Fire M", a swap and its cancel, a refused launch, and a two-missile salvo on the plot
async function stagejTable() {
  const touch = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id || 1 })) });
  const tapAt = async (x, y) => { await ev('__G.said.length=0; 1'); await touch('touchStart', [{ x, y }]); await sleep(60); await touch('touchEnd', []); await sleep(140); await ev('__G.stepFrames(3); 1'); await frames(3); };
  const tap = async id => { const r = await ev('__h.rect("' + id + '")'); await tapAt((r.l + r.r) / 2, (r.t + r.b) / 2); };
  const said = async re => { const a = await ev('__G.said.slice()'); return a.find(m => re.test(m)) || ''; };
  const tapBtn = async text => { const r = await ev('(function(){ const r=__i.btn("tset","' + text + '").getBoundingClientRect(); return [r.left+r.width/2,r.top+r.height/2]; })()'); await tapAt(r[0], r[1]); };
  for (const [w, h, at, first] of [[844, 390, '844x390', true], [932, 430, '932x430', false]]) {
    await size(w, h, true); await open('?test=1&seed=7&table=1'); await ev(HELPERS); await ev(I_HELPERS); await ev(J_HELPERS);
    await ev('__G.start(7,"firstblood"); 1'); await frames(3);
    const clear = async (what, least) => {
      const ids = H_SOLID, o = await ev('__h.overlaps(' + JSON.stringify(ids) + ')'), tg = await ev(H_TARGETS), bt = await ev('__G.table.boat'), cov = await ev('__h.boxHit([' + [bt[0] - 12, bt[1] - 12, bt[0] + 12, bt[1] + 12].join(',') + '],' + JSON.stringify(ids) + ')');
      const small = tg.filter(b => b.w < 40 || b.h < 40), off = tg.filter(b => b.l < 0 || b.t < 0 || b.r > w || b.b > h || !b.hit);
      note(o.length === 0 && small.length === 0 && off.length === 0 && cov.length === 0 && tg.length >= (least || 12), at + ': ' + what + ': nothing overlaps, every tap target is at least 40 px, on the screen and not covered, and nothing covers the boat', { o, small, off, cov, n: tg.length, sizes: tg.map(b => b.id + ' ' + b.w + 'x' + b.h).join(', ') });
    };
    const st0 = await ev('__j.stage(5200,2)'); await ev('__G.mapZoom(1); 1'); await frames(4);   // the plot zoomed out, so that the ship 5 km off is on it
    // SET: Weapon shares its row with Launch; Missile swaps that for Attack and brings the Tubes row
    await tap('t-set'); const r0 = await ev('__j.rows()'), z0 = await ev('__j.sizes()'), fb0 = await txt('t-fire');
    await clear('with the torpedo settings open (Stage J rows)');
    await tapBtn('Missile'); const r1 = await ev('__j.rows()'), z1 = await ev('__j.sizes()'), fb1 = await txt('t-fire'), n1 = await txt('ts-note'), w1 = await said(/Next shot/);
    note(!!st0 && r0.length === 5 && /^weapon: Torpedo\* \/ Missile$/.test(r0[0]) && /^launch:/.test(r0[1]) && z0.length === 12 && z0.every(q => q.w >= 44 && q.h >= 44 && !q.cut) && fb0 === 'Fire'
      && r1.length === 4 && /^weapon: Torpedo \/ Missile\*$/.test(r1[0]) && /^attack: Sea-skim\* \/ Pop-up$/.test(r1[1]) && /^route: Direct\* \/ Dog-leg left \/ Dog-leg right$/.test(r1[2]) && /^ts-tubes/.test(r1[3]) && z1.length === 9 && z1.every(q => q.w >= 44 && q.h >= 44 && !q.cut) && fb1 === 'Fire M' && /anti-ship missile/.test(w1) && /A launch now would be accepted/.test(n1),
      at + ': SET has the Weapon choice; Missile shows Attack, Route and the Tubes row, every choice is at least 44 px with its words whole, the Fire button reads "Fire M", and the line says a launch would be accepted', { staged: st0, torpedo: r0, missile: r1, fire: [fb0, fb1], note: n1, sizes: z0.concat(z1).map(q => q.id + ' ' + q.w + 'x' + q.h + (q.cut ? ' CUT' : '')).join(', ') });
    await clear('with the missile settings open');
    if (first) await shot('j11-set-rows-missile-table-844');
    // a swap, its countdown in the Settings line, and Cancel swap
    await tapBtn('Swap a tube to Missile'); const sw1 = await said(/Tube swap started/);
    await ev('__G.stepFrames(600); 1'); await frames(4);
    const r2 = await ev('__j.rows()'), n2 = await txt('ts-note'), i2 = await ev('__j.info()'), z2 = await ev('__j.sizes()');
    note(/Tube swap started: a missile goes in/.test(sw1) && i2.job === 0 && i2.readyT === 5 && r2.some(q => /^ts-cancel: Cancel swap$/.test(q)) && /Swap to missile: \d+ s left/.test(n2) && z2.every(q => q.w >= 44 && q.h >= 44), at + ': a tap on "Swap a tube to Missile" starts the swap; the line counts it down and Cancel swap appears, at least 44 px', { said: sw1, note: n2, rows: r2, tubes: i2.tubes });
    await clear('with a swap running and Cancel swap showing');
    if (first) await shot('j12-swap-in-progress-table-844');
    await tapBtn('Cancel swap'); const sw2 = await said(/cancel/i), i3 = await ev('__j.info()');
    note(/Swap cancelled: the torpedo stays in the tube\./.test(sw2) && i3.readyT === 6 && i3.job === -1 && !(await ev('__j.rows()')).some(q => /ts-cancel/.test(q)), at + ': Cancel swap in the first half leaves the torpedo in its tube', { said: sw2, tubes: i3.tubes });
    await tapBtn('Pop-up'); const a1 = await ev('__G.input.attack'); await tapBtn('Sea-skim'); const a2 = await ev('__G.input.attack');
    await tap('t-set');
    // a refused launch: too deep
    await ev('(function(){ const p=__G.sim.state.player; p.depth=80; p.depthCmd=80; __G.input.depthCmd=80; __G.stepFrames(2); })(); 1');
    await tap('t-fire'); const no = await said(/./), m0 = await ev('__G.sim.state.stats.missiles'), line = await txt('alert');
    note(a1 === 1 && a2 === 0 && /^Too deep to launch a missile\.$/.test(no) && m0 === 0 && /Too deep to launch a missile\./.test(line), at + ': Attack is chosen by a tap; with the boat at 80 m "Fire M" launches nothing and the message line says "Too deep to launch a missile."', { said: no, line });
    if (first) await shot('j13-refused-launch-table-844');
    await ev('(function(){ const p=__G.sim.state.player; p.depth=30; p.depthCmd=30; __G.input.depthCmd=30; __G.stepFrames(2); })(); __j.watch(); 1');
    // a two-missile salvo
    await tap('t-fire'); if (await said(/Press Fire again/)) await tap('t-fire'); const f1 = await said(/Missile launched/);
    await ev('__G.stepFrames(80); 1'); await tap('t-fire'); const f2 = await said(/Missile launched/), i4 = await ev('__j.info()');
    await ev('__j.until(20,(st,m)=>m.length===2&&m[1].phase!=="capsule"); __G.stepFrames(30); 1'); await frames(4);
    const l1 = await ev('__j.labels()'), fb2 = await txt('t-fire');
    note(!!f1 && !!f2 && i4.missiles.length === 2 && i4.readyM === 0 && l1.filter(q => q === 'datum').length === 2 && l1.filter(q => /^missile/.test(q)).length === 2, at + ': two taps on "Fire M" launch a salvo of two; the plot draws both missiles and rings both launch points', { said: [f1, f2], labels: l1, fire: fb2 });
    await clear('with a salvo in flight', 12);
    let pic = false;
    const fl = await jWatchPlot(60, async () => { if (first && !pic && await ev('__G.sim.state.clouds.length>0&&__G.sim.state.missiles.length>0')) { pic = true; await shot('j14-plot-salvo-datum-chaff-table-844'); } });
    const en = await ev('({seen:__j.seen,ends:__j.ends,hp:__j.ship().hp,said:__G.said.filter(m=>/Missile|decoys/.test(m))})');
    note(jAnswered(fl, en.seen) && fl.drawn.missiles === 2 && fl.drawn.datums === 2 && (fl.drawn.defenceMissiles + fl.drawn.gun) >= 1 && fl.labels.includes('missile: locked') && en.ends.length === 2 && (en.seen.chaff || 0) >= 1 && ((en.seen.samFire || 0) + (en.seen.gunFire || 0)) >= 1,
      at + ': the plot follows the salvo to its end: the chaff clouds and the ship\'s fire are drawn, the seeker locks, and the ship\'s missile defence or gun fires', { labels: fl.labels, drawn: fl.drawn, events: en.seen, ended: en.ends, said: en.said });
    await clear('after the salvo');

    // Revision 5: the Route row in SET, and the Update button, on the bar only while a missile is in flight
    await ev('__G.start(7,"firstblood"); 1'); await frames(3);
    await ev('__j.stage(5200,2)'); await ev('__G.mapZoom(1); 1'); await frames(4);
    const ub0 = await ev('__h.rect("t-upd")');
    await tap('t-set'); await tapBtn('Missile'); await tapBtn('Dog-leg right');
    const r5 = await ev('__j.rows()'), z5 = await ev('__j.sizes()'), n5 = await txt('ts-note'), s5 = await said(/^Route/);
    note(ub0.w === 0 && r5.length === 4 && /^route: Direct \/ Dog-leg left \/ Dog-leg right\*$/.test(r5[2]) && z5.length === 9 && z5.every(q => q.w >= 44 && q.h >= 44 && !q.cut) && /^Route: Dog-leg right\.$/.test(s5) && /flies out to the right and turns in from the side/.test(n5),
      at + ': Route is chosen by a tap in SET; its three choices are at least 44 px with their words whole, and the line says which way the missile will fly', { rows: r5, note: n5, sizes: z5.map(q => q.id + ' ' + q.w + 'x' + q.h + (q.cut ? ' CUT' : '')).join(', ') });
    await clear('with the missile settings open and a dog-leg chosen');
    if (first) await shot('j17-set-route-row-table-844');
    await tapBtn('Swap a tube to Missile'); await ev('__G.stepFrames(60); 1'); await frames(4);
    const z6 = await ev('__j.sizes()');
    note(z6.length === 10 && z6.every(q => q.w >= 44 && q.h >= 44 && !q.cut), at + ': with a swap running the missile settings show Route, Tubes and Cancel swap together, each at least 44 px', { sizes: z6.map(q => q.id + ' ' + q.w + 'x' + q.h + (q.cut ? ' CUT' : '')).join(', ') });
    await clear('with Route, Tubes and Cancel swap all showing');
    await tapBtn('Cancel swap'); await tap('t-set');
    await ev('__j.watch(); 1');
    await tap('t-fire'); if (await said(/Press Fire again/)) await tap('t-fire'); const f5 = await said(/Missile launched/);
    await ev('__j.until(20,(st,m)=>m.length&&m[0].phase!=="capsule"); __G.stepFrames(20); 1'); await frames(4);
    const ub1 = await ev('Object.assign(__h.rect("t-upd"),{c:document.getElementById("t-upd").className})'), l5 = await ev('__j.labels()');
    await clear('with a dog-leg missile in flight and Update on the bar', 12);
    await tap('t-upd'); const no5 = await said(/./);
    await ev('(function(){ const p=__G.sim.state.player; p.depth=9; p.depthCmd=9; __G.input.depthCmd=9; __G.stepFrames(2); })(); 1');
    await tap('tb-menu'); await tap('tm-mast'); await tap('tb-menu'); await ev('__G.stepFrames(50); 1'); await frames(4);
    const ub2 = await ev('document.getElementById("t-upd").className');
    await tap('t-upd'); const ok5 = await said(/Missile updated/), m5 = await ev('(function(){ const m=__G.sim.state.missiles[0]; return m?{route:m.route,leg:m.leg,upd:m.upd}:null; })()');
    note(!!f5 && ub1.w >= 44 && ub1.h >= 44 && ub1.c === 'cut' && l5.includes('missile: dog-leg') && /^Too deep to update a missile: come up to periscope depth\.$/.test(no5) && ub2 === '' && /^Missile updated/.test(ok5) && !!m5 && m5.route === 2 && m5.upd === 1,
      at + ': while a missile flies the bar shows Update, at least 44 px and dimmed while the boat is deep; a tap then is refused with its words; at periscope depth with the mast up (from the menu) it is lit, and a tap updates the missile', { button: ub1, labels: l5, deep: no5, lit: ub2, updated: ok5, missile: m5 });
    await clear('with the mast up and Update lit', 12);
    if (first) await shot('j18-plot-dog-leg-update-table-844');
    const fl5 = await jWatchPlot(70), ub3 = await ev('__h.rect("t-upd")'), en5 = await ev('({seen:__j.seen,ends:__j.ends})');
    note(en5.ends.length === 1 && (en5.seen.mUpdate || 0) === 1 && ub3.w === 0, at + ': the updated dog-leg missile flies on to its end, and Update leaves the bar', { ends: en5.ends, turned: en5.seen.mTurn || 0, events: en5.seen, labels: fl5.labels });
    await clear('after the dog-leg missile');
  }
}

const alertTextOf = () => ev('document.getElementById("alert").textContent');

try {
  if (only === 'perf') await perf();
  if (want('stagec')) { await stagec(); await stagecMap(); }
  if (want('staged')) await staged();
  if (want('stagef')) await stagef();
  // order matters: the scenarios that need touch run in one stretch (see size), and the two-finger pinch at the end of
  // the phone scenario is the last touch of the run, because headless Chrome drops the next touches after it
  if (want('desktop')) await desktop();
  if (want('desktop') || want('missions')) await missions();
  if (want('desktop') || want('stageg')) await stageg();
  if (want('desktop') || want('stagei')) await stageiDesktop();
  if (want('stagej')) { await stagejDesktop(); await stagejPictures(); }
  if (want('live')) { await liveKeys(); await liveTouch(); }
  if (want('stageh')) await stageh();   // touch is on here; its two-finger gestures are made inside the page, so the touches after it still arrive
  if (want('stageh') || want('stagei')) await stageiTable();
  if (want('stagej')) await stagejTable();
  if (want('phone')) await phone();   // with stagef wanted too, its phone part runs inside this one
  else if (want('stagef')) { await size(390, 844, true); await open('?test=1&seed=7&table=0'); await ev(HELPERS); await stagefPhone(); }
  else if (want('stagegphone')) { await size(390, 844, true); await open('?test=1&seed=7&table=0'); await ev(HELPERS); await stagegPhone(); }
  if (want('edge')) await edge();
} catch (e) { failed++; console.log('FAIL script stopped: ' + (e && e.stack || e)); }
const errs = c.errors.filter(e => !/favicon|GPU stall due to ReadPixels|willReadFrequently/.test(e));
note(errs.length === 0, 'no page errors or warnings', errs.slice(0, 12));
console.log(failed ? failed + ' browser check(s) FAILED' : 'All browser checks passed');
clearTimeout(watchdog); c.close(); cleanup(); await sleep(600);
try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { console.log('profile folder not removed: ' + e.message); }
process.exit(failed ? 1 : 0);
