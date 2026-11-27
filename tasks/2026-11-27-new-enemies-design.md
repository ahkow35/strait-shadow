# New enemies: the Archer-class submarine and the Victory-class combat vessel

Design for three build stages of Strait Shadow (`game/strait-shadow.html`). Written 2026-11-27 from the owner's brainstorm answers. Lines marked **(my call)** are the main session's proposals, not the owner's words; the owner may override any of them.

## 1. Intent

The owner wants two new enemies for their Type 218SG-style boat, each with its own 3D model built up from public photos and its own role in the fight:

- **The Archer-class submarine**: a cat-and-mouse duel, submarine against submarine. Today every enemy is on the surface, so this is a new kind of fight, not a new hull on the old one.
- **The Victory-class Multi-Role Combat Vessel (MRCV)**: a drone mothership that hangs back and lets its drones find you. That is the opposite of the frigate, which closes in itself.

The point is variety and a new kind of tension: hearing a quiet submarine before it hears you, and slipping a drone screen to reach a ship that shrugs off missiles.

## 2. What the owner decided

**Missions (the owner's order):**
1. **Duel:** a mission of its own, the player against the Archer. Afterwards the Archer is added to Free Patrol.
2. **Convoy:** the Archer attacks a convoy of 5 merchant ships, 1 frigate and 1 MRCV. The player hunts the Archer. **The Archer wins if it sinks any one of those ships.**
3. **MRCV hunt:** a mission of its own, the MRCV **alone with its drones**. Afterwards the MRCV joins the frigates in Free Patrol, with its drones.

**The Archer:**
- **15% noisier** than the player's boat at the same speed and state. (An older design. A game value.)
- **No endurance model** for either boat: "the missions are single piece and not campaigns". No battery, no recharge trips.

**The convoy:**
- **Friendly fire happens on both sides:** the player's weapons can hit convoy ships, and the convoy's weapons can hit the player.
- **Friendly ships hunt the Archer once the convoy is threatened.** Before that they escort.

**The MRCV (from the owner's armament and defence notes):**
- Layered defences: a 360° radar, long- and short-range defence missiles, a guided 76 mm gun, two 30 mm guns, decoy launchers.
- **About 80% of the player's missiles are stopped.** Missiles act as a **diversion**; torpedoes do the sinking.
- Light torpedoes are its weapon against a submarine.

**Defaults the owner accepted ("defaults are fine"):**
- 3D models from public photos at the frigate's level of detail, with **no hull numbers and no flags**. The Archer is shown surfaced and submerged; the MRCV gets its two kinds of drone, small boats and small aircraft.
- **Anti-goals:** no psychic Archer (it never knows where you are without hearing or seeing you), and no drones that make the MRCV hunt feel unwinnable.

**Names:** class names may appear on screen, hedged like the existing ones ("Archer-class submarine", "Victory-class combat vessel"). Weapons stay generic: "torpedo", "light torpedo", "the ship's gun", "close-in gun", "the ship's missile defence". No weapon model names anywhere in the file.

## 3. Goals, non-goals, anti-goals

**Goals**
- A duel that is tense and winnable: you usually hear it first, but its silences make your solution go stale and one careless sprint gets you killed.
- A convoy mission that is a race: find a quiet boat before it reaches seven targets, without being mistaken for it.
- An MRCV hunt whose puzzle is the drone screen, not a missile slugfest.
- Both enemies joining Free Patrol so the endless mode gets new shapes.

**Non-goals**
- No battery, endurance or recharge model.
- No campaign, no persistence beyond the existing stars and best scores.
- No player-launched drones, no new player weapons. (The player's torpedo gains a depth setting; see stage 1.)
- No real ranges or specifications: the 120 km and 40 km figures in the owner's notes stay out. Every number is a game value.
- The MRCV's own anti-ship missile is left out: it cannot hit a submerged boat.

**Anti-goals (a failure even if it technically works)**
- An Archer that knows where you are without a detection it could plausibly have made.
- Drones that see everything, so that there is no way through.
- Friendly fire that feels like bad luck rather than a mistake you could have avoided.
- Any drop below 60 fps on a MacBook, or the phone becoming unplayable.

## 4. Hard constraints

Everything in `game/DESIGN.md` section 2 still holds:
- one self-contained HTML file with Three.js r128;
- class names hedged, no weapon model names, no hull numbers, flags or ensigns;
- the title-screen note "Illustrative model. Interior layout is not public." (with "Fictional scenario.");
- non-gory damage;
- 60 fps;
- the Safari and iPhone rules.

Also:
- The simulation stays deterministic: seeded, 1/30 s step. The replay check must pass for every new mission.
- Never delete existing tests. Every existing balance target and mission pass mark must still hold unless the stage says otherwise.
- The site files the offline app needs (`site/game/sw.js`, the manifest, the icons) are not touched by builders. The cache name in `sw.js` is bumped by the main session at publish time if needed.

## 5. Approaches

| Approach | Trade-off |
|---|---|
| **Three stages, each published before the next (chosen by the owner)** | 1 Duel, 2 Convoy, 3 MRCV. Each stage builds on the last, each is playable on its own, and smaller changes review better. |
| One big stage | Nothing to play until the end; one huge change to a single file is hard to review. |
| MRCV first | It reuses the frigate's surface code and lands faster, but the duel is the newer idea and the convoy still waits for the Archer. |

## 6. How the game works today (what these stages must change)

From a survey of the code (line numbers as of 2026-11-27):

- **One shared enemy picture.** `st.enemy` holds one estimate of where the player is. Every frigate, helicopter and buoy reads and writes it, and `detect()` assumes the hunted thing is the player.
- **No sides.** A ship is either `neutral` (merchant, fishing) or, implicitly, hostile (`kind==='frigate'`). That assumption sits in sensing, launch-heard, ping-heard, collisions, missile jamming, datums and `hitShip`.
- **The player's torpedo cannot reach depth.** It searches at 6 m, its seeker hears only within 15 m of that, and its hit test needs a target shallower than 13 m. The only depth choice is a deep run during transit.
- **No submarine contact class.** The player's sonar classes are Frigate, High-value ship, Merchant, Fishing boat, Hulk and Biologic. The class is the true kind once identification completes. There is no depth cue.
- **Enemy weapons home only on the player** (and the player's noisemakers). Light torpedoes come from the helicopter and the frigate's deck launchers.
- **The plot has hostile (amber), neutral (grey) and biologic (lilac) colours.** There is no friendly colour.
- **Free Patrol** adds frigates in waves (each with a helicopter), up to 3 alive.

## 7. Stage 1: the Duel

### 7.1 Two sides and per-side pictures (my call: the core structural change)

- Every ship and submarine gets a **side**:
  - `player`: the player's boat;
  - `opfor`: the frigates, helicopters and buoys of today's missions, and the Archer;
  - `friend`: the convoy ships in stage 2;
  - `neutral`: merchants and fishing boats outside the convoy.
- The single `st.enemy` picture becomes **one picture per hunting side per hunted submarine**:
  - Today's missions have exactly one: opfor hunting the player. They must behave exactly as before. The tests store no saved results, so the refactor first captures a baseline (each mission's results and replay hashes over fixed seeds) and then shows them unchanged.
  - In the duel, the Archer keeps **its own picture of the player**, built only from its own detections.
- **What the player sees (the owner's answer, 2026-11-27): the Archer's awareness is hidden.** The threat indicator, alert messages, the time-compression block, hints and the "tracked" counters keep following the opfor surface side's picture (frigates, helicopters, buoys, and in stage 3 the MRCV and its drones). The Archer's picture never shows; the player learns it was heard only from what the Archer does, such as a torpedo in the water. In the Duel, with no surface opfor, the indicator stays quiet; time compression is blocked only by a torpedo in the water.
- **No psychic Archer.** The Archer detects the player only through the same rules the frigates use for their hull sonar (`sense()`), scaled to a submarine's sonar, plus seeing a raised mast at periscope depth within visual range. Its picture decays exactly like today's.
- This is the only refactor in the stage, and it goes in **its own change before the feature** (the owner's rule: a structural refactor and a feature never share a diff). Its acceptance test: every existing mission's results and replay hashes are unchanged.

### 7.2 The Archer as a sound source and a listener

- **Its noise** follows the player's noise curve (speed, cavitation, silent running, firing spikes) multiplied by **1.15**.
- **How the player hears it:** through the existing `listen()` path, like a ship, using its noise. Below the temperature layer it is harder to hear, as ships are today.
- **How it hears the player:** a submarine hull sonar, the same form as the frigate's `sense()`:
  - its own speed deafens it;
  - the layer cuts across it when the two boats are on opposite sides of it.
  - **(my call)** Starting reach: 0.8 of a frigate's, because its sonar sits on a smaller boat. A game value, tuned by the balance targets in 7.7.
- **No active sonar for the Archer (my call).** A ping would give it away. It stays passive, which keeps the duel about listening.

### 7.3 How the Archer behaves (my call)

It runs a cycle that gives the duel its rhythm:
1. **Creep:** slow, quiet, moving towards where it last believed the player was, or along a search pattern.
2. **Stop and listen:** it drifts almost silent, and may go below the layer. The player's solution on it goes stale.
3. **Sprint:** a short fast leg to a new position. This is the player's best chance to hear it.

On a firm picture of the player it closes to firing range and fires. When it hears a torpedo coming, it:
- turns away;
- sprints;
- drops a noisemaker;
- changes depth across the layer.

It never fires without a detection.

### 7.4 Torpedoes at depth

**The player's torpedo gains a search depth setting** in the torpedo settings: *Shallow* (today's 6 m, for ships) and *Deep*.
- *Deep* searches a band around a chosen depth, for example 30 to 120 m, and its seeker and hit test become three-dimensional.
- **(my call)** The default is Shallow. When the selected contact is classified Submarine, the firing computer suggests Deep.
- A shallow-set torpedo does not catch a deep submarine.
- **Hit test:** a submarine is hit when the torpedo's 3D distance to its hull is within the hull's size.

**The Archer's torpedo** is the same weapon as the player's, with the same speed and reach (game values):
- It homes on the loudest thing in its cone: the player, the player's noisemakers, or, in stage 2, a convoy ship.
- It is wire-guided like the player's for its first part (my call), so the Archer can correct it while its picture of the player is fresh.
- The player defends with the existing noisemakers, evasion and the layer.

### 7.5 Telling a submarine apart

- **A new sonar class: Submarine** (plot letter S, hostile colour). It is identified through the same shaft-rate, blades and class steps as ships.
- **(my call)** Until identification completes, a slow submarine can pass for a fishing boat. Biologic is not affected.
- **A depth cue (my call):** once the contact is classified, a rough "above the layer / below the layer" note shows on the contact, from how the sound arrives. Exact depth is never shown.
- Sinking a submarine: non-gory, as with ships. It loses way, blows its tanks and goes quiet, with an "out of action" message. No wreck graphics are needed beyond a short air plume at the surface.

### 7.6 The Duel mission (my call on the details)

- **Name:** "Silent Hunt" (my call; checked for no clash only with the game's own mission names).
- **Setup:**
  - the player and the Archer start 7 to 10 km apart, with neither aware of the other;
  - layer depth random, as in other missions;
  - a little neutral traffic and sea life for noise;
  - no surface warships.
- **Win:** the Archer is out of action. **Lose:** the boat is lost.
- **Time limit:** 30 minutes. Running out of time is a loss ("The Archer slipped away").
- **Stars:** won; no damage; won with no more than 2 torpedoes fired.
- It goes after Strait Shadow in the mission list. Every mission is open from the start, as today.

### 7.7 Balance targets (tune game values to these; each within 10 points over 200 seeds)

| Row | Target |
|---|---|
| Both boats at 4 kn, same side of the layer, 5 km apart: who detects the other first | Player first in about 65% |
| A scripted hunter player (creeps, listens, fires on a Good solution with Deep set) | Wins the duel in about 70% of 40 seeds |
| An idle player (stays put at periscope depth with the mast down) | Does not win; the Archer finds and attacks them in at least 50% of games |
| A careless player (runs at 12 kn the whole time) | Detected first in at least 80% of games |
| One player torpedo, Deep, Good solution, Archer unaware | Hits about 60% |
| The same, Archer alert and evading with a noisemaker | Hits about 35% |

Also: 200 random players end cleanly; the replay check covers the new mission.

### 7.8 Free Patrol (end of stage 1)

- **(my call)** From wave 3, a wave may be the Archer instead of frigates, at most one Archer alive.
- It hunts with its own picture, independent of the frigates' picture. If both hunt you, they do not share information (no datalink between them, my call).
- An Archer sunk scores like a wave cleared, with the usual restock.

### 7.9 3D model: the Archer

- **Source:** built from public photos of the class, as the frigate was.
  - It is a modernised Swedish design: a long cylindrical hull, a sail with hydroplanes on it, a cruciform or X-shaped stern (check the photos; do not guess), and masts in the sail.
  - It is visibly smaller than the player's boat; the length comes from public sources, hedged as a game value.
- **No hull numbers, no flags.**
- **Low- and high-detail versions,** like the frigate.
- **Where it is seen:**
  - from the 3D camera when the player is near it (underwater, in the fog);
  - on the surface only if a mission puts it there.

  **(my call)** It does not surface in the Duel or the Convoy.
- **Its own torpedo uses the existing torpedo model.**

## 8. Stage 2: the Convoy

### 8.1 Mission (my call on the details)

- **Name:** "Convoy" (my call).
- **The convoy:** 5 merchants in two columns, the frigate and the MRCV escorting on the flanks. They steam across the area at a steady speed, about 12 kn (a game value).
- **The Archer** starts ahead of the convoy, lying in wait near its route.
- **The player** starts to one side with a rough bearing to the convoy, and the convoy's planned route is shown on the plot.
- **Win:** the Archer is out of action before it sinks a convoy ship, **or** the convoy leaves the area with no ship sunk.
- **Lose:**
  - a convoy ship is sunk, **by anyone**, the player included (my call: the convoy lost a ship either way);
  - or the boat is lost.
- **Stars:** won; no damage; no convoy ship damaged.

### 8.2 The friendly side

- The frigate, the MRCV, the frigate's helicopter and the MRCV's drones are **friend**.
  - They use the same sensors and weapons they use as enemies elsewhere.
  - **(my call, from the builder check)** Stage 2 builds the MRCV's model, its hull sonar and its drones' sensors and movement (9.1), because the friendly side needs them to search. Stage 3 adds its light torpedoes, missile defence and enemy role. When stage 3 arms the convoy's MRCV, stage 3 re-tunes the Convoy rows in 8.5 so they still hold.
- **Threatened:** the convoy counts as threatened the moment either happens:
  - the Archer fires;
  - a friendly sensor detects **any** submarine within **6 km** of any convoy ship (game value). **The owner's answer (2026-11-27): that includes the player.** Approaching the convoy is risky from the start, which is what makes identifying yourself matter.

  Before that they escort and do not ping. After it:
  - the frigate pings;
  - the helicopter dips;
  - the drones fan out.
- **They cannot tell the player from the Archer.**
  - The friendly side keeps **one picture per submarine it detects**, with no identity attached.
  - It attacks whatever it has a firm picture of inside its search area.
  - That includes the player.
- **Friendly search areas are drawn on the plot** in a new friendly colour (my call: soft blue). **The owner's answer (2026-11-27): they are live**: circles where the friendly side currently believes a submarine is, sized by its uncertainty. They show the player when the friendlies have picked them up, and can hint where the Archer is. Staying out of them is a skill.
  - The plot also shows friendly ships in that colour.
- **(my call) Identify yourself:** raising the mast at periscope depth within 2 km of a friendly ship marks you friendly for 90 s.
  - It costs you: the mast is visible to the Archer as it is to everyone.
  - Their weapons already in the water do not stop.

### 8.3 Friendly fire on both sides

- The player's torpedo homes on the loudest thing in its cone, as now, so it can take a merchant or an escort. Wire controls (Reject, Retarget) matter more.
  - A friendly hit counts as damage to the convoy.
  - Sinking one loses the mission.
- **Friendly light torpedoes** home on any submarine, including the player, and decoys work on them as today.
- **The player's missile** can lock a convoy ship, as it can lock a neutral today.

### 8.4 Archer behaviour in the convoy

- It works to reach a firing position on the convoy:
  - ahead and to one side;
  - creeping;
  - stopping to listen.
- It fires at a convoy ship once in reach, then evades.
- **Its fire is what makes the convoy threatened**, if nothing has before.
- **It also reacts to the player:** if its picture of the player is firm and the player is closer than its target, it may attack the player first (my call).

### 8.5 Balance targets

| Row | Target |
|---|---|
| No player (idle) | The Archer sinks a convoy ship in every seed: the existing rule that an idle player loses every mission holds here too (my call, from the builder check; the Archer gets enough time and torpedoes in its ambush) |
| Scripted hunter player | Wins in about 60% of 40 seeds |
| A player who fires a torpedo, Shallow, into the convoy's middle | Hits a convoy ship (friendly fire) in at least 50% |
| A player who stays inside a friendly search area for 3 minutes after the convoy is threatened, without identifying themselves | Is attacked by a friendly in at least 50% |
| The same player after identifying themselves | Is attacked by a friendly in at most 10% (a torpedo already in the water may still come) |

### 8.6 3D models in stage 2

**The MRCV:**
- built from public photos of *Victory* (launched 21 October 2025);
- about 150 m long, so visibly bigger than the frigate;
- a single composite mast with four flat radar panels;
- a flight deck and hangar aft;
- a stern ramp.

**Its drones:**
- a small unmanned surface boat, about 16 m (confirmed for the class);
- a small vertical take-off air drone, which the renderings appear to show.

Both are kept simple. No hull numbers and no flags on any of them.

**Merchant ships** reuse the existing merchant models.

## 9. Stage 3: the MRCV as an enemy

### 9.1 Its drones (my call on the numbers)

**Surface drones**, 3 in a line 2 to 4 km ahead of the MRCV:
- They listen with a hull sonar at 0.6 of a frigate's reach.
- Each pings once every 60 to 90 s, staggered.
- They are slow and cannot be sunk.
- **There is always a gap:** they keep at least 1.5 km apart.

**Air drones**, 2:
- They sweep the surface around the MRCV out to about 5 km.
- They spot a raised mast or periscope within 1.5 km (the helicopter's visual rule, at shorter reach).
- They do not drop weapons, and they cannot be shot.

**What a detection does:** it updates the opfor picture. The MRCV or nearby frigates then act on it.

### 9.2 Its weapons and defences

**Light torpedoes:**
- It fires on a firm picture within 2.5 km, a longer reach than the frigate's 700 m deck launchers.
- **Only the ship fires.** Drones never attack.
- It holds at most 2 in the water.

**Hit points:** 6, so three torpedo hits. The frigate has 4.

**Missile defence** (all generic names on screen):
- its radar sees a low missile from about 1.5 times as far as the frigate's;
- it reacts faster;
- it has two firing channels against the frigate's one;
- it never runs out;
- its guided gun has about twice the frigate gun's chance;
- a close-in gun covers the last 1 km;
- it has the same decoy clouds.

**Missile defence targets:**

| Row | Target |
|---|---|
| One sea-skimmer, MRCV alert | Stopped about 80% |
| Two-missile salvo, MRCV alert | At least one through about 35% |
| One pop-up | Stopped about 85% |

**Missiles as a diversion:**
- While it is defending against missiles, from the first sight until 20 s after the last ends, it turns bow-on to the threat and moves fast.
- Its own hull sonar is therefore deafened by its speed (existing rule).
- Its drones keep working.
- This is measurable: a test row shows the player's chance of closing to 3 km unseen with and without a missile salvo fired first.

### 9.3 The MRCV hunt mission (my call on the details)

- **Name:** "Mothership".
- The MRCV is alone with its drones, patrolling an area. It stays back and lets the drones find you. On a detection it turns towards it and fires light torpedoes within reach.
- **Win:** the MRCV is out of action. **Lose:** the boat is lost, or time runs out (30 minutes).
- **Stars:** won; no damage; never detected by a drone.

**Balance targets:**

| Row | Target |
|---|---|
| A scripted sneak player (slow, deep, mast down, threading the gap between surface drones) | Reaches 3 km of the MRCV undetected in at least 60% of games (guards against "unwinnable") |
| A scripted hunter player | Wins in about 55% of 40 seeds |
| A player who fires only missiles | Wins in at most 15% |

### 9.4 Free Patrol (end of stage 3)

- **(my call)** From wave 4, a wave may bring the MRCV with its drones instead of a frigate, with at most one MRCV alive.
- Its detections feed the same opfor picture as the frigates.

## 10. Testing (every stage)

- **Sim checks in `game/tests/sim.test.mjs`**, following the existing `check()` groups:
  - the new rules;
  - the balance rows above;
  - a scripted player entry in `PLAYERS` for each new mission;
  - pass marks;
  - 200 random players ending cleanly;
  - replay for each new mission.
- **A browser-check mode per stage:** `stagek`, `stagel`, `stagem`. Each takes screenshots of the new models and missions at desktop and phone size, and checks frame rate in the `perf` mode with the new models on screen.
- **Unchanged:** every existing check passes unless a stage note explains a change.

## 11. Left to the builder

- All exact game values not given above, tuned to the targets.
- Model geometry from the photos, inside the detail and frame-rate budget.
- How the per-side pictures are stored, as long as today's missions behave identically.
- Wording of briefs, Help lines and messages, in the game's existing plain style. Help gets one line per new enemy and for the depth setting.
- The phone layout of any new control (the Shallow/Deep setting sits with the existing torpedo settings).

## 12. Builder check

A builder-check reviewer read this document on 2026-11-27. The owner answered three questions (sections 7.1, 8.2: the Archer's awareness is hidden, any submarine near the convoy triggers the hunt, the search areas are live). The main session settled three more (sections 7.6, 7.1, 8.2, 8.5: missions all open, a baseline before the refactor, the MRCV's sensors and drones in stage 2, an idle player always loses the Convoy). No open questions remain.
