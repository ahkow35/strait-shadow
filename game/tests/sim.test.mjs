// Strait Shadow sim tests. Run: node game/tests/sim.test.mjs [path to the html] [-v]
// The sim is pulled out of the page's <script id="sim"> block and run here with no browser.
// -v prints every part of every check with its measured numbers; without it each check is one short line (a failed check is always printed in full).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// --only=name,name runs only those checks (names as printed; 'missions' is the per-mission set)
const args = process.argv.slice(2), verbose = args.includes('-v'), fileArg = args.find(a => a !== '-v' && !a.startsWith('--'));
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').slice(7), want = name => !onlyArg || onlyArg.split(',').includes(name);
const htmlPath = resolve(fileArg || resolve(here, '..', 'strait-shadow.html'));
const html = readFileSync(htmlPath, 'utf8');
const m = html.match(/<script id="sim">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no <script id="sim"> block in ' + htmlPath); process.exit(1); }
const simText = m[1];
const SIM = new Function(simText + '\nreturn StraitSim;')();
const { createSim, MISSIONS, STEP, wrap, bearing, pace, isThreat } = SIM;
const PI = Math.PI, clamp = (v, a, b) => v < a ? a : v > b ? b : v;

let failed = 0;
// One check is one printed line. Each part is [passed, text]; a failed part is marked in the line. A check with many numbers may give a
// shorter line to print when every part has passed.
function check(name, parts, brief) {
  const bad = parts.filter(p => !p[0]);
  if (bad.length) failed++;
  if (verbose) { console.log((bad.length ? 'FAIL ' : 'PASS ') + name); for (const p of parts) console.log('     ' + (p[0] ? 'ok   ' : 'FAIL ') + p[1]); }
  else if (brief && !bad.length) console.log('PASS ' + name + ': ' + brief);
  else console.log((bad.length ? 'FAIL ' : 'PASS ') + name + ': ' + parts.map(p => (p[0] ? '' : '[FAILED] ') + p[1]).join('; '));
}
const pct = x => (x * 100).toFixed(0) + '%';

/* ---------- players ---------- */
// Every scripted player uses only what a person can see: the gauges, the threat word, the sonar contacts, the map (marks, own torpedoes, pings it has
// heard), the Solution box (fire control's grade, range, course and speed for a contact, and its "may have turned" flag), the seeker view (what the
// torpedo on the wire is doing) and the layer depth. None of them reads where the other side really is or what it knows.
const strongest = (st, kind) => { let b = null; for (const c of st.contacts) if (c.kind === kind && (!b || c.sig > b.sig)) b = c; return b; };
// Ship contacts start as Unknown. The sound-signature panel shows the shaft rate first, then the blade count, then the class. A careful captain
// goes for the loudest contact known to be the wanted class; failing that he closes the loudest unknown one that could still be it and listens.
// He never fires on a contact that is not classified. (Game values from the help card: a frigate turns fast on 5 blades, the high-value ship slowly on 4.)
const could = (c, want) => c.cls ? c.cls === want : want === 'frigate' ? (!c.blades || c.blades === 5) && (!c.shaft || c.shaft > 90) : (!c.blades || c.blades === 4) && (!c.shaft || c.shaft < 90);
const pick = (st, want) => { let known = null, unk = null; for (const c of st.contacts) { if (c.kind !== 'ship' || !could(c, want)) continue; if (c.cls) { if (!known || c.sig > known.sig) known = c; } else if (!unk || c.sig > unk.sig) unk = c; } return known || unk; };
const steer = (inp, p, h, max) => { inp.rudder = clamp(-wrap(h - p.h) * 3, -(max || 1), max || 1); };
const blank = () => ({ rudder: 0, throttle: 0, depthCmd: 20, fire: false, ping: false, silent: false, decoy: false, mast: false, wire: 0, target: 0, cmd: '', arg: 0, launch: 0, enable: 0, runDepth: 0, search: 0 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const mark = (st, kind) => st.marks.find(k => k.kind === kind);
// Steer the torpedo that is on the wire back onto the line from the boat to the contact.
function guide(st, inp, ship) {
  const p = st.player, t = st.torps.find(t => t.id === p.wireId);
  if (!t || !ship) return;
  const want = ship.brg + clamp(wrap(ship.brg - bearing(p.x, p.z, t.x, t.z)) * 4, -0.7, 0.7);
  inp.wire = clamp(-wrap(want - t.h) * 4, -1, 1);
}
// Run from a torpedo in the water: away from it, fast and deep, with one noisemaker for each new torpedo.
function evade(st, inp, torp, mem, decoys) {
  steer(inp, st.player, torp.brg + PI); inp.throttle = 4; inp.depthCmd = 160; inp.silent = false;
  if (decoys && torp.id !== mem.lastTorp) { mem.lastTorp = torp.id; inp.decoy = true; }
}

// Stage I. What the Solution box shows for a contact (grade, range, course, speed) and the torpedo that takes the wire orders, as the seeker view shows it.
const solutionOf = (st, c) => { const k = c ? st.tracks.find(q => q.id === c.id) : null; return k ? { k, q: k.sol } : { k: null, q: null }; };
const onWire = st => st.torps.find(t => t.id === st.player.wireId) || null;
// The torpedo settings both attackers use: a Swim-out launch, Short enable (the seeker listens early, so a target that has turned is still heard) and
// a Snake search. The torpedo is left to the course fire control gave it; only one that is searching with nothing in its seeker is steered by hand.
const presets = inp => { inp.launch = 0; inp.enable = 1; inp.runDepth = 0; inp.search = 1; };
const nurse = (st, inp, c) => { const t = onWire(st); if (t && t.phase === 'search') guide(st, inp, c); };
// First Blood, as played from Stage I on. Closes quietly on a zigzag, 0.8 rad either side of the bearing in 40 s legs, so that the bearings cross and
// fire control gets a range. Fires a pair, aimed by the solution, once the frigate is classified and the solution is Fair or better and inside 1,800 m
// (or, 4 minutes after closing with nothing better, on a Poor one from close in). Holds the wire while the torpedoes run, then clears the firing point.
function attacker() {
  return () => {
    const mem = { shots: 0, clearUntil: -1, side: 1, pulse: false, hold: false, lastTorp: 0, legT: 0, zig: 1, closeT: -1 };
    return st => {
      const p = st.player, inp = blank(), ship = pick(st, 'frigate'), torp = strongest(st, 'torp');
      const wired = st.torps.some(t => t.side === 0 && t.wire), { k, q } = solutionOf(st, ship);
      if (ship) inp.target = ship.id;
      presets(inp); nurse(st, inp, ship);
      if (torp) { evade(st, inp, torp, mem, true); mem.hold = false; return inp; }
      if (mem.hold) {
        if (wired && ship) { steer(inp, p, ship.brg, 0.7); inp.throttle = 1; inp.depthCmd = 60; return inp; }
        mem.hold = false; mem.clearUntil = st.t + 40; mem.side = -mem.side;
      }
      if (st.t < mem.clearUntil) { if (ship) steer(inp, p, ship.brg + mem.side * PI * 0.6); inp.throttle = 2; inp.depthCmd = 130; return inp; }
      if (!ship) { inp.throttle = 2; inp.depthCmd = 60; return inp; }
      if (st.t - mem.legT > 40) { mem.legT = st.t; mem.zig = -mem.zig; }
      const near = ship.sig >= 0.3;
      if (near && mem.closeT < 0) mem.closeT = st.t;
      const good = !!q && q.fit && q.r !== null && q.g >= 2 && q.r < 1800 && st.t - k.turnT > 20;
      const late = !!q && q.fit && q.g >= 1 && ship.sig >= 0.42 && mem.closeT >= 0 && st.t - mem.closeT > 240;
      steer(inp, p, ship.brg + (near ? mem.zig * 0.8 : 0));
      if (ship.sig < 0.1) { inp.throttle = 3; inp.depthCmd = 90; }
      else if (ship.sig < 0.27) { inp.throttle = 2; inp.depthCmd = 60; }
      else { inp.throttle = 1; inp.depthCmd = 60; inp.silent = p.readyT >= 2; }
      if (ship.cls === 'frigate' && (good || late) && p.readyT > 0) {
        mem.pulse = !mem.pulse; inp.fire = mem.pulse; inp.silent = false;
        if (st.stats.fired > mem.shots) { mem.shots = st.stats.fired; if (mem.shots % 2 === 0) mem.hold = true; }
      }
      return inp;
    };
  };
}
// The attack as it was played before Stage I, kept for the checks on the wire itself: nothing is selected, so the torpedoes leave along the bow, and
// they are steered down the wire by hand. Closes quietly, fires a pair from a good range, holds the wire and steers it, then clears the firing point.
// wire: 'steer' (default) or 'cut' (a hard turn straight after each pair, so the torpedoes run with no wire).
function hunter(opt) {
  opt = opt || {};
  return () => {
    const mem = { shots: 0, clearUntil: -1, side: 1, pulse: false, hold: false, cutUntil: -1, lastTorp: 0 };
    return st => {
      const p = st.player, inp = blank(), ship = pick(st, 'frigate'), torp = strongest(st, 'torp');
      const wired = st.torps.some(t => t.side === 0 && t.wire);
      if (opt.wire !== 'cut') guide(st, inp, ship);
      if (torp) { evade(st, inp, torp, mem, opt.decoys !== false); mem.hold = false; return inp; }
      if (st.t < mem.cutUntil) { inp.rudder = mem.side; inp.throttle = 2; inp.depthCmd = 60; return inp; }
      if (mem.hold) {
        if (wired && ship) { steer(inp, p, ship.brg, 0.7); inp.throttle = 1; inp.depthCmd = 60; return inp; }
        mem.hold = false; mem.clearUntil = st.t + 40; mem.side = -mem.side;
      }
      if (st.t < mem.clearUntil) {
        if (ship) steer(inp, p, ship.brg + mem.side * PI * 0.6);
        inp.throttle = 2; inp.depthCmd = 130; return inp;
      }
      if (!ship) { inp.throttle = 2; inp.depthCmd = 60; return inp; }
      steer(inp, p, ship.brg);
      if (ship.sig < 0.1) { inp.throttle = 3; inp.depthCmd = 90; }
      else if (ship.sig < 0.27) { inp.throttle = 2; inp.depthCmd = 60; }
      else { inp.throttle = 1; inp.depthCmd = 60; inp.silent = p.readyT >= 2; }
      if (ship.cls === 'frigate' && ship.sig >= 0.42 && Math.abs(wrap(ship.brg - p.h)) < 0.08 && p.readyT > 0) {
        mem.pulse = !mem.pulse; inp.fire = mem.pulse; inp.silent = false;
        if (st.stats.fired > mem.shots) {
          mem.shots = st.stats.fired;
          if (mem.shots % 2 === 0) { if (opt.wire === 'cut') { mem.cutUntil = st.t + 4; mem.clearUntil = st.t + 44; mem.side = -mem.side; } else mem.hold = true; }
        }
      }
      return inp;
    };
  };
}
// Shakedown. Does what the prompt on screen asks for, one step at a time.
function trainee() {
  let pulse = false;
  return st => {
    const p = st.player, inp = blank(), key = st.coach ? st.coach.key : '';
    inp.throttle = 2;
    if (key === 'steer') { const w = mark(st, 'waypoint'); steer(inp, p, bearing(p.x, p.z, w.x, w.z)); inp.throttle = 3; }
    else if (key === 'dive') inp.depthCmd = st.layer + 15;
    else if (key === 'scope') { inp.depthCmd = 9; inp.throttle = 1; inp.mast = p.depth <= 11; }
    else if (key === 'decoy') { inp.depthCmd = 9; pulse = !pulse; inp.decoy = pulse; }
    else if (key === 'shoot') {
      const hk = mark(st, 'hulk'), b = bearing(p.x, p.z, hk.x, hk.z), d = dist(p, hk), c = st.contacts.find(q => q.kind === 'hulk');
      if (c) inp.target = c.id;      // the periscope look gave a fix on it: fire control aims the shot. Not seen: the torpedo runs out along the bow.
      steer(inp, p, b); inp.throttle = d > 1000 ? 3 : 1;
      if (d < 1200 && Math.abs(wrap(b - p.h)) < 0.04 && !st.torps.length) { pulse = !pulse; inp.fire = pulse; }
    }
    return inp;
  };
}
// Through the Gate. Goes under the layer, keeps off the shoals that would push it back up, waits south of the patrol line until the frigate
// has passed, and crosses astern of it. The frigate's place and direction come from its pings, which the boat hears and the map shows;
// the two ends of its patrol line are marked on the map.
function sneak() {
  const mem = { lastTorp: 0, decoyT: -99, f: null, dir: 0, side: 0 };
  return st => {
    const p = st.player, inp = blank(), exit = mark(st, 'exit'), line = mark(st, 'patrol'), torp = strongest(st, 'torp');
    inp.throttle = 2; inp.depthCmd = Math.min(st.layer + 45, 150);
    const ping = st.heard[st.heard.length - 1];
    if (ping && (!mem.f || ping.t > mem.f.t)) { if (mem.f && Math.abs(ping.x - mem.f.x) > 20) mem.dir = Math.sign(ping.x - mem.f.x); mem.f = { x: ping.x, z: ping.z, t: ping.t }; }
    const lo = Math.min(line.x, line.x2), hi = Math.max(line.x, line.x2), lz = line.z + (line.z2 - line.z) * clamp((p.x - line.x) / (line.x2 - line.x), 0, 1);
    // where the frigate will be along its line some seconds from now, turning round at each end
    const ahead = s => { let x = mem.f.x + mem.dir * 6 * (st.t - mem.f.t), d = mem.dir; for (let k = 0; k < s; k += 5) { x += d * 30; if (x > hi) { x = hi; d = -1; k += 45; } else if (x < lo) { x = lo; d = 1; k += 45; } } return x; };
    let tx = exit.x, tz = exit.z;
    const south = p.z - lz;                                   // how far the boat still is south of the line
    if (south > -450 && st.enemy.level < 2) {
      let safe = false;
      if (mem.f && mem.dir && st.t - mem.f.t < 30) {
        const v = p.below ? 7 : 5, t1 = Math.max(0, south - 450) / v, t2 = (south + 450) / v;
        safe = true; for (let s = t1; s <= t2; s += 5) if (Math.abs(p.x - ahead(s)) < 550) safe = false;
      }
      if (safe || south < 380) { tx = p.x; tz = lz - 700; if (p.below) inp.throttle = 3; }       // clear: cross now, briskly once under the layer
      else if (south < 700) { tx = p.x - mem.dir * 400; tz = p.z + 60; inp.throttle = 1; }           // wait: loiter south of the line, drifting astern of the frigate
      else { tx = p.x; tz = lz + 650; }                                                               // close up to the waiting line
    } else if (south < -900 && p.below) inp.throttle = 3;
    let h = bearing(p.x, p.z, tx, tz);
    // steer round any shoal that would lift the boat above the layer
    const clear = a => { for (const d of [150, 300, 450]) { const x = p.x + Math.cos(a) * d, z = p.z - Math.sin(a) * d; for (const s of st.bed.shoals) { const need = s.h / Math.max(5, 125 - st.layer); if (need > 1 && Math.hypot(x - s.x, z - s.z) < s.r * Math.sqrt(Math.log(need)) + 80) return false; } } return true; };
    if (!clear(h)) { let best = null; for (const o of [0.3, 0.6, 0.9, 1.2, 1.5, 1.9]) { for (const sg of mem.side ? [mem.side] : [1, -1]) if (!best && clear(h + sg * o)) best = sg * o; if (best) break; } if (best) { mem.side = Math.sign(best); h += best; } } else mem.side = 0;
    if (st.enemy.level >= 3 && st.t - mem.decoyT > 20) { mem.decoyT = st.t; inp.decoy = true; }
    steer(inp, p, h);
    if (st.enemy.level >= 3 && mem.f) { steer(inp, p, bearing(mem.f.x, mem.f.z, p.x, p.z)); inp.throttle = 3; inp.depthCmd = 150; }   // caught: open the range
    if (torp) evade(st, inp, torp, mem, true);
    return inp;
  };
}
// Shoot first: no stealth and no evasion. Charges the contact, slows to Half just before firing range so the wires hold, and fires pairs
// as soon as the contact is classified as a frigate.
function shootFirst() {
  let pulse = false;
  return st => {
    const p = st.player, inp = blank(), ship = pick(st, 'frigate');
    inp.throttle = (ship && ship.sig >= 0.3) || st.torps.some(t => t.side === 0 && t.wire) ? 2 : 3; inp.depthCmd = 40;
    if (!ship) return inp;
    steer(inp, p, ship.brg); guide(st, inp, ship);
    if (ship.cls === 'frigate' && ship.sig >= 0.42 && Math.abs(wrap(ship.brg - p.h)) < 0.1 && p.speed < 6.4) { pulse = !pulse; inp.fire = pulse; }
    return inp;
  };
}
const idle = () => () => ({});
// Random: holds each random order for one or two seconds, and sometimes sends values far out of range.
function randomPlayer(seed) {
  let a = seed >>> 0; const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const wild = [NaN, Infinity, -Infinity, 1e9, -1e9, undefined, null, 'x'];
  // Stage I: a contact picked for fire control, an order to it or to a torpedo, and the torpedo settings. These come from a second generator, so the
  // older orders above are the same numbers as before Stage I. Some of them are nonsense: unknown orders, ids that do not exist, values far out of range.
  let b = (seed ^ 0x51ed270b) >>> 0; const r2 = () => { b = (Math.imul(b, 1664525) + 1013904223) >>> 0; return b / 4294967296; };
  const cmds = ['course+', 'course-', 'speed+', 'speed-', 'auto', 'restart', 'retarget', 'reject', 'next', 'weapon', '', '', '', 'constructor', '__proto__', 'fire', 7];
  // Stage J: the weapon and the attack chosen for the next shot, and orders to swap a tube or cancel a swap, from a third generator (so every older order is the
  // same number as before Stage J). With Missile chosen the random presses of Fire go through the launch gate. Some values are nonsense here too.
  let c = (seed ^ 0x2f6b9d1c) >>> 0; const r3 = () => { c = (Math.imul(c, 1664525) + 1013904223) >>> 0; return c / 4294967296; };
  let hold3 = 0, extra = {};
  let hold = 0, inp = {}, hold2 = 0, more = {};
  return st => {
    if (--hold3 <= 0) {
      hold3 = 10 + Math.floor(r3() * 60);
      extra = { weapon: r3() < 0.35 ? 1 : 0, attack: Math.floor(r3() * 2) }; const q = r3();
      if (q < 0.15) { extra.cmd = 'swap'; extra.arg = Math.floor(r3() * 2); } else if (q < 0.25) extra.cmd = 'unswap';
      if (r3() < 0.08) extra[['weapon', 'attack'][Math.floor(r3() * 2)]] = wild[Math.floor(r3() * wild.length)];
      inp = Object.assign({}, inp, extra);
    }
    if (--hold <= 0) {
      hold = 30 + Math.floor(r() * 30);
      inp = { rudder: r() * 2 - 1, throttle: Math.floor(r() * 5), depthCmd: r() * 220, fire: r() < 0.3, ping: r() < 0.1, silent: r() < 0.2, decoy: r() < 0.15, mast: r() < 0.25, wire: r() * 2 - 1 };
      if (r() < 0.08) { const k = ['rudder', 'throttle', 'depthCmd', 'wire', 'mast', 'decoy'][Math.floor(r() * 6)]; inp[k] = wild[Math.floor(r() * wild.length)]; }
      Object.assign(inp, more, extra);
    }
    if (--hold2 <= 0) {
      hold2 = 6 + Math.floor(r2() * 40);
      const cs = st && st.contacts ? st.contacts.filter(c => c.kind !== 'torp' && c.kind !== 'helo') : [], ts = st && st.torps ? st.torps.filter(t => t.side === 0) : [];
      more = { target: cs.length && r2() < 0.8 ? cs[Math.floor(r2() * cs.length)].id : Math.floor(r2() * 20000), cmd: cmds[Math.floor(r2() * cmds.length)], arg: ts.length && r2() < 0.7 ? ts[Math.floor(r2() * ts.length)].id : Math.floor(r2() * 50),
        launch: Math.floor(r2() * 2), enable: Math.floor(r2() * 3), runDepth: Math.floor(r2() * 2), search: Math.floor(r2() * 3) };
      if (r2() < 0.1) { const k = ['target', 'cmd', 'arg', 'launch', 'enable', 'runDepth', 'search'][Math.floor(r2() * 7)]; more[k] = wild[Math.floor(r2() * wild.length)]; }
      inp = Object.assign({}, inp, more, extra);
    }
    return inp;
  };
}
// Transit players for the detection check: both head for the contact and never fire.
const transit = (throttle, depth, silent) => () => st => {
  const p = st.player, inp = blank(), ship = pick(st, 'frigate');
  inp.throttle = throttle; inp.depthCmd = depth; inp.silent = silent; if (ship) steer(inp, p, ship.brg); return inp;
};
// For the torpedo checks: ping once so the other side gets a firm position. Then do nothing ('none'), run fast and deep ('run', with or without
// noisemakers), or only turn away at Half ('turn', with or without noisemakers).
const pingThen = (how, decoys) => () => {
  const mem = { lastTorp: 0 };
  return st => {
    const p = st.player, inp = blank(), torp = strongest(st, 'torp'), helo = strongest(st, 'helo');
    inp.throttle = 2; inp.depthCmd = 40; inp.ping = st.t > 2 && st.t < 3;
    if (how === 'none') return inp;
    if (how === 'turn') { if (torp) { steer(inp, p, torp.brg + PI); if (decoys && torp.id !== mem.lastTorp) { mem.lastTorp = torp.id; inp.decoy = true; } } return inp; }
    if (torp) evade(st, inp, torp, mem, decoys);
    else if (helo) { steer(inp, p, helo.brg + PI); inp.throttle = 4; inp.depthCmd = 160; }
    else if (st.t > 3) { inp.throttle = 1; inp.silent = true; inp.depthCmd = 160; }
    return inp;
  };
};
// Shoals are on the map: near one, order a depth that clears it.
const overShoals = (st, inp) => { const p = st.player; for (const s of st.bed.shoals) if (Math.hypot(p.x - s.x, p.z - s.z) < s.r * 1.6 + 200) inp.depthCmd = Math.min(inp.depthCmd, Math.max(20, 120 - s.h)); return inp; };
// Hunted. Dives under the layer and runs from the frigate, throws a noisemaker at each torpedo, and goes quiet whenever the threat word
// says they no longer hold a firm position.
function survivor() {
  const mem = { lastTorp: 0, away: null };
  return st => {
    const p = st.player, inp = blank(), ship = pick(st, 'frigate'), torp = strongest(st, 'torp');
    if (ship) mem.away = ship.brg + PI;
    inp.depthCmd = 160;
    if (torp) { evade(st, inp, torp, mem, true); return overShoals(st, inp); }
    if (mem.away !== null) steer(inp, p, mem.away);
    if (st.enemy.level >= 3) inp.throttle = 3; else { inp.throttle = 1; inp.silent = true; }
    return overShoals(st, inp);
  };
}
// Strait Shadow. The map shows the route the high-value ship is expected to take, so one bearing on it gives its place along that route,
// and its speed along the route carries that forward when the contact fades. Runs under the layer to a point off its near beam, zigzags there
// (0.6 rad either side of the bearing, 40 s legs) until fire control has a solution of Fair or better (or for 150 s), fires a pair aimed by that
// solution, holds the wire, then goes deep and opens the range from the frigates until clear.
// The raider plots any contact that could still be the high-value ship, but fires only once it is classified as that.
const byClass = (st, cls) => { let b = null; for (const c of st.contacts) if (c.kind === 'ship' && c.cls === cls && (!b || c.sig > b.sig)) b = c; return b; };
function raider() {
  const mem = { lastTorp: 0, pulse: false, shots: 0, hold: false, away: PI * 1.5, est: null, estT: 0, decoyT: -99, legT: 0, zig: 1, closeT: -1 };
  return st => {
    const p = st.player, inp = blank(), cargo = pick(st, 'cargo'), frig = byClass(st, 'frigate'), torp = strongest(st, 'torp');
    const wires = st.torps.filter(t => t.side === 0 && t.wire).length, route = mark(st, 'route');
    const L = Math.hypot(route.x2 - route.x, route.z2 - route.z), ux = (route.x2 - route.x) / L, uz = (route.z2 - route.z) / L;
    const known = !!cargo && cargo.cls === 'cargo', { q } = solutionOf(st, known ? cargo : null);
    if (known) inp.target = cargo.id;
    presets(inp); nurse(st, inp, cargo);
    if (frig) mem.away = frig.brg + PI;
    if (torp) { evade(st, inp, torp, mem, true); mem.hold = false; return overShoals(st, inp); }
    if (st.phase === 1) {
      steer(inp, p, mem.away); inp.throttle = 2; inp.depthCmd = 150;
      if (st.enemy.level >= 3) { inp.throttle = 3; if (st.t - mem.decoyT > 25) { mem.decoyT = st.t; inp.decoy = true; } }
      return overShoals(st, inp);
    }
    inp.depthCmd = Math.min(st.layer + 30, 140);
    // where the bearing crosses the route is where the ship is
    if (cargo) {
      const bx = Math.cos(cargo.brg), bz = -Math.sin(cargo.brg), den = bx * uz - bz * ux;
      if (Math.abs(den) > 0.15) { const s = ((route.x - p.x) * uz - (route.z - p.z) * ux) / den, k = ((route.x - p.x) * bz - (route.z - p.z) * bx) / den; if (s > 200) { mem.est = clamp(k, -500, L + 4000); mem.estT = st.t; } }
    }
    if (mem.hold) {
      if (wires && cargo) { steer(inp, p, cargo.brg, 0.7); inp.throttle = 1; return overShoals(st, inp); }
      mem.hold = false;
    }
    if (st.t - mem.legT > 40) { mem.legT = st.t; mem.zig = -mem.zig; }
    const close = known && cargo.sig >= 0.28;
    if (close && mem.closeT < 0) mem.closeT = st.t;
    if (close) { steer(inp, p, cargo.brg + mem.zig * 0.6); inp.throttle = 1; inp.silent = p.readyT >= 2 && !wires; }
    else if (mem.est === null) { inp.throttle = 2; if (cargo) steer(inp, p, cargo.brg); }
    else {
      // cut it off: the first point along its route that the boat can reach before the ship does, 1 km short of the route so the leading
      // frigate passes well clear. A long chase is run at Full.
      const now = mem.est + 5 * (st.t - mem.estT), side = Math.sign((p.x - route.x) * uz - (p.z - route.z) * ux) || 1;
      let tx = 0, tz = 0, a = 0;
      for (; a <= 4000; a += 100) { tx = route.x + ux * (now + a) + uz * side * 1050; tz = route.z + uz * (now + a) - ux * side * 1050; if (Math.hypot(tx - p.x, tz - p.z) / 5 <= a / 5 + 20) break; }
      steer(inp, p, bearing(p.x, p.z, tx, tz)); inp.throttle = a > 1500 ? 3 : Math.hypot(tx - p.x, tz - p.z) > 150 ? 2 : 1;
    }
    const good = !!q && q.fit && q.r !== null && q.g >= 2, late = !!q && q.fit && q.g >= 1 && st.t - mem.closeT > 150;
    if (close && (good || late) && p.readyT > 0 && wires < 2) {
      mem.pulse = !mem.pulse; inp.fire = mem.pulse; inp.silent = false;
      if (st.stats.fired > mem.shots) { mem.shots = st.stats.fired; if (mem.shots % 2 === 0) mem.hold = true; }
    }
    return overShoals(st, inp);
  };
}
// Free Patrol. The First Blood attack, repeated on whichever frigate is loudest.
const PLAYERS = { shakedown: trainee, gate: sneak, firstblood: attacker(), hunted: survivor, strait: raider, patrol: attacker() };

/* ---------- runner ---------- */
function finite(o, path, bad) {
  if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(path); }
  else if (o && typeof o === 'object') for (const k in o) finite(o[k], path + '.' + k, bad);
}
function run(mission, seed, makePlayer, opt) {
  opt = opt || {};
  const sim = createSim({ mission, seed, difficulty: opt.difficulty || 'standard' }), st = sim.state, player = makePlayer(seed);
  // a set number of seconds, or until the mission's own clock ends it (Strait Shadow restarts its clock for the escape)
  const limit = opt.seconds ? Math.ceil(opt.seconds / STEP) + 2 : Infinity;
  const out = { result: '', t: 0, maxLevel: 0, firstOutT: -1, firstHitTakenT: -1, bad: [], error: null, ev: {} };
  try {
    for (let i = 0; i < limit && !st.over && st.t < st.timeLimit + 1; i++) {
      const inp = player(st); sim.step(STEP, inp);
      for (const e of sim.events) {
        out.ev[e.type] = (out.ev[e.type] || 0) + 1;
        // Stage J: how each missile ended, and what the solution lacked when a launch was refused for it
        const mk = e.type === 'mEnd' ? 'm:' + e.why : e.type === 'hit' && e.weapon === 'missile' ? 'm:hit' : '';
        if (mk) out.ev[mk] = (out.ev[mk] || 0) + 1;
        if (e.type === 'refuse' && e.what === 'missile' && e.why === 'solution') { const k = st.tracks.find(q => q.id === inp.target), why = !k || !k.sol.fit ? 'none' : k.sol.g < SIM.V.missile.grade ? 'grade' : k.sol.r === null ? 'range' : 'other'; out.ev['no:' + why] = (out.ev['no:' + why] || 0) + 1; }
        if (e.type === 'mFire' && (e.route || e.direct)) out.ev.mAsk = (out.ev.mAsk || 0) + 1;
        if (e.type === 'shipOut' && out.firstOutT < 0) out.firstOutT = e.t;
        if (e.type === 'playerHit' && out.firstHitTakenT < 0) out.firstHitTakenT = e.t;
      }
      sim.events.length = 0;
      if (st.enemy.level > out.maxLevel) out.maxLevel = st.enemy.level;
      if (opt.checkEvery && i % opt.checkEvery === 0) finite(st, 'state', out.bad);
    }
    // the sea keeps moving behind the result card: a few seconds of that must not change the result or break anything
    if (st.over && opt.after) { const r = st.result, t = st.t; for (let i = 0; i < 150; i++) sim.step(STEP, player(st)); if (st.result !== r || st.t !== t || sim.events.length) out.bad.push('changed after the end'); }
  } catch (e) { out.error = e; }
  finite(st, 'state', out.bad);
  out.result = st.result; out.t = st.t; out.over = st.over; out.stats = st.stats; out.lost = st.dmg.lost; out.state = st;
  return out;
}
const rate = (n, f) => { let k = 0; for (let i = 0; i < n; i++) if (f(i)) k++; return k / n; };

/* ---------- checks ---------- */
const t0 = Date.now();
{
  const a = run('firstblood', 7, PLAYERS.firstblood), b = run('firstblood', 7, PLAYERS.firstblood);
  check('sim', [[!/Math\.random|\bDate\b|\bperformance\b|\bTHREE\b|\bdocument\b|\bwindow\b|requestAnimationFrame/.test(simText), 'pure and seeded'],
    [JSON.stringify(a.state) === JSON.stringify(b.state), 'same seed, same game'],
    [['constructor', '__proto__', 'toString', 'nonsense', '', null, 7].every(bad => { const s = createSim({ mission: bad, difficulty: bad, seed: 3 }); for (let i = 0; i < 90; i++) s.step(STEP, { throttle: 2 }); const bad2 = []; finite(s.state, 'state', bad2); return s.state.mission === 'firstblood' && s.state.difficulty === 'standard' && bad2.length === 0; }), 'bad names fall back']], 'pure, seeded, repeatable; bad names fall back');
}
const SEEDS = [11, 23, 37, 41, 59], table = [], graded = [];
// Stage I: the share of 40 games (seeds 500 to 539) the scripted player must win in each mission
const mRandom = {};
const PASS_MARK = { shakedown: 1, gate: 1, firstblood: 0.85, hunted: 0.7, strait: 0.8 };
for (const id of want('missions') ? Object.keys(MISSIONS) : []) {
  const M = MISSIONS[id], player = PLAYERS[id], parts = [];
  if (M.endless) continue;
  // 1. the scripted player wins: at least the mission's pass mark over 40 seeds; and the fixed seed, and at least 4 of 5 other seeds.
  // In Hunted the six fixed seeds are printed but not counted: its pass mark is 70%, and at that rate (or at the 83% measured over 160 seeds, the same before
  // and after Stage I) six games cannot be asked to come out 1 and 4 of 5. Stage I took the old range-bias draws out of the shared random stream, so the same
  // seed now deals the other side different dice; its code and its game values are unchanged.
  const fixed = run(id, 1, player), tries = SEEDS.map(s => run(id, s, player)), wins = tries.filter(r => r.result === 'win').length;
  const won40 = rate(40, i => run(id, 500 + i, player).result === 'win'), six = fixed.result === 'win' && wins >= 4;
  parts.push([won40 >= PASS_MARK[id], 'scripted wins ' + pct(won40) + ' of 40 seeds (pass mark ' + pct(PASS_MARK[id]) + ')']);
  parts.push([six || id === 'hunted', 'scripted wins ' + wins + '/5' + (fixed.result === 'win' ? '' : ' but loses seed 1') + (six ? '' : ' (' + (id === 'hunted' ? 'not counted in Hunted; ' : '') + [fixed].concat(tries).map((r, i) => r.result === 'win' ? '' : 'seed ' + [1].concat(SEEDS)[i] + ': ' + r.state.reason + ' at ' + Math.round(r.t) + ' s').filter(Boolean).join('; ') + ')')]);
  // 2. an idle player fails, on every one of those seeds; in Hunted, where waiting is the way to win, it must lose the boat
  const lazy = [1].concat(SEEDS).map(s => run(id, s, idle));
  parts.push([lazy.every(r => r.over && r.result === 'lose' && (id !== 'hunted' || r.lost)), 'idle fails' + (id === 'hunted' ? ' (the boat is lost)' : '')]);
  // 3. fuzz: 200 random players
  let ended = 0, nan = 0, threw = 0, rwins = 0, late = 0, rm = 0, rs = 0;
  for (let s = 1; s <= 200; s++) {
    const r = run(id, 1000 + s, randomPlayer, { checkEvery: 300, after: true });
    if (r.over) ended++; if (r.bad.length) nan++; if (r.error) threw++; if (r.result === 'win') rwins++; if (r.t > r.state.timeLimit + STEP) late++;
    rm += r.ev.mFire || 0; rs += r.ev.swap || 0;
    for (const k of Object.keys(r.ev)) if (k.indexOf('m:') === 0 || k.indexOf('no:') === 0 || k === 'mFire') mRandom[k] = (mRandom[k] || 0) + r.ev[k];
  }
  const clean = ended === 200 && nan === 0 && threw === 0 && late === 0;
  parts.push([clean, clean ? '200 random end cleanly (they launched ' + rm + ' missiles; ' + rs + ' tube swaps were ordered or begun)' : '200 random: ' + ended + ' ended, ' + late + ' late, ' + nan + ' bad states, ' + threw + ' errors']);
  check(id, parts);
  graded.push(fixed, ...tries, ...lazy);
  table.push(M.name + ' ' + (won40 * 100).toFixed(0) + '/' + (rwins / 2).toFixed(0));
}
// Free Patrol has no win: every game must end with the boat lost, and the score must be what the frigates put out of action are worth
if (want('patrol')) {
  const id = 'patrol', P = SIM.V.patrol.points, parts = [];
  const tally = (seed, mk, opt) => { const sim = createSim({ mission: id, seed }), st = sim.state, pl = mk(seed), bad = []; let pts = 0, outs = 0, err = null;
    try { for (let i = 0; i < 3600 * 30 && !st.over; i++) { sim.step(STEP, pl(st)); for (const e of sim.events) { if (e.type === 'score') pts += e.add; if (e.type === 'shipOut' && !e.neutral) outs++; } sim.events.length = 0; if (opt && i % 300 === 0) finite(st, 'state', bad); } } catch (e) { err = e; }
    finite(st, 'state', bad);
    return { st, pts, outs, seed, ok: !err && !bad.length && st.over && st.dmg.lost && /^Boat lost \(simulated\)/.test(st.reason) && st.result === 'lose' }; };
  const games = []; for (let i = 0; i < 20; i++) games.push(tally(100 + i, PLAYERS.patrol));
  // the score is the sum of what was reported: at least the base points for each frigate, less the fine for each neutral ship hit and each torpedo set off among sea life, never below zero
  const right = g => g.st.score === g.pts && g.st.stats.out === g.outs && g.pts >= Math.max(0, P * g.outs - SIM.V.neutral.fine * (g.st.stats.neutral + g.st.stats.bio)) && (g.outs || g.pts === 0);
  const outs = games.reduce((n, g) => n + g.outs, 0), exact = games.every(g => right(g));
  parts.push([outs >= 10 && exact, 'score rises with each of ' + outs + ' frigates put out in 20 games' + (exact ? '' : ' (wrong in seeds ' + games.filter(g => !(right(g))).map(g => g.seed + ': score ' + g.st.score + ', events ' + g.pts + ', out ' + g.st.stats.out + '/' + g.outs + ', neutral ' + g.st.stats.neutral + ', sea life ' + g.st.stats.bio).join('; ') + ')')]);
  const notOk = games.filter(g => !g.ok);
  parts.push([!notOk.length && [1].concat(SEEDS).every(s => { const g = tally(s, idle); return g.ok && g.st.score === 0; }), 'scripted and idle games end with the boat lost' + (notOk.length ? ' (not seeds ' + notOk.map(g => g.seed + ': t ' + Math.round(g.st.t) + ', ' + g.st.reason + ', score ' + g.st.score).join('; ') + ')' : '')]);
  let good = 0; for (let s = 1; s <= 200; s++) if (tally(1000 + s, randomPlayer, true).ok) good++;
  parts.push([good === 200, good === 200 ? '200 random end cleanly, boat lost' : '200 random: only ' + good + ' ended cleanly with the boat lost']);
  check(id, parts, 'score rises per frigate out; ends with the boat lost; 200 random end cleanly');
  graded.push(...games.map(g => ({ result: g.st.result, state: g.st })));
}
// stars: a win earns one to three, a loss none; Free Patrol earns them by score
if (want('stars')) {
  // a neutral ship hit, or a torpedo set off among sea life, costs one star (never in Free Patrol, where it costs points)
  const wrong = graded.filter(r => { const g = r.state.grade, n = g ? g.stars : -1, st = r.state, hits = st.stats.neutral + st.stats.bio, fine = hits > 0 && st.mission !== 'patrol' ? 1 : 0;
    if (!g || g.lines.length !== 3 || n !== Math.max(0, g.lines.filter(l => l.ok).length - fine) || !!g.penalty !== hits > 0) return true;
    if (st.mission === 'patrol') return n !== (st.score >= 1200 ? 3 : st.score >= 500 ? 2 : st.score >= 100 ? 1 : 0); return r.result === 'win' ? !(n >= 1 - fine && n <= 3 - fine) : n !== 0; });
  const hitN = graded.filter(r => r.state.stats.neutral > 0).length, hitB = graded.filter(r => r.state.stats.bio > 0).length;
  check('stars', [[!wrong.length, 'a win earns 1 to 3, a loss 0, in ' + graded.length + ' games (' + hitN + ' with a neutral ship hit, ' + hitB + ' with sea life hit)' + (wrong.length ? ': wrong in ' + wrong.map(r => r.state.mission + ' seed ' + r.state.seed).join(', ') : '')]], 'win 1 to 3, loss 0, in ' + graded.length + ' games');
}
// balance, all on First Blood unless said
if (want('balance')) {
  const N = 40, id = 'firstblood', parts = [];
  const sf = []; for (let i = 0; i < N; i++) sf.push(run(id, 300 + i, shootFirst));
  const sfWin = sf.filter(r => r.result === 'win').length / N;
  parts.push([sfWin >= 0.6, 'shoot at first contact wins ' + pct(sfWin)]);
  const hitRate = (mk, n) => rate(n || N, i => run(id, 700 + i, mk, { seconds: 240 }).stats.taken > 0);
  const passive = hitRate(pingThen('none')), evading = hitRate(pingThen('run', false));
  parts.push([passive >= 0.6 && evading <= 0.4, 'tracked boat hit: idle ' + pct(passive) + ', running deep ' + pct(evading)]);
  const found = mk => rate(200, i => run(id, 900 + i, mk, { seconds: 420 }).maxLevel >= 2);
  const loud = found(transit(3, 20, false)), quiet = found(transit(1, 160, true));
  parts.push([loud >= quiet + 0.3 && quiet >= 0.15 && quiet <= 0.35, 'located: fast and shallow ' + pct(loud) + ', silent and deep ' + pct(quiet)]);
  // noisemakers: the same weak evasion (only turning away at Half) with and without them
  const bare = hitRate(pingThen('turn', false), 100), decoyed = hitRate(pingThen('turn', true), 100);
  parts.push([decoyed <= bare - 0.2, 'hit without noisemakers ' + pct(bare) + ', with ' + pct(decoyed)]);
  // wire: the same attack with the wire held and steered, and with the wire cut straight after firing
  const shots = mk => { let f = 0, h = 0, w = 0; for (let i = 0; i < 100; i++) { const r = run(id, 1300 + i, mk); f += r.stats.fired; h += r.stats.hits; if (r.result === 'win') w++; } return { per: h / Math.max(1, f), win: w / 100 }; };
  const held = shots(hunter({ wire: 'steer' })), cut = shots(hunter({ wire: 'cut' }));
  parts.push([held.per >= cut.per + 0.15 && held.win > cut.win, 'hits per torpedo: wire held ' + pct(held.per) + ', cut ' + pct(cut.per)]);
  // layer: the frigate's own sonar against a boat crossing its line at Slow just above or just below the layer (Through the Gate, where the
  // helicopter starts on deck), and the helicopter's dipping sonar against a boat that pinged once and then creeps just above or below it
  const cross = off => rate(100, i => run('gate', 1500 + i, () => st => { const inp = blank(), ex = mark(st, 'exit'); inp.throttle = 1; inp.depthCmd = st.layer + off; steer(inp, st.player, bearing(st.player.x, st.player.z, ex.x, ex.z)); return inp; }, { seconds: 420 }).maxLevel >= 3);
  const dips = off => { let close = 0, fix = 0; for (let i = 0; i < 100; i++) { const sim = createSim({ mission: id, seed: 1700 + i }), st = sim.state; for (let n = 0; n < 9000 && !st.over; n++) { const inp = blank(), f0 = st.enemy.fixAge; inp.throttle = 1; inp.depthCmd = st.layer + off; inp.ping = st.t > 2 && st.t < 3; inp.silent = st.t > 3; sim.step(STEP, inp); for (const e of sim.events) if (e.type === 'ping' && e.src === 'dip' && e.d < 650) { close++; if (st.enemy.fixAge < f0 && st.enemy.fixAge < 0.1) fix++; } sim.events.length = 0; } } return fix / Math.max(1, close); };
  const hullUp = cross(-12), hullDown = cross(12), dipUp = dips(-12), dipDown = dips(12);
  parts.push([hullUp >= hullDown + 0.2 && dipDown >= 0.5 && dipDown >= 0.7 * dipUp, 'frigate tracks a crossing above the layer ' + pct(hullUp) + ', below ' + pct(hullDown) + '; dipping sonar fixes ' + pct(dipUp) + ', ' + pct(dipDown)]);
  // search: the boat is put 4 km from the frigate (staged), pings once or not at all, then creeps away silent. Does the frigate come over 1 km closer to that spot within 3 minutes?
  const closes = ping => rate(100, i => { const sim = createSim({ mission: id, seed: 1900 + i }), st = sim.state, s = st.ships[0], p = st.player; p.x = s.x + 4000; p.z = s.z; const x0 = p.x, z0 = p.z; let dmin = 4000; for (let n = 0; n < 5400 && !st.over; n++) { const inp = blank(); inp.throttle = 1; inp.depthCmd = 160; inp.silent = st.t > 3; inp.ping = ping && st.t > 2 && st.t < 3; sim.step(STEP, inp); sim.events.length = 0; dmin = Math.min(dmin, Math.hypot(s.x - x0, s.z - z0)); } return dmin < 3000; });
  const drawn = closes(true), undrawn = closes(false);
  parts.push([drawn >= 0.6 && undrawn <= 0.3, 'frigate closes on a ping from 4 km ' + pct(drawn) + ', unpinged ' + pct(undrawn)]);
  // periscope: a short look is a small risk, a long one is very likely seen
  const seen = look => rate(200, i => { const sim = createSim({ mission: id, seed: 2100 + i }), st = sim.state; let up = 0, got = false; for (let n = 0; n < 6000 && !st.over && up < look * 30; n++) { const inp = blank(); inp.throttle = 1; inp.depthCmd = 9; inp.mast = st.t >= 60; if (inp.mast) up++; sim.step(STEP, inp); for (const e of sim.events) if (e.type === 'mastSeen') got = true; sim.events.length = 0; } return got; });
  const quick = seen(3), long = seen(20);
  parts.push([quick <= 0.12 && long >= 0.5, 'mast seen in a 3 s look ' + pct(quick) + ', 20 s ' + pct(long)]);
  check('balance', parts, parts.length + ' measured rules hold (-v lists them)');
}
// neutral traffic: sonar clutter in every mission but the exercise
if (want('traffic')) {
  const parts = [], combat = Object.keys(MISSIONS).filter(id => id !== 'shakedown'), n = {}; let near = 0, moved = 0, total = 0;
  for (const id of Object.keys(MISSIONS)) {
    n[id] = [99, 0];
    for (let s = 1; s <= 30; s++) {
      const sim = createSim({ mission: id, seed: s }), st = sim.state, neu = st.ships.filter(q => q.neutral), at = neu.map(q => [q.x, q.z]);
      n[id][0] = Math.min(n[id][0], neu.length); n[id][1] = Math.max(n[id][1], neu.length);
      for (const q of neu) { total++; if (Math.hypot(q.x, q.z) < 900 || st.ships.some(o => !o.neutral && Math.hypot(o.x - q.x, o.z - q.z) < 500)) near++; }
      for (let i = 0; i < 900; i++) sim.step(STEP, { throttle: 1 });
      neu.forEach((q, i) => { if (Math.hypot(q.x - at[i][0], q.z - at[i][1]) > 30) moved++; });
    }
  }
  parts.push([n.shakedown[1] === 0 && combat.every(id => n[id][0] >= 2 && n[id][1] <= 3), 'none in Shakedown, 2 to 3 in each other mission']);
  parts.push([near === 0 && moved === total, total + ' placed clear of the boat and the warships, all under way']);
  check('traffic', parts, 'neutral ships in every mission but Shakedown, placed clear, under way');
}
// classification: a contact starts Unknown and listening works it out, shaft rate first, then blades, then class
if (want('classification')) {
  const parts = []; let firstUnknown = 0, firsts = 0, order = 0, classed = 0, wrong = 0, leak = 0, byKind = {};
  for (let seed = 1; seed <= 20; seed++) {
    const sim = createSim({ mission: seed % 2 ? 'firstblood' : 'strait', seed }), st = sim.state, seenIds = new Map();
    for (let i = 0; i < 300 * 30 && !st.over; i++) {
      sim.step(STEP, { throttle: 1, depthCmd: 20 }); sim.events.length = 0;
      if (i % 30) continue;
      for (const c of st.contacts) {
        if (c.kind !== 'ship') continue;
        const truth = st.ships.find(q => q.id === c.id), was = seenIds.get(c.id);
        if (!was) { firsts++; if (!c.cls && c.ident < 1 && !c.shaft && !c.blades) firstUnknown++; seenIds.set(c.id, { stage: 0, bad: false, done: false }); }
        const m = seenIds.get(c.id), stage = c.cls ? 3 : c.blades ? 2 : c.shaft ? 1 : 0;
        if (stage < m.stage || (c.blades && !c.shaft && !truth.out) ) m.bad = true; m.stage = stage;
        if (c.cls && !m.done) { m.done = true; classed++; byKind[c.cls] = (byKind[c.cls] || 0) + 1; if (c.cls !== truth.kind) wrong++; }
        // nothing the boat is shown may give the class away early
        const k = st.tracks.find(t => t.id === c.id);
        if (!c.cls && (JSON.stringify(c).includes(truth.kind) || (k && JSON.stringify(k).includes(truth.kind)) || 'neutral' in c)) leak++;
      }
    }
    for (const m of seenIds.values()) if (m.bad) order++;
  }
  parts.push([firsts >= 40 && firstUnknown === firsts, firsts + ' new contacts all start Unknown']);
  parts.push([order === 0 && classed >= 30 && wrong === 0 && leak === 0, classed + ' classified by listening, all correctly (' + Object.keys(byKind).sort().map(k => byKind[k] + ' ' + k).join(', ') + '); shaft rate, then blades, then class; nothing shown early']);
  // staged: the boat is held 2 km south of the merchant, bow on. How long until it is classified, stopped and at Full?
  const stage = (seed, mission, kind, dist, input, secs, fn) => { const sim = createSim({ mission, seed }), st = sim.state, s = st.ships.find(q => q.kind === kind), p = st.player; let out = -1;
    for (let i = 0; i < secs * 30 && !st.over; i++) { p.x = s.x; p.z = s.z + dist; p.h = PI / 2; sim.step(STEP, typeof input === 'function' ? input(st, i) : input); const r = fn(st, s, sim.events, i); sim.events.length = 0; if (r !== undefined) { out = r; break; } } return out; };
  const timeTo = thr => { let sum = 0, n = 0, never = 0; for (let seed = 1; seed <= 10; seed++) { const t = stage(seed, 'firstblood', 'merchant', 2000, { throttle: thr, depthCmd: 20 }, 240, (st, s) => { const c = st.contacts.find(c => c.id === s.id); return c && c.cls ? st.t : undefined; }); if (t < 0) never++; else { sum += t; n++; } } return { mean: n ? sum / n : Infinity, never }; };
  const slow = timeTo(0), fast = timeTo(3);
  parts.push([slow.never === 0 && slow.mean < 25 && (fast.never > 0 || fast.mean > slow.mean * 1.8), 'a merchant at 2 km is classified in ' + slow.mean.toFixed(0) + ' s stopped, ' + (fast.mean === Infinity ? 'never' : fast.mean.toFixed(0) + ' s') + ' at Full']);
  // a look through the periscope classifies at once; a ping gives a range but no class
  let sight = 0, pinged = 0;
  for (let seed = 1; seed <= 10; seed++) {
    if (stage(seed, 'firstblood', 'fishing', 1500, { throttle: 0, depthCmd: 9, mast: true }, 40, (st, s, ev) => { const c = st.contacts.find(c => c.id === s.id); return st.player.mast && st.player.mastT > 3 ? (c && c.cls === 'fishing' && c.range > 0 ? 1 : 0) : undefined; }) === 1) sight++;
    if (stage(seed, 'firstblood', 'merchant', 5300, st => ({ throttle: 2, depthCmd: 20, ping: st.t > 2 && st.t < 3 }), 9, (st, s) => { const c = st.contacts.find(c => c.id === s.id); return st.t > 6 ? (c && c.range > 0 && !c.cls && c.ident < 0.1 && !c.shaft && !c.blades ? 1 : 0) : undefined; }) === 1) pinged++;
  }
  parts.push([sight === 10 && pinged === 10, 'a periscope look classifies at once (' + sight + '/10); a ping gives range but no class (' + pinged + '/10)']);
  // sprint and drift: the slower the boat, the farther it hears. The boat is held at each range in turn until the merchant is heard.
  const reach = thr => { const sim = createSim({ mission: 'firstblood', seed: 3 }), st = sim.state, s = st.ships.find(q => q.kind === 'merchant'), p = st.player;
    for (let d = 7000; d >= 500; d -= 100) { for (let i = 0; i < (d === 7000 ? 1500 : 90); i++) { p.x = s.x; p.z = s.z + d; p.h = PI / 2; sim.step(STEP, { throttle: thr, depthCmd: 20 }); sim.events.length = 0; } if (st.contacts.some(c => c.id === s.id)) return { d, hear: p.hear }; } return { d: 0, hear: p.hear }; };
  const r0 = reach(0), r2 = reach(2), r4 = reach(4);
  parts.push([r0.d >= r2.d * 1.4 && r2.d >= r4.d * 2 && r0.hear > 1.5 && Math.abs(r2.hear - 1) < 0.01 && r4.hear < 0.35, 'a merchant is heard from ' + (r0.d / 1000).toFixed(1) + ' km stopped, ' + (r2.d / 1000).toFixed(1) + ' km at Half, ' + (r4.d / 1000).toFixed(1) + ' km at Flank']);
  check('classification', parts, 'contacts start Unknown; listening, or a periscope look, classifies them; slow and quiet hears farther');
}
// hitting a neutral ship: a star lost, the mission failed on Hard, points lost in Free Patrol
if (want('neutral')) {
  const parts = [];
  // staged: the boat is put 600 m south of the fishing boat, bow on, and fires once. After that the usual First Blood attack carries on.
  const strike = (seed, difficulty, mission, score) => { const sim = createSim({ mission: mission || 'firstblood', seed, difficulty }), st = sim.state, s = st.ships.find(q => q.kind === 'fishing'), p = st.player, pl = PLAYERS.firstblood(seed);
    const o = { hitT: -1, overAtHit: false, add: null, st };
    if (score) st.score = score;
    p.x = s.x; p.z = s.z + 600; p.h = PI / 2;
    for (let i = 0; i < 1200 * 30 && !st.over; i++) {
      const inp = o.hitT < 0 && st.t < 90 ? { throttle: 0, depthCmd: 20, fire: st.t > 1 && st.t < 1.2 } : mission === 'patrol' ? {} : pl(st);
      sim.step(STEP, inp);
      for (const e of sim.events) { if (e.type === 'hit' && e.neutral && o.hitT < 0) { o.hitT = st.t; o.overAtHit = st.over; } if (e.type === 'score' && e.neutral) o.add = e.add; }
      sim.events.length = 0;
      if (mission === 'patrol' && o.hitT >= 0) break;
    }
    return o; };
  const std = [], hard = [], easy = [];
  for (let seed = 1; seed <= 12; seed++) { std.push(strike(seed, 'standard')); hard.push(strike(seed, 'hard')); easy.push(strike(seed, 'relaxed')); }
  const hits = std.filter(o => o.hitT >= 0), wins = hits.filter(o => o.st.result === 'win');
  const fined = o => { const g = o.st.grade, earned = g.lines.filter(l => l.ok).length; return o.st.stats.neutral >= 1 && g.stars === Math.max(0, earned - 1) && /neutral/i.test(g.penalty); };
  parts.push([hits.length >= 10 && hits.every(o => !o.overAtHit) && wins.length >= 3 && hits.every(fined),
    'Standard: ' + hits.length + '/12 staged shots hit; the mission goes on; ' + wins.length + ' later won, each one star short of what it earned']);
  const hh = hard.filter(o => o.hitT >= 0);
  parts.push([hh.length >= 10 && hh.every(o => o.overAtHit && o.st.result === 'lose' && /neutral/.test(o.st.reason) && o.st.grade.stars === 0), 'Hard: all ' + hh.length + ' hits end the mission at once']);
  const eh = easy.filter(o => o.hitT >= 0);
  parts.push([eh.length >= 10 && eh.every(o => !o.overAtHit && fined(o)), 'Relaxed: the mission goes on, a star is lost']);
  const pa = strike(5, 'standard', 'patrol', 400), pb = strike(5, 'standard', 'patrol', 100), fine = SIM.V.neutral.fine;
  parts.push([pa.hitT >= 0 && pa.add === -fine && pa.st.score === 400 - fine && pb.add === -100 && pb.st.score === 0 && !pa.st.over, 'Free Patrol: ' + fine + ' points lost, never below zero']);
  // a careless captain: random players on Standard are never failed for it; on Hard the first neutral hit is the end
  let stdEnd = 0, hardHit = 0, hardBio = 0, hardWrong = 0, bad = 0;
  for (let s = 1; s <= 100; s++) {
    const a = run('strait', 3000 + s, randomPlayer, { after: true }), b = run('strait', 3000 + s, randomPlayer, { difficulty: 'hard', after: true });
    if (/neutral|sea life/.test(a.state.reason)) stdEnd++; if (a.error || a.bad.length || b.error || b.bad.length || !a.over || !b.over) bad++;
    if (b.stats.neutral > 0) { hardHit++; if (b.stats.neutral !== 1 || b.result !== 'lose' || !/neutral/.test(b.state.reason)) hardWrong++; }
    if (b.stats.bio > 0) { hardBio++; if (b.stats.bio !== 1 || b.result !== 'lose' || !/sea life/.test(b.state.reason)) hardWrong++; }
  }
  parts.push([stdEnd === 0 && hardWrong === 0 && bad === 0, '100 random games each way end cleanly (' + hardHit + ' on Hard ended by a neutral hit, ' + hardBio + ' by a torpedo among sea life, none on Standard)']);
  check('neutral penalty', parts, 'a neutral hit costs a star, fails the mission on Hard, costs points in Free Patrol');
}
// sea life: pods of whales and dolphins and schools of fish. They are sonar contacts like any other, they start Unknown, and a torpedo set off among them is penalised
if (want('sealife')) {
  const parts = [], B = SIM.V.bio, names = { whale: 'whales', dolphin: 'dolphins', fish: 'fish' };
  const seg = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1, k = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L)); return Math.hypot(x - ax - dx * k, z - az - dz * k); };
  // present in every mission, a few in the exercise; for ten minutes none comes near the start or a marked route, and each wanders near where it began
  const counts = {}, kinds = {}; let nearStart = 1e9, nearRoute = 1e9, farHome = 0, lazy = 0, pods = 0;
  for (const id of Object.keys(MISSIONS)) {
    counts[id] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const sim = createSim({ mission: id, seed }), st = sim.state, from = new Map(st.bios.map(b => [b.id, { b, x: b.x, z: b.z, lx: b.x, lz: b.z, path: 0 }]));
      counts[id].push(st.bios.length); for (const b of st.bios) kinds[id + ' ' + b.kind] = 1;
      for (let i = 0; i < 600 * 30; i++) {
        sim.step(STEP, {}); sim.events.length = 0; if (i % 30) continue;
        for (const b of st.bios) {
          nearStart = Math.min(nearStart, Math.hypot(b.x, b.z));
          for (const m of st.marks) { nearRoute = Math.min(nearRoute, seg(b.x, b.z, 0, 0, m.x, m.z)); if (m.x2 || m.z2) nearRoute = Math.min(nearRoute, seg(b.x, b.z, m.x, m.z, m.x2, m.z2)); }
          const f = from.get(b.id); if (!f) continue;
          f.path += Math.hypot(b.x - f.lx, b.z - f.lz); f.lx = b.x; f.lz = b.z; farHome = Math.max(farHome, Math.hypot(b.x - f.x, b.z - f.z) / B[b.kind].home);
        }
      }
      for (const f of from.values()) { pods++; if (f.path < 100) lazy++; }
    }
  }
  const fixed = Object.keys(MISSIONS).filter(id => MISSIONS[id].life), few = counts.shakedown, all = id => ['whale', 'dolphin', 'fish'].every(k => kinds[id + ' ' + k]);
  parts.push([fixed.length === 5 && fixed.every(id => counts[id].every(n => n === MISSIONS[id].life.length) && all(id)) && few.every(n => n === 3) && fixed.every(id => MISSIONS[id].life.length >= 3) && counts.patrol.every(n => n >= 2 && n <= B.max),
    'pods per game: ' + fixed.map(id => MISSIONS[id].name + ' ' + counts[id][0]).join(', ') + ', Free Patrol ' + Math.min(...counts.patrol) + ' to ' + Math.max(...counts.patrol) + '; whales, dolphins and fish in every mission']);
  parts.push([nearStart >= 450 && nearRoute >= 450 && farHome < 1.3 && lazy === 0, 'over 10 minutes in 60 games none comes within ' + Math.round(Math.min(nearStart, nearRoute)) + ' m of the start or a marked route; all ' + pods + ' wander, none beyond ' + farHome.toFixed(2) + ' of its range']);
  // the boat can sail straight through dolphins or fish: nothing is hit and nothing is lost. Through whales it brushes one (Stage G): a small jolt,
  // no breach, the animal unharmed and the pod scattering, and nothing that counts against the mission but the "no damage" star
  let through = 0, bumps = 0, tries = 0;
  for (let seed = 1; seed <= 6; seed++) { const sim = createSim({ mission: 'strait', seed }), st = sim.state, p = st.player, b = st.bios[seed % st.bios.length]; let ev = 0, bump = 0;
    for (let i = 0; i < 20 * 30; i++) { p.x = b.x; p.z = b.z; p.depth = Math.min(100, b.depth); p.vd = 0; sim.step(STEP, { throttle: 2, depthCmd: Math.min(100, b.depth) }); for (const e of sim.events) { if (e.type === 'bioHit' || e.type === 'bioScatter' || e.type === 'breach') ev++; if (e.type === 'collide' && e.with === 'bio') bump++; } sim.events.length = 0; }
    const clean = !st.over && st.stats.bio === 0 && st.stats.taken === 0 && st.stats.breaches === 0;
    if (b.kind === 'whale') { tries++; if (clean && bump === 1 && b.scareT > 0 && st.stats.collisions === 1) bumps++; }
    else if (clean && ev === 0 && bump === 0 && b.scareT <= 0 && st.stats.collisions === 0) through++; }
  parts.push([through === 6 - tries && bumps === tries && tries > 0, 'the boat sails through dolphins and fish unharmed, and they do not mind (' + through + '/' + (6 - tries) + '); through whales it brushes one: a jolt, no breach, the pod scatters (' + bumps + '/' + tries + ')']);
  // classification: a pod starts Unknown like any contact; listening works out that it is alive, and then which animal
  let firsts = 0, firstUnknown = 0, classed = 0, wrong = 0, early = 0, back = 0, told = 0; const byKind = {};
  for (let seed = 1; seed <= 24; seed++) {
    const sim = createSim({ mission: ['firstblood', 'strait', 'gate', 'shakedown'][seed % 4], seed }), st = sim.state, seen = new Map();
    for (let i = 0; i < 300 * 30 && !st.over; i++) {
      sim.step(STEP, { throttle: 1, depthCmd: 20 });
      for (const e of sim.events) if (e.type === 'classified' && e.kind === 'bio' && e.by === 'sound') told++;
      sim.events.length = 0; if (i % 30) continue;
      for (const c of st.contacts) {
        if (c.kind !== 'bio') continue;
        const truth = st.bios.find(q => q.id === c.id), k = st.btracks.find(t => t.id === c.id); let m = seen.get(c.id);
        if (!m) { firsts++; if (!c.cls && !c.bio && c.ident < 1) firstUnknown++; seen.set(c.id, m = { ident: 0, done: false }); }
        if (c.ident < m.ident || c.shaft || c.blades) back++; m.ident = c.ident;
        // nothing the boat is shown gives the animal away early
        if (!c.cls && (c.bio || JSON.stringify(c).includes(truth.kind) || !k || k.cls || JSON.stringify(k).includes(truth.kind))) early++;
        if (c.cls && !m.done) { m.done = true; classed++; byKind[c.bio] = (byKind[c.bio] || 0) + 1; if (c.cls !== 'bio' || c.bio !== truth.kind || k.cls !== 'bio') wrong++; }
      }
    }
  }
  parts.push([firsts >= 40 && firstUnknown === firsts, firsts + ' new sea-life contacts all start Unknown']);
  parts.push([classed >= 30 && wrong === 0 && early === 0 && back === 0 && told === classed && ['whale', 'dolphin', 'fish'].every(k => byKind[k] >= 3),
    classed + ' classified as Biologic by listening, all correctly (' + Object.keys(byKind).sort().map(k => byKind[k] + ' ' + names[k]).join(', ') + '); never a shaft rate; nothing shown early']);
  // staged: the boat is held south of a pod, bow on
  const held = (seed, kind, dist, input, secs, fn) => { const sim = createSim({ mission: 'firstblood', seed }), st = sim.state, b = st.bios.find(q => q.kind === kind), p = st.player; let out = -1;
    for (let i = 0; i < secs * 30 && !st.over; i++) { p.x = b.x; p.z = b.z + dist; p.h = PI / 2; sim.step(STEP, typeof input === 'function' ? input(st, i) : input); const r = fn(st, b, sim.events, i); sim.events.length = 0; if (r !== undefined) { out = r; break; } } return out; };
  // a look through the periscope settles it at once for animals at the surface; a ping gives a range and nothing more
  let sight = 0, pinged = 0, songs = 0;
  for (let seed = 1; seed <= 10; seed++) {
    if (held(seed, 'dolphin', 1200, { throttle: 0, depthCmd: 9, mast: true }, 40, st => { const c = st.contacts.find(c => c.kind === 'bio' && c.bio === 'dolphin'); return st.player.mast && st.player.mastT > 3 ? (c && c.cls === 'bio' && c.range > 0 ? 1 : 0) : undefined; }) === 1) sight++;
    if (held(seed, 'fish', 2600, st => ({ throttle: 2, depthCmd: 20, ping: st.t > 2 && st.t < 3 }), 9, (st, b) => { const c = st.contacts.find(c => c.id === b.id); return st.t > 6 ? (c && c.range > 0 && !c.cls && !c.bio && c.ident < 0.1 ? 1 : 0) : undefined; }) === 1) pinged++;
    // a whale is heard only while it sings: the contact comes and goes, but it is reported as a new contact once
    const w = { on: 0, off: 0, news: 0 };
    held(seed, 'whale', 1500, { throttle: 0, depthCmd: 20 }, 240, (st, b, ev, i) => { for (const e of ev) if (e.type === 'contact' && e.ship === b.id) w.news++; if (i % 30 === 29) { if (st.contacts.some(c => c.id === b.id)) w.on++; else w.off++; } });
    if (w.on >= 20 && w.off >= 20 && w.news === 1) songs++;
  }
  parts.push([sight === 10 && pinged === 10 && songs === 10, 'a periscope look classifies dolphins at once (' + sight + '/10); a ping gives range but no class (' + pinged + '/10); a whale is heard only while it sings, and is one contact (' + songs + '/10)']);
  // a torpedo fired straight at a pod from 600 m. After that the usual First Blood attack carries on.
  const shoot = (seed, kind, difficulty, mission, score) => { const sim = createSim({ mission: mission || 'firstblood', seed, difficulty }), st = sim.state, p = st.player, b = st.bios.find(q => kind ? q.kind === kind : q.kind !== 'fish'), pl = PLAYERS.firstblood(seed);
    const o = { hitT: -1, overAtHit: false, add: null, scat: 0, scatT: -1, away: -1, quiet: false, running: false, st, b };
    if (!b) return o; if (score) st.score = score;
    p.x = b.x; p.z = b.z + 600; p.h = PI / 2; let at = null, d0 = 0;
    for (let i = 0; i < 1200 * 30 && !st.over; i++) {
      const inp = o.hitT < 0 && st.t < 110 ? { throttle: 0, depthCmd: 20, fire: st.t > 1 && st.t < 1.2 } : mission === 'patrol' ? {} : pl(st);
      sim.step(STEP, inp);
      for (const e of sim.events) {
        if (e.type === 'bioHit' && o.hitT < 0) { o.hitT = st.t; o.overAtHit = st.over; at = [e.x, e.z]; d0 = Math.hypot(b.x - e.x, b.z - e.z); }
        if (e.type === 'bioScatter' && e.pod === b.id) { o.scat++; if (o.scatT < 0) o.scatT = st.t; } if (e.type === 'score' && e.bio) o.add = e.add;
      }
      sim.events.length = 0;
      if (at && o.away < 0 && st.t >= o.hitT + 15) { o.away = Math.hypot(b.x - at[0], b.z - at[1]) - d0; o.quiet = !b.call && b.scareT > 0; if (mission === 'patrol') break; }
      // a school of fish: watch until the torpedo is well past it
      if (kind === 'fish' && (st.t > 110 || (o.scatT >= 0 && st.t >= o.scatT + 8))) { o.running = st.torps.some(t => t.side === 0); break; }
    }
    return o; };
  const std = [], hard = [], easy = [], fish = [];
  for (let seed = 1; seed <= 12; seed++) { const kind = seed % 2 ? 'whale' : 'dolphin'; std.push(shoot(seed, kind, 'standard')); hard.push(shoot(seed, kind, 'hard')); easy.push(shoot(seed, kind, 'relaxed')); fish.push(shoot(seed, 'fish', 'standard')); }
  const hits = std.filter(o => o.hitT >= 0), wins = hits.filter(o => o.st.result === 'win');
  const fined = o => { const g = o.st.grade, earned = g.lines.filter(l => l.ok).length; return o.st.stats.bio >= 1 && g.stars === Math.max(0, earned - 1) && (o.st.stats.neutral ? /neutral/ : /sea life/).test(g.penalty); };
  parts.push([hits.length >= 10 && hits.every(o => !o.overAtHit && o.scat >= 1 && o.away > 20 && o.quiet) && wins.length >= 3 && hits.every(fined),
    'Standard: ' + hits.length + '/12 torpedoes fired at whales and dolphins go off among them; the pod scatters and falls silent; the mission goes on; ' + wins.length + ' later won, each one star short']);
  const hh = hard.filter(o => o.hitT >= 0), eh = easy.filter(o => o.hitT >= 0);
  parts.push([hh.length >= 10 && hh.every(o => o.overAtHit && o.st.result === 'lose' && /sea life/.test(o.st.reason) && o.st.grade.stars === 0) && eh.length >= 10 && eh.every(o => !o.overAtHit && fined(o)), 'Hard: all ' + hh.length + ' end the mission at once. Relaxed: the mission goes on, a star is lost']);
  const past = fish.filter(o => o.hitT < 0 && o.scat === 1 && o.running && o.st.stats.bio === 0 && o.b.scareT > 0).length;
  parts.push([past === 12, 'a torpedo runs straight through a school of fish: the school scatters, nothing goes off, the torpedo runs on, no penalty (' + past + '/12)']);
  let ps = 0; for (let s = 1; s <= 30 && !ps; s++) if (createSim({ mission: 'patrol', seed: s }).state.bios.some(q => q.kind !== 'fish')) ps = s;
  const pa = shoot(ps, '', 'standard', 'patrol', 400), pb = shoot(ps, '', 'standard', 'patrol', 100), fine = SIM.V.neutral.fine;
  parts.push([ps > 0 && pa.hitT >= 0 && pa.add === -fine && pa.st.score === 400 - fine && pb.add === -100 && pb.st.score === 0 && !pa.st.over, 'Free Patrol: ' + fine + ' points lost, never below zero']);
  check('sea life', parts, 'present; classify as Biologic; hits penalised; routes clear');
}
// snapping shrimp crackle over every shoal. A boat on a bed is harder to hear, and hears less itself; a ping is not affected
if (want('shrimp')) {
  const parts = [], sp = SIM.V.shrimp;
  // two places to hold the boat: the middle of the first shoal, and a point well clear of every shoal
  const spot = (sim, on) => { const st = sim.state, q = st.bed.shoals[0]; if (on) return [q.x, q.z];
    for (let k = 2.2; k < 8; k += 0.4) for (let a = 0; a < 8; a++) { const x = q.x + Math.cos(a * PI / 4) * q.r * k, z = q.z + Math.sin(a * PI / 4) * q.r * k; if (st.bed.shoals.every(o => Math.hypot(x - o.x, z - o.z) > o.r * 2.2) && sim.shrimp(x, z) === 0) return [x, z]; }
    throw new Error('no place clear of the shoals'); };
  // every shoal carries a bed: full over the middle, gone well before two shoal widths out
  let shoals = 0, good = 0;
  for (const id of Object.keys(MISSIONS)) for (let seed = 1; seed <= 5; seed++) { const sim = createSim({ mission: id, seed }); for (const q of sim.state.bed.shoals) { shoals++; if (sim.shrimp(q.x, q.z) === 1 && sim.shrimp(q.x + q.r * sp.reach * 0.8, q.z) > 0.3 && sim.shrimp(q.x + 30000, q.z) === 0) good++; } }
  parts.push([shoals >= 60 && good === shoals && sp.cut > 0.2 && sp.cut < 0.7, 'all ' + shoals + ' shoals in 30 games carry a bed: full over the middle, still there four fifths of the way out, none far away']);
  // their side. The boat is held in one place at Full; one listener is held a set distance north of it, and everything else is kept far away.
  // How many games out of 12 have the enemy alerted within 90 seconds?
  const alerted = (on, what, D) => { let n = 0, mask = 0;
    for (let seed = 1; seed <= 12; seed++) { const sim = createSim({ mission: 'firstblood', seed }), st = sim.state, p = st.player, f = st.ships.find(q => q.kind === 'frigate'), h = st.helos[0], at = spot(sim, on);
      if (what === 'buoy') st.buoys.push({ id: 99999, x: at[0], z: at[1] - D, life: 1e9, known: true });
      for (let i = 0; i < 90 * 30 && !st.over && st.stats.firstAlert < 0; i++) {
        p.x = at[0]; p.z = at[1]; p.h = PI / 2; f.x = at[0]; f.z = at[1] - (what === 'hull' ? D : 9000); f.h = 0;
        if (what === 'dip') { h.phase = 'dip'; h.pt = 0; h.x = h.tx = at[0]; h.z = h.tz = at[1] - D; h.alt = SIM.V.helo.alt; h.cable = 99; }
        sim.step(STEP, { throttle: 3, depthCmd: 20 }); sim.events.length = 0;
      }
      if (st.stats.firstAlert >= 0) n++; mask += p.mask; }
    return { n, mask: mask / 12 }; };
  const hOff = alerted(false, 'hull', 1500), hOn = alerted(true, 'hull', 1500), hNear = alerted(true, 'hull', 800);
  parts.push([hOff.mask === 0 && hOn.mask === 1 && hOff.n >= 10 && hOn.n <= 2 && hNear.n >= 10, 'at Full 1.5 km from a listening frigate the boat is heard in ' + hOff.n + '/12 games off a bed and ' + hOn.n + '/12 on one; at 800 m it is heard on the bed too (' + hNear.n + '/12)']);
  const bOff = alerted(false, 'buoy', 500), bOn = alerted(true, 'buoy', 500), dOff = alerted(false, 'dip', 1000), dOn = alerted(true, 'dip', 1000), dNear = alerted(true, 'dip', 400);
  parts.push([bOff.n >= 10 && bOn.n <= 2 && dOff.n >= 10 && dOn.n <= 2 && dNear.n >= 10, 'a sonobuoy 500 m away hears it in ' + bOff.n + '/12 off a bed and ' + bOn.n + '/12 on one; a dipping sonar 1 km away in ' + dOff.n + '/12 and ' + dOn.n + '/12, but its ping still finds the boat at 400 m (' + dNear.n + '/12)']);
  // the boat's side. Stopped and listening, how far off is a merchant first heard? And does a ping still reach it?
  const reach = (seed, on) => { const sim = createSim({ mission: 'firstblood', seed }), st = sim.state, p = st.player, s = st.ships.find(q => q.kind === 'merchant'), at = spot(sim, on);
    for (let d = 7000; d >= 300; d -= 100) { for (let i = 0; i < (d === 7000 ? 600 : 90); i++) { p.x = at[0]; p.z = at[1]; p.h = PI / 2; s.x = at[0]; s.z = at[1] - d; sim.step(STEP, { throttle: 0, depthCmd: 20 }); sim.events.length = 0; } if (st.contacts.some(c => c.id === s.id)) return d; } return 0; };
  let off = 0, on = 0; for (let seed = 1; seed <= 4; seed++) { off += reach(seed, false) / 4; on += reach(seed, true) / 4; }
  const echo = on => { let n = 0; for (let seed = 1; seed <= 6; seed++) { const sim = createSim({ mission: 'firstblood', seed }), st = sim.state, p = st.player, s = st.ships.find(q => q.kind === 'merchant'), at = spot(sim, on);
    for (let i = 0; i < 8 * 30; i++) { p.x = at[0]; p.z = at[1]; p.h = PI / 2; s.x = at[0]; s.z = at[1] - 4500; sim.step(STEP, { throttle: 0, depthCmd: 20, ping: st.t > 2 && st.t < 3 }); sim.events.length = 0; }
    const c = st.contacts.find(c => c.id === s.id); if (c && c.range > 0) n++; } return n; };
  const eOn = echo(true), eOff = echo(false);
  parts.push([on > 0 && on <= off * 0.7 && on >= off * 0.4 && eOn === 6 && eOff === 6, 'a merchant is heard from ' + (off / 1000).toFixed(1) + ' km off a bed and ' + (on / 1000).toFixed(1) + ' km on one; a ping from the bed still ranges it at 4.5 km (' + eOn + '/6)']);
  check('shrimp', parts, 'masks passive sonar both ways');
}
// time compression: the page runs the same fixed steps at 1x, 2x and 4x, only more of them per frame, and drops to 1x when something new happens
if (want('time')) {
  const parts = [];
  // frames arrive unevenly, as they do in a browser
  const frames = seed => { let a = seed >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; const r = a / 4294967296; return r < 0.8 ? 1 / 60 : r < 0.95 ? 1 / 30 : 1 / 12; }; };
  const play = (id, seed, warp0, auto, ticks) => { const sim = createSim({ mission: id, seed }), st = sim.state, pl = PLAYERS[id](seed), clock = { acc: 0 }, dt = frames(seed);
    let warp = warp0, n = 0, real = 0, drops = 0, lateSteps = 0, calm = 0;
    outer: while (!st.over && st.tick < ticks) {
      const k = pace(clock, dt(), warp); n++; real += 1;
      for (let i = 0; i < k; i++) {
        sim.step(STEP, pl(st)); let threat = false;
        for (const e of sim.events) if (isThreat(e, st)) threat = true;
        sim.events.length = 0;
        if (st.over || st.tick >= ticks) break outer;
        if (threat) { calm = 0; if (auto && warp > 1) { warp = 1; clock.acc = 0; drops++; break; } } else calm++;
      }
      if (auto && warp === 1 && calm > 20 * 30) warp = warp0;   // the captain puts it back up once things have been quiet for 20 seconds
    }
    return { json: JSON.stringify(st), n, drops, tick: st.tick, warp }; };
  let same = 0, total = 0, faster = 0, dropped = 0; const ratio = [];
  for (const [id, seed] of [['firstblood', 4], ['firstblood', 9], ['gate', 5], ['hunted', 6], ['strait', 8], ['patrol', 12], ['shakedown', 2]]) {
    const a = play(id, seed, 1, false, 12000), b = play(id, seed, 2, false, 12000), c = play(id, seed, 4, false, 12000), d = play(id, seed, 4, true, 12000);
    total++; if (a.json === b.json && a.json === c.json && a.json === d.json && a.tick === c.tick) same++;
    if (c.n < a.n / 2.5 && b.n < a.n / 1.6) faster++; if (d.drops > 0 || id === 'shakedown') dropped++;
    ratio.push((a.n / c.n).toFixed(1));
  }
  parts.push([same === total, 'the same game at 1x, 2x, 4x and 4x with automatic drops, in ' + same + '/' + total + ' missions']);
  parts.push([faster === total && dropped === total, '4x takes ' + ratio.join(', ') + ' times fewer frames; a new threat drops it to 1x in every combat mission']);
  // pace: never more steps than the cap, bad values are safe, and a threat is recognised
  const clock = { acc: 0 }; let okPace = pace(clock, 1 / 60, 1) === 0 && pace(clock, 1 / 60, 1) === 1 && pace({ acc: 0 }, 5, 4) <= 16 && pace({ acc: 0 }, NaN, 4) === 0 && pace({ acc: 0 }, 1 / 30, 'x') === 1 && pace({ acc: 0 }, 1 / 30, 3) === 1 && pace({ acc: 0 }, 1 / 30, 4) === 4;
  const stH = { heard: [{ src: 'ship' }] };
  const okThreat = isThreat({ type: 'alert', level: 2, prev: 1 }, stH) && !isThreat({ type: 'alert', level: 1, prev: 2 }, stH) && isThreat({ type: 'splash' }, stH) && isThreat({ type: 'contact' }, stH) && !isThreat({ type: 'reload' }, stH)
    && !isThreat({ type: 'ping', src: 'own', d: 0 }, stH) && isThreat({ type: 'ping', src: 'ship', d: 900 }, stH) && !isThreat({ type: 'ping', src: 'ship', d: 900 }, { heard: [{ src: 'ship' }, { src: 'ship' }] });
  parts.push([okPace && okThreat, 'step pacing is capped and safe with bad values; threats are told from routine reports']);
  check('time compression', parts, 'same game at 1x, 2x and 4x; drops to 1x on a new threat');
}
// Helicopters keep clear of ships. Over a ship's hull a flying helicopter is above the ship's top; it never lowers its sonar onto a ship; and a whole sortie
// (lift off, dip, come back, land, take on fuel, lift off again) still completes, so the rule has not left one hovering for ever.
if (want('helicopter')) {
  const TOPS = SIM.V.tops || {}, FLY = { transit: 1, lower: 1, dip: 1, raise: 1, return: 1 }, parts = [];
  let low = 0, over = 0, onShip = 0, sorties = 0, longest = 0, games = 0, worst = '';
  for (const [id, seeds] of [['hunted', [1, 11, 23, 37, 41, 59]], ['strait', [1, 11, 23]], ['patrol', [100, 101, 102, 103]], ['firstblood', [1, 11]]]) for (const seed of seeds) {
    const sim = createSim({ mission: id, seed }), st = sim.state, pl = PLAYERS[id](seed), log = {}; games++;
    for (let i = 0; i < 1200 * 30 && !st.over; i++) {
      sim.step(STEP, pl(st)); sim.events.length = 0;
      for (const h of st.helos) {
        const g = log[h.id] || (log[h.id] = { p: '', seq: '', n: 0 });
        if (h.phase !== g.p) { g.p = h.phase; g.seq += h.phase + ','; g.n = 0; } else if (h.phase === 'return' || h.phase === 'transit') { g.n++; if (g.n > longest) longest = g.n; }
        if (!FLY[h.phase]) continue;
        for (const s of st.ships) {
          const B = TOPS[s.kind]; if (!B) continue;
          const c = Math.cos(s.h), n = Math.sin(s.h), dx = h.x - s.x, dz = h.z - s.z, x = dx * c - dz * n, z = dx * n + dz * c;
          if (Math.abs(z) > B.hw || x > B.x1) continue;
          if (x >= B.x0) { over++; if (h.alt < B.top) { low++; if (!worst) worst = id + ' seed ' + seed + ' at ' + st.t.toFixed(1) + ' s: ' + h.alt.toFixed(1) + ' m over a ' + s.kind + ' (' + B.top + ' m)'; } }
          if (x >= (B.aft || B.x0) && h.phase !== 'transit' && h.phase !== 'return') onShip++;
        }
      }
    }
    for (const k in log) if (/lift,(?:[a-z]+,)*?dip,(?:[a-z]+,)*?return,land,spindown,deck,spinup,lift,/.test(log[k].seq)) sorties++;
  }
  parts.push([low === 0 && over > 300, 'over a ship a helicopter is above its top: ' + over + ' steps over a hull in ' + games + ' games, ' + low + ' too low' + (worst ? ' (' + worst + ')' : '')]);
  parts.push([onShip === 0, 'the sonar is never lowered onto a ship (' + onShip + ' steps)']);
  parts.push([sorties >= 6 && longest < 150 * 30, sorties + ' helicopters flew a whole sortie and lifted off again; the longest single flight leg took ' + (longest / 30).toFixed(0) + ' s']);
  check('helicopter', parts, 'clears ship tops; never dips onto a ship; ' + sorties + ' full sorties');
}
// damage control (Stage G): flooding, the pumps, the blow, crush depth, the seabed, ships overhead, torpedo hits and fire. Each is staged in the
// exercise, which has no enemy, at a place deep enough for the test.
if (want('damage')) {
  const parts = [], K = SIM.V.dmg;
  const stage = (seed, minBed, mission, difficulty) => {
    const sim = createSim({ mission: mission || 'shakedown', seed, difficulty: difficulty || 'standard' }), st = sim.state, p = st.player;
    let at = null; for (let r = 0; r < 20000 && !at; r += 150) for (let a = 0; a < 16 && !at; a++) { const x = Math.cos(a * PI / 8) * r, z = Math.sin(a * PI / 8) * r; let ok = true; for (let k = -2; k <= 2; k++) for (let j = -2; j <= 2; j++) if (sim.seabed(x + k * 120, z + j * 120) < minBed) ok = false; if (ok) at = [x, z]; }
    if (!at) throw new Error('no place with ' + minBed + ' m of water');
    p.x = at[0]; p.z = at[1]; return sim;
  };
  // hold the boat at a depth for some seconds
  const hold = (sim, depth, secs, inp) => { const p = sim.state.player; for (let i = 0; i < secs * 30; i++) { p.depth = depth; p.vd = 0; sim.step(STEP, Object.assign({ throttle: 0, depthCmd: depth }, inp)); sim.events.length = 0; } };
  const evs = (sim, secs, inp, stop) => { const st = sim.state, out = []; for (let i = 0; i < secs * 30 && !st.over && !(stop && stop(st)); i++) { sim.step(STEP, typeof inp === 'function' ? inp(st) : inp); out.push(...sim.events); sim.events.length = 0; } return out; };
  // a lightweight torpedo put right against the hull, so far along it (bow +)
  const strike = (sim, along) => { const st = sim.state, p = st.player, c = Math.cos(p.h), s = Math.sin(p.h);
    st.torps.push({ id: 99000 + st.tick, side: 1, phase: 'home', x: p.x + c * along, z: p.z - s * along, depth: p.depth, alt: 0, h: p.h + PI / 2, speed: 0.1, vy: 0, run: 0, st: 0, life: 30, target: 0, pod: 0, spin: 1, wire: false, lock: 0, bait: 0, seen: [], tx: 0, tz: 0 }); };

  // 1. flooding: the same breach at 150 m and at 30 m, the team sent to it
  const flood = depth => { const sim = stage(3, 175), dm = sim.state.dmg; hold(sim, depth, 1); dm.on = true; dm.sec[1].breach = 0.3; hold(sim, depth, 20, { team: 3 }); return dm.sec[1].water; };
  const w150 = flood(150), w30 = flood(30);
  parts.push([w150 > 0.15 && w30 < 0.02, 'one breach held 20 s, the team busy elsewhere: ' + pct(w150) + ' of the Control room flooded at 150 m, ' + pct(w30) + ' at 30 m (the pumps win shallow and lose deep)']);

  // 2. the blow: from 120 m with the Control room flooded, and again with the Torpedo room breached as well (ruptured forward tanks)
  const blow = fore => { const sim = stage(4, 160), st = sim.state, dm = st.dmg; hold(sim, 120, 1, { throttle: 2 }); dm.on = true; dm.sec[1].water = 1; dm.sec[1].lost = true;
    if (fore) { dm.sec[0].breach = 0.25; dm.tanks = true; }
    let t0 = st.t, up = -1, n = 0; const ev = evs(sim, 150, st => ({ throttle: 2, depthCmd: 120, blow: st.t < t0 + 0.5 || (st.t > t0 + 1 && st.t < t0 + 1.5) }), st => st.dmg.surfaced && st.player.depth < 1);
    for (const e of ev) if (e.type === 'surfaced') { up = e.t - t0; n++; }
    return { up, over: st.over, blows: ev.filter(e => e.type === 'blow').length };
  };
  const still = (() => { const sim = stage(4, 160), st = sim.state, dm = st.dmg; hold(sim, 120, 1, { throttle: 2 }); dm.on = true; dm.sec[1].water = 1; dm.sec[1].lost = true; evs(sim, 40, { throttle: 2, depthCmd: 20 }); return st.player.depth; })();
  const b0 = blow(false), b1 = blow(true);
  parts.push([b0.up > 0 && !b0.over && b0.blows === 1 && b1.up > b0.up * 1.2 && !b1.over && still > 60, 'with the Control room flooded at 120 m the boat ordered up at Half is still at ' + Math.round(still) + ' m after 40 s; the blow (one shot) surfaces it in ' + b0.up.toFixed(0) + ' s, ' + b1.up.toFixed(0) + ' s with the forward tanks ruptured']);

  // 3. crush depth: a hull stressed to its limit, ordered below its crush depth
  const crush = (() => { const sim = stage(5, 175), st = sim.state, dm = st.dmg; dm.stress = 1; dm.crush = Math.max(K.crushMin, K.crush - K.crushStress); const ev = evs(sim, 200, { throttle: 2, depthCmd: 160 });
    return { warn: ev.some(e => e.type === 'crushWarn'), creak: ev.filter(e => e.type === 'creak').length, over: st.over, result: st.result, reason: st.reason, depth: st.player.depth, crush: dm.crush }; })();
  const sound = (() => { const sim = stage(5, 175), st = sim.state; evs(sim, 120, { throttle: 2, depthCmd: 160 }); return !st.over && st.player.depth > 150; })();
  parts.push([crush.warn && crush.creak >= 2 && crush.result === 'lose' && /hull collapsed under pressure/.test(crush.reason) && sound, 'a sound hull holds at 160 m; one stressed to its limit (crush depth ' + crush.crush + ' m) creaks, warns, and at ' + Math.round(crush.depth) + ' m is lost: "' + crush.reason + '"']);

  // 4. the seabed: driven into it at Slow and at Flank
  const bed = speed => { const sim = stage(6, 120), st = sim.state, p = st.player, b = sim.seabed(p.x, p.z); p.depth = b - SIM.V.keel + 0.05; p.speed = speed; p.vd = 0.5;
    const ev = evs(sim, 1, { throttle: speed > 5 ? 4 : 1, depthCmd: 200 }); return { ev, st }; };
  const slow = bed(2.5), fast = bed(11), hurtN = r => r.ev.filter(e => e.type === 'injured').reduce((n, e) => n + e.n, 0);
  const slowOk = slow.ev.some(e => e.type === 'ground' && e.scrape) && !slow.ev.some(e => e.type === 'breach') && slow.st.stats.collisions === 0 && hurtN(slow) === 0;
  const fastOk = fast.ev.some(e => e.type === 'breach' && e.sec === 0 && e.why === 'bed') && hurtN(fast) >= 3 && fast.st.dmg.bow && fast.st.dmg.stress > 0;
  parts.push([slowOk && fastOk, 'aground at Slow: a scrape, no breach; at Flank: the Torpedo room breached (' + pct(fast.st.dmg.sec[0].breach) + '), bow sonar damaged, ' + hurtN(fast) + ' hurt']);

  // 5. a ship's hull overhead: the boat waits at periscope depth on a merchant's track, and again at 20 m
  const under = depth => { let got = null;
    for (let seed = 1; seed <= 6 && !got; seed++) { const sim = createSim({ mission: 'firstblood', seed }), st = sim.state, p = st.player, s = st.ships.find(q => q.kind === 'merchant'); if (!s) continue;
      p.x = s.x + Math.cos(s.h) * 160; p.z = s.z - Math.sin(s.h) * 160; p.depth = depth; p.depthCmd = depth;
      const ev = evs(sim, 60, { throttle: 0, depthCmd: depth }); got = { hit: ev.find(e => e.type === 'collide' && e.with === 'ship'), st, ev, sim }; }
    return got; };
  const pd = under(SIM.V.periscope), deep = under(20);
  const mastAfter = pd && (() => { evs(pd.sim, 5, { throttle: 0, depthCmd: 9, mast: true }); return !pd.st.player.mast; })();
  parts.push([!!pd.hit && pd.st.dmg.fin && mastAfter && pd.ev.some(e => e.type === 'breach' && e.sec === 1) && pd.st.stats.incidents === 1 && !pd.st.over && !deep.hit, 'at periscope depth under a merchant the fin strikes its hull (masts out, a small leak in the Control room, a neutral incident with no harm to the ship); at 20 m it passes under']);

  // 6. a torpedo hit: the section struck matches where along the hull it hit; it hurts crew, and a captain who climbs and sends the team
  // survives it, while a boat left idle at 150 m is lost
  const where = [25, 7, -7, -25].map(a => { const sim = stage(7, 175), st = sim.state; hold(sim, 60, 1); strike(sim, a); const ev = evs(sim, 0.2, { throttle: 0, depthCmd: 60 }); const h = ev.find(e => e.type === 'playerHit'), b = ev.find(e => e.type === 'breach'), n = ev.filter(e => e.type === 'injured').reduce((k, e) => k + e.n, 0); return h && b && h.sec === b.sec ? [h.sec, n] : [-1, n]; });
  parts.push([where.map(w => w[0]).join() === '0,1,2,3' && where.every(w => w[1] > 0), 'hits 25 m forward, 7 m forward, 7 m aft and 25 m aft of amidships breach sections ' + where.map(w => w[0]).join(', ') + ' and hurt ' + where.map(w => w[1]).join(', ')]);
  const after = (seed, respond, diff) => { const sim = stage(seed, 168, 'shakedown', diff), st = sim.state;
    hold(sim, 150, 1); const along = [25, 7, -7, -25, 7][seed % 5]; strike(sim, along);
    // the responder sends the team to the section that was holed, once the hit has landed
    evs(sim, 300, st => { const sec = st.dmg.sec.findIndex(s => s.breach > 0 || s.water > 0); return respond && st.stats.taken > 0 ? { throttle: 3, depthCmd: 30, team: sec } : { throttle: 0, depthCmd: 150 }; });
    return { lost: st.dmg.lost, reason: st.reason, water: st.dmg.water }; };
  const saved = [1, 2, 3, 4, 5].map(s => after(s, true)), idleLost = [1, 2, 3, 4, 5].map(s => after(s, false)), hardSaved = [1, 2, 3, 4, 5].map(s => after(s, true, 'hard'));
  const nSaved = saved.filter(r => !r.lost).length, nLost = idleLost.filter(r => r.lost).length, nHard = hardSaved.filter(r => !r.lost).length;
  parts.push([nSaved >= 4 && nLost >= 4, 'hit at 150 m on Standard: climbing at Full and sending the team saves the boat in ' + nSaved + '/5 (on Hard ' + nHard + '/5); left idle it is lost in ' + nLost + '/5 (' + [...new Set(idleLost.filter(r => r.lost).map(r => r.reason.replace('Boat lost (simulated): ', '')))].join(' / ') + ')']);
  // two hits in the same section are usually fatal, even for a captain who climbs and sends the team
  const twice = seed => { const sim = stage(seed, 168), st = sim.state; hold(sim, 100, 1, { throttle: 2 }); const along = [25, 7, -7, -25][seed % 4]; strike(sim, along); let n = 0;
    evs(sim, 300, st => { if (++n === 15 * 30) strike(sim, along); const sec = st.dmg.sec.findIndex(s => s.breach > 0 || s.water > 0); return { throttle: 3, depthCmd: 30, team: sec }; });
    return st.stats.taken === 2 && st.dmg.lost; };
  const nTwice = [1, 2, 3, 4, 5].filter(twice).length;
  parts.push([nTwice >= 4, 'two hits 15 s apart in the same section at 100 m sink the boat in ' + nTwice + '/5 even with the climb and the team']);
  // one hit must not leave a boat evading at 160 m below its crush depth
  const crushAfter = d => Math.max(K.crushMin, K.crush - K.crushStress * K.hit.stress * d);
  parts.push([crushAfter(1) > 160 + 5, 'crush depth ' + K.crush + ' m sound, ' + crushAfter(1) + ' m after one hit, ' + crushAfter(2) + ' m after two, never below ' + K.crushMin + ' m']);

  // 7. fire: left alone it spreads smoke and hurts crew; fought it goes out
  const fire = team => { const sim = stage(8, 120), st = sim.state, dm = st.dmg; hold(sim, 40, 1); dm.on = true; dm.sec[2].fire = K.fire.start;
    const ev = evs(sim, 60, { throttle: 1, depthCmd: 40, team }); return { out: ev.some(e => e.type === 'fireOut' && e.sec === 2), smoke: Math.max(dm.sec[1].smoke, dm.sec[3].smoke), hurt: ev.filter(e => e.type === 'injured' && e.why === 'smoke').length, fire: dm.sec[2].fire }; };
  const left = fire(0), fought = fire(2);
  parts.push([!left.out && left.smoke > 0.2 && left.hurt >= 1 && fought.out && fought.hurt === 0, 'a Battery fire left for a minute: smoke ' + pct(left.smoke) + ' next door, ' + left.hurt + ' hurt by smoke; fought by the team it goes out']);
  // seal and starve: the fire dies, everyone in the section is hurt
  const sealed = (() => { const sim = stage(8, 120), st = sim.state, dm = st.dmg; hold(sim, 40, 1); dm.on = true; dm.sec[3].fire = 0.8; const crew = dm.sec[3].crew;
    const ev = evs(sim, 30, st => ({ throttle: 1, depthCmd: 40, team: 0, seal: st.t > 1.2 && st.t < 1.5 ? 3 : -1 })); return { out: ev.some(e => e.type === 'fireOut' && e.sec === 3), hurt: dm.sec[3].hurt, crew, used: dm.sec[3].sealUsed, open: !dm.sec[3].sealed }; })();
  parts.push([sealed.out && sealed.hurt === sealed.crew && sealed.used && sealed.open, 'sealing the burning Engine room starves the fire, and all ' + sealed.crew + ' inside are hurt']);

  // 8. damage to the systems: a flooded Torpedo room cuts the bow sonar and jams the reloads; a damaged Engine room caps the speed
  const sys = (() => { const sim = stage(9, 120), st = sim.state, dm = st.dmg, p = st.player; hold(sim, 40, 2, { throttle: 2 }); const h0 = p.hear; p.tube[0].s = 'empty'; p.tube[0].w = '';   // Stage J: one of the six torpedo tubes is emptied (the count used to be set to 5 of 8)
    dm.on = true; dm.sec[0].water = 1; dm.sec[0].lost = true; dm.sec[3].sys = 0.6; hold(sim, 40, 30, { throttle: 4 }); return { hear: p.hear / h0, speed: p.speed, tubes: p.readyT }; })();
  parts.push([sys.hear < 0.5 && sys.speed <= K.speed.aft + 0.01 && sys.tubes === 5, 'Torpedo room flooded: hearing ×' + sys.hear.toFixed(2) + ', no reloads; Engine room machinery worn by fire: speed held to ' + sys.speed.toFixed(1)]);

  // 9. new inputs with wild values never break the game
  let bad = 0;
  for (let s = 1; s <= 60; s++) { const pl = randomPlayer(7000 + s), r2 = (() => { let a = s; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; })(), wild = [NaN, Infinity, -5, 9, undefined, null, 'x', 2.6];
    const r = run(['firstblood', 'hunted', 'strait'][s % 3], 7000 + s, () => st => { const inp = Object.assign({}, pl(st)); inp.blow = r2() < 0.01; inp.team = r2() < 0.1 ? wild[Math.floor(r2() * wild.length)] : Math.floor(r2() * 5) - 1; inp.seal = r2() < 0.02 ? Math.floor(r2() * 4) : r2() < 0.01 ? wild[Math.floor(r2() * wild.length)] : -1; return inp; }, { checkEvery: 300, after: true });
    if (r.error || r.bad.length || !r.over) bad++; }
  parts.push([bad === 0, '60 random games with the blow, the team and sealing pressed at random (wild values too) end cleanly']);
  check('damage', parts, parts.length + ' damage-control rules hold (-v lists them)');
}
/*STAGE-I-BEGIN*/
/* ---------- Stage I: fire control, torpedo settings, orders to a torpedo on its wire ---------- */
// Staging for these checks. One ship of the First Blood sea is made the target and moved by hand along a straight track (so the check knows the truth);
// every other ship is kept 40 km away. The boat is driven by its ordinary controls.
const KN = 0.5144, DEG = PI / 180;
const hdgOf = deg => (90 - deg) * DEG;                          // a compass course as the sim's heading
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
function fcWorld(seed, o) {
  o = o || {};
  const sim = createSim({ mission: 'firstblood', seed, solver: o.solver }), st = sim.state, p = st.player;
  const tgt = st.ships.find(q => q.kind === (o.kind || 'merchant')), others = st.ships.filter(q => q !== tgt), extra = [];
  // the picture the boat formed of the sea as the mission laid it out is dropped: the check moves the ships by hand, they did not sail to where it puts them
  const forget = q => { for (let i = st.tracks.length - 1; i >= 0; i--) if (!q || st.tracks[i].id === q.id) st.tracks.splice(i, 1); };
  forget(); st.btracks.length = 0;
  const w = { sim, st, p, tgt, extra, ev: [], x: 60000, z: 0, c: 0, v: 0, t0: 0,
    // put the target at this range and compass bearing from the boat, on this compass course at this speed (m/s)
    place(range, brgDeg, courseDeg, v) { const b = hdgOf(brgDeg); forget(tgt); w.x = p.x + Math.cos(b) * range; w.z = p.z - Math.sin(b) * range; w.c = hdgOf(courseDeg); w.v = v; w.t0 = st.t; w.hold(); },
    turn(byDeg) { const dt = st.t - w.t0; w.x += Math.cos(w.c) * w.v * dt; w.z -= Math.sin(w.c) * w.v * dt; w.t0 = st.t; w.c = wrap(w.c - byDeg * DEG); },
    hold() { const dt = st.t - w.t0; tgt.x = w.x + Math.cos(w.c) * w.v * dt; tgt.z = w.z - Math.sin(w.c) * w.v * dt; tgt.h = w.c; tgt.speed = w.v; tgt.out = false;
      others.forEach((q, i) => { if (extra.indexOf(q) < 0) { q.x = 40000 + i * 900; q.z = 40000; } }); for (const b of st.bios) { b.x = -40000; b.z = 40000; b.hx = b.x; b.hz = b.z; b.tx = b.x; b.tz = b.z; } },
    // one more ship held still at a place of its own
    also(kind, x, z, h) { const q = others.find(q => q.kind === kind && extra.indexOf(q) < 0); extra.push(q); q.fx = x; q.fz = z; q.fh = h || 0; forget(q); return q; },
    step(inp) { w.hold(); for (const q of extra) { q.x = q.fx; q.z = q.fz; q.h = q.fh; q.speed = 0; } sim.step(STEP, inp); for (const e of sim.events) w.ev.push(e); sim.events.length = 0; },
    run(secs, inp, each) { for (let i = 0; i < Math.round(secs * 30); i++) { w.step(typeof inp === 'function' ? inp(st, i) : inp); if (each && each(st, i) === false) return false; } return true; },
    track() { return st.tracks.find(k => k.id === tgt.id) || null; },
    range() { return Math.hypot(tgt.x - p.x, tgt.z - p.z); }
  };
  return w;
}
// the boat steers a compass course at Half
const settled = (seed, courseDeg, o) => { const w = fcWorld(seed, o); w.p.h = hdgOf(courseDeg); w.run(15, onCourse(courseDeg)); return w; };
const onCourse = (deg, more) => st => Object.assign({ throttle: 2, depthCmd: 20, rudder: clamp(-wrap(hdgOf(deg) - st.player.h) * 3, -0.8, 0.8) }, more || {});
const angle = (a, b) => Math.abs(wrap(a - b));

if (want('fc')) {
  const parts = [], F = SIM.V.fc;
  // 1. the log. Bearings at least 2 s apart, 60 entries at most, one 'ping' entry per echoing ship per ping, a 'scope' entry every 5 s while a ship is in sight,
  //    and nothing written in a step with no ping, no look and no listening pass.
  {
    let pingsOk = 0, pings = 0, stray = 0, gapBad = 0, over = 0, scopeN = 0, scopeBad = 0, keys = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const sim = createSim({ mission: seed % 2 ? 'firstblood' : 'strait', seed }), st = sim.state, p = st.player; let first = null;
      for (let i = 0; i < 200 * 30 && !st.over; i++) {
        const n0 = st.fcObs, before = new Map(st.tracks.concat(st.btracks).map(k => [k.id, k.obs.filter(e => e.k === 'ping').length]));
        sim.step(STEP, { throttle: 1, depthCmd: st.t > 100 ? 9 : 20, mast: st.t > 120 && st.t < 150, ping: (st.t > 30 && st.t < 30.2) || (st.t > 60 && st.t < 60.2) });
        const pinged = sim.events.some(e => e.type === 'ping' && e.src === 'own'), listened = st.contacts[0] !== first; first = st.contacts[0]; sim.events.length = 0;
        if (st.fcObs > n0 && !pinged && !listened) stray++;
        if (pinged) { pings++; let ok = true;
          for (const s of st.ships) { const k = st.tracks.find(k => k.id === s.id), d = Math.hypot(s.x - p.x, s.z - p.z), got = k ? k.obs.filter(e => e.k === 'ping').length - (before.get(s.id) || 0) : 0; if (got !== (d < 6000 && !s.out ? 1 : 0)) ok = false; }
          if (ok) pingsOk++; }
        if (i % 30 === 0) for (const k of st.tracks.concat(st.btracks)) {
          if (k.obs.length > F.keep) over++;
          const b = k.obs.filter(e => e.k === 'bearing'), sc = k.obs.filter(e => e.k === 'scope');
          for (let j = 1; j < b.length; j++) if (b[j].t - b[j - 1].t < 2) gapBad++;
          for (let j = 1; j < sc.length; j++) { scopeN++; if (sc[j].t - sc[j - 1].t < 4.9) scopeBad++; }
          for (const e of k.obs) for (const key in e) if (!['t', 'x', 'z', 'b', 's', 'k', 'r', 'rs', 'c', 'cs'].includes(key)) keys++;
        }
      }
    }
    parts.push([pings >= 10 && pingsOk === pings && stray === 0 && gapBad === 0 && over === 0 && scopeN >= 10 && scopeBad === 0 && keys === 0,
      'the log: ' + pingsOk + '/' + pings + ' pings wrote exactly one fix per echoing ship; ' + stray + ' entries written in a step with no ping, look or listening pass; bearings 2 s apart or more; never over ' + F.keep + ' entries; ' + scopeN + ' periscope fixes 5 s apart']);
  }
  // 2. no truth leak. The solver is given the track's log and plain numbers, nothing else; and once nothing new is observed, where the ship really goes makes no difference.
  {
    let calls = 0, bad = 0;
    const plain = v => v === null || typeof v === 'number' || typeof v === 'boolean';
    for (let seed = 1; seed <= 4; seed++) {
      let st = null;
      const spy = (obs, o) => { calls++;
        if (st) { const mine = st.tracks.concat(st.btracks).some(k => k.obs === obs); if (!mine && obs.length) bad++; }
        for (const key in o) { if (key === 'prev') { const q = o[key]; if (q) for (const f in q) if (!plain(q[f])) bad++; } else if (!['t', 'x', 'z', 'from', 'holdC', 'holdS', 'still', 'wide'].includes(key) || !plain(o[key])) bad++; }
        return SIM.solveTrack(obs, o); };
      const sim = createSim({ mission: seed % 2 ? 'firstblood' : 'strait', seed, solver: spy }); st = sim.state;
      for (let i = 0; i < 120 * 30 && !st.over; i++) { sim.step(STEP, { throttle: 2, depthCmd: 20, ping: st.t > 20 && st.t < 20.2 }); sim.events.length = 0; }
    }
    // two copies of one game; from 90 s on the target is taken out of hearing, to two different places
    const far = side => { const w = fcWorld(5); w.place(1500, 20, 250, 5); w.run(40, onCourse(340)); w.run(50, onCourse(20));
      const n = st => st.fcObs; const n0 = w.st.fcObs; w.x = side * 60000; w.z = side * 30000; w.v = side > 0 ? 0 : 9; w.t0 = w.st.t;
      const sols = []; w.run(40, onCourse(20), (st, i) => { if (i % 30 === 29) sols.push(JSON.stringify(w.track().sol)); });
      return { sols, grew: w.st.tracks.find(k => k.id === w.tgt.id).obs.filter(e => e.t > 91).length, n0 }; };
    const a = far(1), b = far(-1);
    // and the solver itself: the same log and numbers give the same answer whatever else exists
    const w = fcWorld(6); w.place(1500, 20, 250, 5); w.run(60, onCourse(340));
    const k = w.track(), o = { t: w.st.t, x: w.p.x, z: w.p.z, from: 0, holdC: null, holdS: null, still: false, prev: null, wide: true }, s1 = JSON.stringify(SIM.solveTrack(k.obs, o));
    w.tgt.x += 5000; w.tgt.z -= 3000; const s2 = JSON.stringify(SIM.solveTrack(k.obs, o));
    parts.push([calls > 300 && bad === 0 && a.sols.length === 40 && a.sols.join() === b.sols.join() && a.grew === 0 && b.grew === 0 && s1 === s2,
      'no truth leak: ' + calls + ' solver calls were given only a track log and plain numbers; with nothing new observed, 40 s of solutions are identical wherever the ship really went']);
  }
  // 3. geometry. A merchant 1,200 m off, crossing; the boat at Half.
  {
    const N = 20; let straightGood = 0, straightKnown = 0, straightFlag = 0, zigGood = 0, zigOk = 0, zigFlag = 0, turned = 0, turnT = [], falseTurn = 0, pingPos = 0, pingCourse = 0, hulk = 0;
    for (let seed = 1; seed <= N; seed++) {
      const brg0 = (seed * 47) % 360, course = brg0 + 100 + (seed * 31) % 160, v = 4 + seed % 4;
      // a straight leg for 180 s
      { const w = settled(seed, brg0 + 20); w.place(1200, brg0, course, v); let good = false, known = false;
        w.run(180, onCourse(brg0 + 20), st => { const k = w.track(); if (k && k.sol.g >= 3) good = true; if (k && k.sol.r !== null) known = true; });
        if (good) straightGood++; if (known) straightKnown++; if (w.ev.some(e => e.type === 'fcTurn')) straightFlag++; }
      // 90 s one side of the bearing, a 40 degree zig, 90 s more
      { const w = settled(seed, brg0 + 20); w.place(1200, brg0, course, v); w.run(90, onCourse(brg0 + 20)); w.run(90, onCourse(brg0 - 20));
        const k = w.track(), s = k.sol; if (w.ev.some(e => e.type === 'fcTurn')) zigFlag++;
        if (s.g >= 3) { zigGood++; if (Math.abs(s.r - w.range()) / w.range() < 0.15 && angle(s.c, w.c) < 20 * DEG) zigOk++; } }
      // the same, then the target turns 60 degrees
      { const w = settled(seed, brg0 + 20); w.place(1200, brg0, course, v); w.run(90, onCourse(brg0 + 20)); w.run(90, onCourse(brg0 - 20));
        if (w.ev.some(e => e.type === 'fcTurn')) falseTurn++;
        w.ev.length = 0; w.turn(seed % 2 ? 60 : -60); const t0 = w.st.t; let at = -1;
        w.run(30, onCourse(brg0 - 20), st => { if (at < 0 && w.ev.some(e => e.type === 'fcTurn')) at = st.t - t0; });
        if (at >= 0) { turned++; turnT.push(at); } }
      // one ping and nothing else: the place is known, the course is not
      { const w = fcWorld(seed); w.place(3900, brg0, course, v); w.run(4, st => ({ throttle: 0, depthCmd: 20, ping: st.t > 1 && st.t < 1.2 }));
        const s = w.track().sol; if (s.pg >= 3 && Math.abs(s.r - w.range()) / w.range() < 0.15) pingPos++; if (s.g < 3 && s.c === null) pingCourse++; }
    }
    // a hulk is known to lie still: one fix is enough
    { const sim = createSim({ mission: 'shakedown', seed: 3 }), st = sim.state; for (let i = 0; i < 6 * 30; i++) { sim.step(STEP, { throttle: 1, depthCmd: 20, ping: st.t > 1 && st.t < 1.2 }); } const k = st.tracks[0]; if (k && k.cls === 'hulk' && k.sol.g >= 3 && k.sol.c === null) hulk = 1; }
    turnT.sort((a, b) => a - b);
    parts.push([straightGood === 0 && straightKnown === 0 && straightFlag === 0, 'a straight leg, 180 s: grade Good in ' + straightGood + '/' + N + ', range known in ' + straightKnown + '/' + N + ', false turn flags ' + straightFlag]);
    parts.push([zigGood >= N * 0.8 && zigOk >= N * 0.8 && zigFlag === 0, 'a 40 degree zig then 90 s: Good in ' + zigGood + '/' + N + ', of which ' + zigOk + ' have the range within 15% and the course within 20 degrees; false turn flags ' + zigFlag]);
    parts.push([turned >= N * 0.8, 'the target turns 60 degrees: flagged within 30 s in ' + turned + '/' + N + (turnT.length ? ' (median ' + turnT[turnT.length >> 1].toFixed(0) + ' s)' : '')]);
    parts.push([pingPos === N && pingCourse === N && hulk === 1, 'a single ping: position Good in ' + pingPos + '/' + N + ', course unknown and grade below Good in ' + pingCourse + '/' + N + '; a hulk, known to lie still, grades Good on one fix']);
  }
  // 4. manual correction: a course set by hand is held through 30 automatic updates, the fit works round it, and Auto gives it back
  {
    const w = fcWorld(9); w.place(1200, 30, 200, 5); w.run(60, onCourse(50)); w.run(60, onCourse(10));
    const id = w.tgt.id, k0 = w.track(), n0 = k0.n;
    w.run(0.1, onCourse(10, { target: id, cmd: 'course+' })); w.run(0.1, onCourse(10, { target: id }));
    const held = w.track().holdC, deg = ((90 - held / DEG) % 360 + 360) % 360;
    let kept = true; w.run(31, onCourse(10, { target: id }), () => { const k = w.track(); if (k.holdC !== held || !k.sol.hc || Math.abs(wrap(k.sol.c - held)) > 1e-9 || k.sol.cs !== 0) kept = false; });
    const updates = w.track().n - n0;
    w.run(0.1, onCourse(10, { target: id, cmd: 'course+' })); w.run(0.1, onCourse(10, { target: id })); const up = ((90 - w.track().holdC / DEG) % 360 + 360) % 360;
    w.run(0.1, onCourse(10, { target: id, cmd: 'speed+' })); w.run(0.1, onCourse(10, { target: id })); const spd = w.track().holdS / KN;
    // Restart fit clears the log and keeps what is held
    w.run(0.1, onCourse(10, { target: id, cmd: 'restart' })); const afterRestart = w.track(), cleared = afterRestart.obs.length <= 1 && afterRestart.holdC !== null && afterRestart.holdS !== null;
    w.run(0.1, onCourse(10, { target: id })); w.run(0.1, onCourse(10, { target: id, cmd: 'auto' })); const auto = w.track().holdC === null && w.track().holdS === null;
    w.run(3, onCourse(10, { target: id })); const free = !w.track().sol.hc && !w.track().sol.hs;
    // a held course that is wrong: the newest bearings say so, and the value stays
    const w2 = fcWorld(9); w2.place(1200, 30, 200, 6); w2.run(90, onCourse(50)); w2.run(60, onCourse(10));
    const tc = ((90 - w2.c / DEG) % 360 + 360) % 360; let off = false;
    for (let i = 0; i < 9; i++) { w2.run(0.1, onCourse(10, { target: w2.tgt.id, cmd: 'course+' })); w2.run(0.1, onCourse(10, { target: w2.tgt.id })); }
    const wrongC = w2.track().holdC; w2.run(40, onCourse(10, { target: w2.tgt.id }), () => { if (w2.track().sol.off) off = true; });
    parts.push([Math.abs(deg % 10) < 1e-6 && kept && updates >= 30 && Math.abs(wrap((up - deg - 10) * DEG)) < 1e-6 && Math.abs(spd - Math.round(spd)) < 1e-6 && cleared && auto && free && off && w2.track().holdC === wrongC,
      'by hand: a course of ' + deg.toFixed(0) + ' held through ' + updates + ' updates, +10 gives ' + up.toFixed(0) + ', a speed of ' + spd.toFixed(0) + ' kn; Restart fit clears the log and keeps both; Auto frees both; a wrong course (true ' + tc.toFixed(0) + ') is kept and reported as disagreeing']);
  }
  // 5. the solver's budget: at most 1 ms of solver time for each simulated second with 6 tracks (so 4 ms a second at 4x time). The ships are set around the boat by hand
  //    and jump to new tracks every 90 s, which is the costly case: every jump is a turn, and the fit starts again from scratch.
  {
    const budget = () => { let ms = 0, calls = 0, least = 99, most = 0;
      const timed = (obs, o) => { const t0 = performance.now(), r = SIM.solveTrack(obs, o); ms += performance.now() - t0; calls++; return r; };
      const sim = createSim({ mission: 'strait', seed: 2, solver: timed }), st = sim.state, p = st.player, n = st.ships.length;
      for (let i = 0; i < 300 * 30 && !st.over; i++) {
        st.ships.forEach((q, j) => { const a = j * 2 * PI / n, c = a + 2 + j, v = 3 + j % 5, dt = st.t % 90; q.x = p.x + Math.cos(a) * (900 + 150 * j) + Math.cos(c) * v * dt; q.z = p.z - Math.sin(a) * (900 + 150 * j) - Math.sin(c) * v * dt; q.h = c; q.speed = v; q.out = false; });
        st.bios.forEach((b, j) => { b.x = p.x + 700 + 200 * j; b.z = p.z + 500; b.hx = b.x; b.hz = b.z; b.tx = b.x; b.tz = b.z; });
        sim.step(STEP, { throttle: 2, depthCmd: 20, rudder: clamp(-wrap(PI / 2 + (Math.floor(st.t / 70) % 2 ? 1 : -1) * 25 * DEG - p.h) * 3, -0.8, 0.8) }); sim.events.length = 0;
        if (st.t > 30) { const k = st.tracks.length + st.btracks.length; least = Math.min(least, k); most = Math.max(most, k); }
      }
      return { per: ms / st.t, each: ms / calls, rate: calls / st.t, least, most }; };
    budget(); const b = [budget(), budget(), budget()].sort((x, y) => x.per - y.per)[1];      // the middle one of three, after a warm-up
    parts.push([b.least >= 5 && b.per < 1 && b.each * 10 < 1, 'the budget: ' + b.per.toFixed(3) + ' ms of solver time for each simulated second with ' + b.least + ' to ' + b.most + ' tracks (' + b.rate.toFixed(1) + ' fits a second, ' + (b.each * 1000).toFixed(0) + ' microseconds each; ten tracks would take ' + (b.each * 10).toFixed(3) + ' ms); the limit is 1 ms']);
  }
  check('fire control', parts, parts.length + ' rules hold: the log, no truth leak, geometry, correction by hand, the solver budget (-v lists them)');
}

if (want('weapon')) {
  const parts = [], T = SIM.V.torp, K = SIM.V.attack;
  const fires = w => w.ev.filter(e => e.type === 'fire' && e.id);
  const hits = (w, s) => w.ev.filter(e => e.type === 'hit' && (!s || e.ship === s.id));
  // a target lying still dead ahead at this range; one ping, then a shot with these settings on the selected contact
  const shot = (seed, range, set, opt) => {
    opt = opt || {};
    const w = fcWorld(seed); w.p.h = PI / 2; w.place(range, 0, 90, 0); const prof = []; let id = 0, enable = 0, max = 0;
    w.run(4, st => ({ throttle: 1, depthCmd: 20, ping: opt.ping !== false && st.t > 1 && st.t < 1.2 }));
    const inp = st => Object.assign({ throttle: 1, depthCmd: 20, target: opt.select === false ? 0 : w.tgt.id, fire: st.t > 4.1 && st.t < 4.4 }, set);
    w.run(opt.secs || 110, inp, st => { const t = st.torps.find(t => t.side === 0); if (t) { id = t.id; enable = t.enable; max = t.max; prof.push([t.run, t.depth, t.phase]); } if (!t && id && opt.stop !== false) return false; });
    return { w, prof, enable, max, fire: fires(w)[0], hit: hits(w, w.tgt)[0] };
  };
  // depth: shallow and deep runs at a target 1,200 m off with a Short enable both hit, by different roads
  {
    const sh = shot(3, 1200, { enable: 1, runDepth: 0 }), dp = shot(3, 1200, { enable: 1, runDepth: 1 });
    const deepest = r => Math.max(...r.prof.map(q => q[1])), atEnable = r => { const q = r.prof.find(q => q[0] >= r.enable); return q ? q[1] : 99; };
    parts.push([!!sh.hit && !!dp.hit && deepest(sh) < 25 && deepest(dp) >= K.deep.run - 1 && atEnable(dp) <= T.depth + 1 && sh.enable === K.short && dp.enable === K.short,
      'run depth: at 1,200 m with a Short enable a shallow run (deepest ' + deepest(sh).toFixed(0) + ' m) and a deep run (deepest ' + deepest(dp).toFixed(0) + ' m, at ' + atEnable(dp).toFixed(0) + ' m by the enable point) both hit']);
    // a Long enable, and a ship lying across the track 800 m out: the deep run passes under it, the shallow run hits it
    const under = shot(3, 800, { enable: 2, runDepth: 1 }, { select: false, ping: false, secs: 50, stop: false }), over = shot(3, 800, { enable: 2, runDepth: 0 }, { select: false, ping: false, secs: 50 });
    const at800 = under.prof.find(q => q[0] >= 800);
    parts.push([!under.hit && !!over.hit && at800 && at800[1] >= 30 && at800[0] >= K.arm, 'a ship across the track at 800 m of run: the deep run passes under it (armed, at ' + (at800 ? at800[1].toFixed(0) : '?') + ' m), the shallow run hits']);
    // too close for a deep run: the torpedo climbs from the tube
    const close = SIM.firePlan(0, 0, 1, 150, null, null, null);
    parts.push([close.close && !close.deep && !SIM.firePlan(0, 1, 1, 20, null, null, null).close, 'a deep run with too short an enable distance is refused: the torpedo climbs from the tube']);
  }
  // enable and reach
  {
    let worst = 0, n = 0, ok = true;
    for (const launch of [0, 1]) for (const enable of [0, 1, 2]) for (const run of [null, 200, 900, 1700, 2500, 5000]) { const q = SIM.firePlan(launch, enable, 0, 20, run, run, run === null ? null : run * 0.1); n++; worst = Math.max(worst, q.enable / q.max); if (q.enable > q.max + 1e-9 || Math.abs(q.max - 0.65 * q.reach) > 1e-6) ok = false; }
    const swim = SIM.firePlan(0, 0, 0, 20, null, null, null), imp = SIM.firePlan(1, 0, 0, 20, null, null, null);
    const far = shot(4, 2400, { enable: 0 }, { secs: 3 }), beyond = shot(4, 5000, { enable: 0 }, { secs: 3 }), near = shot(4, 1200, { enable: 0 }, { secs: 3 });
    parts.push([ok && far.enable <= far.max && Math.abs(far.enable - far.max) < 1 && near.enable > K.short && near.enable < 800 && !near.fire.beyond && !far.fire.beyond && beyond.fire.beyond && beyond.fire.aimed && beyond.enable <= beyond.max,
      'enable: never past 0.65 of the reach in ' + n + ' settings (reach ' + swim.reach.toFixed(0) + ' m swim-out, ' + imp.reach.toFixed(0) + ' m impulse); Auto gives ' + near.enable.toFixed(0) + ' m on a 1,200 m solution and the most (' + far.enable.toFixed(0) + ' m) on a 2,400 m one; a 5 km solution fires and is reported beyond torpedo reach']);
  }
  // aim: fire control leads a crossing target from its solution, never from the truth; with nothing selected the torpedo runs out along the bow
  {
    let led = 0, bow = 0, N = 8, hitN = 0;
    for (let seed = 1; seed <= N; seed++) {
      const w = fcWorld(seed); w.p.h = PI / 2; w.place(1300, 20, 270, 6);
      w.run(60, onCourse(40)); w.run(75, onCourse(0));
      const k = w.track(), s = k.sol, lead = SIM.intercept(w.p.x + Math.cos(w.p.h) * 36, w.p.z - Math.sin(w.p.h) * 36, s.x, s.z, s.v !== null ? s.vx : 0, s.v !== null ? s.vz : 0, T.speed, SIM.firePlan(0, 0, 0, 20, null, null, null).lag);
      w.run(0.2, onCourse(0, { target: w.tgt.id, fire: true })); const f = fires(w)[0], t = w.st.torps.find(t => t.side === 0);
      if (f && f.aimed && t && Math.abs(wrap(t.gyro - lead.h)) < 0.02 && s.g >= 2) led++;
      w.run(100, onCourse(0, { target: w.tgt.id }), st => st.torps.some(t => t.side === 0)); if (hits(w, w.tgt).length) hitN++;
      const w2 = fcWorld(seed); w2.p.h = PI / 2; w2.place(1300, 20, 270, 6); w2.run(30, onCourse(0)); w2.run(0.2, onCourse(0, { fire: true }));
      const f2 = fires(w2)[0], t2 = w2.st.torps.find(t => t.side === 0); if (f2 && !f2.aimed && t2 && !t2.aimed && t2.enable === T.enable) bow++;
    }
    parts.push([led >= N - 1 && bow === N && hitN >= N - 2, 'aim: ' + led + '/' + N + ' shots on a Fair or better solution leave on the lead course fire control worked out, and ' + hitN + ' hit the crossing ship; ' + bow + '/' + N + ' shots with nothing selected run out along the bow with the 250 m enable']);
  }
  // the defensive snap shot in Hunted: with nothing selected, or with a contact selected that has no solution yet, Fire sends the torpedo out along the bow
  // on that very step; and with the frigate 700 m off the bow such a shot hits it
  {
    const N = 5; let bow = 0, none = 0, hitN = 0;
    for (let seed = 1; seed <= N; seed++) {
      const sim = createSim({ mission: 'hunted', seed }), st = sim.state, p = st.player, ev = [];
      const go = (sec, inp) => { for (let i = 0; i < Math.round(sec * 30) && !st.over; i++) { sim.step(STEP, inp); for (const e of sim.events) ev.push(e); sim.events.length = 0; } };
      const shots = () => ev.filter(e => e.type === 'fire' && e.id);
      go(3, { throttle: 2, depthCmd: 20 });
      const c = st.contacts.find(q => q.kind === 'ship'), k = c ? st.tracks.find(q => q.id === c.id) : null, h0 = p.h;
      go(1 / 30, { throttle: 2, depthCmd: 20, fire: true, target: c ? c.id : 0 });
      const f = shots()[0], t = f ? st.torps.find(q => q.id === f.id) : null;
      if (k && k.sol.g === 0 && f && !f.aimed && f.enable === T.enable && t && !t.aimed && Math.abs(wrap(t.h - h0)) < 0.02) none++;
      go(8, { throttle: 2, depthCmd: 20 });
      const fr = st.ships.find(q => q.kind === 'frigate'); fr.x = p.x + Math.cos(p.h) * 700; fr.z = p.z - Math.sin(p.h) * 700; fr.speed = 0;
      const n0 = shots().length, h1 = p.h, t1 = st.t;
      go(1 / 30, { throttle: 2, depthCmd: 20, fire: true });
      const f2 = shots()[n0], t2 = f2 ? st.torps.find(q => q.id === f2.id) : null;
      if (f2 && Math.abs(f2.t - t1) < 2 * STEP && !f2.aimed && f2.enable === T.enable && t2 && Math.abs(wrap(t2.h - h1)) < 0.02) bow++;
      go(60, { throttle: 2, depthCmd: 20 });
      if (f2 && ev.some(e => e.type === 'hit' && e.id === f2.id && e.ship === fr.id)) hitN++;
    }
    parts.push([none === N && bow === N && hitN >= N - 1, 'the Hunted snap shot: ' + none + '/' + N + ' shots with a contact selected that has no solution yet, and ' + bow + '/' + N + ' with nothing selected, leave along the bow on the step Fire is pressed, with the ' + T.enable + ' m enable; ' + hitN + '/' + N + ' of those hit the frigate 700 m off the bow']);
  }
  // arming: a ship 200 m ahead is passed harmlessly
  {
    const w = fcWorld(2); w.p.h = PI / 2; w.place(200, 0, 90, 0); let inside = 0, early = 0;
    w.run(1, { throttle: 0, depthCmd: 20 }); w.run(12, st => ({ throttle: 0, depthCmd: 20, fire: st.t > 1.1 && st.t < 1.4 }), st => { const t = st.torps.find(t => t.side === 0); if (t && t.run < K.arm) { const dx = t.x - w.tgt.x, dz = t.z - w.tgt.z, c = Math.cos(w.tgt.h), s = Math.sin(w.tgt.h); if (Math.abs(dx * c - dz * s) < w.tgt.hl && Math.abs(dx * s + dz * c) < w.tgt.hb && t.depth < 13) inside++; } });
    for (const e of hits(w)) { if (e.t < 1.4 + 11) early++; }
    const first = w.ev.find(e => e.type === 'hit');
    parts.push([inside > 0 && !w.ev.some(e => e.type === 'hit' && e.t < 9), 'arming: a ship 200 m ahead is run through for ' + inside + ' steps before the ' + K.arm + ' m mark without going off' + (first ? ' (it comes back armed and hits at ' + first.t.toFixed(0) + ' s)' : '')]);
  }
  // swim-out: slower off the mark, and heard by a frigate at a shorter range than an impulse launch
  {
    const speedAt = launch => { const w = fcWorld(2); w.p.h = PI / 2; w.place(3000, 0, 90, 0); w.run(1, { throttle: 0, depthCmd: 20 }); w.run(0.2, { throttle: 0, depthCmd: 20, fire: true, launch }); const v0 = w.st.torps[0].speed; w.run(6, { throttle: 0, depthCmd: 20, launch }); const v6 = w.st.torps[0].speed; w.run(7, { throttle: 0, depthCmd: 20, launch }); return [v0, v6, w.st.torps[0].speed, w.st.torps[0].run]; };
    const sw = speedAt(0), im = speedAt(1);
    // a frigate lying stopped, bow on, at this range: how often does the launch alert it?
    const heard = (launch, d) => rate(40, i => { const w = fcWorld(100 + i, { kind: 'frigate' }); w.p.h = PI / 2; w.place(d, 0, 180, 0); w.run(0.5, { throttle: 0, depthCmd: 150, silent: true }); const a0 = w.st.stats.firstAlert; w.run(0.3, { throttle: 0, depthCmd: 150, fire: true, launch }); return a0 < 0 && w.st.stats.firstAlert >= 0; });
    const s14 = heard(0, 1400), s155 = heard(0, 1550), i155 = heard(1, 1550), i17 = heard(1, 1700);
    parts.push([sw[0] <= K.swim.speed + 0.5 && sw[1] < T.speed - 5 && sw[2] === T.speed && im[1] === T.speed && sw[3] < im[3] - 100 && s14 >= 0.6 && s155 === 0 && i155 >= 0.6 && i17 === 0,
      'swim-out leaves at ' + sw[0].toFixed(0) + ' m/s and is at run speed by 13 s (' + (im[3] - sw[3]).toFixed(0) + ' m behind an impulse launch); a stopped frigate hears it at 1,400 m in ' + pct(s14) + ' of launches and at 1,550 m in ' + pct(s155) + ', an impulse launch at 1,550 m in ' + pct(i155) + ' and at 1,700 m in ' + pct(i17)]);
  }
  // orders down the wire
  {
    // A lies 700 m ahead, B 1,500 m off on the starboard bow. The torpedo is fired along the bow, locks on to A, and is then sent to B.
    const w = fcWorld(7); w.p.h = PI / 2; w.place(700, 0, 90, 0); const A = w.tgt, B = w.also('fishing', w.p.x + 1100, w.p.z - 1100, 0);
    w.run(4, st => ({ throttle: 0, depthCmd: 20, ping: st.t > 1 && st.t < 1.2 }));
    w.run(40, st => ({ throttle: 0, depthCmd: 20, enable: 1, launch: 1, fire: st.t > 4.1 && st.t < 4.4 }), st => !st.torps.some(t => t.phase === 'home'));
    const t = w.st.torps.find(t => t.side === 0), lockedA = !!t && t.phase === 'home' && t.target === A.id, gB = w.st.tracks.find(k => k.id === B.id).sol.g;
    w.run(0.1, { throttle: 0, depthCmd: 20, target: B.id, cmd: 'retarget' });
    let transit = 0, reacq = 0, hadA = 0;
    w.run(60, { throttle: 0, depthCmd: 20, target: B.id }, st => { const q = st.torps.find(q => q.id === t.id); if (!q) return false;
      if (q.phase === 'transit') { transit++; if (q.target || q.pod || q.bait) reacq++; const d = Math.hypot(A.x - q.x, A.z - q.z); if (d < T.seek && Math.abs(wrap(bearing(q.x, q.z, A.x, A.z) - q.h)) < T.cone) hadA++; }
      if (q.target === A.id) reacq++; });
    const hitB = hits(w, B).length > 0, re = w.ev.find(e => e.type === 'retarget');
    parts.push([lockedA && gB >= 1 && !!re && transit > 30 && hadA > 0 && reacq === 0 && hitB, 'Retarget: locked on a ship 700 m ahead, the torpedo is sent to another contact; for ' + (transit / 30).toFixed(0) + ' s of transit it locks on to nothing (the first ship lay in its cone for ' + hadA + ' steps), then finds and hits the second']);
    // refused: a contact with no solution, or one that is no longer tracked
    const w3 = fcWorld(7); w3.p.h = PI / 2; w3.place(3000, 0, 90, 0); w3.run(2, { throttle: 0, depthCmd: 20 }); w3.run(0.3, { throttle: 0, depthCmd: 20, fire: true }); w3.ev.length = 0;
    w3.run(0.1, { throttle: 0, depthCmd: 20, target: w3.tgt.id, cmd: 'retarget' }); const none = w3.ev.find(e => e.type === 'refuse');
    w3.run(0.1, { throttle: 0, depthCmd: 20, target: 0 }); w3.run(0.1, { throttle: 0, depthCmd: 20, target: 424242, cmd: 'retarget' }); const gone = w3.ev.filter(e => e.type === 'refuse')[1];
    parts.push([!!none && none.why === 'grade' && !!gone && gone.why === 'target' && w3.st.torps[0].phase === 'run', 'Retarget is refused, with the reason, for a contact with no solution and for one no longer tracked']);
  }
  {
    // Reject: a torpedo circling a noisemaker is told to leave it; it searches again and does not go back
    const w = fcWorld(8); w.p.h = PI / 2; w.place(1500, 0, 90, 0);
    w.run(2, { throttle: 0, depthCmd: 20 }); w.run(18, st => ({ throttle: 0, depthCmd: 20, enable: 1, launch: 1, fire: st.t > 2.1 && st.t < 2.4 }));
    const t = w.st.torps.find(t => t.side === 0), dc = { id: 77777, side: 1, x: t.x + Math.cos(t.h) * 150, z: t.z - Math.sin(t.h) * 150, depth: 6, life: 60 };
    w.st.decoys.push(dc); t.phase = 'bait'; t.bait = dc.id; t.seen.push(dc.id);
    w.run(1, { throttle: 0, depthCmd: 20 }); const view = w.st.seeker, cue = view && view.lock && !view.lock.moving && !view.lock.mach;
    w.run(0.1, { throttle: 0, depthCmd: 20, cmd: 'reject' }); const after = t.phase, rej = t.rej.slice(); let back = 0;
    w.run(30, { throttle: 0, depthCmd: 20 }, st => { if (t.bait === dc.id) back++; return st.torps.includes(t); });
    // a ship lock reads as moving, with machinery; and rejecting it throws the chance away
    const w2 = fcWorld(8); w2.p.h = PI / 2; w2.place(900, 350, 90, 5);
    w2.run(2, { throttle: 0, depthCmd: 20 }); w2.run(40, st => ({ throttle: 0, depthCmd: 20, enable: 1, launch: 1, fire: st.t > 2.1 && st.t < 2.4 }), st => !st.torps.some(t => t.phase === 'home'));
    w2.run(0.2, { throttle: 0, depthCmd: 20 }); const v2 = w2.st.seeker, cue2 = v2 && v2.lock && v2.lock.moving && v2.lock.mach, t2 = w2.st.torps.find(t => t.side === 0);
    w2.run(0.1, { throttle: 0, depthCmd: 20, cmd: 'reject' }); let again = 0; w2.run(40, { throttle: 0, depthCmd: 20 }, st => { if (t2.target === w2.tgt.id) again++; return st.torps.includes(t2); });
    // the list holds two: a third rejection drops the oldest
    t.rej = [1, 2]; t.phase = 'home'; t.target = 3; if (!w.st.torps.includes(t)) w.st.torps.push(t); t.wire = true; t.life = 50; w.p.wireId = t.id; w.run(1 / 30, { throttle: 0, depthCmd: 20, cmd: 'reject' });
    // with no lock there is nothing to reject
    const w4 = fcWorld(8); w4.p.h = PI / 2; w4.place(3000, 0, 90, 0); w4.run(2, { throttle: 0, depthCmd: 20 }); w4.run(0.3, { throttle: 0, depthCmd: 20, fire: true }); w4.ev.length = 0; w4.run(0.1, { throttle: 0, depthCmd: 20, cmd: 'reject' });
    const no = w4.ev.find(e => e.type === 'refuse');
    parts.push([cue && after === 'search' && rej.length === 1 && rej[0] === dc.id && back === 0 && cue2 && again === 0 && t.rej.join() === '2,3' && !!no && no.why === 'nolock',
      'Reject: a lock on a noisemaker reads "stationary, no machinery" in the seeker view; rejected, the torpedo searches again and never returns to it. A ship reads "moving, machinery"; rejected, it is never locked on to again. The list keeps the last two. With no lock the order is refused.']);
  }
  {
    // selection: the newest torpedo takes the wire orders; another can be picked; when the picked one is gone the orders fall to the next still on its wire
    const w = fcWorld(9); w.p.h = PI / 2; w.place(900, 0, 90, 0);
    w.run(2, { throttle: 0, depthCmd: 20 }); w.run(0.3, { throttle: 0, depthCmd: 20, fire: true, launch: 1 }); const a = w.st.torps[0].id;
    w.run(4, { throttle: 0, depthCmd: 20 }); w.run(0.3, { throttle: 0, depthCmd: 20, fire: true, launch: 1 }); const b = w.st.torps[1].id, newest = w.p.wireId === b;
    w.run(0.1, { throttle: 0, depthCmd: 20, cmd: 'weapon', arg: a }); const picked = w.p.wireId === a;
    w.run(0.1, { throttle: 0, depthCmd: 20 }); w.run(0.1, { throttle: 0, depthCmd: 20, cmd: 'next' }); const nxt = w.p.wireId === b;
    w.run(0.1, { throttle: 0, depthCmd: 20 }); w.run(0.1, { throttle: 0, depthCmd: 20, cmd: 'weapon', arg: a });
    let fell = false, stale = 0; w.run(60, { throttle: 0, depthCmd: 20 }, st => { const ids = st.torps.filter(t => t.side === 0 && t.wire).map(t => t.id); if (st.player.wireId && !ids.includes(st.player.wireId)) stale++; if (!ids.includes(a) && ids.includes(b) && st.player.wireId === b) fell = true; return ids.length > 0; });
    // homing does not end the selection (it did before Stage I)
    const w2 = fcWorld(9); w2.p.h = PI / 2; w2.place(900, 0, 90, 0); w2.run(2, { throttle: 0, depthCmd: 20 }); let homingSel = false;
    w2.run(40, st => ({ throttle: 0, depthCmd: 20, launch: 1, fire: st.t > 2.1 && st.t < 2.4 }), st => { const t = st.torps.find(t => t.side === 0); if (t && t.phase === 'home' && st.player.wireId === t.id && st.seeker && st.seeker.id === t.id) homingSel = true; });
    parts.push([newest && picked && nxt && fell && stale === 0 && w.p.wireId === 0 && homingSel, 'selection: the newest torpedo is selected; another can be picked, by name or with Next; when the picked one hits, the orders fall to the other still on its wire, and to none when that is gone; a homing torpedo stays selected']);
  }
  {
    // the wire cut: every wire order is refused aloud
    const w = fcWorld(10); w.p.h = PI / 2; w.place(3000, 0, 90, 0);
    w.run(2, { throttle: 2, depthCmd: 20 }); w.run(0.3, { throttle: 2, depthCmd: 20, fire: true }); const t = w.st.torps[0];
    w.run(12, { throttle: 4, depthCmd: 20 }); const cut = w.ev.find(e => e.type === 'wireCut'); w.ev.length = 0;
    for (const c of [{ cmd: 'retarget', target: w.tgt.id }, { cmd: 'reject' }, { cmd: 'next' }, { cmd: 'weapon', arg: t.id }, { wire: 1 }]) { w.run(0.1, Object.assign({ throttle: 2, depthCmd: 20 }, c)); w.run(0.1, { throttle: 2, depthCmd: 20 }); }
    const ref = w.ev.filter(e => e.type === 'refuse'), h0 = t.h; w.run(1, { throttle: 2, depthCmd: 20, wire: 1 });
    parts.push([!!cut && cut.sel === true && !t.wire && w.p.wireId === 0 && w.st.seeker === null && ref.length === 5 && ref.every(e => e.why === 'wire') && Math.abs(wrap(t.h - h0)) < 1e-9 && t.rej.length === 0,
      'the wire cut (by speed): the selected weapon is dropped, and Retarget, Reject, Next, picking it and steering are each refused with an event (' + ref.map(e => e.what).join(', ') + ')']);
  }
  {
    // search patterns: with nothing to find, a Snake sweeps 30 degrees either side and gets less far along its course than a Straight run; a Circle turns once round
    const road = search => { const w = fcWorld(11); w.p.h = PI / 2; w.place(30000, 0, 90, 0); w.run(1, { throttle: 0, depthCmd: 20 }); const hs = []; let x0 = 0, z0 = 0, turned = 0, prev = null;
      w.run(70, st => ({ throttle: 0, depthCmd: 20, launch: 1, enable: 1, search, fire: st.t > 1.1 && st.t < 1.4 }), st => { const t = st.torps[0]; if (!t) return; if (prev !== null) turned += wrap(t.h - prev); prev = t.h; hs.push(wrap(t.h - PI / 2)); });
      const t = w.st.torps[0]; return { adv: t.z, swing: [Math.min(...hs), Math.max(...hs)], turned }; };
    const st0 = road(0), sn = road(1), ci = road(2);
    parts.push([Math.abs(st0.swing[0]) < 1e-6 && Math.abs(st0.swing[1]) < 1e-6 && sn.swing[0] < -0.5 && sn.swing[1] > 0.5 && sn.swing[1] < 0.54 && -sn.adv < -st0.adv - 50 && Math.abs(Math.abs(ci.turned) - 2 * PI) < 0.05,
      'search: Straight holds its course; Snake swings ' + (sn.swing[1] / DEG).toFixed(0) + ' degrees either side and is ' + (sn.adv - st0.adv).toFixed(0) + ' m less far along after 70 s; Circle turns once round (' + (Math.abs(ci.turned) / DEG).toFixed(0) + ' degrees) and runs on']);
  }
  check('weapon', parts, parts.length + ' rules hold: run depth, enable and reach, aim, arming, swim-out, Retarget, Reject, selection, the wire cut, search patterns (-v lists them)');
}
/*STAGE-I-END*/
/*STAGE-J-BEGIN*/
/* ---------- Stage J: the anti-ship missile, the tubes and the rack, and the frigate's defences ---------- */
// Staging for these checks: the fixed scene that section 5 of the brief sets for its balance table. The boat is at 30 m and 4 knots; one ship of the First
// Blood sea is the target, due north at 5,000 m, crossing at 8 knots; every other ship and all sea life is far away. Fire control's solution for the target is
// exact: it is fitted to a log of noiseless fixes, so the scene measures the missile and the defences, not the aim. The target is moved by hand along its
// track until a frigate first sees a missile; from then on the ships sail themselves. Options change one thing at a time (range, depth, target kind, ...).
const MQ = SIM.V.missile, MSG = SIM.MSG;
const brgTo = (ax, az, bx, bz) => Math.atan2(-(bz - az), bx - ax);
function mWorld(seed, o) {
  o = o || {};
  // whenever the sim fits the target's track again it is handed the noiseless log (until the ship starts to react, when its last exact fit stands); 'plain' leaves the sim's own fitter alone
  let K = null, clean = null;
  const solver = o.plain ? undefined : (obs, q) => K && obs === K.obs ? (w.free ? K.sol : SIM.solveTrack(clean(q.t), Object.assign({}, q, { from: -1e9, holdC: null, holdS: null, wide: true }))) : SIM.solveTrack(obs, q);
  // build: another build of the sim to make the world in (the 'unchanged' check; 'plain' worlds only, as the fitter handed in above is this build's)
  const sim = (o.build || SIM).createSim({ mission: o.mission || 'firstblood', seed, solver, difficulty: o.difficulty || 'standard' }), st = sim.state, p = st.player;
  const tgt = o.convoy ? st.ships[0] : st.ships.find(q => q.kind === (o.kind || 'frigate'));
  const w = { sim, st, p, tgt, ev: [], free: false, launched: false, pins: [], inp: { throttle: 1, depthCmd: o.depth || 30, weapon: 1, attack: o.attack || 0, route: o.route || 0, mast: !!o.mast, target: tgt.id } };
  if (!o.convoy) for (const q of st.ships) if (q !== tgt) { q.x = 60000 + q.id * 500; q.z = 60000; q.wp = [{ x: q.x + 1e5, z: q.z }]; q.wi = 0; }
  for (const b of st.bios) { b.x = b.hx = b.tx = -60000; b.z = b.hz = b.tz = 60000; }
  for (const h of st.helos) h.fuel = 1e9;
  st.bed.shoals.length = 0;
  const place = () => { p.h = PI / 2; p.depth = o.depth || 30; p.depthCmd = p.depth; p.speed = (o.knots || 4) * KN; };
  p.x = 0; p.z = 0; place();
  // the escorted row: the Strait Shadow convoy sails for 20 s to settle on its stations, then the boat is put off the high-value ship's beam
  if (o.convoy) { for (let i = 0; i < 600; i++) sim.step(STEP, { throttle: 1, depthCmd: p.depth }); sim.events.length = 0; p.x = tgt.x; p.z = tgt.z + (o.range || 5000); place(); st.tracks.length = 0; }
  const R = o.range || 5000;
  w.tx = 0; w.tz = -R; w.c = o.course === undefined ? 0 : o.course; w.v = (o.tknots === undefined ? 8 : o.tknots) * KN; w.t0 = 0;
  w.hold = () => { for (const q of w.pins) { q.s.x = q.x; q.s.z = q.z; q.s.h = q.h; q.s.speed = 0; }
    if (w.free || o.convoy) return; const dt = st.t - w.t0; tgt.x = w.tx + Math.cos(w.c) * w.v * dt; tgt.z = w.tz - Math.sin(w.c) * w.v * dt; tgt.h = w.c; tgt.speed = w.v; };
  // the ship turns by so much, where it is, and holds the new course
  w.turn = by => { const dt = st.t - w.t0; w.tx += Math.cos(w.c) * w.v * dt; w.tz -= Math.sin(w.c) * w.v * dt; w.t0 = st.t; w.c += by; w.hold(); };
  // one more ship, held still at a place of its own
  w.also = (kind, x, z, h) => { const s = st.ships.find(q => q.kind === kind && q !== tgt && !w.pins.some(n => n.s === q)); w.pins.push({ s, x, z, h: h || 0 }); return s; };
  // the alert level the other side holds, with no idea where the boat is
  w.level = l => { const e = st.enemy; e.base = l; e.level = l; e.x = 30000; e.z = 30000; e.err = 260; e.age = 0; e.fixAge = 99; e.cues = l ? 4 : 0; };
  w.step = inp => { w.hold(); p.speed = Math.min(p.speed, (o.knots || 4) * KN); if (o.level !== undefined && !w.launched) w.level(o.level); if (w.pre) w.pre();
    sim.step(STEP, Object.assign({}, w.inp, inp || {})); for (const e of sim.events) { w.ev.push(e); if (e.type === 'mFire') w.launched = true; } sim.events.length = 0;
    if (!w.free) for (const m of st.missiles) if (Object.keys(m.seen).length) w.free = true; };
  w.run = (secs, inp, each) => { for (let i = 0; i < Math.round(secs * 30); i++) { w.step(typeof inp === 'function' ? inp(st, i) : inp); if (each && each(st, i) === false) return false; } return true; };
  w.track = () => st.tracks.find(q => q.id === tgt.id) || null;
  // the boat has to have heard the ship once for fire control to hold a track of it: the ship is shown to it close by for a moment
  w.hear = () => { let k = w.track(); if (k) return k; const was = w.free, sx = tgt.x, sz = tgt.z; w.free = true;
    for (let i = 0; i < 45 && !k; i++) { tgt.x = p.x; tgt.z = p.z - 900; sim.step(STEP, { throttle: 1, depthCmd: p.depth }); k = w.track(); }
    w.free = was; sim.events.length = 0; tgt.x = sx; tgt.z = sz; w.hold(); return k; };
  // noiseless fixes of the ship's steady track over the last two minutes, as the boat would have logged them (dx, dz: the whole log put this far off the truth)
  const fixes = (now, dx, dz) => { const obs = [], vx = Math.cos(tgt.h) * tgt.speed, vz = -Math.sin(tgt.h) * tgt.speed, bvx = Math.cos(p.h) * p.speed, bvz = -Math.sin(p.h) * p.speed, lead = now - st.t;
    for (let a = 120; a >= 0; a -= 3) { const ox = p.x - bvx * a, oz = p.z - bvz * a, sx = tgt.x + (dx || 0) - vx * (a - lead), sz = tgt.z + (dz || 0) - vz * (a - lead);
      obs.push({ t: now - a, x: ox, z: oz, b: Math.atan2(oz - sz, sx - ox), s: 0.002, k: 'ping', r: Math.hypot(sx - ox, sz - oz), rs: 10 }); }
    return obs; };
  w.exact = (dx, dz) => { const k = w.hear(); w.hold(); clean = now => fixes(now, dx, dz); K = k;
    k.sol = SIM.solveTrack(clean(st.t), { t: st.t, x: p.x, z: p.z, from: -1e9, holdC: null, holdS: null, still: false, prev: k.sol, wide: true }); return k; };
  // the same fixes written into fire control's own log, for the sim's own fitter to work on ('plain' worlds)
  w.log = (dx, dz) => { const k = w.hear(); w.hold(); k.obs.length = 0; for (const q of fixes(st.t, dx, dz)) k.obs.push(q); k.from = -1e9; k.holdC = null; k.holdS = null; return k; };
  // the tubes and the rack set by hand: one letter a tube, T a torpedo, M a missile, - empty
  w.load = (tubes, rack) => { tubes.split('').forEach((c, i) => { const u = p.tube[i], x = c === 'T' ? 'torpedo' : c === 'M' ? 'missile' : ''; u.s = x || 'empty'; u.w = x; u.to = ''; u.q = ''; u.t = 0; });
    if (rack) { p.rack.torpedo = rack.torpedo; p.rack.missile = rack.missile; } p.readyT = p.tube.filter(u => u.s === 'torpedo').length; p.readyM = p.tube.filter(u => u.s === 'missile').length; };
  // Fire pressed n times, one fire gap apart (or so many seconds apart). Gives the missiles' ids; 0 for a press that was refused.
  w.fire = (n, gap) => { const ids = []; for (let i = 0; i < (n || 1); i++) { const n0 = w.ev.length; w.step({ fire: true }); const e = w.ev.slice(n0).find(q => q.type === 'mFire'); ids.push(e ? e.id : 0);
      if (!e) w.refused = w.ev.slice(n0).find(q => q.type === 'refuse'); if (i + 1 < (n || 1)) w.run(gap || SIM.V.fireGap + 0.05); } return ids; };
  // an order given once: the step that carries it, then a step without it, so that the same order can be given again
  w.tap = inp => { w.step(inp); w.step(); };
  w.fly = (max, each) => { w.run(max || 90, null, (s, i) => { if (each) each(s, i); return st.missiles.length > 0 || st.shots.length > 0; }); return w; };
  w.of = type => w.ev.filter(e => e.type === type);
  w.ends = () => w.ev.filter(e => e.type === 'mEnd' || (e.type === 'hit' && e.weapon === 'missile'));
  w.bare = keep => { tgt.sam = 0; tgt.chaff = keep && keep.chaff || 0; tgt.gun = !!(keep && keep.gun); return w; };
  return w;
}
// one row of the balance table: so many seeds, every missile's one outcome counted
function mRow(o, n) {
  const r = { n: 0, hit: 0, other: 0, sam: 0, gun: 0, decoyed: 0, missed: 0, jammed: 0, fore: 0, mid: 0, aft: 0, launches: 0, through: 0, shots: 0, pulls: 0, tries: 0, far: 0, refused: 0, taken: 0, two: 0, pulled: [], looks: 0, takes: 0, lured: 0, luredHit: 0, luredEnd: 0, luredShot: 0, seen: 0, flank: 0, slow: 0, updates: 0, updRefused: 0, relock: 0, direct: 0, time: 0 };
  for (let seed = 1; seed <= n; seed++) {
    const w = mWorld(seed, o); w.exact(o.dx, o.dz);
    const ids = w.fire(o.salvo || 1); if (ids.some(i => !i)) { r.refused++; continue; }
    // o.turn: the target turns { by } so much { at } so many seconds after the launch. o.update: so many seconds after the launch fire control's solution is made exact again and Update missile is ordered once.
    const t0 = w.st.t, each = st => { for (const s of st.ships) if (st.shots.filter(d => d.ship === s.id).length > 1) r.two++; }; let turned = !o.turn, sent = !o.update, tap = 0;
    if (o.turn || o.update) w.run(150, () => tap-- > 0 ? { cmd: 'mupdate' } : null, st => { each(st);
      if (!turned && st.t - t0 >= o.turn.at) { turned = true; w.turn(o.turn.by); } if (!sent && st.t - t0 >= o.update) { sent = true; w.exact(); tap = 1; }
      return st.missiles.length > 0 || st.shots.length > 0 || !sent; });
    else w.fly(120, each);
    let got = 0;
    for (const e of w.ev) {
      if (e.type === 'mSeen') { r.seen++; if (e.flank) r.flank++; if (e.alert && e.flank) r.slow++; }
      else if (e.type === 'mUpdate') { r.updates++; if (e.lock) r.relock++; }
      else if (e.type === 'refuse' && e.what === 'update') r.updRefused++;
      else if (e.type === 'mFire') { if (e.direct) r.direct++; const end = w.ev.find(q => (q.type === 'mEnd' || (q.type === 'hit' && q.weapon === 'missile')) && q.id === e.id); if (end) r.time += end.t - e.t; }
      if (e.type === 'hit' && e.weapon === 'missile') { r.n++; r.hit++; got++; r[e.where]++; if (e.ship !== w.tgt.id) r.other++; }
      else if (e.type === 'mEnd') { r.n++; r[e.why]++; if (e.why === 'missed' && e.jam) r.jammed++; }
      else if (e.type === 'samFire') r.shots++;
      else if (e.type === 'chaff') { if (e.kind === 'near') { r.tries++; if (e.pull) { r.pulls++; r.pulled.push(seed); } } else r.far++; }
      else if (e.type === 'mLock' && e.cloud && !w.ev.some(q => q.type === 'chaff' && q.cloud === e.cloud && q.pull && q.id === e.id)) r.taken++;
      else if (e.type === 'chaffLook') { r.looks++; if (e.take) r.takes++; }
    }
    // the missiles whose lock a distraction cloud took, and how many of those went on to hit a ship after all
    for (const id of new Set(w.ev.filter(e => e.type === 'mLock' && e.cloud && w.ev.some(q => q.type === 'chaff' && q.cloud === e.cloud && q.kind === 'far')).map(e => e.id))) {
      r.lured++; const end = w.ev.find(e => e.type === 'mEnd' && e.id === id);
      if (w.ev.some(e => e.type === 'hit' && e.weapon === 'missile' && e.id === id)) r.luredHit++; else if (end && end.why === 'decoyed') r.luredEnd++; else if (end && (end.why === 'sam' || end.why === 'gun')) r.luredShot++; }
    r.launches++; if (got > 0) r.through++;
  }
  r.stop = 100 * (r.n - r.hit) / Math.max(1, r.n); r.thru = 100 * r.through / Math.max(1, r.launches);
  return r;
}
const mShow = r => { const q = x => (100 * x / Math.max(1, r.n)).toFixed(1) + '%';
  return 'stopped ' + r.stop.toFixed(1) + '% of ' + r.n + ' missiles (defence missile ' + q(r.sam) + ', gun ' + q(r.gun) + ', decoyed ' + q(r.decoyed) + ', missed ' + q(r.missed) + ', of which jammed ' + q(r.jammed) + '); hits ' + q(r.hit)
    + ' (forward ' + r.fore + ', amidships ' + r.mid + ', aft ' + r.aft + '; on a ship other than the target ' + r.other + '); at least one through in ' + r.thru.toFixed(1) + '% of ' + r.launches + ' launches; ' + (r.shots / Math.max(1, r.launches)).toFixed(2)
    + ' defence missiles fired per launch; seduction took ' + r.pulls + ' of ' + r.tries + ' locks; ' + r.far + ' distraction clouds, which came into a seeker\'s view ' + r.looks + ' times and were taken ' + r.takes + ' times; a cloud chosen by the seeker itself ' + r.taken + ' times; ' + r.lured + ' missiles lured by a distraction cloud: ' + r.luredEnd + ' ended at it (' + (100 * r.luredEnd / Math.max(1, r.n - r.hit)).toFixed(1) + '% of all stops), ' + r.luredShot + ' were shot down on the way and ' + r.luredHit + ' still hit a ship'
    + '; ' + (r.time / Math.max(1, r.n)).toFixed(1) + ' s from launch to the end; ' + r.slow + ' of ' + r.seen + ' first sights by an alert frigate came from the flank (slow reaction)' + (r.updates || r.updRefused ? '; ' + r.updates + ' updates taken (' + r.relock + ' let go of a lock), ' + r.updRefused + ' refused' : '') + (r.direct ? '; ' + r.direct + ' dog-legs flown direct' : ''); };
const mLines = [];
if (want('missile')) {
  const near = (a, b, tol) => Math.abs(a - b) <= tol, f1 = x => x.toFixed(1), sec = (w, type, k) => { const e = w.of(type)[k || 0]; return e ? e.t : -1; };

  // 1. the launch gate: every refusal, each with its own words, in the order the brief lists them
  {
    const parts = [], TEXT = { target: 'Select a ship first.', solution: 'No usable solution for a missile yet: it needs a range.', close: 'Too close for a missile.', far: 'Beyond missile reach.', deep: 'Too deep to launch a missile.', fast: 'Too fast to launch a missile.', tube: 'No missile tube is ready.' };
    const press = (w, inp) => { const tg = inp && inp.target !== undefined ? inp.target : w.tgt.id, g = w.sim.gate(tg), n0 = w.ev.length, m0 = w.st.missiles.length; w.step(Object.assign({ fire: true }, inp || {}));
      const ev = w.ev.slice(n0), r = ev.find(e => e.type === 'refuse' && e.what === 'missile'); return { fired: ev.some(e => e.type === 'mFire'), why: r ? r.why : '', gate: g, flew: w.st.missiles.length - m0 }; };
    const made = (o, exact) => { const w = mWorld(5, o); if (exact !== false) w.exact(); if (o && o.knots) w.p.speed = o.knots * KN; return w; };
    const got = {
      target: press(made(), { target: 0 }),
      solution: (() => { const w = made({}, false), k = w.hear(); w.run(1); const r = press(w); r.note = 'grade ' + k.sol.g; return r; })(),
      close: press(made({ range: 1400 })), far: press(made({ range: 9200 })), deep: press(made({ depth: 61 })), fast: press(made({ knots: 7 })),
      tube: (() => { const w = made(); w.fire(2); w.run(SIM.V.fireGap + 0.05); return press(w); })()
    };
    for (const k of Object.keys(TEXT)) { const r = got[k];
      parts.push([r.why === k && !r.fired && r.flew === 0 && MSG[k] === TEXT[k] && r.gate.why === k && r.gate.text === TEXT[k] && !r.gate.ok, 'refused "' + TEXT[k] + '"' + (r.why === k ? '' : ' (got: ' + (r.why || 'a launch') + ')') + (r.note ? ' (' + r.note + ')' : '')]); }
    // several things wrong at once: the first in the list is the one named
    const many = press(made({ range: 1400, depth: 61, knots: 7 })), two = press(made({ depth: 61, knots: 7 }));
    parts.push([many.why === 'close' && two.why === 'deep', 'too close, too deep and too fast at once is refused as "' + MSG[many.why] + '"; too deep and too fast as "' + MSG[two.why] + '"']);
    // and at the limits it is accepted
    const edge = press(made({ range: 8900, depth: 60, knots: 6 })), low = press(made({ range: 1600 }));
    parts.push([edge.fired && edge.gate.ok && low.fired, 'accepted at 60 m and 6 kn from 8,900 m, and from 1,600 m']);
    // a rough aim is enough: a solution graded Poor is accepted when it gives a range at all (here bearings on a steady course and two rough range fixes, each 40% uncertain, fitted by
    // the sim's own fitter); bearings alone give no range, and that is still refused. The torpedo's rules are not touched.
    { const rough = fixes => { const w = mWorld(5, { plain: true }), k = w.log(); k.obs.forEach((q, i) => { if (fixes && i % 20 === 10) q.rs = 0.4 * q.r; else { q.k = 'bearing'; q.s = 0.02; delete q.r; delete q.rs; } });
        k.sol = SIM.solveTrack(k.obs, { t: w.st.t, x: w.p.x, z: w.p.z, from: -1e9, holdC: null, holdS: null, still: false, prev: null });
        const g = k.sol.g, r = k.sol.r, res = press(w); return { g, r, res, n: k.obs.length, d: Math.hypot(w.tgt.x - w.p.x, w.tgt.z - w.p.z) }; };
      const a = rough(true), b = rough(false);
      parts.push([MQ.grade === 1 && a.g === 1 && a.r !== null && a.res.gate.ok && a.res.fired && b.r === null && !b.res.fired && b.res.why === 'solution',
        'a solution graded Poor (grade ' + a.g + ': ' + a.n + ' bearings, two of them with a rough range; it puts the ship at ' + (a.r === null ? 'no range' : Math.round(a.r) + ' m, truly ' + Math.round(a.d) + ' m') + ') is accepted: ' + (a.res.fired ? 'launched' : 'refused as ' + a.res.why)
        + '; bearings alone (grade ' + b.g + ', no range) are refused: "' + (MSG[b.res.why] || 'launched') + '"']); }
    check('missile gate', parts, parts.length + ' rules hold: every refusal has its own words (-v lists them)');
  }

  // 2. no truth leak, and the aim's allowance for the capsule's rise and the boost
  {
    const parts = [];
    // Two launches from the same log of fixes. In the second the real ship is moved 800 m before firing, and nothing new is heard of it. The aim point is the same to the last digit.
    const shot = move => { const w = mWorld(9, { plain: true }); w.log(); w.run(1.4); if (move) { w.tx += move; w.hold(); w.run(0.2); } else w.run(0.2);
      const k = w.track(), log = JSON.stringify(k.obs), sol = JSON.stringify(k.sol), at = { x: w.tgt.x, z: w.tgt.z }; w.fire(1); const f = w.of('mFire')[0]; return { w, log, sol, at, f, grade: k.sol.g }; };
    const a = shot(0), b = shot(800), moved = Math.hypot(a.at.x - b.at.x, a.at.z - b.at.z);
    parts.push([!!a.f && !!b.f && a.log === b.log && a.sol === b.sol && moved > 790 && a.f.ax === b.f.ax && a.f.az === b.f.az,
      'two launches with the same log of fixes (' + JSON.parse(a.log).length + ' fixes, grade ' + a.grade + ') and the real ship ' + Math.round(moved) + ' m apart are aimed at the same point' + (a.f && b.f ? ' (' + Math.round(a.f.ax) + ', ' + Math.round(a.f.az) + ' and ' + Math.round(b.f.ax) + ', ' + Math.round(b.f.az) + ')' : ': a launch was refused')]);
    // after the launch the real ship is moved a kilometre: the missile's aim point does not change
    if (a.f) { const m = a.w.st.missiles[0], ax = m.ax, az = m.az; a.w.free = true; a.w.tgt.x += 1000; a.w.run(8); const m2 = a.w.st.missiles[0];
      parts.push([!!m2 && m2.ax === ax && m2.az === az && ax === a.f.ax, 'a ship that moves 1,000 m after the launch does not move the aim point']); }
    // the lag: a launch from deep takes longer to reach the surface, so the aim point is set further along the ship's track. Without the allowance the ship would be 80 m on.
    const lagged = depth => { const w = mWorld(4, { kind: 'merchant', tknots: 16, depth }); w.exact(); w.fire(1); const f = w.of('mFire')[0]; w.fly(80); const h = w.ev.find(e => e.type === 'hit' && e.weapon === 'missile');
      return { lag: f ? f.lag : -1, want: MQ.speed * (depth / MQ.rise + MQ.boost), off: f && h ? Math.hypot(f.ax - w.tgt.x, f.az - w.tgt.z) : -1, wait: (depth / MQ.rise + MQ.boost) * 16 * KN }; };
    const deep = lagged(56), shallow = lagged(8);
    parts.push([near(deep.lag, deep.want, 1e-6) && near(shallow.lag, shallow.want, 1e-6) && deep.lag > shallow.lag && deep.off >= 0 && deep.off < 20 && shallow.off >= 0 && shallow.off < 20,
      'the aim allows for the capsule\'s rise and the boost: fired from 56 m at a ship crossing at 16 kn, the ship is ' + f1(deep.off) + ' m from the aim point when the missile strikes (it sails ' + Math.round(deep.wait) + ' m while the capsule rises and the booster burns); from 8 m, ' + f1(shallow.off) + ' m']);
    check('missile aim', parts, parts.length + ' rules hold: no truth leak, the aim point is fixed at launch, the lag covers the rise and the boost');
  }

  // 3. the tubes, the rack and the one handling team
  {
    const parts = [], tw = seed => { const w = mWorld(seed || 3); w.inp.weapon = 0; w.inp.target = 0; return w; }, rk = p => p.rack.torpedo + 'T ' + p.rack.missile + 'M';
    // every mission starts with 6 torpedoes and 2 missiles in the tubes and 4 and 2 in the rack
    const loads = Object.keys(MISSIONS).map(id => { const p = createSim({ mission: id, seed: 2 }).state.player; return p.tube.map(u => u.s[0]).join('') + ' ' + rk(p); });
    parts.push([loads.every(l => l === 'ttttttmm 4T 2M'), 'every mission starts with 6 torpedo tubes and 2 missile tubes loaded, and 4 torpedoes and 2 missiles in the rack']);
    // a swap takes 60 s; the tube cannot fire meanwhile; the rack gives one and takes one
    { const w = tw(), p = w.p; w.tap({ cmd: 'swap', arg: 1 }); const i = p.job, u = p.tube[i], t0 = sec(w, 'swap', 1); let held = true, r29 = '', r31 = '';
      w.run(59, null, st => { if (u.s !== 'swapping' || p.readyT !== 5 || p.readyM !== 2) held = false; if (near(st.t - t0, 29, 0.02)) r29 = rk(p); if (near(st.t - t0, 31, 0.02)) r31 = rk(p); });
      w.run(1.2); const e = w.of('swapEnd')[0];
      parts.push([i >= 0 && held && r29 === '4T 2M' && r31 === '5T 2M' && rk(p) === '5T 1M' && !!e && near(e.t - t0, SIM.V.swap, 0.1) && u.s === 'missile' && p.readyT === 5 && p.readyM === 3,
        'a swap to a missile takes ' + (e ? f1(e.t - t0) : '?') + ' s; the tube is out of use throughout; the rack goes 4T 2M, then ' + r31 + ' at half time (the torpedo is back), then ' + rk(p) + ' (the missile is in the tube)']); }
    { const w = tw(), p = w.p; w.tap({ cmd: 'swap', arg: 1 }); const u = p.tube[p.job]; w.run(3); const ids = []; for (let k = 0; k < 6; k++) { const n0 = w.ev.length; w.step({ fire: true }); ids.push(w.ev.slice(n0).find(e => e.type === 'fire' || e.type === 'refuse')); w.run(SIM.V.fireGap + 0.05); }
      const fired = ids.filter(e => e && e.type === 'fire').length, last = ids[5];
      parts.push([fired === 5 && !!last && last.type === 'refuse' && last.why === 'onlyM' && u.s === 'swapping' && u.w === 'torpedo', 'with a tube in the middle of a swap, the other 5 torpedoes fire and the sixth press is refused ("' + (last && last.why ? MSG[last.why] : '?') + '"): the torpedo still inside the swapping tube cannot be fired']); }
    // a cancel in the first half keeps the weapon; after that the tube is left empty and is reloaded like any other
    { const w = tw(), p = w.p; w.tap({ cmd: 'swap', arg: 1 }); const u = p.tube[p.job]; w.run(20); w.tap({ cmd: 'unswap' }); const e = w.of('swapEnd')[0];
      const early = !!e && e.why === 'cancel' && e.kept === 'torpedo' && u.s === 'torpedo' && p.readyT === 6 && rk(p) === '4T 2M' && p.held.torpedo === 0 && p.held.missile === 0 && p.job === -1;
      const w2 = tw(), p2 = w2.p; w2.tap({ cmd: 'swap', arg: 1 }); const u2 = p2.tube[p2.job]; w2.run(40); w2.tap({ cmd: 'unswap' }); const e2 = w2.of('swapEnd')[0], mid = u2.s + ' ' + rk(p2); w2.run(SIM.V.reload + 0.5);
      parts.push([early && !!e2 && e2.kept === '' && mid === 'empty 5T 2M' && p2.held.missile === 0 && u2.s === 'torpedo' && rk(p2) === '4T 2M' && p2.readyT === 6,
        'a swap cancelled after 20 s leaves the torpedo in its tube and the rack at ' + rk(p) + '; cancelled after 40 s it leaves the tube ' + mid + ', and the team then reloads it as any empty tube']); }
    // silent running pauses the team; a flooded Torpedo room jams it
    { const w = tw(), p = w.p; w.tap({ cmd: 'swap', arg: 1 }); const u = p.tube[p.job], t0 = sec(w, 'swap', 1); w.run(10); const a = u.t; w.run(30, { silent: true }); const b = u.t; w.run(52); const e = w.of('swapEnd')[0];
      const w2 = tw(), p2 = w2.p, dm = w2.st.dmg; w2.tap({ cmd: 'swap', arg: 1 }); const u2 = p2.tube[p2.job]; w2.run(10); const c = u2.t; dm.on = true; dm.sec[0].water = 1; dm.sec[0].lost = true; w2.run(10); const d = u2.t;
      parts.push([near(b, a, 0.05) && !!e && near(e.t - t0, SIM.V.swap + 30, 0.2) && near(d, c, 0.05) && u2.s === 'swapping' && !w2.st.over,
        '30 s of silent running pause a swap (work done ' + f1(a) + ' s before and ' + f1(b) + ' s after; it ends ' + (e ? f1(e.t - t0) : '?') + ' s after it began); with the Torpedo room flooded it stops (' + f1(c) + ' s, and ' + f1(d) + ' s ten seconds later)']); }
    // the queue: a reload of an empty tube goes before a waiting swap, but never interrupts the one in hand
    { const w = tw(), p = w.p; w.tap({ cmd: 'swap', arg: 1 }); const a = p.job, t0 = sec(w, 'swap', 1); w.tap({ cmd: 'swap', arg: 1 }); const b = p.swaps[0]; w.run(5); w.step({ fire: true }); const e0 = p.tube.findIndex(u => u.s === 'empty'); let same = true;
      w.run(54, null, () => { if (p.job !== a) same = false; }); w.run(100);
      const seq = w.ev.filter(e => (e.type === 'swap' && e.start) || e.type === 'swapEnd' || e.type === 'reload').map(e => (e.type === 'swap' ? 'swap starts' : e.type === 'reload' ? 'reload done' : 'swap done') + ' tube ' + (e.tube + 1) + ' at ' + Math.round(e.t - t0) + ' s');
      const want = ['swap starts tube ' + (a + 1) + ' at 0 s', 'swap done tube ' + (a + 1) + ' at 60 s', 'reload done tube ' + (e0 + 1) + ' at 82 s', 'swap starts tube ' + (b + 1) + ' at 82 s', 'swap done tube ' + (b + 1) + ' at 142 s'];
      parts.push([same && a !== b && e0 >= 0 && JSON.stringify(seq) === JSON.stringify(want), 'one swap in hand, one waiting, then a torpedo is fired: ' + seq.join(', ') + (same ? '' : ' (the swap in hand was interrupted)')]); }
    // two orders for the last rack missile: one accepted, one refused; a cancel gives the missile back once
    { const w = tw(), p = w.p, held = [], said = () => { const e = w.ev[w.ev.length - 1]; return e && e.type === 'refuse' ? e.why : e ? e.type : ''; };
      w.tap({ cmd: 'swap', arg: 1 }); held.push(p.held.missile); w.tap({ cmd: 'swap', arg: 1 }); held.push(p.held.missile); const n0 = w.ev.length; w.tap({ cmd: 'swap', arg: 1 }); const third = w.ev.slice(n0).find(e => e.type === 'refuse'); held.push(p.held.missile);
      w.tap({ cmd: 'unswap' }); held.push(p.held.missile); const n1 = w.ev.length; w.tap({ cmd: 'swap', arg: 1 }); const again = w.ev.slice(n1).some(e => e.type === 'swap' && !e.start); held.push(p.held.missile);
      w.tap({ cmd: 'unswap' }); held.push(p.held.missile); w.tap({ cmd: 'unswap' }); held.push(p.held.missile); const n2 = w.ev.length; w.tap({ cmd: 'unswap' }); const none = w.ev.slice(n2).find(e => e.type === 'refuse'); held.push(p.held.missile);
      const n3 = w.ev.length; w.load('TTTTTTTT', { torpedo: 4, missile: 1 }); w.tap({ cmd: 'swap', arg: 1 }); w.tap({ cmd: 'swap', arg: 1 }); const last = w.ev.slice(n3).filter(e => e.type === 'swap' && !e.start).length + '/' + w.ev.slice(n3).filter(e => e.type === 'refuse' && e.why === 'rackM').length;
      parts.push([held.join(',') === '1,2,2,1,2,1,0,0' && !!third && third.why === 'rackM' && MSG.rackM === 'No missile in the rack.' && again && !!none && none.why === 'none' && last === '1/1' && rk(p) === '4T 1M',
        'missiles spoken for after each order (swap, swap, swap, cancel, swap, cancel, cancel, cancel): ' + held.join(', ') + '; the third swap is refused ("' + (third ? MSG[third.why] : '?') + '"), the last cancel too ("' + (none ? MSG[none.why] : '?') + '"); with one missile in the rack, two orders give ' + last + ' accepted/refused']); }
    // a swap to a torpedo with no torpedo in the rack, and with no loaded tube of the other kind
    { const w = tw(); w.load('TTTTTTMM', { torpedo: 0, missile: 2 }); const n0 = w.ev.length; w.tap({ cmd: 'swap', arg: 0 }); const a = w.ev.slice(n0).find(e => e.type === 'refuse');
      w.load('MMMMMMMM', { torpedo: 4, missile: 2 }); const n1 = w.ev.length; w.tap({ cmd: 'swap', arg: 1 }); const b = w.ev.slice(n1).find(e => e.type === 'refuse');
      parts.push([!!a && a.why === 'rackT' && MSG.rackT === 'No torpedo in the rack.' && !!b && b.why === 'tubeT', 'a swap to a torpedo with none in the rack is refused ("' + (a ? MSG[a.why] : '?') + '"); a swap to a missile with no loaded torpedo tube too ("' + (b ? MSG[b.why] : '?') + '")']); }
    // an unfunded reload: a waiting swap holds the last rack torpedo; another tube then fires and has to wait
    { const w = tw(), p = w.p; w.load('TTTTTTMM', { torpedo: 2, missile: 0 }); w.step({ fire: true }); const A = p.job; w.tap({ cmd: 'swap', arg: 0 }); const S = p.swaps[0], heldT = p.held.torpedo; w.run(SIM.V.fireGap); w.step({ fire: true }); const t1 = w.st.t;
      const B = p.tube.findIndex((u, i) => u.s === 'empty' && i !== A); let empty = true, stalled = false, idle = 0;
      w.run(SIM.V.reload + SIM.V.swap + 1, null, () => { if (p.tube[B].s !== 'empty') empty = false; if (p.job < 0 && p.swaps.length) { if (++idle > 2) stalled = true; } else idle = 0; });
      const rel = w.of('reload')[0], st1 = w.ev.find(e => e.type === 'swap' && e.start), en1 = w.of('swapEnd')[0], after = p.tube.map(u => u.s[0]).join('') + ' ' + rk(p) + ' held ' + p.held.torpedo + '/' + p.held.missile;
      w.run(SIM.V.reload + 0.5, { weapon: 1 });
      parts.push([heldT === 2 && B >= 0 && empty && !stalled && !!rel && rel.tube === A && !!st1 && st1.tube === S && near(st1.t, rel.t, 0.1) && !!en1 && near(en1.t - st1.t, SIM.V.swap, 0.1) && p.tube[S].s === 'torpedo' && after.endsWith('0T 1M held 0/0') && p.tube[B].s === 'missile',
        'two torpedoes in the rack, one being loaded and the other held for a waiting swap: the second tube fired stays empty for the ' + Math.round(SIM.V.reload + SIM.V.swap) + ' s the reload and the swap take, the swap starts as the reload ends (' + (st1 && rel ? f1(st1.t - rel.t) : '?') + ' s later) and runs its 60 s, and the team is never idle with work waiting. Afterwards: ' + after + '; with Missile chosen the empty tube then takes the missile the swap put back']); }
    // the last weapon aboard, inside a swapping tube: the mission is not lost; with nothing at all aboard it is
    { const w = tw(), p = w.p; w.load('T-------', { torpedo: 0, missile: 1 }); w.tap({ cmd: 'swap', arg: 1 }); let least = 99, over = false; w.run(61, null, st => { least = Math.min(least, p.carried); if (st.over) over = true; if (p.tube[0].s === 'swapping' && p.readyT + p.readyM !== 0) over = true; });
      const w2 = tw(); w2.load('--------', { torpedo: 0, missile: 0 }); w2.run(0.2);
      parts.push([!over && least >= 1 && p.readyM === 1 && w2.st.over && w2.st.reason === 'Mission failed: no weapons left.', 'with no tube ready and the only torpedo inside a swapping tube the mission goes on (never fewer than ' + least + ' weapon counted aboard); with nothing aboard at all it ends: ' + w2.st.reason]); }
    // only missiles loaded: a torpedo shot is refused in words, and the "close enough to shoot" hint is not offered
    { const w = tw(), p = w.p; w.load('------MM', { torpedo: 0, missile: 0 }); const n0 = w.ev.length; w.step({ fire: true }); const r = w.ev.slice(n0).find(e => e.type === 'refuse'), shot = w.ev.slice(n0).some(e => e.type === 'fire' || e.type === 'mFire');
      const hint = /\['shoot',\(st,p\)=>\{[^\n]*?p\.readyT>0/.test(html);
      parts.push([!!r && r.what === 'fire' && r.why === 'onlyM' && MSG.onlyM === 'Only missiles are loaded.' && !shot && w.st.torps.length === 0 && p.readyM === 2 && hint, 'with only missile tubes loaded and Torpedo chosen, Fire is refused ("' + (r ? MSG[r.why] : '?') + '") and nothing leaves; the page offers its torpedo hint only while a torpedo tube is loaded' + (hint ? '' : ' (NOT found in the page)')]); }
    check('missile tubes', parts, parts.length + ' rules hold: the load, the swap, cancelling, silent running, flooding, the queue, reservations, the loss rule, typed readiness (-v lists them)');
  }

  // 4. the flight: silent running, the alarm, first sighting, jamming, the loss rule
  {
    const parts = [];
    // silent running ends at the breach and stays off until it is ordered afresh
    { const w = mWorld(6); w.exact(); w.inp.silent = true; w.run(2); const was = w.p.silent; w.fire(1); w.run(12, null, () => !w.of('mBreach').length); const off = w.of('silentOff').length; let stayed = true; w.run(5, null, () => { if (w.p.silent) stayed = false; });
      w.inp.silent = false; w.step(); w.inp.silent = true; w.run(0.2);
      parts.push([was && off === 1 && stayed && w.p.silent, 'the breach ends silent running, and it stays off for the next 5 s with the order still held; given afresh, it is on again']); }
    // a missile launch leaves the wire torpedoes alone
    { const w = mWorld(6); w.exact(); w.step({ weapon: 0, fire: true }); const tp = w.st.torps.find(t => t.side === 0), id0 = w.p.wireId; w.run(SIM.V.fireGap + 0.1); w.fire(1); w.run(6);
      parts.push([!!tp && id0 === tp.id && w.p.wireId === id0 && tp.wire && !w.of('wireCut').length && w.of('mFire').length === 1 && w.of('mBreach').length === 1, 'a missile launch does not change which torpedo the wire orders go to, and cuts no wire']); }
    // the alarm: 15 s after the breach, never at it; the estimate is at the launch point, not where the boat went
    { const w = mWorld(8, { range: 6000, level: 0 }), s = w.tgt, st = w.st; w.exact(); w.fire(1); const f = w.of('mFire')[0]; w.p.x -= 1000;      // the boat is a kilometre away by the time the capsule is up
      let before = 0, at = null, mode0 = -1, first = -1; const seenAt = () => { const m = st.missiles[0]; return m && m.seen[s.id] ? m.seen[s.id] : null; }; let sn = null;
      w.run(60, null, () => { const d = w.of('datum')[0]; if (!d) before = Math.max(before, st.enemy.level); else if (!at) at = { lvl: st.enemy.level, x: st.enemy.x, z: st.enemy.z, t: d.t };
        const q = seenAt(); if (q && !sn) sn = { t: q.t, at: q.at }; if (mode0 < 0 && s.mode === 'defend') mode0 = st.t; return st.missiles.length > 0 || st.shots.length > 0 || st.t < f.t + 30; });
      const b = w.of('mBreach')[0], seen = w.of('mSeen')[0], acts = w.ev.filter(e => e.type === 'samFire' || e.type === 'gunFire' || (e.type === 'chaff' && e.kind === 'near')); first = acts.length ? acts[0].t : -1;
      const off = at ? Math.hypot(at.x - f.x, at.z - f.z) : -1, boat = at ? Math.hypot(at.x - w.p.x, at.z - w.p.z) : -1;
      parts.push([!!b && !!at && near(at.t - b.t, MQ.datum, 0.1) && before === 0 && at.lvl >= 2, 'the alarm reaches the ships ' + (at && b ? f1(at.t - b.t) : '?') + ' s after the breach: the level is ' + before + ' until then and ' + (at ? at.lvl : '?') + ' after']);
      parts.push([off >= 0 && off <= 260 && boat > 700, 'they are given an area ' + Math.round(off) + ' m from the launch point, ' + Math.round(boat) + ' m from where the boat has gone']);
      // seen before the alarm, with the alarm arriving before the reaction is over: the reaction time stays 8 s
      parts.push([!!seen && !!sn && !seen.alert && !!at && seen.t < at.t && at.t < sn.at && near(sn.at - sn.t, MQ.react[0], 0.05) && first >= sn.at - 0.05 && mode0 >= sn.at - 0.05 && mode0 < sn.at + 0.2,
        'a missile first seen ' + (seen && b ? f1(seen.t - b.t) : '?') + ' s after the breach, before the alarm: the frigate still takes ' + (sn ? f1(sn.at - sn.t) : '?') + ' s to react, though the alarm came ' + (sn && at ? f1(sn.at - at.t) : '?') + ' s before that; it turns ' + (sn ? f1(mode0 - sn.t) : '?') + ' s after the sighting and first fires ' + (first >= 0 && sn ? f1(first - sn.t) : 'never') + ' s after']);
      // an alert frigate reacts in 4 s
      const w2 = mWorld(8, { range: 6000, level: 2 }); w2.exact(); w2.fire(1); let q2 = null; w2.fly(60, st2 => { const m = st2.missiles[0]; if (m && m.seen[w2.tgt.id] && !q2) q2 = { t: m.seen[w2.tgt.id].t, at: m.seen[w2.tgt.id].at }; });
      parts.push([!!q2 && near(q2.at - q2.t, MQ.react[1], 0.05) && w2.of('mSeen')[0].alert, 'an alert frigate reacts ' + (q2 ? f1(q2.at - q2.t) : '?') + ' s after the sighting']); }
    // a fresh fix is not replaced by the alarm
    { const w = mWorld(8, { range: 6000 }), e = w.st.enemy; w.exact(); w.fire(1); const f = w.of('mFire')[0]; e.base = 3; e.level = 3; e.x = 2000; e.z = 500; e.err = 45; e.age = 0; e.fixAge = 0; let at = null;
      w.run(30, null, () => { if (w.of('datum').length && !at) at = { x: e.x, z: e.z }; return !at; });
      parts.push([!!at && Math.hypot(at.x - 2000, at.z - 500) < 1 && Math.hypot(at.x - f.x, at.z - f.z) > 1500, 'a fresh fix they already hold (2 km from the launch point) is still their estimate after the alarm']); }
    // first sighting, on the same shot from 8,000 m: a pop-up as its climb starts, a sea-skimmer much later
    { const sight = attack => { const w = mWorld(12, { range: 8000, level: 0, attack }); w.exact(); w.fire(1); w.fly(80); const e = w.of('mSeen')[0]; return e ? e.d : -1; }, pop = sight(1), low = sight(0);
      parts.push([near(pop, MQ.pop.at, 150) && near(low, MQ.see.low, 150), 'the same shot from 8,000 m is first seen ' + Math.round(pop) + ' m from the frigate as a pop-up and ' + Math.round(low) + ' m as a sea-skimmer']); }
    // jamming: the seeker's reach near a frigate that is alert
    { const lock = o => { const w = mWorld(13, Object.assign({ range: 8000 }, o)); w.exact(); w.fire(1); let d = -1; w.fly(80, st => { const m = st.missiles[0]; if (m && d < 0 && (m.lock || m.cloud)) d = Math.hypot(m.x - w.tgt.x, m.z - w.tgt.z); }); return d; };
      const calm = lock({ level: 0 }), alert = lock({ level: 2 }), one = lock({ level: 1 }), three = lock({ level: 3 }), lone = lock({ level: 2, kind: 'merchant' });
      parts.push([near(calm, MQ.seek, 30) && near(one, MQ.seek, 30) && near(alert, MQ.jam.lock, 30) && near(three, MQ.jam.lock, 30) && near(lone, MQ.seek, 30),
        'the seeker locks ' + Math.round(calm) + ' m from a frigate at level 0 and ' + Math.round(one) + ' m at level 1, ' + Math.round(alert) + ' m at level 2 and ' + Math.round(three) + ' m at level 3; a merchant with no frigate within reach is locked at ' + Math.round(lone) + ' m whatever the level']); }
    // the loss rule: the last weapon is a missile in flight, and the mission waits for it
    { const last = hp => { const w = mWorld(14, { level: 0 }), st = w.st; w.exact(); w.load('------M-', { torpedo: 0, missile: 0 }); w.bare(); w.tgt.hp = hp; w.fire(1); let waited = 0, early = false; const c0 = w.p.carried;
        w.run(60, null, () => { if (st.missiles.length) { waited++; if (st.over) early = true; } return !st.over; }); return { c0, waited, early, res: st.result, why: st.reason, hit: w.ev.some(e => e.type === 'hit' && e.weapon === 'missile') }; };
      const a = last(4), b = last(1);
      parts.push([a.c0 === 0 && a.waited > 300 && !a.early && a.hit && a.res === 'lose' && a.why === 'Mission failed: no weapons left.' && b.c0 === 0 && !b.early && b.res === 'win',
        'with nothing left aboard and a missile in flight the mission goes on for the ' + f1(a.waited / 30) + ' s it flies; it ends only then (' + a.why + '), or is won if that hit puts the frigate out (' + b.res + ')']); }
    check('missile flight', parts, parts.length + ' rules hold: silent running, the wire left alone, the 15 s alarm and its place, reaction times, first sighting, jamming, the loss rule (-v lists them)');
  }

  // 5. damage by where the missile strikes; the torpedo as before
  {
    const parts = [];
    // a frigate with no missile defence and no decoys left, and up to 8 missiles one after another
    let hits = 0, wrong = 0, twoMid = 0, fourEnds = 0, threeEnds = 0, foreN = 0, gunLeft = 0, gunAfter = 0, chances = 0, outside = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const w = mWorld(seed, { level: 0 }), s = w.tgt; w.exact(); w.load('MMMMMMMM'); w.bare({ gun: true }); let hp = s.hp, gunOut = -1; const seq = [];
      for (let k = 0; k < 8; k++) { w.step({ fire: true }); w.run(4, null, st => { if (gunOut >= 0 && s.gun) gunLeft++; if (gunOut >= 0) for (const m of st.missiles) { const d = Math.hypot(m.x - s.x, m.z - s.z), e = m.seen[s.id]; if (!s.out && m.lock === s.id && e && st.t >= e.at && d <= MQ.gun.from && d >= MQ.gun.to) chances++; } if (gunOut < 0 && !s.gun) gunOut = st.t; }); }
      w.fly(60);
      for (const e of w.ev) { if (e.type === 'gunFire' && gunOut >= 0 && e.t > gunOut) gunAfter++; if (e.type !== 'hit' || e.weapon !== 'missile' || e.ship !== s.id || hp <= 0) continue;
        const pts = e.where === 'mid' ? MQ.mid : MQ.end, left = Math.max(0, hp - pts); hits++; if (e.hp !== left || Math.abs(e.off) > s.hl + 1e-9) wrong++; if (Math.abs(e.off) > s.hl + 1e-9) outside++;
        if (e.where === 'fore') { foreN++; if (seq.indexOf('fore') < 0 && !e.gun) wrong++; } seq.push(e.where); hp = left; }
      if ((hp <= 0) !== s.out) wrong++;
      if (seq.length === 2 && seq[0] === 'mid' && seq[1] === 'mid' && s.out) twoMid++;
      if (seq.length === 4 && seq.every(x => x !== 'mid') && s.out) fourEnds++;
      if (seq.length >= 3 && seq.slice(0, 3).every(x => x !== 'mid')) threeEnds++;
    }
    parts.push([hits > 300 && wrong === 0 && outside === 0, hits + ' missile hits on 120 frigates: every hit amidships takes ' + MQ.mid + ' points and every hit forward or aft ' + MQ.end + ', and no hit point lies beyond the bow or the stern' + (wrong ? ' (' + wrong + ' wrong)' : '')]);
    parts.push([twoMid > 0 && fourEnds > 0 && threeEnds >= fourEnds, twoMid + ' frigates were put out by exactly 2 hits amidships, and ' + fourEnds + ' by exactly 4 hits at the ends (all ' + threeEnds + ' that took 3 end hits first were still in action after the third)']);
    parts.push([foreN > 20 && gunLeft === 0 && gunAfter === 0 && chances > 1000, foreN + ' hits forward: each first one put the gun out of action, and it never fired again, though a missile locked on the ship was inside its reach for ' + Math.round(chances / 30) + ' s in all']);
    // the torpedo is as it was: one hit leaves the frigate hurt, a second puts it out. The words give its state, never a count of shots.
    { const w = mWorld(21, { range: 700, tknots: 0 }), s = w.tgt; w.inp.weapon = 0; w.inp.target = 0; w.inp.throttle = 0; w.step({ fire: true }); w.run(70, null, () => !w.of('hit').length); const h1 = w.of('hit')[0], hp1 = s.hp, out1 = s.out, text1 = h1 ? SIM.hitText(h1) : '';
      w.step({ fire: true }); w.run(70, null, () => w.of('hit').length < 2); const h2 = w.of('hit')[1], text2 = h2 ? SIM.hitText(h2) : '';
      parts.push([!!h1 && hp1 === 2 && h1.max === 4 && !out1 && !!h2 && s.hp === 0 && s.out && w.of('shipOut').length === 1, 'one torpedo hit leaves a frigate at ' + hp1 + ' of 4 points and in action; a second puts it out']);
      parts.push([text1 === 'Hit! The frigate is badly damaged.' && /damaged/.test(text1) && !/\d/.test(text1) && text2 === 'Hit!', 'after one torpedo hit the message is "' + text1 + '": the ship\'s state, with no count of shots']);
      const words = [SIM.hitText({ kind: 'frigate', weapon: 'missile', where: 'fore', hp: 3, max: 4, gun: true }), SIM.hitText({ kind: 'frigate', weapon: 'missile', where: 'mid', hp: 2, max: 4 }), SIM.hitText({ kind: 'cargo', weapon: 'missile', where: 'aft', hp: 3, max: 4 })];
      parts.push([words[0] === 'Missile hit forward. The frigate is damaged. Their gun is out of action.' && words[1] === 'Missile hit amidships. The frigate is badly damaged.' && words[2] === 'Missile hit aft. The high-value ship is damaged.', 'missile hits are reported as: ' + words.join(' / ')]); }
    // where the hit falls, measured on a merchant ship (it neither turns nor defends): 200 seeds each way
    { const fall = o => { const r = { n: 0, fore: 0, mid: 0, aft: 0, out: 0 }; for (let seed = 1; seed <= 200; seed++) { const w = mWorld(seed, Object.assign({ kind: 'merchant' }, o)); w.exact(); w.fire(1); w.fly(60); const h = w.ev.find(e => e.type === 'hit' && e.weapon === 'missile' && e.ship === w.tgt.id); if (!h) continue; r.n++; r[h.where]++; if (Math.abs(h.off) > w.tgt.hl + 1e-9) r.out++; } r.share = r.mid / Math.max(1, r.n); return r; };
      const beam = fall({ course: 0 }), end = fall({ course: PI / 2 }), beamPop = fall({ course: 0, attack: 1 }), endPop = fall({ course: PI / 2, attack: 1 }), t = r => r.fore + ' forward, ' + r.mid + ' amidships, ' + r.aft + ' aft';
      parts.push([beam.n >= 195 && end.n >= 195 && beam.share > 0.8 && end.share < 0.6 && end.fore > 30 && end.aft > 30 && beam.out + end.out + beamPop.out + endPop.out === 0, 'sea-skim hits over 200 seeds: beam-on ' + t(beam) + ' (' + pct(beam.share) + ' amidships); end-on ' + t(end) + ' (' + pct(end.share) + '); none beyond the hull']);
      parts.push([beamPop.n >= 195 && endPop.n >= 195 && endPop.share > end.share + 0.1 && beamPop.share >= beam.share, 'pop-up hits: beam-on ' + t(beamPop) + ' (' + pct(beamPop.share) + '); end-on ' + t(endPop) + ' (' + pct(endPop.share) + '): more often amidships than sea-skim']); }
    // the seeker takes whatever ship lies nearest its aim point: here a merchant, 1,400 m from the frigate the wrong solution was for
    { const wrongAim = difficulty => { const w = mWorld(11, { level: 0, difficulty }); w.exact(1400, 0); w.bare(); w.fire(1); const f = w.of('mFire')[0], n = w.also('merchant', f.ax + 60, f.az - 40, 0); w.fly(60);
        const lock = w.of('mLock')[0], hit = w.ev.find(e => e.type === 'hit' && e.weapon === 'missile'); return { w, n, lock, hit, far: Math.hypot(f.ax - w.tgt.x, f.az - w.tgt.z) }; };
      const a = wrongAim('standard'), b = wrongAim('hard');
      parts.push([!!a.lock && a.lock.ship === a.n.id && !!a.hit && a.hit.ship === a.n.id && a.hit.neutral === true && a.w.st.stats.neutral === 1 && a.w.st.stats.hits === 0 && !a.w.st.over && a.w.tgt.hp === 4
        && b.w.st.over && b.w.st.result === 'lose' && b.w.st.reason === 'Mission failed: a weapon struck a neutral ship.',
        'aimed ' + Math.round(a.far) + ' m wide of the frigate, with a merchant ship beside the aim point: the seeker locks the merchant and hits it. It counts as a neutral ship hit (the star is lost; on Hard: ' + b.w.st.reason + ')']); }
    check('missile damage', parts, parts.length + ' rules hold: points by hit place, the gun, 2 amidships or 4 end hits, the torpedo as before, the hurt message, hit location, a merchant locked (-v lists them)');
  }

  // 6. the defences: the magazine, the one fire channel, the rockets, the clouds, turning
  {
    const parts = [];
    // eight pop-up missiles, 5 s apart, at one alert frigate
    { const w = mWorld(15, { level: 2, attack: 1 }), s = w.tgt, st = w.st; w.exact(); w.load('MMMMMMMM'); s.hp = 99; let two = 0, idle = 0, salvoT = -1; const tally = () => { if (st.shots.filter(d => d.ship === s.id).length > 1) two++;
        if (s.sam === 0 && !s.busy && !s.out) for (const m of st.missiles) { const e = m.seen[s.id], d = Math.hypot(m.x - s.x, m.z - s.z); if (e && st.t >= e.at && !(m.cloud && !m.lure) && !m.done && d <= MQ.sam.range && d >= MQ.sam.min) { idle++; break; } } };
      for (let k = 0; k < 8; k++) { w.step({ fire: true }); w.run(5, null, tally); } w.fly(60, tally);
      const fired = w.of('samFire').filter(e => e.ship === s.id), salvos = w.of('chaff').filter(e => e.ship === s.id); if (salvos.length) salvoT = salvos[salvos.length - 1].t;
      const later = w.of('mSeen').filter(e => e.ship === s.id && e.t > salvoT).length, launched = w.of('mFire').length;
      parts.push([launched === 8 && fired.length === MQ.sam.n && s.sam === 0 && fired[fired.length - 1].left === 0 && idle > 30, 'against 8 missiles a frigate fires its ' + fired.length + ' defence missiles and no more: afterwards a missile it could have engaged was in reach for ' + f1(idle / 30) + ' s with nothing fired']);
      parts.push([two === 0 && fired.length === 8, 'it never has two defence missiles in the air at once (' + fired.length + ' fired, each after the one before had arrived)']);
      parts.push([salvos.length === MQ.chaff.n / MQ.chaff.salvo && s.chaff === 0 && later >= 2, 'its decoy rockets are gone after ' + salvos.length + ' salvos of ' + MQ.chaff.salvo + '; the ' + later + ' missiles first seen after that draw none']); }
    // the seeker chooses among ships and seduction clouds left in the water by their distance from its aim point. The cloud here is put in place by hand, 300 m beyond the ship, before the seeker comes on.
    // A distraction cloud is taken only by the seeker's one draw (Revision 5: whether or not the seeker holds a lock): the chance is set to 0 for one shot (it never counts) and to 1 for another (it always does).
    { const C = MQ.chaff, keep = C.pullFar;
      const choose = (dz, kind, chance) => { C.pullFar = chance; const w = mWorld(16, { level: 0, range: 8000 }), st = w.st, s = w.tgt; w.exact(0, dz); w.fire(1); let c = null, got = null, held = 0;
        w.fly(60, () => { const m = st.missiles[0]; if (!m) return; if (!c && m.phase === 'fly') { c = { id: 990001, ship: s.id, kind, x: s.x + 40, z: s.z - 300, life: 40 }; st.clouds.push(c); }
          if (c && !got && (m.lock || m.cloud)) got = { cloud: m.cloud === c.id, dc: Math.hypot(c.x - m.ax, c.z - m.az), ds: Math.hypot(s.x - m.ax, s.z - m.az), seek: Math.hypot(m.ax - m.x, m.az - m.z) };
          if (got && m.lock === s.id) held++; if (got && m.cloud === c.id) got.took = true; });
        C.pullFar = keep; if (got) { got.looks = w.of('chaffLook').filter(e => e.cloud === 990001); got.held = held; got.hit = w.ev.some(e => e.type === 'hit' && e.weapon === 'missile'); } return got; };
      const wide = choose(-500, 'near', keep), true0 = choose(0, 'near', keep), blind = choose(-500, 'far', 0), drawn = choose(0, 'far', 1);
      parts.push([!!wide && wide.cloud && wide.dc < wide.ds && near(wide.seek, MQ.seek, 30) && !!true0 && !true0.cloud && true0.ds < true0.dc,
        'at Seeker on, with the aim point ' + (wide ? Math.round(wide.dc) + ' m from a seduction cloud left in the water and ' + Math.round(wide.ds) + ' m from the ship' : '?') + ', the seeker takes the cloud; with the aim point ' + (true0 ? Math.round(true0.ds) + ' m from the ship and ' + Math.round(true0.dc) + ' m from the cloud' : '?') + ', the ship']);
      parts.push([!!blind && !blind.cloud && !blind.took && blind.dc < blind.ds && blind.looks.length === 1 && !blind.looks[0].take && C.pullFar === keep,
        'a seeker draws once for a distraction cloud: when the draw fails it ignores that cloud and takes the ship, though the cloud lies nearer its aim point (' + (blind ? Math.round(blind.dc) + ' m against ' + Math.round(blind.ds) + ' m; ' + blind.looks.length + ' draw' : '?') + ')']);
      parts.push([!!drawn && !drawn.cloud && drawn.held > 0 && drawn.took && drawn.looks.length === 1 && drawn.looks[0].take && drawn.looks[0].lock === 0 + drawn.looks[0].lock && drawn.looks[0].lock > 0 && drawn.ds < drawn.dc,
        'when the draw passes, a seeker that already holds the ship lets go of it and flies for the distraction cloud, though the ship lies nearer its aim point (' + (drawn ? Math.round(drawn.ds) + ' m against ' + Math.round(drawn.dc) + ' m; it had held the ship for ' + f1(drawn.held / 30) + ' s' : '?') + ')']); }
    // where a distraction cloud bursts: between the ship and the missile, 600 to 900 m from the ship, 35 degrees off the line to the missile on the side the ship is steaming away from, and off the missile's path
    { let n = 0, good = 0, eg = ''; const C = MQ.chaff;
      for (let seed = 1; seed <= 20; seed++) { const w = mWorld(seed, { level: 2 }), st = w.st, s = w.tgt; w.exact(); w.fire(1); let at = null;
        w.fly(60, () => { const m = st.missiles[0], c = w.of('chaff').find(e => e.kind === 'far'); if (m && c && !at) at = { mx: m.x, mz: m.z, mh: m.h, sx: s.x, sz: s.z, sh: s.h, c }; });
        if (!at) continue; n++; const c = at.c, d = Math.hypot(c.x - at.sx, c.z - at.sz), off = Math.abs(SIM.wrap(brgTo(at.sx, at.sz, c.x, c.z) - brgTo(at.sx, at.sz, at.mx, at.mz)));
        const astern = Math.cos(brgTo(at.sx, at.sz, c.x, c.z) - at.sh) < 0, nearer = Math.hypot(c.x - at.mx, c.z - at.mz) < Math.hypot(at.sx - at.mx, at.sz - at.mz);
        const side = Math.abs(Math.sin(brgTo(at.mx, at.mz, c.x, c.z) - at.mh)) * Math.hypot(c.x - at.mx, c.z - at.mz);
        if (d >= C.far[0] - 30 && d <= C.far[1] + 30 && near(off, C.farOff, 0.03) && astern && nearer && side > 250) { good++; if (!eg) eg = 'seed ' + seed + ': ' + Math.round(d) + ' m from the ship, ' + Math.round(off * 180 / PI) + ' degrees off the line to the missile, ' + Math.round(side) + ' m to the side of the missile\'s path'; } }
      parts.push([n >= 18 && good === n, 'a distraction cloud bursts between the ship and the missile, astern of the ship\'s beam and off the missile\'s path, in ' + good + ' of ' + n + ' games (' + eg + ')']); }
    // a missile lured by a distraction cloud is still coming, and the ship goes on firing at it (unlike one drawn off by seduction chaff close in); with no other ship about, none of them hits
    { let n = 0, shot = 0, fired = 0, hit = 0, ended = 0; const C = MQ.chaff, keep = C.pullFar; C.pullFar = 1;
      for (let seed = 1; seed <= 20; seed++) { const w = mWorld(seed, { level: 2 }); w.exact(); const id = w.fire(1)[0]; w.fly(90);
        const lk = w.ev.find(e => e.type === 'mLock' && e.id === id && e.cloud); if (!lk) continue; n++;
        if (w.ev.some(e => (e.type === 'samFire' || e.type === 'gunFire') && e.id === id && e.t >= lk.t)) fired++;
        const end = w.ev.find(e => e.type === 'mEnd' && e.id === id); if (end && (end.why === 'sam' || end.why === 'gun')) shot++; else if (end && end.why === 'decoyed') ended++;
        if (w.ev.some(e => e.type === 'hit' && e.weapon === 'missile')) hit++; }
      C.pullFar = keep;
      parts.push([n === 20 && fired >= 15 && shot >= 1 && ended >= 1 && shot + ended === n && hit === 0, 'with the distraction chance set to 1, ' + n + ' of 20 missiles are lured; the ship still fires at ' + fired + ' of them after that, ' + shot + ' are shot down, ' + ended + ' end at the cloud, and ' + hit + ' hit']); }
    // a missile drawn off by seduction chaff looks again at the cloud; a ship in that cone is locked and hit, and that missile is a hit, not a decoyed one
    { let seed = 0, base = null; for (let s0 = 1; s0 <= 60 && !seed; s0++) { const w = mWorld(s0, { level: 0 }); w.exact(); w.fire(1); w.fly(60); if (w.of('chaff').some(e => e.kind === 'near' && e.pull)) { seed = s0; base = w; } }
      const w = mWorld(seed || 1, { level: 0 }), st = w.st; w.exact(); w.fire(1); let n = null;
      w.fly(60, () => { const c = w.of('chaff').find(e => e.kind === 'near' && e.pull), m = st.missiles[0]; if (c && m && !n) { const dx = c.x - m.x, dz = c.z - m.z, d = Math.hypot(dx, dz); n = w.also('merchant', c.x + dx / d * 1000, c.z + dz / d * 1000, 0); } });
      const again = n ? w.ev.find(e => e.type === 'mLock' && e.again && e.ship === n.id) : null, hit = n ? w.ev.find(e => e.type === 'hit' && e.weapon === 'missile' && e.ship === n.id) : null, s1 = st.stats, s0 = base ? base.st.stats : {};
      parts.push([!!seed && !!base && s0.mDecoyed === 1 && s0.mHit === 0 && base.of('mEnd')[0].why === 'decoyed' && !!again && !!hit && s1.mHit === 1 && s1.mDecoyed === 0 && !w.of('mEnd').length,
        'seed ' + seed + ': the missile is drawn to a chaff cloud and, with no ship beyond it, ends there (decoyed 1, hits 0). The same shot with a merchant ship 1,000 m beyond the cloud: it locks again and hits (decoyed ' + s1.mDecoyed + ', hits ' + s1.mHit + ')']); }
    // the second missile of a salvo can take the first one's cloud: a frigate with one salvo of rockets fires it at the first missile, and the second missile, when its own draw comes up,
    // goes to that same cloud (staged with the distraction chance set to 1 and the hard-kill defences taken away, so that both missiles end at the cloud)
    { let n = 0, took = 0, eg = ''; const C = MQ.chaff, keep = C.pullFar; C.pullFar = 1;
      for (let seed = 1; seed <= 20; seed++) { const w = mWorld(seed, { level: 2 }); w.exact(); w.bare({ chaff: MQ.chaff.salvo }); const ids = w.fire(2); w.fly(60);
        const c = w.of('chaff').find(e => e.id === ids[0]), lk = c ? w.ev.find(e => e.type === 'mLock' && e.id === ids[1] && e.cloud === c.cloud) : null, end = w.ev.find(e => e.type === 'mEnd' && e.id === ids[1]);
        if (c && w.of('chaff').length === 1) { n++; if (lk && end && end.why === 'decoyed') { took++; if (!eg) eg = 'seed ' + seed + ': the cloud burst at ' + f1(c.t) + ' s for the first missile, the second locked it at ' + f1(lk.t) + ' s and ended there'; } } }
      C.pullFar = keep;
      parts.push([n >= 15 && took >= n - 2, 'a two-missile salvo at a frigate with one salvo of rockets left: in ' + took + ' of ' + n + ' games the second missile took the cloud fired at the first (' + eg + ')']); }
    // turning bow-on
    { const off = (s, m) => Math.abs(wrap(brgTo(s.x, s.z, m.x, m.z) - s.h));
      const w = mWorld(7, { level: 2 }), s = w.tgt, st = w.st; w.exact(); w.bare(); w.fire(1); let a0 = -1, a1 = -1, defend = 0, other = 0, endT = -1, after = 0, afterN = 0;
      w.run(60, null, () => { const m = st.missiles[0], e = m && m.seen[s.id]; if (m && e && st.t > e.at + STEP) { const a = off(s, m); if (a0 < 0) a0 = a; a1 = a; if (s.mode === 'defend') defend++; else other++; }
        if (!m && w.launched && endT < 0 && w.ends().length) endT = st.t; if (endT >= 0 && st.t > endT) { afterN++; if (s.mode === 'defend') after++; } return endT < 0 || st.t < endT + 5; });
      parts.push([a0 > 1.3 && a0 - a1 > 0.4 && defend > 200 && other === 0, 'a frigate that has seen a missile turns its bow towards it: from ' + Math.round(a0 / DEG) + '° off the bow to ' + Math.round(a1 / DEG) + '° in ' + f1(defend / 30) + ' s']);
      parts.push([afterN > 100 && after === 0 && !s.out, 'when the missile is gone the turn ends: in the 5 s after, the ship is back to its own business (' + s.mode + ')']);
      // a torpedo it knows of comes first
      const w2 = mWorld(7, { level: 2 }), s2 = w2.tgt; w2.exact(); w2.bare(); w2.step({ weapon: 0, fire: true, target: 0 }); const tp = w2.st.torps.find(t => t.side === 0); w2.pre = () => { if (tp && w2.st.torps.indexOf(tp) >= 0) s2.threat = tp.id; };
      w2.run(SIM.V.fireGap + 0.1); w2.fire(1); let ev2 = 0, df2 = 0; w2.fly(60, st2 => { const m = st2.missiles[0], e = m && m.seen[s2.id]; if (m && e && st2.t > e.at + STEP) { if (s2.mode === 'evade') ev2++; else if (s2.mode === 'defend') df2++; } });
      parts.push([!!tp && ev2 > 200 && df2 === 0, 'with a torpedo it knows of in the water as well, it runs from the torpedo for all ' + f1(ev2 / 30) + ' s that it could have turned to the missile']);
      // two missiles from different sides: it faces the nearer one, and the other once that one is gone
      const w3 = mWorld(7, { level: 2 }), s3 = w3.tgt, st3 = w3.st; w3.exact(); w3.bare(); s3.hp = 99; const A = w3.fire(1)[0]; w3.run(SIM.V.fireGap + 0.1); w3.p.x = s3.x + 6000; w3.p.z = s3.z; w3.p.h = PI; w3.exact(); const B = w3.fire(1)[0];
      let both = 0, toNear = 0, toFar = 0, alone = 0, toB = 0, h0 = s3.h;
      w3.fly(80, () => { const a = st3.missiles.find(m => m.id === A), b = st3.missiles.find(m => m.id === B), ea = a && a.seen[s3.id], eb = b && b.seen[s3.id], dh = wrap(s3.h - h0); h0 = s3.h;
        const ra = a && ea && st3.t > ea.at + STEP, rb = b && eb && st3.t > eb.at + STEP; if (Math.abs(dh) < 1e-6) return;
        if (ra && rb) { const na = Math.hypot(a.x - s3.x, a.z - s3.z) < Math.hypot(b.x - s3.x, b.z - s3.z) ? a : b, fa = na === a ? b : a, wn = wrap(brgTo(s3.x, s3.z, na.x, na.z) - s3.h), wf = wrap(brgTo(s3.x, s3.z, fa.x, fa.z) - s3.h); if (wn * wf < 0) { both++; if (dh * wn > 0) toNear++; else toFar++; } }
        else if (!a && rb) { alone++; if (dh * wrap(brgTo(s3.x, s3.z, b.x, b.z) - s3.h) > 0) toB++; } });
      // (the step on which the nearer missile ends is turned before that missile is stepped, so one step either way is allowed)
      parts.push([!!A && !!B && both > 60 && toNear >= both - 1 && toFar <= 1 && alone > 60 && toB >= alone - 1, 'two missiles from different sides: while both are seen and call for opposite turns it turns towards the nearer one (' + toNear + ' of ' + both + ' steps); once that one is gone it turns towards the other (' + toB + ' of ' + alone + ' steps)']); }
    check('missile defences', parts, parts.length + ' rules hold: 8 defence missiles, one in the air at a time, 5 salvos of rockets, the cloud choice, the re-lock, a second missile on the first one\'s cloud, turning bow-on (-v lists them)');
  }

  // 6b. Revision 5, the dog-leg route: the waypoint, the longer way, the seeker kept off on the first leg, the alarm as before, the slow reaction from the flank, and flying direct when the ship is too close
  {
    const parts = [], L = MQ.leg;
    // one shot at a frigate that cannot shoot back (unless `armed`), watched all the way
    const shot = (o, armed, each) => { const w = mWorld(21, Object.assign({ level: 2, range: 6000 }, o)), st = w.st; w.exact(); if (!armed) w.bare(); if (each) each(w, null);
      const g = w.sim.gate(w.tgt.id, o.route || 0), id = w.fire(1)[0], f = w.of('mFire')[0], q = { w, g, f, id, alt: 0, turnAt: -1, popAt: -1, lockAt: -1, lockShip: 0, seekOnLeg: false, legSeen: -1, ship0: { x: w.tgt.x, z: w.tgt.z, h: w.tgt.h, v: w.tgt.speed } };
      w.fly(150, () => { const m = st.missiles.find(n => n.id === id); if (!m) return; q.alt = Math.max(q.alt, m.alt); if (m.leg && (m.seek || m.lock)) q.seekOnLeg = true; if (each) each(w, m);
        const e = m.seen[w.tgt.id]; if (e && q.legSeen < 0) { q.legSeen = m.leg; q.seen = { t: e.t, at: e.at, d: e.d, off: Math.abs(SIM.wrap(brgTo(w.tgt.x, w.tgt.z, m.x, m.z) - brgTo(w.tgt.x, w.tgt.z, m.lx, m.lz))) }; } });
      const tn = w.of('mTurn')[0], pp = w.of('mPop')[0], lk = w.of('mLock')[0], end = w.ends()[0];
      if (tn) { q.turnAt = tn.t; q.turnD = Math.hypot(tn.x - f.wx, tn.z - f.wz); } if (pp) q.popAt = pp.t; if (lk) { q.lockAt = lk.t; q.lockShip = lk.ship; }
      q.end = end; q.hit = !!end && end.type === 'hit'; q.time = end ? end.t - f.t : -1;
      // where the waypoint lies from the aim point: so far short of it along the line of fire, and so far to the left of that line (the left of a heading (ux, uz) is (uz, -ux))
      const d = Math.hypot(f.ax - f.x, f.az - f.z), ux = (f.ax - f.x) / d, uz = (f.az - f.z) / d, rx = f.wx - f.ax, rz = f.wz - f.az; q.run = d; q.back = -(rx * ux + rz * uz); q.left = rx * uz - rz * ux;
      q.len = Math.hypot(f.wx - f.x, f.wz - f.z) + Math.hypot(rx, rz);
      return q; };
    const direct = shot({}), left = shot({ route: 1 }), right = shot({ route: 2 });
    parts.push([L.off === 4200 && L.back === 1600 && left.f.route === 1 && right.f.route === 2 && near(left.back, L.back, 1) && near(left.left, L.off, 1) && near(right.back, L.back, 1) && near(right.left, -L.off, 1) && left.f.wx < left.f.ax && direct.f.route === 0
      && left.g.ok && left.g.route === 1 && Math.hypot(left.g.wx - left.f.wx, left.g.wz - left.f.wz) < 5 && Math.hypot(left.g.ax - left.f.ax, left.g.az - left.f.az) < 5,
      'a dog-leg has one waypoint, ' + Math.round(left.back) + ' m short of the aim point and ' + Math.round(left.left) + ' m to the left of the line of fire (Dog-leg left) or ' + Math.round(-right.left) + ' m to the right (Dog-leg right); the plan shown before the launch is the one flown']);
    // the longer way round, and an aim point that allows for it: where the ship will be after the rise, the boost and the whole way by the waypoint
    { const ahead = q => { const T = (q.f.lag + (q.f.route ? q.len : q.run)) / MQ.speed; return Math.hypot(q.ship0.x + Math.cos(q.ship0.h) * q.ship0.v * T - q.f.ax, q.ship0.z - Math.sin(q.ship0.h) * q.ship0.v * T - q.f.az); };
      const more = (left.len - left.run) / MQ.speed;
      parts.push([direct.hit && left.hit && right.hit && left.time > direct.time + 10 && near(left.time - direct.time, more, 2.5) && ahead(left) < 5 && ahead(direct) < 5,
        'it flies ' + Math.round(left.len) + ' m instead of ' + Math.round(left.run) + ' m and hits ' + f1(left.time - direct.time) + ' s later than the direct shot (' + f1(left.time) + ' s against ' + f1(direct.time) + ' s); its aim point is where the ship will be by then (' + f1(ahead(left)) + ' m off the reckoning)']); }
    // the seeker stays off until the missile has turned for its aim point: a merchant ship dead ahead on the first leg is flown past
    { const mid = shot({ route: 1 }, false, (w, m) => { if (!m && !w.blocker) { const g = w.sim.gate(w.tgt.id, 1); w.blocker = w.also('merchant', (w.p.x + g.wx) / 2, (w.p.z + g.wz) / 2, 0); } });
      parts.push([left.turnAt > 0 && near(left.turnD, L.turn, 12) && !left.seekOnLeg && left.lockAt > left.turnAt && left.lockShip === left.w.tgt.id && mid.hit && !mid.seekOnLeg && mid.lockShip === mid.w.tgt.id && mid.end.ship === mid.w.tgt.id && !!mid.w.blocker,
        'it turns for its aim point ' + Math.round(left.turnD) + ' m short of the waypoint; the seeker is off until then (first lock ' + f1(left.lockAt - left.turnAt) + ' s after the turn), so a merchant ship dead ahead half-way along the first leg is flown past and the frigate is hit']); }
    // the alarm does not change: 15 s after the breach, at the launch point
    { const dat = q => { const b = q.w.of('mBreach')[0], d = q.w.of('datum')[0]; return b && d ? { dt: d.t - b.t, off: Math.hypot(d.x - q.f.x, d.z - q.f.z) } : null; }, a = dat(direct), b = dat(left);
      parts.push([!!a && !!b && near(a.dt, MQ.datum, 0.1) && near(b.dt, MQ.datum, 0.1) && a.off < 1 && b.off < 1, 'the alarm is the same as for a direct shot: ' + (b ? f1(b.dt) : '?') + ' s after the breach, at the launch point (' + (b ? f1(b.off) : '?') + ' m from it)']); }
    // the gain: an alert frigate sees the missile only on its final leg, more than 60 degrees off the bearing of the breach, and reacts as slowly as an unaware one
    { const a = shot({ route: 1 }, true), b = shot({}, true), sa = a.w.of('mSeen')[0], sb = b.w.of('mSeen')[0];
      parts.push([!!a.seen && !!sa && sa.alert && sa.flank && a.legSeen === 0 && a.seen.off > L.flank && near(a.seen.at - a.seen.t, MQ.react[2], 0.05) && MQ.react[2] > MQ.react[1] && MQ.react[2] < MQ.react[0] && a.seen.d <= MQ.see.low + 1 && !!b.seen && !!sb && sb.alert && !sb.flank && near(b.seen.at - b.seen.t, MQ.react[1], 0.05) && !a.w.of('chaff').some(e => e.kind === 'far') && b.w.of('chaff').some(e => e.kind === 'far'),
        'an alert frigate first sees a dog-leg missile on its final leg, ' + (a.seen ? Math.round(a.seen.d) + ' m off and ' + Math.round(a.seen.off * 180 / PI) : '?') + ' degrees off the bearing of the breach: it takes ' + (a.seen ? f1(a.seen.at - a.seen.t) : '?') + ' s to react and fires no distraction rockets; the direct shot is seen ' + (b.seen ? Math.round(b.seen.off * 180 / PI) : '?') + ' degrees off, reacted to in ' + (b.seen ? f1(b.seen.at - b.seen.t) : '?') + ' s, and draws a distraction salvo']);
      // the 60 degrees is a threshold: a dog-leg that comes in less wide gets no such gain (the waypoint is moved by hand for this one shot)
      const keep = [L.off, L.back]; L.off = 1500; L.back = 2600; const c = shot({ route: 1 }, true), sc = c.w.of('mSeen')[0]; L.off = keep[0]; L.back = keep[1];
      parts.push([!!c.seen && !!sc && !sc.flank && c.seen.off < L.flank && near(c.seen.at - c.seen.t, MQ.react[1], 0.05) && L.off === 4200 && L.back === 1600, 'a dog-leg that comes in only ' + (c.seen ? Math.round(c.seen.off * 180 / PI) : '?') + ' degrees off that bearing (its waypoint moved for the test) is reacted to in ' + (c.seen ? f1(c.seen.at - c.seen.t) : '?') + ' s, like a direct shot']); }
    // room: the first leg stays outside the frigate's radar reach, from the shortest dog-leg up, even with the solution's range 600 m wrong either way (the ship is where it is; the route is laid out from the solution).
    // With the starting values first tried (3,400 m to the side, 1,200 m short, from 4,500 m) the first leg passed within about 3,230 m of the ship and the missile was seen on it.
    { let n = 0, early = 0, flank = 0; const cases = [];
      for (const R of [L.min + 100, 6000, 7500]) for (const dz of [-600, 0, 600]) { let k = 0;
        for (let s = 1; s <= 4; s++) { const w = mWorld(600 + s, { level: 2, range: R, route: 1 }); w.exact(0, dz); if (!w.fire(1)[0] || w.of('mFire')[0].direct) continue; w.fly(150); n++; k++;
          const seen = w.of('mSeen')[0], turn = w.of('mTurn')[0]; if (!seen || !turn || seen.t < turn.t) early++; if (seen && seen.flank) flank++; }
        cases.push(R + ' m' + (dz ? (dz > 0 ? ' +' : ' ') + dz : '') + ': ' + k); }
      parts.push([n >= 28 && early === 0 && flank === n, 'the first leg keeps outside the frigate\'s radar reach: in ' + n + ' dog-legs from ' + (L.min + 100) + ', 6,000 and 7,500 m, with the solution\'s range exact and 600 m wrong either way, ' + early + ' were seen before the turn and ' + flank + ' were first seen from the flank']); }
    // too close for a dog-leg: the missile flies direct, and the launch says so
    { const a = shot({ route: 1, range: 4000 }), b = shot({ range: 4000 }), far = shot({ route: 1, range: 5200 });
      parts.push([L.min === 5000 && a.f.route === 0 && a.f.direct === true && a.g.ok && a.g.direct && a.g.route === 0 && a.turnAt < 0 && a.hit && b.hit && near(a.time, b.time, 0.05) && far.f.route === 1 && !far.f.direct && !direct.f.direct,
        'with the aim point ' + Math.round(a.run) + ' m off (under ' + L.min + ' m) a missile set to Dog-leg flies direct and the launch says so: it hits after ' + f1(a.time) + ' s, as the direct shot does (' + f1(b.time) + ' s); from ' + Math.round(far.run) + ' m it flies the dog-leg']); }
    // a pop-up by the dog-leg: it climbs on the way, dives and hits
    { const a = shot({ route: 1, attack: 1 });
      parts.push([a.hit && a.popAt > 0 && a.alt > MQ.pop.alt - 20 && a.end.pop === true, 'a pop-up flown by the dog-leg climbs to ' + Math.round(a.alt) + ' m ' + (a.popAt < a.turnAt ? f1(a.turnAt - a.popAt) + ' s before' : f1(a.popAt - a.turnAt) + ' s after') + ' its turn, dives and hits']); }
    check('missile route', parts, parts.length + ' rules hold: the waypoint, the longer way and its aim point, the seeker off on the first leg, the alarm, the slow reaction from the flank and its 60 degrees, room on the first leg, direct when too close, the pop-up (-v lists them)');
  }

  // 6c. Revision 5, Update missile: who may send it, what it changes, and what it cannot do
  {
    const parts = [], TEXT = { uNone: 'No missile in flight to update.', uDeep: 'Too deep to update a missile: come up to periscope depth.', uMast: 'No mast is up: raise the mast to update a missile.', uSolution: 'No usable solution to send: it needs a range.' };
    // the order given once; what came of it
    const order = (w, inp) => { const n0 = w.ev.length, aims = w.st.missiles.map(m => m.ax + ',' + m.az).join(';'); w.step(Object.assign({ cmd: 'mupdate' }, inp || {})); const ev = w.ev.slice(n0); w.step(inp);
      const r = ev.find(e => e.type === 'refuse' && e.what === 'update'); return { why: r ? r.why : '', ups: ev.filter(e => e.type === 'mUpdate'), same: aims === w.st.missiles.map(m => m.ax + ',' + m.az).join(';') }; };
    // the boat at periscope depth with its mast up (unless told otherwise), an alert frigate 8,000 m off, one missile (or more) launched and flown for so many seconds
    const made = (o, secs, n) => { const w = mWorld(22, Object.assign({ level: 2, range: 8000, depth: 9, mast: true }, o)); w.exact(o && o.dx, 0); if (!(o && o.armed)) w.bare(o && o.keep); w.run(3); w.ids = n === 0 ? [] : w.fire(n || 1); if (secs) w.run(secs); return w; };
    const mis = (w, k) => w.st.missiles.find(m => m.id === w.ids[k || 0]);
    // 1. the refusals, each with its own words, in the order they are tried
    { const got = {
        uNone: order(made({}, 0, 0)),
        uDeep: order(made({ depth: 30 }, 8)),
        uMast: order(made({ mast: false }, 8)),
        uSolution: (() => { const w = made({}, 8); w.free = true; const k = w.track(); k.sol = Object.assign({}, k.sol, { r: null }); return order(w); })() };
      for (const k of Object.keys(TEXT)) { const r = got[k]; parts.push([r.why === k && r.ups.length === 0 && r.same && MSG[k] === TEXT[k], 'refused "' + TEXT[k] + '"' + (r.why === k ? '' : ' (got: ' + (r.why || 'an update') + ')')]); }
      // a mast only just raised is not up yet; a capsule still under water is not in flight; and of several things wrong the first in the list is named
      const rising = (() => { const w = made({ mast: false }, 8); return order(w, { mast: true }); })(), capsule = (() => { const w = made({ depth: 9 }, 0); return { r: order(w), phase: w.st.missiles[0] ? w.st.missiles[0].phase : '?' }; })();
      const both = order(made({ depth: 30, mast: false }, 0, 0)), deepNoMast = order(made({ depth: 30, mast: false }, 8));
      parts.push([rising.why === 'uMast' && capsule.r.why === 'uNone' && capsule.phase === 'capsule' && both.why === 'uNone' && deepNoMast.why === 'uDeep',
        'a mast raised that same moment is not up yet ("' + MSG[rising.why] + '"); a capsule still under water is not in flight ("' + MSG[capsule.r.why] + '"); too deep with no mast is refused as "' + MSG[deepNoMast.why] + '"']); }
    // 2. accepted: the new aim point is where the solution now puts the ship, by the launch's own intercept rule, from where the missile is. The first aim point was 3,000 m wrong.
    { const w = made({ dx: 3000 }, 10), st = w.st, m = mis(w), k = w.exact(), s = k.sol, a0 = { x: m.ax, z: m.az }, t1 = st.t + STEP, dt = t1 - s.t;
      const want = SIM.intercept(m.x, m.z, s.x + s.vx * dt, s.z + s.vz * dt, s.v !== null ? s.vx : 0, s.v !== null ? s.vz : 0, MQ.speed, 0), r = order(w), u = r.ups[0];
      const moved = u ? Math.hypot(u.ax - a0.x, u.az - a0.z) : 0, off = u ? Math.hypot(u.ax - want.x, u.az - want.z) : -1; w.fly(90); const end = w.ends()[0];
      parts.push([!r.why && r.ups.length === 1 && u.id === w.ids[0] && off >= 0 && off < 2 && moved > 2500 && !!end && end.type === 'hit' && end.ship === w.tgt.id && w.st.stats.mUpdates === 1,
        'accepted at periscope depth with the mast up: the aim point moves ' + Math.round(moved) + ' m, to where the solution now puts the ship when the missile gets there (' + f1(off) + ' m from the reckoning), and the missile, first aimed 3,000 m wrong, hits']);
      // the same shot never updated finds nothing
      const w0 = made({ dx: 3000 }, 10); w0.fly(90); const e0 = w0.ends()[0];
      parts.push([!!e0 && e0.type === 'mEnd' && e0.why === 'missed', 'the same shot with no update: ' + (e0 ? (e0.why || 'hit') : '?')]); }
    // 3. it reads the solution, never the ship: with the same solution the update is the same wherever the ship truly is (in the second game the ship is moved 2,000 m just before the order)
    { const go = shift => { const w = made({ dx: 1500 }, 10); w.exact(); w.free = true; if (shift) { w.tgt.x += shift; w.tgt.z -= shift; } const r = order(w); return r.ups[0] || null; }, a = go(0), b = go(2000);
      parts.push([!!a && !!b && a.ax === b.ax && a.az === b.az, 'the same solution gives the same new aim point, to the last digit, with the ship moved 2,000 m: no truth leak']); }
    // 4. a seeker that had locked lets go and searches again from the new aim point
    { const w = made({}, 0), st = w.st; let lk = false; w.run(60, null, () => { const m = mis(w); lk = !!m && m.lock === w.tgt.id; return !lk; }); w.run(1); w.exact(); const r = order(w), u = r.ups[0], m = mis(w), after = m ? { lock: m.lock, seek: m.seek } : null;
      w.fly(90); const again = w.ev.slice(w.ev.indexOf(u) + 1).find(e => e.type === 'mLock'), end = w.ends()[0];
      // (the lock is let go in the order's own step; with the ship still in view the seeker takes it again within a step or two)
      parts.push([lk && !!u && u.lock === w.tgt.id && !!again && again.again === true && again.ship === w.tgt.id && again.t - u.t < 2 && !!end && end.type === 'hit',
        'a missile locked on the frigate lets go of its lock when updated, searches again from the new aim point and locks again ' + (again && u ? f1(again.t - u.t) : '?') + ' s later; it hits']); }
    // 5. an update takes a missile off a chaff cloud, and it does not go back to that cloud
    { const C = MQ.chaff, keep = C.pullFar; C.pullFar = 1; const w = made({ range: 6000, keep: { chaff: 2 } }, 0), st = w.st; let lured = false;
      w.run(60, null, () => { const m = mis(w); lured = !!m && !!m.cloud && m.lure; return !lured; }); const cl = lured ? mis(w).cloud : 0; w.run(0.5); w.exact(); const r = order(w), u = r.ups[0];
      const n0 = w.ev.length; w.fly(90); C.pullFar = keep; const back = w.ev.slice(n0).some(e => e.type === 'mLock' && e.cloud === cl), end = w.ends()[0];
      parts.push([lured && !!u && u.cloud === cl && cl > 0 && !back && !!end && end.type === 'hit' && C.pullFar === keep, 'a missile flying at a distraction cloud is taken off it by an update, does not go back to that cloud, and hits the frigate']); }
    // 6. an update onto empty water: the missile turns for the new aim point, finds nothing there and is soon a miss; it does not circle
    { const w = made({}, 8), st = w.st; w.exact(5000, 0); const m = mis(w), r = order(w), u = r.ups[0], d0 = u ? Math.hypot(u.ax - m.x, u.az - m.z) : 0; let turned = 0, h0 = m.h; w.fly(150, () => { const q = mis(w); if (q) { turned += Math.abs(SIM.wrap(q.h - h0)); h0 = q.h; } });
      const end = w.ends()[0], took = end && u ? end.t - u.t : -1;
      parts.push([!!u && !!end && end.type === 'mEnd' && end.why === 'missed' && took > 0 && took < (d0 + MQ.past) / MQ.speed + 6 && turned < PI,
        'updated onto empty water ' + Math.round(d0) + ' m away, the missile turns ' + Math.round(turned * 180 / PI) + ' degrees in all, flies there and is a miss ' + f1(took) + ' s after the update']); }
    // 7. no missile flies for ever: updated every 6 s between two aim points far apart, it runs out of fuel
    { const w = made({}, 6), st = w.st, f = w.of('mFire')[0]; let n = 0, side = 1; w.run(200, null, (s, i) => { if (!mis(w)) return false; if (i % 180 === 0) { w.exact(6000 * side, 0); side = -side; if (!order(w).why) n++; } });
      const end = w.ends()[0], took = end ? end.t - f.t : -1;
      parts.push([MQ.fuel === 20000 && n >= 8 && !!end && end.type === 'mEnd' && end.why === 'missed' && near(took, MQ.fuel / MQ.speed, 8), 'sent to and fro by ' + n + ' updates, the missile ends as a miss ' + f1(took) + ' s after its launch, with its ' + MQ.fuel + ' m of fuel gone']); }
    // 8. one order reaches every missile in the air; a dog-leg missile on its first leg keeps its dog-leg, the waypoint moved with the aim point
    { const w = made({ range: 8000, route: 2 }, 0, 2); w.run(9); w.exact(-1200, 0); const before = w.st.missiles.map(m => m.leg), r = order(w), L = MQ.leg;
      const ok = r.ups.length === 2 && r.ups.every(u => { const m = w.st.missiles.find(q => q.id === u.id), d = Math.hypot(u.ax - m.lx, u.az - m.lz), ux = (u.ax - m.lx) / d, uz = (u.az - m.lz) / d, rx = u.wx - u.ax, rz = u.wz - u.az;
        return u.leg === 1 && near(-(rx * ux + rz * uz), L.back, 1) && near(rx * uz - rz * ux, -L.off, 1); });
      parts.push([before.length === 2 && before.every(l => l === 1) && ok, 'one order updates both missiles of a salvo; each is still on the first leg of its dog-leg and keeps it, the waypoint moved with the aim point']); }
    check('missile update', parts, parts.length + ' rules hold: four refusals with their own words, the new aim point, no truth leak, the lock let go, off a chaff cloud, empty water, the fuel, every missile at once (-v lists them)');
  }

  // 6d. Revision 5: the new inputs with wild values never break the game. Sixty random games in which Route and Update missile are pressed at random too, with the boat often shallow and its mast up.
  {
    let bad = 0, ups = 0, refused = 0, legs = 0, fired = 0, asked = 0;
    for (let s = 1; s <= 60; s++) { const pl = randomPlayer(9000 + s), r2 = (() => { let a = s * 31 + 7; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; })(), wild = [NaN, Infinity, -5, 9, undefined, null, 'x', 2.6]; let hold = 0, x = {};
      const r = run(['firstblood', 'hunted', 'strait'][s % 3], 9000 + s, () => st => { const inp = Object.assign({}, pl(st)); if (--hold <= 0) { hold = 10 + Math.floor(r2() * 60); x = { route: r2() < 0.1 ? wild[Math.floor(r2() * wild.length)] : Math.floor(r2() * 3), weapon: r2() < 0.6 ? 1 : 0, up: r2() < 0.4, shallow: r2() < 0.5 }; }
        inp.route = x.route; inp.weapon = x.weapon; if (x.shallow) { inp.depthCmd = 9; inp.mast = true; } if (x.up) inp.cmd = 'mupdate'; return inp; }, { checkEvery: 300, after: true });
      if (r.error || r.bad.length || !r.over) bad++; ups += r.ev.mUpdate || 0; refused += r.ev['refuse'] || 0; legs += r.ev.mTurn || 0; fired += r.ev.mFire || 0; asked += r.ev.mAsk || 0; }
    check('missile inputs', [[bad === 0 && fired > 0, '60 random games with Route and Update missile pressed at random (wild values too) end cleanly: ' + fired + ' missiles launched, ' + asked + ' of them set to Dog-leg (' + legs + ' flew one to its turn: these players fire from close in, where a dog-leg is flown direct), ' + ups + ' updates were taken']]);
  }

  // 7. the balance table of section 5: each row over 200 seeds, every layer counted together
  {
    // 200 seeds a row is the test; MN=1000 in the environment measures the same rows over more seeds (the pass marks are meant for 200)
    const parts = [], N = +process.env.MN || 200, C = MQ.chaff;
    const ROWS = [['One sea-skimmer, one frigate, unaware', { attack: 0, level: 0 }, 35, 'stop'], ['One sea-skimmer, one frigate, alert', { attack: 0, level: 2 }, 50, 'stop'], ['One pop-up, one frigate, alert', { attack: 1, level: 2 }, 55, 'stop'],
      ['Two-missile salvo, one frigate, alert', { attack: 0, level: 2, salvo: 2 }, 65, 'thru'], ['One missile, escorted high-value ship, alert', { mission: 'strait', convoy: true, level: 2 }, 70, 'stop']];
    const got = ROWS.map(q => mRow(q[1], N));
    ROWS.forEach((q, i) => { const r = got[i], v = r[q[3]], whole = r.refused === 0 && r.n === N * (q[1].salvo || 1) && r.hit + r.sam + r.gun + r.decoyed + r.missed === r.n;
      parts.push([whole && Math.abs(v - q[2]) <= 10, q[0] + ': ' + (q[3] === 'thru' ? 'at least one through in ' : 'stopped ') + v.toFixed(1) + '% (target about ' + q[2] + '%)' + (whole ? '' : ' [' + r.refused + ' launches refused, ' + r.n + ' outcomes]')]);
      mLines.push('  ' + q[0] + ' (target ' + (q[3] === 'thru' ? 'one through in ' : 'stopped ') + 'about ' + q[2] + '%): ' + mShow(r)); });
    const extra = mRow({ mission: 'strait', convoy: true, level: 0 }, N); mLines.push('  (not a target row) One missile, escorted high-value ship, unaware: ' + mShow(extra));
    // not target rows either: the same alert sea-skimmer with the whole log put wrong, to show what a poor aim point and distraction chaff do together (the ship crosses the line of fire)
    for (const q of [['700 m beyond the ship', 0, -700], ['1,500 m ahead of the ship', 1500, 0]])
      mLines.push('  (not a target row) One sea-skimmer, one frigate, alert, the aim point ' + q[0] + ': ' + mShow(mRow({ attack: 0, level: 2, dx: q[1], dz: q[2] }, N)));
    // Revision 5, printed and not targets: the dog-leg, and one mid-flight update. Each has the same shot without it beside it. They are fired from 6,000 m and 8,000 m, because a dog-leg needs
    // room and an update needs time; the boat of the update rows is at periscope depth with its mast up.
    const R5 = [['One sea-skimmer, one frigate, alert, from 6,000 m, direct', { level: 2, range: 6000 }], ['the same by a dog-leg', { level: 2, range: 6000, route: 1 }],
      ['One pop-up, one frigate, alert, from 6,000 m, direct', { level: 2, range: 6000, attack: 1 }], ['the same by a dog-leg', { level: 2, range: 6000, attack: 1, route: 1 }],
      ['One sea-skimmer, one frigate, alert, from 8,000 m; the target turns 90 degrees 5 s after the launch; no update', { level: 2, range: 8000, depth: 9, mast: true, turn: { at: 5, by: PI / 2 } }],
      ['the same with one update 15 s after the launch', { level: 2, range: 8000, depth: 9, mast: true, turn: { at: 5, by: PI / 2 }, update: 15 }],
      ['One sea-skimmer, one frigate, alert, from 8,000 m, the first aim point 3,000 m ahead of the ship (a rough solution); no update', { level: 2, range: 8000, depth: 9, mast: true, dx: 3000 }],
      ['the same with one update 15 s after the launch', { level: 2, range: 8000, depth: 9, mast: true, dx: 3000, update: 15 }]];
    const r5 = R5.map(q => { const r = mRow(q[1], N); mLines.push('  (not a target row) ' + q[0] + ': ' + mShow(r)); return r; });
    const midShare = r => r.mid / Math.max(1, r.hit);
    parts.push([midShare(got[2]) > midShare(got[1]), 'pop-up hits fall amidships more often than sea-skim hits: ' + pct(midShare(got[2])) + ' against ' + pct(midShare(got[1]))]);
    // seduction: the share of locks the chaff takes is the configured chance, for a low missile and for one in the pop-up
    const low = { p: got[0].pulls + got[1].pulls, n: got[0].tries + got[1].tries }, pop = { p: got[2].pulls, n: got[2].tries }, rl = 100 * low.p / Math.max(1, low.n), rp = 100 * pop.p / Math.max(1, pop.n);
    parts.push([low.n >= 2 * N - 0.2 * N && pop.n >= N - 0.2 * N && Math.abs(rl - 100 * C.pull) <= 5 && Math.abs(rp - 100 * C.pullPop) <= 5 && Math.abs(100 * got[0].pulls / got[0].tries - 100 * C.pull) <= 5 && Math.abs(100 * got[1].pulls / got[1].tries - 100 * C.pull) <= 5,
      'seduction takes ' + rl.toFixed(1) + '% of ' + low.n + ' low missiles\' locks (set to ' + (100 * C.pull).toFixed(0) + '%; ' + f1(100 * got[0].pulls / got[0].tries) + '% unaware, ' + f1(100 * got[1].pulls / got[1].tries) + '% alert) and ' + rp.toFixed(1) + '% of ' + pop.n + ' pop-ups\' (set to ' + (100 * C.pullPop).toFixed(0) + '%)']);
    // distraction: a seeker takes the configured share of the clouds that come into its view (the three single-frigate alert rows), and a lured missile hits no more often than the rest
    const dl = got.slice(1, 4).reduce((n, r) => n + r.looks, 0), dt = got.slice(1, 4).reduce((n, r) => n + r.takes, 0), rd = 100 * dt / Math.max(1, dl);
    const lured = got.reduce((n, r) => n + r.lured, 0), luredHit = got.reduce((n, r) => n + r.luredHit, 0), allHit = got.reduce((n, r) => n + r.hit, 0), all = got.reduce((n, r) => n + r.n, 0);
    parts.push([dl >= 3 * N && Math.abs(rd - 100 * C.pullFar) <= 5 && got[0].far === 0 && got.slice(1, 3).every(r => r.luredEnd >= 1),
      'distraction takes ' + rd.toFixed(1) + '% of the ' + dl + ' clouds that came into a seeker\'s view (set to ' + (100 * C.pullFar).toFixed(0) + '%); it ended ' + got.slice(1, 5).map(r => r.luredEnd).join(', ') + ' missiles in the four alert rows ('
      + got.slice(1, 5).map(r => (100 * r.luredEnd / Math.max(1, r.n - r.hit)).toFixed(1) + '%').join(', ') + ' of their stops); an unaware frigate fires none']);
    parts.push([lured >= 20 && luredHit / lured <= allHit / all, 'of ' + lured + ' missiles lured by a distraction cloud ' + luredHit + ' still hit a ship (' + pct(luredHit / Math.max(1, lured)) + ', against ' + pct(allHit / all) + ' of all missiles): distraction does not help the missile']);
    // Revision 5. The escorted row after the jamming change: whom the hits fell on.
    parts.push([got[4].hit > 0, 'escorted row: of ' + got[4].hit + ' hits, ' + (got[4].hit - got[4].other) + ' fell on the high-value ship the missile was fired at and ' + got[4].other + ' on an escort or another ship']);
    if (r5.length) {
      const [d0, d1, p0, p1, t0, t1, a0, a1] = r5;
      parts.push([d1.refused === 0 && d1.direct === 0 && d1.slow === d1.seen && d1.seen >= N && d0.slow === 0 && d1.stop < d0.stop - 5 && d1.time / d1.n > d0.time / d0.n + 10 && p1.stop < p0.stop,
        'from 6,000 m at an alert frigate (not targets): a dog-leg sea-skimmer is stopped ' + d1.stop.toFixed(1) + '% of the time against ' + d0.stop.toFixed(1) + '% direct, and flies ' + f1(d1.time / d1.n) + ' s against ' + f1(d0.time / d0.n) + ' s; all ' + d1.slow + ' first sights came from the flank; a dog-leg pop-up ' + p1.stop.toFixed(1) + '% against ' + p0.stop.toFixed(1) + '%']);
      parts.push([t1.updates === N && t1.updRefused === 0 && a1.updates === N && Math.abs(t1.stop - t0.stop) <= 10 && a0.hit === 0 && a1.hit > N / 4,
        'one update 15 s after the launch, from 8,000 m at an alert frigate (not targets): after the target turned 90 degrees, stopped ' + t1.stop.toFixed(1) + '% against ' + t0.stop.toFixed(1) + '% with no update (the seeker\'s own view covers a turn); with the first aim point 3,000 m wrong, ' + a1.hit + ' of ' + a1.n + ' hit against ' + a0.hit + ' of ' + a0.n + ' with no update']);
    }
    const two = got.reduce((n, r) => n + r.two, 0);
    parts.push([two === 0, 'in all ' + got.reduce((n, r) => n + r.launches, 0) + ' launches no frigate ever had two defence missiles in the air at once']);
    check('missile balance', parts);
  }
}
/*STAGE-J-END*/
// Replay. The same seed and the same orders, step for step, give the same game: every number in the state at the end is the same. (Until Stage I this place
// held a check that undamaged games matched Stage F exactly. Fire control changed what the boat knows of every contact, so no game matches Stage F any more;
// the old Stage F record it was checked against has been removed.) Each game is played by the mission's scripted player with a second hand on the fire-control
// panel: it picks contacts, sets courses and speeds by hand, changes the torpedo settings and sends orders down the wire. Every order of every step is written
// down and played back into a fresh game.
// The second hand, the fingerprint of a state and the missile games are also used by the 'unchanged' check below.
const fiddle = seed => { let a = (seed * 7919) >>> 0; const r = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; let a5 = (seed * 15485863) >>> 0; const r5 = () => { a5 = (Math.imul(a5, 1664525) + 1013904223) >>> 0; return a5 / 4294967296; };
  const cmds = ['course+', 'course-', 'speed+', 'speed-', 'auto', 'restart', 'retarget', 'reject', 'next', 'weapon', 'swap', 'unswap']; let hold = 0, more = {};
  return st => { if (--hold <= 0) { hold = 8 + Math.floor(r() * 50); const cs = st.contacts.filter(c => c.kind === 'ship' || c.kind === 'hulk' || c.kind === 'bio'), ts = st.torps.filter(t => t.side === 0);
    more = { target: cs.length ? cs[Math.floor(r() * cs.length)].id : 0, cmd: st.seeker && st.seeker.lock && r() < 0.3 ? 'reject' : r() < 0.6 ? cmds[Math.floor(r() * cmds.length)] : '', arg: ts.length ? ts[Math.floor(r() * ts.length)].id : 0, launch: Math.floor(r() * 2), enable: Math.floor(r() * 3), runDepth: Math.floor(r() * 2), search: Math.floor(r() * 3) };
    // Stage J: the weapon and the attack chosen for the next shot, which way a swap goes, and now and then a press of Fire with Missile chosen (most are refused, and the refusal is part of the game)
    more.weapon = r() < 0.3 ? 1 : 0; more.attack = Math.floor(r() * 2); if (more.cmd === 'swap') more.arg = Math.floor(r() * 2); if (more.weapon === 1 && r() < 0.6) more.fire = true;
    // Revision 5: the route chosen for the next missile, and now and then Update missile, from a generator of their own (so the older orders are the same numbers as before)
    more.route = Math.floor(r5() * 3); if (!more.cmd && r5() < 0.15) more.cmd = 'mupdate'; }
    return more; }; };
const stateText = st => JSON.stringify(st, (k, v) => typeof v === 'number' && !isFinite(v) ? String(v) : v), hash = st => fnv(stateText(st));
const mSetup = (seed, o, build) => { const w = mWorld(seed, { plain: true, range: o.range, level: 2, depth: o.scope ? 9 : 0, build }); w.log(o.dx || 0, 0); w.level(2); w.free = true; return w; };
const mHand = (seed, id, o) => { let a = (seed * 104729) >>> 0; const r = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; let hold = 0, more = {};
  let a5 = (seed * 15485863) >>> 0; const r5 = () => { a5 = (Math.imul(a5, 1664525) + 1013904223) >>> 0; return a5 / 4294967296; };
  return () => { if (--hold <= 0) { hold = 10 + Math.floor(r() * 80); const c = r();
    more = { throttle: 1, depthCmd: r() < 0.1 ? 70 : 30, target: r() < 0.9 ? id : 0, weapon: r() < 0.85 ? 1 : 0, attack: Math.floor(r() * 2) * (o.low ? 0 : 1), fire: r() < 0.6, cmd: c < 0.12 ? 'swap' : c < 0.2 ? 'unswap' : '', arg: Math.floor(r() * 2), silent: r() < 0.05 };
    more.route = Math.floor(r5() * 3); if (!more.cmd && r5() < (o.scope ? 0.5 : 0.2)) more.cmd = 'mupdate'; if (o.scope) { more.depthCmd = 9; more.mast = true; } }
    return more; }; };
const M_GAMES = [[1, { range: 5000 }], [2, { range: 5000 }], [3, { range: 6000 }], [4, { range: 6000 }], [5, { range: 7000 }], [6, { range: 7000 }], [7, { range: 5000 }], [8, { range: 6000 }], [9, { range: 7000, dx: 5000, low: true }], [10, { range: 7000, dx: -5000, low: true }],
  [11, { range: 6000, scope: true }], [12, { range: 7000, scope: true }], [13, { range: 8000, dx: 2500, low: true, scope: true }]];
if (want('replay')) {
  // what the orders and the game held, counted from the events
  const seen = {}, mOut = { launched: 0, hit: 0, sam: 0, gun: 0, decoyed: 0, missed: 0 }, mGames = { launched: 0 };
  const note = (e, from) => { const J = ['missile', 'swap', 'fire', 'update'];
    if (e.type === 'mUpdate') seen['missile updated'] = (seen['missile updated'] || 0) + 1; if (e.type === 'mFire' && e.route) seen['dog-leg launched'] = (seen['dog-leg launched'] || 0) + 1;
    const key = e.type === 'fire' ? (e.id ? 'launch' + e.launch + (e.aimed ? ' aimed' : ' bow') : '') : e.type === 'refuse' ? 'refuse ' + e.what + (J.includes(e.what) ? ' ' + e.why : '') : ['fcEdit', 'fcTurn', 'retarget', 'reject', 'weapon', 'enabled'].includes(e.type) ? e.type + (e.what ? ' ' + e.what : '')
      : e.type === 'swap' ? (e.start ? '' : 'swap ordered') : e.type === 'swapEnd' ? (e.why === 'cancel' ? 'swap cancelled' : 'swap done') : e.type === 'mFire' ? 'missile launched' : '';
    if (key) seen[key] = (seen[key] || 0) + 1;
    const end = e.type === 'mEnd' ? e.why : e.type === 'hit' && e.weapon === 'missile' ? 'hit' : '';
    if (e.type === 'refuse' && e.what === 'missile' && e.why === 'solution') from.poor = (from.poor || 0) + 1;
    if (e.type === 'mFire') { mOut.launched++; from.launched++; } else if (end) { mOut[end]++; from[end] = (from[end] || 0) + 1; } };
  const switches = tape => { let n = 0; for (let i = 1; i < tape.length; i++) if ((tape[i].weapon || 0) !== (tape[i - 1].weapon || 0)) n++; if (n) seen['weapon switched'] = (seen['weapon switched'] || 0) + n; };
  let games = 0, same = 0, steps = 0; const differ = [], inMissions = { launched: 0 };
  for (const id of Object.keys(MISSIONS)) for (const seed of [3, 17, 29]) {
    const tape = [], a = createSim({ mission: id, seed }), pl = PLAYERS[id](seed), fd = fiddle(seed);
    for (let i = 0; i < 9000 && !a.state.over; i++) { const inp = Object.assign({}, pl(a.state), fd(a.state)); tape.push(inp); a.step(STEP, inp);
      for (const e of a.events) note(e, inMissions);
      a.events.length = 0; }
    const b = createSim({ mission: id, seed }); for (const inp of tape) { b.step(STEP, inp); b.events.length = 0; }
    games++; steps += tape.length; switches(tape); if (hash(a.state) === hash(b.state) && a.state.tick === b.state.tick) same++; else differ.push(id + ':' + seed);
  }
  // Stage J: missile games. In the mission games a missile launch is seldom accepted (it needs a solution with a range, from at least 1,500 m), so the set gains games that begin
  // from the fixed scene of the missile checks: an alert frigate 5,000 to 7,000 m off, with two minutes of clean fixes already in fire control's log. From there on nothing
  // is staged: the ships sail themselves, the sim's own fitter works the log, and a hand keeps Missile chosen and presses Fire, swaps tubes, cancels and changes the
  // attack. In two of the games the log is 5,000 m wrong and the hand keeps to Sea-skim, so those missiles pass the frigate unseen and find nothing. Each game is played,
  // its orders written down, and played back.
  // Revision 5: the hand also chooses the route and now and then orders Update missile (refused while the boat is deep); in the last three games the boat stays at periscope depth with its mast up, so updates go out.
  let mSame = 0, mSteps = 0;
  for (const g of M_GAMES) {
    const a = mSetup(g[0], g[1]), hand = mHand(g[0], a.tgt.id, g[1]), tape = [];
    for (let i = 0; i < 4500 && !a.st.over; i++) { const inp = Object.assign({}, hand()); tape.push(inp); a.sim.step(STEP, inp); for (const e of a.sim.events) note(e, mGames); a.sim.events.length = 0; }
    const b = mSetup(g[0], g[1]); for (const inp of tape) { b.sim.step(STEP, inp); b.sim.events.length = 0; }
    mSteps += tape.length; switches(tape); if (hash(a.st) === hash(b.st) && a.st.tick === b.st.tick) mSame++; else differ.push('missile game ' + g[0]);
  }
  const need = ['fcEdit course+', 'fcEdit speed-', 'fcEdit auto', 'fcEdit restart', 'retarget', 'reject', 'weapon', 'launch0 aimed', 'launch1 aimed'], missing = need.filter(k => !seen[k]);
  const needJ = ['missile launched', 'swap ordered', 'swap cancelled', 'swap done', 'weapon switched', 'missile updated', 'dog-leg launched', 'refuse update uDeep', 'refuse update uNone'], missingJ = needJ.filter(k => !seen[k]).concat(Object.keys(seen).some(k => k.indexOf('refuse missile') === 0) ? [] : ['a refused launch']);
  const down = mOut.sam + mOut.gun, flying = mOut.launched - mOut.hit - down - mOut.decoyed - mOut.missed;
  check('replay', [[same === games && games === Object.keys(MISSIONS).length * 3 && !missing.length && !missingJ.length, same + '/' + games + ' games (every mission, 3 seeds, ' + steps + ' steps) end in exactly the same state when their orders are played back'
    + (differ.length ? ': differ in ' + differ.join(', ') : '') + '. The orders held ' + Object.keys(seen).sort().map(k => seen[k] + ' ' + k).join(', ') + (missing.length || missingJ.length ? '; MISSING: ' + missing.concat(missingJ).join(', ') : '')],
    [mSame === M_GAMES.length, mSame + '/' + M_GAMES.length + ' missile games (' + mSteps + ' steps) end in exactly the same state when their orders are played back'],
    [mOut.launched >= 6 && mOut.hit >= 1 && down >= 1 && mOut.decoyed >= 1 && mOut.missed >= 1 && flying >= 0, 'missile launches accepted across the replay set: ' + mOut.launched + ' (' + inMissions.launched + ' in the 18 mission games, against ' + (inMissions.poor || 0) + ' launches refused there for the solution; they ended as hit ' + (inMissions.hit || 0) + ', shot down ' + ((inMissions.sam || 0) + (inMissions.gun || 0)) + ', decoyed ' + (inMissions.decoyed || 0) + ', missed ' + (inMissions.missed || 0) + '; ' + mGames.launched + ' in the missile games); in all they ended as: hit ' + mOut.hit
      + ', shot down ' + down + ' (' + mOut.sam + ' by a defence missile, ' + mOut.gun + ' by the gun), decoyed ' + mOut.decoyed + ', missed ' + mOut.missed + (flying ? ', still in flight when the game stopped ' + flying : '')]]);
}
// Unchanged. A change that only rearranges the rules must leave every game exactly as it was (the Duel plan, PR 1: tasks/todo.md). The game file as it stands on
// the main branch is taken from git and its sim is run beside the one under test: the same mission, the same seed and the same player in each, step for step.
// Every event is compared as it is emitted (events are not part of the saved state), and with it whether it would drop time compression. The whole state is
// compared after every step, so a difference that lasts one step and is then put right is still found. At the end the result, the reason, the tick, the score,
// the statistics and the whole state must be the same: the state is compared as text, which is what the replay check's fingerprint is taken from.
// The games: in every mission the scripted player on six seeds, an idle player, twelve random players and the three replay games with the second hand on
// the panel; then the 13 missile games. A game file that cannot be read from git fails the check: it is never skipped.
// Free Patrol may part from the old game at its first Archer wave (the Duel plan, PR 2: that wave is drawn from a fourth random stream the old game does not
// have); a Free Patrol game is compared up to that wave and stops there, and only there: a Free Patrol game must have run at least 300 s to stop that way.
if (want('unchanged')) {
  const BASE = 'main:game/strait-shadow.html', diffs = [], forks = [], held = {}, kinds = { scripted: [1].concat(SEEDS), idle: [1], random: [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012], replay: [3, 17, 29] };
  let OLD = null, why = '', sameText = false, games = 0, steps = 0, evs = 0, threats = 0;
  try {
    const om = execFileSync('git', ['show', BASE], { cwd: here, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).match(/<script id="sim">([\s\S]*?)<\/script>/);
    if (om) { OLD = new Function(om[1] + '\nreturn StraitSim;')(); sameText = om[1] === simText; } else why = 'it has no <script id="sim"> block';
  } catch (e) { why = String((e && e.message) || e).split('\n').filter(Boolean).slice(0, 2).join(' '); }
  // Two states looked at side by side, value for value and key for key in the same order. It is quicker than writing both out as text, and it never calls two
  // states alike whose texts differ, so a pair it calls different is then compared as text, which has the last word.
  const alike = (x, y) => {
    if (x === y) return true;
    if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return typeof x === 'number' && typeof y === 'number' && !isFinite(x) && String(x) === String(y);
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    if (Array.isArray(x)) { if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (!alike(x[i], y[i])) return false; return true; }
    const kx = Object.keys(x), ky = Object.keys(y); if (kx.length !== ky.length) return false;
    for (let i = 0; i < kx.length; i++) { const k = kx[i]; if (k !== ky[i] || !alike(x[k], y[k])) return false; }
    return true;
  };
  // one game played in both: a is the sim from git and b the one under test, pa and pb their players. It stops at the first difference and says where.
  const pair = (label, a, b, pa, pb, cap) => {
    const A = a.state, B = b.state; games++;
    for (let i = 0; i < cap && !A.over && !B.over && B.t < B.timeLimit + 1; i++) {
      a.step(STEP, pa(A)); b.step(STEP, pb(B)); steps++;
      for (let k = 0; k < Math.max(a.events.length, b.events.length); k++) {
        const ea = a.events[k], eb = b.events[k], ta = JSON.stringify(ea), tb = JSON.stringify(eb), threat = !!eb && isThreat(eb, B);
        if (eb && eb.type === 'wave' && eb.sub && B.mission === 'patrol' && B.t >= 300) { forks.push(label + ' at ' + Math.round(B.t) + ' s'); return; }
        if (ta !== tb || (!!ea && OLD.isThreat(ea, A)) !== threat) { diffs.push(label + ' at tick ' + B.tick + ': event ' + ta + ' became ' + tb + (ta === tb ? ' (it drops time compression in one and not the other)' : '')); return; }
        const key = eb.type + (eb.type === 'homing' ? ' side ' + eb.side : ''); held[key] = (held[key] || 0) + 1; evs++; if (threat) threats++;
      }
      a.events.length = 0; b.events.length = 0;
      if (!alike(A, B) && stateText(A) !== stateText(B)) { diffs.push(label + ' at tick ' + B.tick + ': the state ' + hash(A) + ' became ' + hash(B)); return; }
    }
    const bad = [], was = (name, x, y) => { if (x !== y) bad.push(name + ' ' + x + ' became ' + y); };
    was('over', A.over, B.over); was('result', A.result, B.result); was('reason', A.reason, B.reason); was('end tick', A.tick, B.tick); was('score', A.score, B.score);
    was('statistics', JSON.stringify(A.stats), JSON.stringify(B.stats)); if (stateText(A) !== stateText(B)) bad.push('final state ' + hash(A) + ' became ' + hash(B));
    if (bad.length) diffs.push(label + ': ' + bad.join(', '));
  };
  const ids = OLD ? Object.keys(MISSIONS).filter(id => OLD.MISSIONS[id]) : [];
  for (const id of ids) for (const kind of Object.keys(kinds)) for (const seed of kinds[kind]) {
    const a = OLD.createSim({ mission: id, seed }), b = createSim({ mission: id, seed });
    const mk = () => { const pl = (kind === 'idle' ? idle : kind === 'random' ? randomPlayer : PLAYERS[id])(seed), fd = kind === 'replay' ? fiddle(seed) : null; return fd ? st => Object.assign({}, pl(st), fd(st)) : pl; };
    pair(id + ' ' + kind + ' seed ' + seed, a, b, mk(), mk(), kind === 'replay' ? 9000 : Infinity);
  }
  if (OLD) for (const g of M_GAMES) {
    const a = mSetup(g[0], g[1], OLD), b = mSetup(g[0], g[1]);
    pair('missile game ' + g[0], a.sim, b.sim, mHand(g[0], a.tgt.id, g[1]), mHand(g[0], b.tgt.id, g[1]), 4500);
  }
  // the games must have gone through the rules the change touches: what the other side knows and says, torpedoes of both kinds, missiles and the ships' defences
  const need = ['alert', 'mastSeen', 'shipEvade', 'sighted', 'datum', 'mSeen', 'homing side 0', 'homing side 1', 'fooled', 'lostLock', 'wireCut', 'shipDecoy', 'shipFire', 'drop', 'hit', 'playerHit', 'collide', 'heloLaunch', 'buoy', 'wave', 'score'], missing = need.filter(k => !held[k]);
  const per = Object.keys(kinds).map(k => kinds[k].length + ' ' + k).join(', '), n = ids.length * Object.keys(kinds).reduce((q, k) => q + kinds[k].length, 0) + M_GAMES.length;
  check('unchanged', [[!!OLD, OLD ? 'the game file was read from git (' + BASE + '; its sim is ' + (sameText ? 'the same text as the one under test' : 'not the same text as the one under test') + ')' : 'the game file could not be read from git (git show ' + BASE + '), so nothing was compared: ' + why]
  ].concat(!OLD ? [] : [[!diffs.length && games === n && ids.length === Object.keys(OLD.MISSIONS).length, games + ' games (' + ids.length + ' missions: ' + per + ' each; ' + M_GAMES.length + ' missile games), ' + steps + ' steps and ' + evs + ' events (' + threats + ' of them drop time compression)'
      + (diffs.length ? ' DIFFER in ' + diffs.length + ': ' + diffs.slice(0, 6).join(' | ') : ': result, reason, end tick, score, statistics, every event and the state after every step are the same in both')
      + '; ' + forks.length + ' Free Patrol game(s) were compared up to their first Archer wave and stopped there' + (forks.length ? ' (' + forks.join(', ') + ')' : '')],
    [!missing.length, 'the events compared held ' + need.filter(k => held[k]).map(k => held[k] + ' ' + k).join(', ') + (missing.length ? '; MISSING: ' + missing.join(', ') : '')]]));
}
// Sides. The rules that ask whose a picture or a weapon is (the Duel plan, PR 1) have no user in any mission yet: every picture is the shown one and every heavy
// torpedo is the boat's. So the other branches are driven here by hand, each beside a twin that takes the branch the game takes today, to show that the twin
// does what the first must not. A picture that is not the shown one is written through the picture rules the sim hands out (sim.pictures); a heavy torpedo
// that a frigate owns is a record put into the state with that frigate's id as its owner.
if (want('sides')) {
  const V = SIM.V, parts = [], QUIET = ['alert', 'mastSeen', 'shipEvade'], count = (ev, type) => ev.filter(e => e.type === type).length;
  // a torpedo record as the sim makes one, already running and armed at its search depth, heading up the map
  // what an event says of whose weapon it was: 'foe' when it carries foe:1, 'own' when it has no such key at all, 'odd' for anything else or no event
  const whose = e => !e ? 'odd' : e.foe === 1 ? 'foe' : 'foe' in e ? 'odd' : 'own';
  const torp = (st, o) => { const t = Object.assign({ id: 880001 + st.torps.length, side: 1, phase: 'search', x: 0, z: 0, depth: V.torp.depth, alt: 0, h: PI / 2, speed: V.torp.speed, vy: 0, run: 1000, st: 0, life: 90, target: 0, pod: 0, spin: 1, wire: false, lock: 0, bait: 0, seen: [], tx: 0, tz: 0,
    launch: 1, enable: V.torp.enable, max: 1e9, deep: false, climbAt: 0, pat: 0, aimed: false, gyro: 0, aimRun: 1e9, base: 0, sw: 1, circ: 0, circled: false, patOn: false, again: 0, rej: [], from: 0, pref: false, goto: false, transT: 0 }, o); st.torps.push(t); return t; };
  // Pictures. The start of First Blood, with the frigate 900 m off and pointing at the boat, the mast up, and one of the boat's torpedoes and one of its noisemakers
  // close to the ship. Every picture rule is run on it by hand and nothing is stepped: 300 seconds of the ship's own sensors, a fix, an active echo, a noisemaker's
  // pull, a dipping sonar's ping, then three seconds of going stale. Once on a picture of its own that is not the shown one, once in a twin world on the shown one.
  const pictures = shown => { const sim = createSim({ mission: 'firstblood', seed: 7 }), st = sim.state, p = st.player, s = st.ships.find(q => q.kind === 'frigate'), P = sim.pictures;
    const tr = shown ? st.enemy : JSON.parse(JSON.stringify(st.enemy)), stats0 = JSON.stringify(st.stats), enemy0 = JSON.stringify(st.enemy);
    s.x = p.x + 900; s.z = p.z; s.h = bearing(s.x, s.z, p.x, p.z); p.mast = true; p.expo = 1; p.depth = V.periscope;
    torp(st, { side: 0, x: s.x + 200, z: s.z }); const dc = { id: 880100, side: 0, x: s.x + 100, z: s.z, depth: 20, life: 60 }; st.decoys.push(dc);
    for (let i = 0; i < 300; i++) { s.threat = 0; P.shipSense(s, tr, shown, 900, 1); }
    P.detect(tr, shown, 'fix', s.x, s.z); P.activeFix(tr, shown, s.x, s.z); P.lure(tr, shown, dc); P.dipPing({ id: 880200, x: p.x + 300, z: p.z, fix: false }, tr, shown);
    for (let i = 0; i < 90; i++) P.decay(tr, shown, STEP);
    return { tr: JSON.stringify(tr), ev: sim.events.slice(), stats: st.stats, statsSame: JSON.stringify(st.stats) === stats0, enemySame: JSON.stringify(st.enemy) === enemy0, level: tr.level }; };
  const hid = pictures(false), seen = pictures(true), said = ev => QUIET.map(k => count(ev, k) + ' ' + k).join(', ');
  parts.push([hid.level >= 3 && hid.tr === seen.tr, 'a picture that is not the shown one is written exactly as the shown one is in a twin world (it reaches level ' + hid.level + ', and every number in it is the same)']);
  parts.push([hid.statsSame && hid.enemySame && hid.stats.firstAlert < 0 && hid.stats.maxLevel === 0 && hid.stats.trackedT === 0, 'it leaves the statistics and the shown picture as they were (first alert ' + hid.stats.firstAlert + ', highest level ' + hid.stats.maxLevel + ', time tracked ' + hid.stats.trackedT + ')']);
  parts.push([QUIET.every(k => !count(hid.ev, k)) && JSON.stringify(hid.ev) === JSON.stringify(seen.ev.filter(e => !QUIET.includes(e.type))), 'it reports nothing (' + said(hid.ev) + '), and every other event is the same as in the twin (' + hid.ev.length + ')']);
  parts.push([QUIET.every(k => count(seen.ev, k) > 0) && !seen.statsSame && seen.stats.firstAlert >= 0 && seen.stats.maxLevel >= 3 && seen.stats.trackedT > 0,
    'the twin, on the shown picture, does report and count (' + said(seen.ev) + '; first alert ' + seen.stats.firstAlert + ', highest level ' + seen.stats.maxLevel + ', time tracked ' + seen.stats.trackedT.toFixed(1) + ' s)']);
  // A frigate's heavy torpedo and the boat, in Strait Shadow's waters. The torpedo starts 1,000 m astern of the boat and runs up its track at its search depth.
  // The frigate that owns it lies across the torpedo's track 300 m ahead, so the torpedo runs through its hull; the other frigate lies 400 m ahead and 40 m
  // clear of the track. Both are nearer than the boat and inside the seeker's cone.
  // The other side is kept unaware, so nothing else is fired.
  const hunt = depth => { const w = mWorld(11, { plain: true, level: 0, depth, mission: 'strait' }), st = w.st; w.tx = 40; w.tz = 700; w.v = 0; w.hold(); w.also('frigate', -40, 600, PI / 2);
    const t = torp(st, { owner: w.tgt.id, x: 0, z: 1000 }), o = { sub: false, own: false };
    w.run(95, {}, q => { if (t.target === -1) o.sub = true; else if (t.target) o.own = true; return q.torps.includes(t); });
    const mine = e => e.id === t.id; o.homing = w.ev.filter(e => e.type === 'homing' && mine(e)); o.hit = w.ev.filter(e => e.type === 'playerHit' && mine(e)); o.end = w.ev.filter(e => e.type === 'torpEnd' && mine(e)).length;
    o.struck = w.ev.filter(e => e.type === 'hit' && mine(e)).length; o.stats = st.stats; o.t = st.t; return o; };
  const shallow = hunt(V.periscope), under = hunt(14), deep = hunt(30);
  parts.push([shallow.homing.length >= 1 && shallow.homing[0].side === 1 && shallow.sub && !shallow.own && !shallow.struck && shallow.hit.length === 1 && shallow.stats.taken === 1 && shallow.stats.hits === 0 && shallow.stats.neutral === 0,
    "a frigate's heavy torpedo runs through the hull of the frigate that owns it unharmed, passes the other frigate, takes the boat at periscope depth for its target and strikes it (after " + shallow.t.toFixed(0) + ' s; hits taken ' + shallow.stats.taken + ')']);
  parts.push([under.homing.length >= 1 && under.sub && !under.hit.length && under.end === 1 && under.stats.taken === 0, 'with the boat at 14 m it hears the boat and follows it but passes over the hull and runs out (locked ' + under.homing.length + ' time(s), hits taken ' + under.stats.taken + ')']);
  parts.push([!deep.homing.length && !deep.sub && !deep.hit.length && deep.end === 1 && deep.stats.taken === 0, 'with the boat at 30 m, out of its seeker\'s hearing, it never locks on and runs out']);
  // A heavy torpedo and a neutral ship, on Hard: a merchant lies still across the torpedo's track 600 m ahead, with the boat 3,000 m away and deep. The frigate's
  // torpedo has its frigate across its track on the way; the twin is one of the boat's own, with the frigate far off.
  const strike = own => { const w = mWorld(11, { plain: true, level: 0, difficulty: 'hard' }), st = w.st; if (!own) { w.tx = 3040; w.tz = 800; w.v = 0; } w.hold();
    const m = w.also('merchant', 3000, 400, 0), hp = m.hp, score = st.score, t = torp(st, own ? { side: 0, x: 3000, z: 1000 } : { owner: w.tgt.id, x: 3000, z: 1000 });
    w.run(60, {}, q => q.torps.includes(t) && !q.over);
    const hit = w.ev.find(e => e.type === 'hit' && e.id === t.id);
    return { hit: !!hit && hit.ship === m.id && hit.neutral === true, whose: whose(hit), lost: hp - m.hp, neutral: st.stats.neutral, hits: st.stats.hits, over: st.over, result: st.result, score: st.score - score }; };
  const theirs = strike(false), ours = strike(true);
  parts.push([theirs.hit && theirs.lost === 2 && theirs.neutral === 0 && theirs.hits === 0 && !theirs.over && theirs.score === 0,
    "a frigate's heavy torpedo that strikes a merchant damages it (" + theirs.lost + ' points) and is not counted against the captain: neutral ships hit ' + theirs.neutral + ', and on Hard the mission goes on']);
  parts.push([ours.hit && ours.lost === 2 && ours.neutral === 1 && ours.over && ours.result === 'lose', 'the twin, one of the boat\'s own, is counted (neutral ships hit ' + ours.neutral + ') and on Hard ends the mission']);
  // A heavy torpedo and a frigate with two damage points left and no noisemakers, lying across the torpedo's track 600 m ahead in Strait Shadow's waters.
  // A torpedo goes off against any hull it runs into but its owner's, so the other frigate's torpedo sinks it too; only the boat's own is counted as a hit
  // and a ship put out of action.
  const sink = own => { const w = mWorld(11, { plain: true, level: 0, mission: 'strait' }), st = w.st; if (!own) { w.tx = 3040; w.tz = 800; w.v = 0; } w.hold();
    const f = w.also('frigate', 3000, 400, 0), t = torp(st, own ? { side: 0, x: 3000, z: 1000 } : { owner: w.tgt.id, x: 3000, z: 1000 }); f.hp = 2; f.cm = 0;
    w.run(60, {}, q => q.torps.includes(t) && !q.over);
    return { hit: w.ev.some(e => e.type === 'hit' && e.id === t.id && e.ship === f.id), whose: whose(w.ev.find(e => e.type === 'hit' && e.id === t.id)), sunk: f.out && w.ev.some(e => e.type === 'shipOut' && e.ship === f.id), hits: st.stats.hits, out: st.stats.out, scored: f.scored }; };
  const theirF = sink(false), ourF = sink(true);
  parts.push([theirF.hit && theirF.sunk && theirF.hits === 0 && theirF.out === 0 && theirF.scored === true && ourF.hit && ourF.sunk && ourF.hits === 1 && ourF.out === 1 && ourF.scored === false,
    "a frigate's heavy torpedo that runs into the other frigate sinks it without a hit or a ship out of action going to the captain (hits " + theirF.hits + ', out ' + theirF.out + '), and marks it as nothing for a Free Patrol to pay for; the twin, one of the boat\'s own, is counted (hits ' + ourF.hits + ', out ' + ourF.out + ') and left to be scored']);
  // A heavy torpedo and sea life, on Hard: a pod of whales or dolphins 300 m ahead of the torpedo at its depth, with no ship in front of it.
  const pod = own => { const w = mWorld(11, { plain: true, level: 0, difficulty: 'hard' }), st = w.st, b = st.bios.find(q => q.kind !== 'fish'); if (!b) return null; if (!own) { w.tx = 3040; w.tz = 900; w.v = 0; } w.hold();
    b.x = b.hx = b.tx = 3000; b.z = b.hz = b.tz = 700; b.depth = V.torp.depth; const t = torp(st, own ? { side: 0, x: 3000, z: 1000 } : { owner: w.tgt.id, x: 3000, z: 1000 });
    w.run(60, {}, q => q.torps.includes(t) && !q.over);
    return { hit: w.ev.some(e => e.type === 'bioHit' && e.id === t.id && e.pod === b.id), whose: whose(w.ev.find(e => e.type === 'bioHit' && e.id === t.id)), fled: whose(w.ev.find(e => e.type === 'bioScatter' && e.pod === b.id)),
      bio: st.stats.bio, over: st.over, result: st.result }; };
  const theirP = pod(false), ourP = pod(true);
  parts.push([!!theirP && !!ourP && theirP.hit && theirP.bio === 0 && !theirP.over && ourP.hit && ourP.bio === 1 && ourP.over && ourP.result === 'lose',
    "a frigate's heavy torpedo that goes off among sea life is not counted against the captain" + (theirP && ourP ? ' (sea life hit ' + theirP.bio + ', and on Hard the mission goes on); the twin, one of the boat\'s own, is counted (' + ourP.bio + ') and on Hard ends the mission' : ': NO POD in this world')]);
  // What the screen is told. Each of those events from the frigate's torpedo carries foe:1, which is what keeps the screen from calling the weapon the captain's;
  // the same events from the boat's own torpedo have no such key, as they never had.
  parts.push([theirs.whose === 'foe' && theirF.whose === 'foe' && !!theirP && theirP.whose === 'foe' && theirP.fled === 'foe' && ours.whose === 'own' && ourF.whose === 'own' && !!ourP && ourP.whose === 'own' && ourP.fled === 'own',
    "the events of a frigate's torpedo are marked as not the boat's (merchant hit: " + theirs.whose + ', frigate hit: ' + theirF.whose + ', sea life hit: ' + (theirP ? theirP.whose : 'none') + ', pod scattered: ' + (theirP ? theirP.fled : 'none') +
    "), and the twins' events carry no such mark (" + [ours.whose, ourF.whose, ourP ? ourP.whose : 'none', ourP ? ourP.fled : 'none'].join(', ') + ')']);
  // The owner gone: a heavy torpedo still on its wire whose ship is no longer there. The wire drops, and as it was never the boat's nothing is reported or counted.
  const orphan = (() => { const w = mWorld(11, { plain: true, level: 0 }), st = w.st, t = torp(st, { owner: 424242, wire: true, x: 3000, z: 1000 }); let threw = '';
    try { w.run(2, {}); } catch (e) { threw = String((e && e.message) || e); }
    return { threw, wire: t.wire, cuts: st.stats.wireCuts, said: count(w.ev, 'wireCut'), runs: st.torps.includes(t) }; })();
  parts.push([!orphan.threw && orphan.wire === false && orphan.cuts === 0 && !orphan.said && orphan.runs,
    'a heavy torpedo whose owning ship is gone drops its wire and runs on, with no wire cut reported or counted' + (orphan.threw ? ' (it threw: ' + orphan.threw + ')' : '')]);
  // The owner sunk: the same torpedo on its wire, 500 m from the frigate that owns it and well inside the wire's length. The frigate is out of action but still
  // among the ships. The wire drops on the first step, again with nothing reported or counted; in the twin, with the frigate afloat, the wire holds.
  const widow = sunk => { const w = mWorld(11, { plain: true, level: 0 }), st = w.st, f = w.tgt; w.tx = 3500; w.tz = 1000; w.v = 0; w.hold(); if (sunk) { f.out = true; f.outT = 0; }
    const t = torp(st, { owner: f.id, wire: true, x: 3000, z: 1000 }); w.step({});
    return { wire: t.wire, off: Math.hypot(t.x - f.x, t.z - f.z), cuts: st.stats.wireCuts, said: count(w.ev, 'wireCut'), runs: st.torps.includes(t), there: st.ships.includes(f) && f.out === sunk }; };
  const lost = widow(true), held = widow(false);
  parts.push([lost.wire === false && lost.there && lost.off < V.wire.len && lost.cuts === 0 && !lost.said && lost.runs && held.wire === true && held.there && held.runs,
    'a heavy torpedo whose owning ship is out of action but still there (' + lost.off.toFixed(0) + ' m off, the wire ' + V.wire.len + ' m long) drops its wire on the next step and runs on, with no wire cut reported or counted; with that ship afloat the wire holds']);
  check('sides', parts);
}
if (mLines.length) { console.log('Missile balance over 200 seeds (the fixed scene of section 5; every layer counted together):'); for (const l of mLines) console.log(l); }
if (table.length && mRandom.mFire !== undefined) { const q = k => mRandom[k] || 0;
  console.log('Missiles in the 1,000 random games of the five missions (the scripted players fire torpedoes only): ' + q('mFire') + ' launched; they ended as hit ' + q('m:hit') + ', shot down ' + (q('m:sam') + q('m:gun')) + ' (' + q('m:sam') + ' by a defence missile, ' + q('m:gun')
    + ' by the gun), decoyed ' + q('m:decoyed') + ', missed ' + q('m:missed') + ', still in flight when the game ended ' + (q('mFire') - q('m:hit') - q('m:sam') - q('m:gun') - q('m:decoyed') - q('m:missed'))
    + '. Launches refused for the solution: ' + (q('no:none') + q('no:grade') + q('no:range') + q('no:other')) + ' (no fit ' + q('no:none') + ', graded None ' + q('no:grade') + ', graded Poor or better but with no range ' + q('no:range') + ', refitted in the same step ' + q('no:other') + ')'); }
if (table.length) console.log('Wins % scripted/random over 40 seeds: ' + table.join(', '));
console.log((failed ? failed + ' check(s) FAILED' : 'All checks passed') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exit(failed ? 1 : 0);
