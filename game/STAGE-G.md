# Stage G: damage control (flooding, fire, injured crew, collisions)

Owner's request (2026-11-21): "can we add realistic damage, flooding, crew injured, fires, research about how torpedo damage or interaction w the seabed or collisions affect a submarine and apply".

Read `DESIGN.md` first. Every hard constraint there still holds: one file, no invented specifications, every number a game value, non-gory, smooth on phone, original game. This stage **replaces** the rule "hull integrity shown as 3 segments" with the damage model below. "No people are shown hurt" still holds: injured crew is a number and a status line, never a picture.

## 1. What the research says (public accounts, used as behaviour, not numbers)

| Source event | What happened | What the game takes from it |
|---|---|---|
| A US attack submarine hit an uncharted seamount at high speed, deep (2005). | The bow sonar dome and forward ballast tanks were wrecked, the pressure hull held, about 98 crew were injured and one died, thrown by the stop. The emergency blow worked only slowly because air leaked from the ruptured forward tanks. | Hitting the seabed at speed: damage grows with speed squared. Speed is the killer, not the touch. It wrecks the bow sonar, injures crew across the boat, and weakens the emergency blow if the forward tanks are hit. A slow touch is just a scrape. |
| A US submarine lost on deep trials (1963). | The court of inquiry blamed flooding from a piping failure; later analysis disputes that. Either way, the emergency blow could not overcome the boat's heaviness, partly from ice in the strainers. Blowing and pumping work better shallow because sea pressure is lower. The boat sank past collapse depth. | Flooding rate grows with depth (game: with the square root of depth, like water through a hole). Pumps and the blow both lose strength with depth. The way out of a flooding casualty is UP: speed, planes up and blow. Below a crush depth the boat is lost. |
| A diesel-electric submarine fire (2014). | Burning cables on the deck above the battery. Dense smoke killed two officers who went to help and hurt seven. The fire ate the oxygen in a closed space. | Fire spreads smoke to the next compartment, injures crew over time, and must be fought by the damage-control team. Electrical fires are most likely near the battery and motor. |
| A British submarine at periscope depth struck a merchant ship (2016). | A glancing blow damaged the top of the fin, where sonar and masts sit. The merchant ship was unharmed. | Being at periscope depth or shallower under a ship's track risks a collision with its hull. It damages the fin: masts and periscope out, a small leak, a few injured. |
| Torpedo warhead primers (US Navy weapons primer; a USNI article). | Lightweight torpedoes use a shaped charge to punch the pressure hull. A smaller warhead "may not sink" a submarine but does serious damage. A near miss whips the hull with shock from the gas bubble. A breached pressure hull is very hard to survive. | All enemy torpedoes in this game are lightweight. A hit makes a hole in ONE compartment (the one along the hull where it struck), sends a shock through the whole boat (injuries, equipment trips), and may start a fire. A near miss (it exploded close but missed) gives shock only. |

Sources for the report: en.wikipedia.org/wiki/USS_San_Francisco_(SSN-711); usni.org Proceedings 2021-08 "What did the Thresher disaster court of inquiry find"; indiannavy.nic.in/node/1245 (Sindhuratna); news.usni.org 2016-07-20 (Ambush); man.fas.org Naval Weapons Engineering, underwater weapons chapter; usni.org Proceedings 2009-06 "Changing face of undersea warfare".

## 2. The model (sim, deterministic, seeded; every value goes in `V.dmg`, commented "game value")

**Compartments.** There are four, front to back, named as on the cutaway page so the two match: `Torpedo room` (tubes, bow sonar; along-hull > +14), `Control room` (periscope and masts, flank sonar; 0 to +14), `Battery` (battery, auxiliary machinery; -14 to 0), `Engine room` (motor, shaft, rudder, stern planes; < -14). Short names in code: fore, ctrl, batt, aft. They are labelled "illustrative sections". Everywhere below, Fore = Torpedo room, Control = Control room, Aft = Engine room. Each one holds:
- `water` 0..1 (share of its free volume flooded);
- `breach` 0..1 (hole size; 0 means sealed);
- `fire` 0..1;
- `smoke` 0..1;
- `hurt` (injured crew in it).

The crew is a game number spread across the compartments.

**Flooding.**
- Inflow per second = breach × k × √(depth / 50).
- Pumps remove a fixed rate, scaled by √(50 / max(depth, 50)) (weaker deep), by the damage-control team's strength, and by 0.4 when Silent running is on. Pumping is loud: it adds to own noise unless silent.
- The damage-control team slowly plugs the breach it is assigned to.
- Water weight makes the boat heavy. The total flooded weight sets a sink rate that the planes can offset only with speed: at Half or above with depth ordered shallower, the boat can still climb if the flooding is small.
- A compartment at water 1 is "lost". Its systems are gone, and the next compartments start to leak through the bulkhead slowly.
- If total flooding passes a threshold the boat cannot hold depth at all.

**Crush depth.** A game value below `depthMax`, reduced as the hull takes hits ("hull stress", 0..1). Going below it is "Boat lost (simulated): the hull collapsed under pressure." Above it there is a creaking warning band.

**Emergency blow.** A new control: key `B` and a touch button, confirmed by pressing twice within 2 s.
- It is a one-shot (air banks), loud, and drives the boat to the surface fast.
- It is weaker the deeper the boat is and the more water it has taken, and weakened if the Fore compartment is breached (ruptured tanks).
- Surfacing exposes the boat (detection as for surfaced) but stops the flooding getting worse.
- A surfaced boat with flooding under control survives. If the mission requires staying hidden, the mission may still fail. That is fine and realistic: being forced up is the price.

**Fire.**
- Fire starts from torpedo hits (high chance in the compartment hit), from hard grounding (low chance), and from water reaching the Battery compartment (electrical).
- It grows unless fought, makes smoke, and smoke spreads to neighbouring compartments.
- It injures crew in proportion to smoke, damages that compartment's systems over time, and adds noise.
- The damage-control team puts it out.
- Optional, one per compartment per mission: "Seal and starve". The compartment is shut, the fire dies after some seconds, and anyone in it is injured. That is a hard choice.

**Crew and damage control.**
- Injuries come from shock (hits, collisions, scaled by severity), smoke and fire.
- The damage-control team's strength = healthy share of the crew.
- The player chooses which compartment the team works in: click or tap it on the damage panel, or keys `1` to `4` while the panel is open. Default: auto, worst first.
- Work in one compartment means fire out, then breach plugged, then water pumped.

**Systems affected.** These are shown as status lines on the panel and as effects in play.
- Fore flooded or hit: bow sonar range ×0.4 (or ×0.15 if lost), tubes jam (no reloads from the rack), forward tanks ruptured.
- Control: periscope and mast unusable if the fin is hit, map contacts update slower.
- Battery: max speed capped, chance of fire.
- Aft: max speed capped further, rudder sluggish, stern planes stiff (slower depth change).
- Any shock: a short "breakers tripped" blackout. Propulsion drops to zero for a few seconds, then returns.

**Collisions.**
- Seabed: replace the flat "damage(1)". Severity = (speed / Flank)².
  - Under 0.1: a scrape, a message, no damage.
  - Above it: a breach in Fore scaled by severity, bow sonar damage, crew injured across the boat scaled by severity, hull stress up, and a fire chance.
  - Keep the 6 s cooldown.
- Ship hulls: when the boat's sail top (depth minus a game sail height) is shallower than a surface ship's draft (a game value per kind) and within its hull box, it is a collision.
  - Fin damage (periscope and mast out), a small Control breach, a few injured.
  - The ship is not harmed, but it now knows where you are (fix).
  - Neutrals count as a neutral incident, with no star loss unless they are harmed. Here they are not.
- Whales: a pod's animal is within a few metres. A small shock, the animal is unharmed and scatters, and a Biologic message shows.

**Torpedo hit.**
- The compartment is chosen from where along the hull it struck (the hit test already computes the along-hull coordinate).
- Breach size is large (lightweight shaped charge).
- Shock injuries go across the boat, hull stress goes up, there is a fire chance, and breakers trip.
- On Hard (the existing `D.two`), the breach is bigger. A hit is survivable if handled: blow or climb and fight it. Two hits in the same area are usually fatal.
- **Near miss:** only where a torpedo really detonates. In this sim, enemy torpedoes that time out or lose lock do not explode (`torpEnd` only), so there is no near miss from them. Do NOT invent one. If a decoy-lured enemy torpedo detonates on a decoy (check whether the sim detonates there), and that point is within a game distance of the boat, apply shock only. Otherwise leave near misses out and say so in the report.

**Seabed limits the depth.** `bedDepth` is 30 m and up but mostly around 150 m, and the ordered depth is clamped to the seabed minus the keel, so most of the map is shallower than any crush depth. Set crush depth (game value) around 190 m, falling with hull stress to no less than about 120 m, so it bites only in the deep basins or after heavy damage. A heavy boat that sinks onto the bottom **settles** there (a soft landing because it sinks slowly, not a collision, and no seabed damage below a sink-rate game value). It keeps flooding, and the pumps keep fighting.

**Loss conditions** (replace "hull reaches 0"; at least one must not depend on depth):
- crush depth;
- **depth-independent:** total flooded share over the four sections passes a game threshold (about 2 sections' worth), whether the boat is sinking or bottomed ("Boat lost (simulated): too much water aboard to stay afloat."). A boat already surfaced by the blow has a higher threshold, because the casing is above water.
- fire plus smoke making every compartment uninhabitable (smoke 1 everywhere) for a game time.

Messages stay calm and factual: "Boat lost (simulated): …".

**Stars and stats.** `unhurt(st)` still means no damage taken (count any breach, collision or hit). Add `st.stats.injured` and `st.stats.flooded` for the debrief.

**Free Patrol** keeps "the patrol ends when the boat is lost". Update its text in lines ~710-711 to drop "hull".

**Random stream.** Draw `rng()` only at damage events, never per tick, so any seed where the boat is never damaged plays out exactly as in Stage F. Add a test for that: same seed, same scripted player, no damage, same end state and time as before the change. Before editing, copy the current game to `game/tmp/stageF.html` and compare against it.

**Sim events (the contract for the screen pass):** `breach{sec,size,why}`, `flood{sec}` (section lost), `fire{sec}`, `fireOut{sec}`, `injured{n,why}`, `trip{t}`, `blow{}`, `surfaced{by:'blow'}`, `collide{with:'ship'|'bio'|'bed',sev,ship?}`, `crushWarn{}`, `creak{}`, `team{sec}`. Keep the existing `playerHit` and `ground` events (now with `sec` and `sev`) because the screen already reacts to them.

**Old hull sites to update** (all of them): help text (~line 356); Free Patrol objective and brief (~710-711); `V.hull`, `p.hull` and `damage()` (~956); grounding (~978); the torpedo hit (~1246); `hullSegs` and the `#hull` HTML (~297, ~3694); the "Hull integrity" messages (~4032-4036); `DIFF.two` (now the bigger breach on Hard); every `hull` assertion in `tests/`.

**Keys:** H is already Help, and 1-4 and B and G are free. Blow = `B` (press twice within 2 s). Damage panel expand = `G`. Assign team = `1`-`4` (work any time, not only when the panel is open). Add touch buttons for Blow and the panel.

## 3. Screen

- **Damage panel** replaces the three hull segments. It is a small side silhouette of the boat cut into the 4 sections. Each shows:
  - water as a blue fill rising from the bottom;
  - fire as an orange flicker;
  - smoke as grey;
  - a small number for injured;
  - the damage-control team as a marker.

  Clicking or tapping a section assigns the team. It is compact on phone, and expands on tap or with key `H`.
- Status line under it, for example: "Flooding in Fore. Pumps on. Team plugging the breach." Use plain words.
- Crush-depth line on the depth gauge, which moves up as hull stress grows. A creak sound in the warning band.
- **Sound:** a flooding alarm (short repeating tone, original), rushing water noise scaled by inflow, a fire alarm, the blow (a long roar of air), and hull creaks. All are synthesised, as now.
- **Outside view:**
  - air bubbles streaming from a breached section, at the right place along the hull;
  - after a blow, the boat breaches the surface bow-first with spray;
  - a thin oil sheen or wake on the surface above a badly damaged boat (optional, cheap);
  - smoke from the fin when surfaced with a fire.
  - Camera shake respects reduced motion.
- Help screen: a short "Damage control" section saying what to do: go shallower, slow the flooding, fight fires, use the blow as a last resort. Keep the "All numbers are game values" line.

## 4. Build in two passes

**Pass 1:** the sim model, events and `sim.test.mjs` (all old tests plus new), with the before and after balance numbers. Write a 10-line checkpoint to `game/tmp/passG1.md`. **Pass 2:** panel, sound, outside view and help, then `browser-check.mjs`. Check the upright-phone layout (390×844) with the panel open and closed, because the panel already overlaps the boat there; fix the overlap.

**Ship collisions:** check the scripted winners and a surfaced or periscope-depth boat against traffic, hulks and settling wrecks. Existing play must not start colliding all the time. If it does, tune the drafts, not the missions.

## 5. Tests (extend `tests/sim.test.mjs`; keep every existing test green)

- **Flooding depth:** the same breach floods faster at 150 m than at 30 m, and pumps win shallow and lose deep.
- **Blow:** from 120 m with one flooded compartment, the blow surfaces the boat; with Fore breached it is slower.
- **Crush:** forcing depth past crush ends the mission "lose" with the collapse message.
- **Seabed:** grounding at Slow causes no breach; at Flank it breaches Fore and injures crew.
- **Ship collision:** the boat at periscope depth under a merchant's track collides, and the fin is damaged.
- **Torpedo:** a hit breaches the compartment matching its along-hull position, injures crew, and is survivable by a scripted responder (climb plus assign team) on Standard in at least 4 of 5 seeds. An idle player at 150 m after a hit is lost in at least 4 of 5.
- **Fire:** an unfought fire spreads smoke to a neighbour and injures crew; a fought one goes out.
- **Balance:** all scripted mission wins still at least 4 of 5 seeds; report the 40-seed win rates before and after for First Blood and Hunted. If they drop by more than about 10 points, tune damage values, not AI.
- `browser-check.mjs`: all modes pass. Add the damage panel to the screenshots, plus one shot of a flooding boat (bubbles) and one of a blow surfacing. Perf: 60 fps desktop, and phone mode not worse than Stage F.
