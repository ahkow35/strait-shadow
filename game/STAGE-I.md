# Stage I: firing solution and torpedo attack

The owner asked on 2026-11-25 to improve the firing solution and the submarine's attack options. Their research notes are summarised in `RESEARCH-ATTACK.md`, which also lists the sources. Their choices:
- **"Both"**: the computer fits a solution, the player sharpens it by manoeuvring, and the player can correct it by hand.
- **Two stages.** This is Stage I (torpedo). Stage J (anti-ship missile, a "what if") gets its own brief later.

A cross-family review of the options (Codex, round 1) raised 8 gaps. Each is closed below, marked **[R1-n]**.

Read `DESIGN.md` first; its hard constraints still apply. Also read `STAGE-G.md` and `STAGE-H.md`.
- Every number here is a **game value**, tunable for play, never a real specification.
- No weapon model names: the game says "heavy torpedo".
- The Help screen states that these are illustrative game mechanics; the research supports the ideas in general, not this boat's exact equipment.

## 1. One honest contact estimate [R1-1]

Today `listen()` (around line 1486) builds `k.range` and `k.err` from the target's true distance, so the estimate partly reads the truth. Stage I replaces this with a **fire-control (FC) estimate built only from what the boat observed**.

- **Observation log per track.** Each entry records:
  - time;
  - the boat's own position;
  - the measured bearing (the noisy `mb` as heard today);
  - its error σ, a game value growing with range, as today;
  - its kind: `bearing`, `ping` (range and bearing, σ about 5% of range) or `scope` (range and bearing, plus a course estimate with σ about 15°, because the aspect is seen).

  Keep at most 60 entries. In the window, keep the newest bearings spaced at least 2 s apart, and keep fixes ahead of bearings.
- **Fixes are sampled once, never re-read from truth [R2-4].** Today a ping sets `seenT` ahead (`V.pingHold`), and while it lasts every `listen()` reads the ship's *current* true position (`exact`). In Stage I:
  - A ping writes **exactly one** `ping` observation per echoing ship, at the echo time.
  - The periscope writes one `scope` observation per ship **every 5 s** while the mast is up and the ship is in sight. Repeated looks are real observations, so this is allowed.
  - `seenT` may still govern how long the *marker of that fix* stays on screen, but the marker sits at the logged fix position, not the ship's live position.
  - The test counts `ping` entries per ship per ping (must be 1) and checks that no observation is written in a tick without a ping, a look or a heard bearing.
- **The solver** is a pure function `solveTrack(obs, opts)`. It must take nothing else from the state: no ship objects, no true positions. It fits straight-line target motion (position at a reference time, course, speed) to the observations in a sliding window (default 180 s), using bounded Gauss-Newton from a few starting guesses, with speed limited to 0 … the fastest ship's game speed. It returns the state estimate and its covariance (the inverse of JᵀJ scaled by σ²).
- **Unobservable directions [R2-2].**
  - **Covariance.** Compute it by eigen-decomposition of JᵀJ. An eigenvalue below a floor (game value; the builder sets it so that a straight own-ship leg against a steady target always trips it) marks that direction as **unobservable**. The covariance is then built only from the observable directions, and every field that depends on an unobservable direction is reported as **unknown**, not as a large finite σ.
  - **Display:** "range ?" (with the bearing still shown), "course ?" and "speed ?".
  - **Grade:** any unknown field caps the grade at **Poor**.
  - **A target slower than 1 knot**, such as the tutorial hulk, has course "—". Its course σ is ignored for grading, and range alone can reach Good.
  - **No fallback:** never use a pseudo-inverse or regularisation that produces a finite σ for an unobservable direction.
- **Every reader uses the FC estimate:** the plot ellipse, the contact strip ("range about N ± M"), the tabletop selected-contact strip, the mission coach lines and the scripted test players. The old truth-derived `k.range`, `k.err` and `k.par` go.
- The AI frigates and the helicopter keep their own knowledge model, unchanged.

## 2. Solution quality that cannot lie [R1-2]

Quality comes from the **covariance and freshness, not the neatness of the fit**:

| Grade | Rule (game values) |
|---|---|
| None | fewer than 4 bearings in the window, or no bearing for 60 s |
| Poor | otherwise, when it is neither Fair nor Good |
| Fair | range σ / range < 0.30 and course σ < 35° |
| Good | range σ / range < 0.15 and course σ < 20° and the newest observation is < 15 s old and the fit is consistent (mean normalised residual² < 3) |

- **A straight leg cannot give a good solution.** On one straight own-ship leg, bearings-only geometry leaves range and course poorly determined (an ill-conditioned covariance), so the grade stays Poor or Fair. One own-ship zig of 30° or more, followed by about 60 s of bearings, should reach Good. A ping or a periscope fix can jump to Good on position but **not** on course or speed: a single fix fixes position only.
- **A target turn.** When the residuals of the newest 20 s are inconsistent (mean normalised residual² > 4), the FC flags **"target may have turned"**, drops the grade to at most Poor, and restarts the window from the observations after the suspected turn. The player can also press **Restart fit**.
- **Stale and damaged sensors.** Fewer or noisier bearings, from a damaged bow sonar, high speed or contact loss, simply raise σ or age the solution. No separate rule is needed.

## 3. Manual correction ("Both") [R1-4]

- On a selected contact the player can **set course and/or speed by hand**, with steps of 10° and 1 knot. The values held become **constraints on the fit** (the solver fits the rest), so the next automatic update keeps them.
- A held value shows a **"hand" mark**. It stays until the player presses **Auto**, which clears both. If the newest bearings disagree with the held value (residual² > 4), the panel says **"your solution disagrees with new bearings"**, and the held value is kept.
- **Restart fit** clears the window but keeps held values.

**Screens.**
- **Desktop:** a Solution box in the contact panel showing the grade, range ± σ, course ± σ, speed ± σ, the held-value steppers, Auto and Restart fit. It also has a small strip of **bearing residuals** (measured minus predicted bearing, over the window): dots that line up when the solution fits.
- **Tabletop:** tapping the selected-contact strip expands it into the same Solution card, with − / + buttons of at least 44 px. **No plot drag ever edits a solution or steers a torpedo; a plot drag always orders own course** (Stage H).
- **Plot:** the solution's predicted track is drawn as a short arrow from the estimated position, labelled with the grade. A target with no solution keeps today's bearing line.

## 4. Firing and presets [R1-6]

**Aim.**
- **With a selected target graded Poor or better,** Fire sets the torpedo's initial gyro course to the lead-angle intercept of the **FC-predicted** target track. It never uses the true track.
- **With nothing selected, or grade None,** the torpedo fires along the bow, as today. That keeps the snap shot available, which Hunted needs.

**Presets.** These come from a **Settings** pop-up next to Fire. Defaults let the player just fire, and the choices persist for the mission.

| Preset | Options | Effect |
|---|---|---|
| Launch | **Swim-out** (default) / Impulse | Swim-out leaves the tube at 4 m/s and needs 12 s to reach run speed. Frigates hear it only within 1.5 km. Impulse is today's launch: fast, and the frigates hear it and turn away, as now. |
| Enable | **Auto** / Short / Long | **Reach (game value):** the torpedo's run is about 2,600 m (`V.torp.speed` 26 m/s × `life` 100 s, less the acceleration and the swim-out ramp). The builder computes `reach` from the actual values. Enable must leave at least 35% of `reach` for acquisition and one re-attack, so **max enable = 0.65 × reach**. Auto = clamp(FC range − 600 m, 400 m, max enable); with no solution, today's 250 m. Short is 400 m; Long is max enable. **Out of reach:** if the FC range minus 1 σ is more than `reach`, Fire still works but says "target is beyond torpedo reach". [R2-1] |
| Run depth | **Shallow** / Deep | Deep runs at 40 m (quieter: frigates hear it at half the range), then starts climbing early enough to reach search depth by enable, at `V.torp.climb`. If the enable distance is too short for the climb, the torpedo climbs as soon as it leaves the tube, and the Settings line says "too close for a deep run". The seeker can acquire only within 15 m of search depth. The hit rule stays as today (`t.depth < 13`), so a ship that the torpedo meets while still on its deep leg (before the climb) is passed under. |
| Search | **Straight** / Snake / Circle | Applies after enable while nothing is acquired. Snake sweeps ±30° and advances more slowly. Circle turns back over the predicted target area once (a re-attack). Once a homing torpedo loses or overshoots its target, it searches again once using the chosen pattern; Straight means no second search. |

- **Enable versus arming.** Today a torpedo can hit before its seeker enables. Stage I adds **arming at 300 m of run**: before that a contact passes harmlessly.
- There is no search-depth floor or ceiling preset: the game has no submerged targets, so it would be a control that does nothing.

## 5. The torpedo after launch: selection, seeker view, retarget, reject [R1-3]

- **Selected weapon.** The player chooses which wired torpedo receives commands: tap it on the plot, or use **Next torpedo**. The default is the newest wired one. Selection is no longer limited to the `run` phase. A selected torpedo whose wire is cut deselects with the message "wire cut: weapon on its own".
- **Seeker view**, while it is on the wire: a small panel showing what the torpedo hears relative to its nose, its lock state, and a cue for each lock, either **"moving, machinery"** or **"stationary, no machinery"**. The second is how a noisemaker sounds; it is a game choice and the only clue the player gets.
- **Commands while wired:**
  - **Steer L / R**: in the run and search phases only, as today.
  - **Retarget [R2-3]:** pick another contact. It is refused (with a message) if that contact has grade None or is no longer tracked. When accepted:
    - **Transit.** The torpedo enters a `transit` phase, drops its lock, turns towards the contact's FC-predicted position and **does not acquire anything** while in transit. Transit ends when it is within 700 m of that point, after 30 s, or at max enable, whichever comes first.
    - **Search.** It then searches with acquisition preferring the eligible ship nearest the predicted point. Ships on its rejected list, and the ship it was retargeted away from, are excluded for this search.
    - It still has to acquire with its seeker.
  - **Reject lock:** in the `home` or `bait` phase. The torpedo adds the locked object to its rejected list (at most 2 entries; a third rejection drops the oldest entry) and searches again. Rejecting a real ship throws the chance away. A new noisemaker can still fool it at today's wired rate (0.1). There is **no blanket immunity to decoys**.
- **Wire strain is unchanged [R1-5].** A hard turn or excess speed still cuts every wire. While a wire is live, the course line and the order message keep warning. After a cut, every wire command shows as unavailable, never as silently ignored. The Help text says: "Turning to sharpen a solution can cost you the wire."

## 5b. State lifecycle [R2-5]

| State | Created | Cleared or changed |
|---|---|---|
| Observation log | per track, on its first bearing | **Restart fit** clears it. **Track dropped** (today's 150 s rule) deletes it with the track. **Ship out of action**: the FC estimate freezes and shows "out of action"; there are no new observations; it cannot be retargeted. |
| Held course/speed | player sets them on a track | **Auto** clears them. They are deleted with the track. A re-acquired ship starts a new track with no held values. |
| Selected weapon | player choice, or the newest wired torpedo | It falls back to the newest still-wired torpedo, or none, when the selected one has its **wire cut, hits, expires, or is otherwise removed**. This is checked every tick, so no command can address a removed id. |
| Rejected list | per torpedo | Kept after a wire cut; gone with the torpedo. |
| Presets | Settings; defaults at mission start | Kept for the mission and **snapshotted into each torpedo at launch**: changing Settings never alters a running weapon. **Restart / Play again** resets presets to defaults. |

Restart and Play again already build a fresh simulation; all of the state above lives inside it, and its interface state (open Solution card, seeker view, Settings) is reset with it.

## 6. Things that stay as they are

- Enemy AI, decoys, damage and the helicopter are unchanged, except that a Swim-out launch is heard as described in the presets table.
- The "no torpedoes left" loss checks (around lines 913 and 970) are unchanged in Stage I; Stage J must extend them to missiles [R1-7].
- Stage J (missile) will define: how good a solution must be to fire (an acceptable range σ), which escorts can intercept and their limits, and the launch datum. The datum is the capsule's surface position at launch, treated by the escorts as an **area to search**, never as a fix.

## 7. Tests and checks [R1-8]

**Sim (`tests/sim.test.mjs`):**
- Replace the Stage F fingerprint test with **replay determinism**: the same seed and the same full input sequence (including solution edits, presets and weapon commands) give an identical state hash at the end, for every mission, 3 seeds each.
- **No truth leak:** log observations, then move the true target with no new observations. `solveTrack` must give an identical output. Also assert that `solveTrack` is only ever called with the log.
- **Geometry:**
  - straight own leg and steady target: the grade stays below Good after 180 s;
  - after a 40° zig plus 90 s: Good, with range error < 15% and course error < 20°;
  - the target turns 60°: "may have turned" is flagged within 30 s;
  - a single ping: position Good, course not Good.
- **Manual:** a held course survives 30 automatic updates; Auto clears it.
- **Weapon:**
  - depth [R2-6, R3-1]: shallow and deep runs fired at one target 1,200 m away with Short enable both hit (the climb from 40 m takes only about 150 m of run), and their logged depth profiles differ. Separately, with Long enable a ship crossing the track at about 800 m of run (armed, still on the deep leg, depth ≥ 30 m) is passed under, while a shallow run on the same geometry hits;
  - an Auto enable never exceeds max enable, and a 5 km solution fires with the "beyond torpedo reach" message;
  - Retarget away from a near ship A towards B: no reacquisition of A during transit;
  - removing the selected torpedo (hit, expiry) falls back to the next wired one;
  - arming: no hit inside 300 m;
  - Reject on a decoy lock goes back to search;
  - Retarget acquires a second ship placed in its search cone;
  - wire cut: commands are refused with an event.
- **Scripted players** (they may use only what is on screen) learn to zig before firing and to aim from the solution. Report wins over 40 seeds before and after. **Do not weaken the enemies to restore old rates.** The pass marks for competent play are: Shakedown and Through the Gate 100%, First Blood ≥ 85%, Hunted ≥ 70%, Strait Shadow ≥ 80%. If one misses, report it rather than tune silently. Hunted must still allow a defensive snap shot.
- **Solver budget:** at most 1 ms of solver time per simulated second, with 6 tracks, measured at 4× time.

**Browser (`tests/browser-check.mjs`):**
- desktop, live, edge and the tabletop (stageh) modes still pass;
- new checks on desktop and tabletop: the Solution card, held values and Auto, Settings, Swim-out, Next torpedo, Retarget, Reject, and the seeker view;
- tap targets of at least 40 px, no overlaps, and no console errors;
- perf mode: about 60 fps at 844×390 with the Solution card and the seeker view open.

**Screenshots** `i01` onwards: Solution card Poor and then Good (desktop and tabletop), the "may have turned" flag, Settings, the seeker view on a decoy lock, and Reject.

## Build rules

- Edit only `strait-shadow.html`, `tests/*` and `tmp/`. Do not publish.
- Save a rollback copy first: `preview/game-stageH-live.html`.
- Work in checkpoints, and run the sim tests after each:
  1. observation log and solver;
  2. grade and manual correction;
  3. aim and presets;
  4. weapon commands;
  5. UI;
  6. scripted players and balance.
- In the final report, list every game value chosen and every departure from this brief.
