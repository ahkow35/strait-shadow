# Stage J: anti-ship missile ("what if")

The owner asked on 2026-11-25 for more attack options, and chose two stages. Stage I (firing solution, torpedo presets, wire control) is live. This is Stage J: an anti-ship missile fired from a torpedo tube.

**Revision 2 (2026-11-26), from the owner's notes:**
- Each mission starts with 2 missiles and 6 torpedoes in the tubes.
- Swapping a tube's weapon takes time, and the tube cannot fire meanwhile.
- Damage depends on where the missile hits: 2 to 4 missiles to put a frigate out.
- The frigate defends itself in two layers: a ship-launched anti-air missile, then a fast-firing gun at close range.
- The missile can make a pop-up attack.
- Revision 3, the same day: the frigate also uses decoys (chaff), jamming and turning away (section 5, layer 3).
- Revision 4, the same day: Codex cross-review round 1 raised 15 gaps. Each fix is marked **[J1-n]**. Round 2 raised 4 more, marked **[J2-n]**.

The research is in `RESEARCH-ATTACK.md`, sections "Anti-ship missile from a torpedo tube" and "Missile flight and the frigate's defences".

**Names: the hard constraint wins.**
- The owner's notes name real systems: the frigate's class, its defence missiles and its gun, and the submarine missile.
- The game names none of them. In the game they are: "anti-ship missile" (short form "missile"), "frigate", "the ship's missile defence" and "the ship's gun".
- The real systems inspired the mechanics only. Every number below is a game value, never a real specification.

**What the research supports, and what it does not.**
- **Supported:**
  - The missile leaves in a capsule that rises to the surface before the booster fires.
  - It needs a good target position.
  - It cruises low over the sea. At the end it either skims the sea or pops up and dives on the target.
  - The real frigate class carries ship-launched anti-air missiles and a fast-firing 76 mm gun.
- **Inference:** a launch is conspicuous and gives the escorts a place to search.
- **Not established [J1-15]:** the frigate class is reported to carry an electronic support suite, which listens for radar. That does not show it can jam. In the game, jamming is a game choice.
- **Game design choices, with no source:**
  - every defence chance and range;
  - the damage by hit location;
  - the swap time;
  - the launch limits.

  Help must not claim realism for them.

Read `DESIGN.md` first; its hard constraints still apply. Also read `STAGE-I.md`, whose fire-control rules this stage builds on. The look must be original: a generic capsule, booster flame and missile body, copying no real missile or other game.

## 1. Why a player would choose it

The torpedo's reach is about 2,600 m (Stage I). The missile is for a target the player can hear but cannot reach. The trade:

| | Heavy torpedo | Anti-ship missile |
|---|---|---|
| Reach | about 2,600 m | 1,500 m to 9,000 m |
| After launch | wire control, seeker view, Retarget, Reject | **none**: fire and forget |
| Can be stopped | by a noisemaker | by the ship's missile defence and gun, or drawn off by chaff and jamming (section 5) |
| Gives the boat away | Impulse launch is heard; Swim-out barely | **always**: the launch point becomes a search area (section 6) |
| Can hit the wrong ship | rarely | yes: its seeker takes the ship nearest the aim point, merchants included |
| Damage to a frigate | 2 points of 4: two torpedoes put it out, as today | 1 or 2 points by where it hits: 2 to 4 missiles (section 4b) |

## 2. Stock, tubes and swapping

**At the start of every mission:**
- the 8 tubes hold **6 torpedoes and 2 missiles**;
- the rack holds **4 torpedoes and 2 missiles**.

The rack contents are my call: the owner set only the tube load. With the rack, that is 14 weapons; today there are 12.

**Each tube has its own state:** `torpedo`, `missile`, `empty` or `swapping`, plus a progress timer. **[J1-9]** `p.tubes` as a single count goes. Every reader switches to typed counts (torpedo tubes ready, missile tubes ready, rack torpedoes, rack missiles):
- the torpedo fire path (~1804) needs a ready **torpedo** tube;
- the "shoot" coach line (~4863) and the fire refusal (~5664) read torpedo tubes;
- the pip renderer (~4895–4898) draws each tube from its own state, not as a filled prefix;
- the practice refill (~976) refills when no **torpedo** is left in the tubes or the rack, whatever missiles remain;
- the loss checks and the Free Patrol rules below.

**One handling team [J1-8].** The torpedo room works on one tube at a time and never interrupts a job in progress. When it picks its next job, a reload of an empty tube goes before any waiting swap; otherwise jobs go in the order given.
- **Rack stock is reserved when a job is queued**, so two swap orders cannot both count on the last missile. A cancel releases the reservation exactly once.
- **Funded jobs only [J2-3].** A job is *funded* when the weapon it needs is in the rack and not reserved by another job. The team picks only among funded jobs: an empty-tube reload first, otherwise in the order given.
  - An empty-tube reload that is not funded waits. It is looked at again each time the team picks a job, and it never takes a weapon another job has reserved.
  - A swap is funded at the moment it is queued, or it is refused then.
- A weapon inside a `swapping` tube still counts as carried, for the loss checks and the rack read-out.

| Job | Time (game value) | Rule |
|---|---|---|
| Reload an empty tube | 22 s (today's `V.reload`) | It loads the chosen type, or torpedo by default, if the rack has one. |
| Swap a loaded tube | 60 s | The weapon goes back to the rack and the other type comes out. The tube **cannot fire** while it is `swapping`. |
| Cancel a swap | at once, from the **Cancel swap** button that the Tubes row shows while a swap is queued or running (desktop and tabletop) [J1-8] | A queued swap is dropped. A running swap leaves the tube with its old weapon if it is in the first half of the time; otherwise the old weapon is in the rack, the tube is `empty`, and it is reloaded as normal. |

- **Silent running** pauses the queue, as it pauses reloads today.
- **A flooded Torpedo room** jams the queue, as it jams reloads today.
- A swap is refused if the rack has none of the wanted type: "No missile in the rack." or "No torpedo in the rack."
- **Restock and rewards [J1-10]:**
  - **Free Patrol** keeps both of today's rules: one torpedo after a while when every tube and the rack are empty (~1129), and +2 rack torpedoes per kill, capped at the rack's torpedo size (~1122).
  - **Strait Shadow** has no restock, as today. It is lost when every weapon is gone (section 7).
- **Practice (Shakedown):** practice rounds never run dry, as today. This covers torpedoes only.

**Tube display.** Each pip shows its type by **shape**, not only colour: a missile pip has a square top. A swapping pip fills with progress. The rack read-out shows both counts, for example "Rack 4 T · 2 M".

## 3. Launch

**Choosing the weapon.**
- **Desktop:** `Y` switches the next shot between Torpedo and Missile. `Y` is unused today; I checked it against the key table. The Settings panel (`I`) gains a **Tubes** row with "Swap a tube to Missile" and "Swap a tube to Torpedo". Each picks the lowest loaded tube of the other type.
- **Tabletop:** no new strip button, because the strip already has 12. The SET pop-up gains a **Weapon: Torpedo / Missile** row and the same **Tubes** swap row. The Fire button reads "Fire M" while Missile is chosen.
- The choice stays until changed. When no missile tube is loaded and ready, Fire with Missile chosen gives "No missile tube is ready."
- With Torpedo chosen and only missile tubes loaded, Fire gives "Only missiles are loaded." [J1-9]

**Missile presets.** These sit in Settings and are snapshotted into each missile at launch, like the torpedo presets.

| Preset | Options |
|---|---|
| Attack | **Sea-skim** (default) / Pop-up (section 4) |

**The launch gate.** Fire with Missile chosen is refused, with the message below, unless every check passes:

| Check | Rule (game values) | Refusal message |
|---|---|---|
| Target | selected, a surface ship, not out of action | "Select a ship first." |
| Solution | grade **Fair or better** (held values count; Stage I grading is unchanged) | "Solution too poor for a missile." |
| Range | FC range from 1,500 m to 9,000 m | "Too close for a missile." / "Beyond missile reach." |
| Depth | no deeper than 60 m | "Too deep to launch a missile." |
| Speed | no faster than 6 knots | "Too fast to launch a missile." |
| Tube | a `missile` tube is loaded and the fire gap has passed | "No missile tube is ready." |

**Salvo.** Two missiles can go one fire gap apart (today's 2.5 s), at the same or different targets. This is how a player overwhelms the defences.

**No truth leak (Stage I rule).** The aim point is the track's solution `k.sol`, predicted to the missile's estimated arrival time with `intercept()` at the missile's speed. **[J1-6]** The `lag` argument (in metres) is missile speed × (launch depth ÷ 8 m/s + 3 s), to cover the capsule rise and the boost. The true ship position is never read for aiming.

**Wire torpedoes [J1-12].** A missile launch does not change the selected wired torpedo (`p.wireId`, `pickWeapon()`), and it never cuts a wire.

## 4. Flight

| Phase | What happens (game values) | Ends |
|---|---|---|
| Capsule | rises from the launch point at 8 m/s, under water and unseen | it reaches the surface |
| Boost | the booster fires; the missile climbs and turns towards the aim point | after 3 s |
| Cruise | flies at 240 m/s and 30 m height on a straight line to the aim point; no orders, no wire | 6,000 m short of the aim point |
| Seeker on | its radar looks ±20° either side of its course, out to 6,000 m. It locks the surface ship nearest the aim point in that cone, any kind except ships already out of action, and steers for it. A frigate, the high-value ship, a merchant or a fishing boat can all be locked. | it locks, or it passes the aim point by 1,000 m with no lock: "Missile missed." |
| Terminal: **Sea-skim** | drops to 5 m for the last 4,000 m and strikes the hull side | a hit, a kill by the defences, or a miss |
| Terminal: **Pop-up** | at **6,000 m** [J2-2] from the locked ship, or from the aim point if it has not locked yet [J1-5], it climbs to 600 m, then dives steeply onto its lock from 1,500 m. A lock made during the climb is steered to. | a hit, a kill by the defences, or a miss |

If the locked ship goes out of action first, the missile locks again as in "Seeker on".

**Pop-up versus sea-skim.** Real pop-ups climb far higher; 600 m is scaled to this map. "In the pop-up" means from the start of the climb to impact [J1-5].
- **Pop-up:** the climb starts at 6,000 m, where a frigate sees it at once (9,000 m visibility), while a sea-skimmer is first seen at 4,000 m [J2-2]. Its missile defence gets more time. The steep dive is harder for the gun, and it hits the middle of the ship more often (section 4b).
- **Sea-skim:** it stays hidden longer but meets the gun head-on, and its hits spread along the hull.

**Other cases.**
- **Clearing or changing the target** does nothing; the missile has no wire.
- **A hit on a neutral** follows the existing neutral rules. The Hard-mode loss text becomes "a weapon struck a neutral ship".
- **Mission end** removes missiles in flight with the simulation.
- **Time compression** stays allowed. The render layer must still show every hit and kill.

## 4b. Damage by where it hits

The game's damage points move from 2 to **4 per frigate and high-value ship**, and the hurt thresholds scale with them:
- a torpedo does 2 points, so two torpedoes still put a frigate out, exactly as today;
- neutrals' hp doubles likewise.

**Where the hit falls [J1-6].** Terminal guidance steers at the locked ship's centre. A missile reaching within 25 m of that centre hits. The hit point along the hull is then **ship-relative**, not taken from the old aim point:
- offset along the hull = seeded normal draw, σ = L × (0.12 + 0.23 × |cos θ|), where L is the hull length and θ is the angle between the missile's course and the ship's heading;
- so a beam-on approach spreads little, and an end-on approach spreads a lot;
- a pop-up dive halves σ;
- an offset beyond the bow or stern is clamped to that end: a missile homing on the ship does not pass it by.

| Where | Share of the hull length | Damage | Side effect |
|---|---|---|---|
| Fore | front 30% | 1 point | the gun is out of action |
| Amidships | middle 40% | 2 points | none |
| Aft | rear 30% | 1 point | none |

- **Pop-up** dives have half the scatter, so they hit amidships more often.
- **The hurt message [J1-13]** (~5433) no longer counts shots, because damage now comes in 1 or 2 points. It says "Hit! The frigate is damaged." above half its points, and "…is badly damaged." at half or below.
- **Both branches of `hitShip`** (ships and neutrals, ~2004–2018) take the damage amount.
- **Counts:** two amidships hits put a frigate out, and four end hits do. Mixed hits fall between, and torpedoes and missiles add together.
- **The ship's missile defence is never knocked out by a hit.** This is a game choice, so that one lucky fore hit does not make the rest easy.
- **Message:** "Missile hit amidships." (or "forward", "aft"). A damaged gun is reported as "Their gun is out of action."

## 5. The frigate's defences (game design choice; no source for any number)

A frigate's existing torpedo noisemakers (4 per ship) are separate and unchanged.

**Seeing the missile [J1-2].** A frigate's radar sees a missile within these ranges of that frigate:
- **4,000 m** while it flies low (boost at the surface, cruise, sea-skim);
- **9,000 m** while it is in the pop-up climb or dive.

The 3 s boost stays low, so it is **not** seen from afar. Once a frigate has seen a missile, it keeps track of it until the missile ends.

**Reacting.** A frigate reacts **4 s** after first seeing a missile if the alert level is 2 or higher at that moment, and **8 s** if lower.

**When the launch alarm takes effect [J1-2].** The datum's raise to level 2 (section 6) takes effect **15 s after the breach**: the time, as a game value, for the sighting to reach the ships. A short shot at an unalerted ship can therefore meet it unaware, while a slow follow-up meets it alert.

**Layer 1: the ship's missile defence.**
- Any frigate, not out of action, that sees the missile and is within 6,000 m of it may fire.
- **One fire channel per frigate [J1-3]:** each frigate has at most one defence missile in the air at a time, across all incoming missiles. Each takes 4 s to arrive, and the next may follow when the first one resolves. The channel engages the nearest incoming missile not already decoyed.
- Each kills with chance **0.20** (starting value [J1-1, J2-1]).
- It cannot engage inside **1,200 m** of the frigate firing.
- Each frigate carries **8** defence missiles; when they are gone, this layer is gone.
- Two incoming missiles split a frigate's attention: it engages the nearest first. That is how a salvo saturates it.

**Layer 2: the ship's gun.**
- Only the locked ship, plus any frigate within 1,000 m of the missile's path, uses its gun.
- It fires from **3,000 m down to 300 m**, while the gun is working (a fore hit stops it).
- Each second it fires, it kills with chance **0.02** against a low missile and **0.01** against one in the pop-up (starting values [J1-1, J2-1]).

**Rules for both layers.**
- Merchants, fishing boats and the helicopter never defend.
- **Random numbers** come from the sim's seeded generator, drawn only while a missile is in flight.
- **Balance targets [J1-1, J1-4].** The chances above and in layer 3 are **starting values**. Tune only the chances (not the ranges or times) until every target below is met within ±10 points, measured over 200 seeds, and report the actual figures.
- **Fixed scenario for every row** (a sim test fixture):
  - the boat at 30 m and 4 knots, firing from 5,000 m;
  - the target frigate on a steady course at 8 knots, crossing the line of fire at 90°;
  - the track's solution exact: the log is built from noiseless observations, so the scenario measures the defences, not the aim;
  - full magazines and rockets;
  - a salvo means two missiles one fire gap apart.

  For the escorted row, use the Strait Shadow convoy: the high-value ship with its two frigates at their stations.
- **"Alert" rows:** the enemy level is set to 2 before launch. **"Unaware" rows:** level 0, and the datum's alarm is still subject to its 15 s delay.
- **Outcome of each missile**, exactly one:
  - **hit** (on any ship; report a hit on a ship other than the target separately);
  - **shot down by a defence missile**;
  - **shot down by the gun**;
  - **decoyed**: it ended at a cloud with no re-lock;
  - **missed**: no lock or overshoot, whether or not jamming was on; report jammed misses separately.

  "Stopped" means every outcome except a hit. A decoyed missile that re-locks and hits counts as a hit.

| Case | Target: share of missiles stopped |
|---|---|
| One sea-skimmer, one frigate, unaware | about 35% [J2-1] |
| One sea-skimmer, one frigate, alert (level 2 or higher) | about 50% |
| One pop-up, one frigate, alert | about 55%, with more amidships hits than sea-skim |
| Two-missile salvo, one frigate, alert | at least one gets through in about 65% of salvos |
| One missile against an escorted high-value ship (two frigates nearby) | about 70% |

**Layer 3: soft kill (decoys, jamming, turning).** Revision 3 (2026-11-26), on the owner's ask.

Sources say these work by giving the seeker something more attractive than the ship, not by destroying the missile. In real sea fights they have stopped more missiles than shooting has.

The real frigate class carries trainable decoy launchers that fire radar or infrared decoys, plus an electronic support suite. This game's missile has a radar seeker, so **only radar decoys (chaff) and jamming matter**. Infrared decoys are left out.

- **Decoy rockets: 10 per frigate** (game value).
  - **Distraction:** when a frigate first sees an incoming missile that has **not yet locked**, it fires 2 rockets. They burst into a **chaff cloud** 600 to 900 m off its beam, on the side away from the missile.
    - **A cloud [J1-7]** is a point target with a 150 m radius. It is compared with ships by its centre, and ships by their centre.
    - At "Seeker on" (section 4), the missile chooses among the ships **and the clouds** in its cone, the centre nearest its aim point first.
    - A cloud drifts with the wind (game value 3 m/s) and lasts 40 s.
    - A poor aim point is more likely to fall nearer a cloud, which rewards a good solution.
  - **Seduction:** when a missile **locked on that frigate** comes within 3,000 m, the frigate fires 2 rockets. They burst 300 m off its beam, on the side away from the missile [J1-7].
    - The lock moves to the cloud with chance **0.20**.
    - That chance is **0.12** if the missile is in the pop-up (climb or dive) when the rockets burst, because the cloud sits low under the steep look-down. This is a game choice. With the pop-up starting at 6,000 m, a pop-up missile is always in it at 3,000 m [J1-5, J2-2].
    - These chances are starting values [J1-1].
  - **Re-lock:** a missile locked on a cloud flies to its centre. When it comes within 150 m of the centre, or the cloud expires, it looks once more, ±20° out to 2,000 m. If a ship is in that cone, it locks on it (any kind, neutrals included). This is how a decoyed missile can still hit, sometimes a different ship. If no ship is there, it falls into the sea: "Missile decoyed." [J1-7]
  - A frigate fires only while it has rockets. Each salvo is 2 rockets, at most one salvo per incoming missile per kind, at least 4 s apart.
- **Jamming:** a frigate with alert level 2 or higher jams. A missile within 6,000 m of a jamming frigate locks only within **3,000 m** instead of 6,000 m, so it searches later and a poor aim point misses more often. There is no jamming below level 2.
- **Turning bow-on:** a frigate that sees an incoming missile turns its bow towards it, at its normal turn rate, while that missile flies. The hit point then falls along the hull more often (section 4b), so more hits land fore or aft, for 1 point.
  - **Priority [J1-11]:** evading a torpedo it knows of comes first, as today (~2267–2287). Then comes the bow-on turn, then today's flight, escort station and patrol or search.
  - With two missiles seen, it faces the nearest.
  - When no seen missile is left, the bow-on turn simply ends and today's AI chooses again. That may be searching, not going back to station, because the launch alarm leaves the alert at level 2. The brief does not promise a return to station.

**How the layers work together.**
- Distraction decoys go out at first sight. The missile defence fires while the missile is out of reach. Seduction decoys and the gun work at the same time at close range.
- A missile already sent to a cloud is no longer engaged by the hard-kill layers, so it costs no defence missiles.
- The second missile of a salvo can be drawn to the first one's cloud. That is a real cost of firing them close together, and the trade the player must judge.
- **The section 5 balance targets now count every layer together.** Report, for each target, what share was stopped by defence missiles, by the gun and by decoys.

**On screen and in sound.**
- "They fired decoys." / "Missile decoyed." / "Missile locked again: [contact name]."
- "Missile engaged by their missile defence." / "…by their gun."
- "Missile shot down."
- In 3D: a small defence missile's trail rising from the frigate, gun flashes and tracer at short range, and a flash where the missile dies.
- Non-gory, with no crew shown.

## 6. Giving the boat away

- **At the surface breach**, call `detect('area', sx, sz, launchX, launchZ)` once:
  - (sx, sz) is the nearest frigate;
  - (launchX, launchZ) is the **launch point**, sampled at launch, not the boat's current position.

  The escorts then hold an area to search with today's 260 m error, never a fix. **The call is made 15 s after the breach** [J1-2], with the launch point sampled at launch, so the alert reaches level 2 only then.
- The booster gives the boat a noise spike at the breach, like an Impulse launch.
- **Silent running ends at the breach [J1-12].** The sim emits `silentOff`, and the input layer sets its silent flag to false on that event. Otherwise the per-step copy of `inp.silent` (~1753) would switch it straight back on. The replay records the input as it was sent, so it stays deterministic. The player may switch silent running on again.
- **Two existing rules, kept on purpose:**
  - Line ~1515 keeps a tighter estimate the escorts already hold. A fresh fix is not replaced by the datum.
  - `lure()` lets a noisemaker dropped after a launch pull the search off the datum. That is a legitimate counter.
- **The alert also feeds the defences:** a missile fired more than about 15 s after an earlier one meets alert ships. A salvo is best fired together, not 30 s apart.
- **Message:** "Missile away. They will search where it broke the surface."

## 7. Rules that change elsewhere

**Loss checks.**
- The checks are at ~1038 (First Blood) and ~1095 (Strait Shadow).
- They count every loaded tube, including a weapon inside a `swapping` tube [J1-8], both rack counts, own torpedoes in the water and missiles in flight.
- The text becomes "Mission failed: no weapons left."

**Other rules.**
- Restock (~1129) and the kill reward (~1122) stay Free Patrol only, as today [J1-10].
- Practice (~976) refills when no torpedo is left, whatever missiles remain [J1-9].
- `hitShip` takes a damage amount: torpedo 2, missile 1 or 2.

**Texts.**
- Key table line ~712: "8 tubes. Each mission starts with 6 torpedoes and 2 anti-ship missiles in the tubes, and 4 torpedoes and 2 missiles in the rack (game values)."
- Add the key `Y`, and the Settings Tubes row.
- The fire refusal at ~5664 gains the missile messages.

**Coach lines.**
- In every combat mission, when the selected target is beyond torpedo reach and graded Fair or better: "Beyond torpedo reach: choose Missile (Y, or SET) and fire. It cannot be steered, and they will know where you launched."
- The first time a missile is shot down: "Two missiles together are harder to stop."

**Help.**
- A **Missile** bullet, covering the reach trade, the gate, swapping, pop-up versus sea-skim, the defences (including chaff and jamming), and the datum.
- The illustrative note gains, word for word: "Anti-ship missiles are a 'what if': reports say this class of boat may be able to fire them from its torpedo tubes, but it is not confirmed. The ship's defences and decoys, the damage by hit location, the swap time and the alarm a launch raises are game choices."

## 7b. State lifecycle

| State | Created | Cleared or changed |
|---|---|---|
| Tube states and rack counts | at mission start (section 2) | by firing, reloading, swapping and restock; a fresh sim on Restart or Play again |
| Handling queue | the player orders a swap; an empty tube adds a reload | the job finishes or is cancelled. It pauses during silent running and jams with a flooded Torpedo room. |
| Weapon choice and Attack preset | the player; defaults Torpedo and Sea-skim | kept for the mission; reset on Restart or Play again. The preset is snapshotted into each missile. |
| A missile in flight | at launch, with its aim point taken from `k.sol` at that moment | removed on hit, kill or miss, or when the sim ends. It never reads the track again. |
| Defence magazine and gun state | per frigate, at spawn (8 missiles, gun working) | spent by firing; the gun is lost to a fore hit; gone with the ship |
| Decoy rockets | per frigate, at spawn (10) | 2 per salvo; gone with the ship |
| A chaff cloud | when a decoy salvo bursts | drifts with the wind and is removed after 40 s, even if a missile is flying at it (that missile then flies on and looks once more) |
| A frigate's turn bow-on | when it first sees an incoming missile | ends when no missile it has seen is in flight; today's AI then chooses again, which may mean searching rather than going back to station [J2-4] |
| The datum | once, at the surface breach | follows the existing enemy-knowledge rules |

## 8. Screens

- **Plot:**
  - a dashed line from the launch point to the aim point, and a moving missile mark;
  - a small ring at the launch point labelled "datum";
  - the line ends on the locked ship once the seeker locks;
  - defence fire is drawn as short lines from the frigate;
  - chaff clouds are drawn as small hazy marks, fading over their 40 s.
- **3D:**
  - spray where the capsule breaks the surface;
  - a booster flame and smoke trail, with particles capped like the wakes;
  - the pop-up climb and dive;
  - the defence trails and gun tracer;
  - decoy rockets bursting into a glittering cloud, using few particles;
  - flashes on hits and kills.
- **Tabletop:** the SET rows and the "Fire M" label only. Every tap target stays at least 40 px, with no overlap (Stage H rules).

## 9. Tests and checks

The tube load changes in every mission, so the Stage I end states will no longer match. Two things guard against regressions instead: replay determinism and the win-rate pass marks.

**Sim (`tests/sim.test.mjs`):**
- **Replay determinism:** the 18-game replay gains missile and swap orders in its random hand (weapon switch, swaps, cancels, missile fire, refused launches), and still ends identically. **[J1-14]** Across the replay set there must be at least 6 accepted missile launches, and at least one of each outcome: hit, shot down, decoyed, missed. Report the counts. Replay equality proves only that the game repeats itself; the rule checks below prove the behaviour.
- **Torpedo damage unchanged:** two torpedo hits put a frigate out, and one leaves it hurt, as before.
- **Missile rules**, each a named check:
  - every gate refusal, each with its own message;
  - no truth leak [J1-14]: two launches with **identical observation logs but different true target positions before firing** give an identical aim point; a later true move does not change it either;
  - the aim lag includes the capsule rise and the boost [J1-6];
  - swap: the tube cannot fire during the 60 s, the rack counts move by one each way, a cancel in the first half keeps the weapon, silent running pauses the swap, and a flooded Torpedo room jams it;
  - damage: the fore, amidships and aft points; a fore hit stops the gun; 2 amidships or 4 end hits put a frigate out;
  - the seeker takes a merchant nearest a deliberately wrong aim point, through the neutral rules;
  - the defences: report each **balance target** in section 5 with its measured value over 200 seeds, within ±10 points of the target;
  - a defence magazine empties after 8 shots;
  - **decoys:**
    - a distraction cloud nearer the aim point than the ship is chosen at "Seeker on";
    - the seduction rate matches its **configured, tuned** values for a low missile and one in the pop-up (measured over 200 seeds, within ±5 points), not the starting values [J2-1]; a seduced missile that re-locks and hits is scored as a hit;
    - a decoyed missile re-locks a ship in its cone after the cloud;
    - the rockets run out after 5 salvos;
    - the second missile of a close salvo can take the first one's cloud;
  - **jamming:** the lock range is 3,000 m near a frigate at alert level 2 or higher, and 6,000 m below that;
  - **turning:** a frigate turns bow-on to a missile it sees, still evades a known torpedo first, faces the nearest of two missiles, and stops turning bow-on when no seen missile is left;
  - **queue [J1-8]:** a reload of an empty tube goes before a waiting swap but never interrupts a running one; two swap orders for the last rack missile give one accepted and one refused; a cancel releases the reservation once; the last weapon inside a swapping tube does not trigger the loss;
  - **typed readiness [J1-9]:** with only missile tubes loaded, torpedo fire is refused with "Only missiles are loaded.", and the torpedo coach line does not show;
  - **fire channel [J1-3]:** one frigate never has two defence missiles in the air at once;
  - **alarm delay [J1-2]:** the enemy level rises 15 s after the breach, not at it. A frigate that first sees a missile before the alarm keeps its 8 s reaction time, even if the alarm comes before that reaction ends;
  - **first sighting [J2-2]:** on the same shot, a pop-up is first seen at about 6,000 m from the frigate and a sea-skimmer at about 4,000 m;
  - **unfunded reload [J2-3]:** a waiting swap holds the last rack torpedo, then another tube fires; that tube's reload waits and does not take the reserved torpedo, the swap runs, and the queue never stalls;
  - **silent running [J1-12]:** after a breach, silent running stays off on the following steps until the player switches it on again;
  - **hit location [J1-6]:** over 200 seeds, beam-on hits are mostly amidships, end-on hits spread along the hull, pop-up hits are more often amidships than sea-skim hits, and no hit point falls outside the hull;
  - **hurt message [J1-13]:** after one torpedo hit, the message says "damaged", with no shot count;
  - the datum: after the breach the enemy level is at least 2, and the estimate sits near the **launch** point, not where the boat moved to (1 km away); a fresh fix is not replaced;
  - the loss rule: with every torpedo spent and a missile in flight, the mission waits for the missile to resolve.
- **Win rates:** the existing pass marks hold:
  - Shakedown and Through the Gate 100%;
  - First Blood ≥ 85%;
  - Hunted ≥ 70%. Its scripted player never fires, so **keep the separate direct snap-shot check** and run it with the new 6-torpedo load [J1-14];
  - Strait Shadow ≥ 80%.

  The scripted players need not use missiles. **Do not weaken the enemies.** Report every mission before and after.

**Browser (`tests/browser-check.mjs`):**
- desktop, live, edge and stageh still pass;
- new checks:
  - `Y` and the SET weapon row;
  - a swap with its pip progress;
  - "Fire M";
  - a refused launch with its message;
  - a launch drawing the line, the datum ring and the flight, then an engagement;
- tap targets of at least 40 px, no overlaps, no console errors;
- **perf:** about 60 fps at 844×390 during a two-missile salvo with defence fire and two chaff clouds on screen.

**Screenshots** `j01` onwards:
- the SET rows (tabletop);
- a swap in progress;
- a refused launch;
- the plot during a salvo with the datum ring;
- the 3D view: breach, sea-skim, pop-up climb, defence fire, a chaff cloud, and a hit or shoot-down.

## Build rules

- Edit only `strait-shadow.html`, `tests/*` and `tmp/`. Do not publish.
- **The main session saves the rollback copy `preview/game-stageI-live.html` before the build starts [J1-15].** The builder does not touch `preview/`, as `DESIGN.md` says.
- Work in checkpoints, and run the sim tests after each:
  1. tubes, rack and the handling queue;
  2. weapon choice and launch gate;
  3. flight, seeker and pop-up;
  4. damage points and hit location;
  5. defences (missile defence, gun, decoys, jamming, turning) and their balance targets;
  6. datum, loss rules and texts;
  7. UI and 3D;
  8. tests and win rates.
- Delete `tmp/` at the end, and leave no other temporary files behind.
- In the final report, list every game value chosen, the measured balance figures, and every departure from this brief.

## Revision 5 (2026-11-27): the missile behaves like a newer two-way-datalink missile

Designer's decisions. On screen it is still only "anti-ship missile"; no model name anywhere in the game. Every number is a game value; range stays 1.5-9 km.

Also decided the same day (sent to the builder separately): the launch gate drops one solution grade (Fair to the grade below); distraction chaff bursts between the frigate and the missile with a tunable chance of taking the lock; jamming onto escorts and the title-screen class names stay.

1. **Mid-flight updates.** While a missile flies and has not yet hit or ended, the player may send it the current fire-control solution for its target ("Update missile"). Allowed only when the boat is at periscope depth with a mast raised (the existing mast and its detection rules apply, so it is a real risk). The update replaces the aim point (same intercept and lag rules as at launch). If the seeker has already locked, an update clears the lock and the seeker searches again from the new aim point. Refused with its own words when no mast is up, the boat is too deep, no missile is in flight, or there is no solution. It is an order in the replay log. The aim still comes only from the solution, never from the ship's true position.
2. **Resists jamming.** An alert frigate's jamming cuts the lock range much less: starting value 5,000 m instead of 3,000 m (tunable).
3. **Dog-leg route.** A Settings choice, Direct or Dog-leg. Dog-leg flies via one waypoint offset to the side (starting value 2,500 m off the straight line, at mid-course, side chosen by the player or automatically away from the boat), so it takes longer. The breach and its 15 s alarm are unchanged: the flame is still seen where the boat is. The gain: a missile whose final leg arrives more than 60 degrees off the bearing from that frigate to the breach point gets the unaware reaction time even against an alert frigate (the defences were looking the wrong way). The dog-leg must still leave room for the seeker-on point; if the target is too close for a dog-leg, refuse with its own words or fly direct and say so.
4. **Lower skimming.** Skim height 5 m to 3 m; the frigate's radar sees a low missile at 3,200 m instead of 4,000 m (tunable).

Balance (main session's call, the designer may override): the five balance targets of section 5 stay as they are. These features change how the missile is used more than how strong it is, so retune defence values (missile-defence kill chance, gun chances, chaff chances) to bring every row back within 10 points. Add two printed rows, not targets: alert frigate with a dog-leg, and alert frigate with one mid-flight update after the target turns. Report the escorted row's hits on the high-value ship versus escorts after the jamming change.

Revision 5a (2026-11-27, the user's call on the main session's recommendation): an alert frigate caught looking the wrong way by a dog-leg now reacts in 6 s (`react[2]`), between alert (4 s) and unaware (8 s). Alert frigate, from 6,000 m: dog-leg stopped 36.5% (was 30%), direct 52.5%. The five target rows are unchanged. Distraction chaff and the update are left as they were.
