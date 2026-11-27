# Plan: Stage 1, the Duel (Archer-class submarine)

Source: the approved design, `tasks/2026-11-27-new-enemies-design.md`, sections 7 and 10. That document is the spec; this plan only orders the work and pins the terms the tests must check. No VISION.md in this repo, so there is no fit check.

**Proposed mode:** one build now, as two pull requests in sequence, each built by a background builder on its own branch, checked by the main session, and opened as a draft PR. Nothing is published to here.now until the owner says "go".

## PR 1: general rules, same stored state (structural only, no new behaviour)

PR #2 (merged 2026-11-27)

Revised after the plan critique (2026-11-27): the replay check fingerprints the whole game state, so PR 1 must not add or rename any stored field, or the "unchanged" test cannot be fair.
- **Sides are worked out, not stored:** one function says which side a ship, helicopter, buoy, torpedo or decoy is on, from what already exists (the neutral flag, the kind, the torpedo's existing numeric side). Every "a frigate means hostile" assumption calls it.
- **Pictures keyed by sensor group, not by side:** the existing shared enemy picture stays where it is and stays the surface opfor group's picture. The picture rules (detect, lure, decay, the hull-sonar check) take the picture to write as a parameter, plus a "shown" flag. Only the shown picture writes the shared statistics (first alert, highest level, time tracked) and emits alert messages. In stage 1 the Archer is its own group with its own picture on its ship record; in stage 2 the friendly side is one group with one picture per detected contact and no identity.
- **Torpedoes get an owner and a weapon type, worked out from the existing numeric side:** the player's heavy torpedo code is made general (owner, target set, wire holder) so a non-player owner can fire it later; the light-torpedo code is made general in what it hunts. With only today's owners, behaviour is identical.
- **Names the tests use stay** (the shared enemy picture, torpedo side, the input names), so the recorded inputs and scripted players are unchanged.
- **Acceptance test:** the previous game file is taken from git; for every mission over fixed seeds, the result, reason, end tick, score, statistics, the full sequence of emitted events and the final state fingerprint of the old and new files are byte-for-byte equal (events live outside the saved state, so they are compared separately). The test stays in the suite.
- Commit the design document and this plan in the same PR (docs only).

## PR 2: the Duel (built on PR 1 after it merges)

claimed-by: new-enemies duel build 2026-11-27

**Carried over from PR 1's review (must be fixed here):** a ship-owned torpedo's lock-on event does not say what it locked on to, so the screen says "locked on to you" for any lock (and must say nothing at all for the hidden Archer's torpedo until the player can hear it); the "fooled" message assumes the boat's own torpedo; the neutral-hit messages name the ship kind even if the captain has not identified it (word them by what the captain knows); mission win rules and the end-of-game summary cannot yet tell who sank a ship (a ship sunk by a weapon that is not the boat's must not count as the captain's success).

In this order, each with its sim checks:
1. **Submarine as a ship kind** with a depth, its own noise (the player's curve times 1.15), its own passive hull sonar (0.8 of a frigate's reach, layer and own-speed rules), and its own picture of the player. No active sonar. **It sees a raised mast only while it is itself at periscope depth** (its own periscope up), at the frigate's visual rule; below that it has only its ears.
2. **Player's sonar:** new class Submarine (letter S), identified through the existing steps; a rough above/below-the-layer note once classified.
3. **Browser checks:** the existing torpedo-settings checks count rows and choices (desktop and phone); update those counts and indices for the new row, keeping their layout and tap-size checks.
4. **Torpedo depth:** a Shallow / Deep setting with the existing torpedo settings, sent with each launch like the existing run-depth choice (so replays record it; not named `search`, which is already taken). Shallow is today's weapon unchanged against ships. **Deep (my call):** the torpedo searches at one depth chosen at launch from the contact's layer note: below the layer, the layer depth plus 30 m; above the layer, half the layer depth but no shallower than 20 m; no note yet, below the layer. Its seeker hears within 40 m above or below that depth and then homes in three dimensions. The firing computer suggests Deep on a Submarine contact.
5. **Archer behaviour:** creep, stop and listen, sprint; close and fire on a firm picture; evade a torpedo (turn, sprint, noisemaker, change depth across the layer). Its torpedo is the player's weapon, wire-corrected while its picture is fresh, homing on the loudest thing in its cone.
6. **Out of action** for a submarine: loses way, air plume at the surface, goes quiet; non-gory.
7. **The mission "Silent Hunt"** after Strait Shadow, with its stars, a scripted player entry, pass marks, random players, replay.
8. **Free Patrol:** from wave 3 a wave may be the Archer, at most one alive, its picture separate from the frigates'. The roll uses a new, fourth random stream used for nothing else (the existing secondary streams already drive traffic, listening and sea life), so every other mission stays byte-identical to PR 1 and Free Patrol stays identical until the first Archer wave. Archer torpedoes do not count towards the surface side's attack level or its torpedo cap.
9. **3D model** of the Archer from public photos, low and high detail, no numbers or flags.
10. **Help** lines for the Archer and the depth setting; a browser-check mode `stagek` with screenshots at desktop and phone size, and the `perf` mode with the Archer on screen.

## Definitions (what the tests check)

- **Detected first:** the Archer has detected the player when its picture reaches contact level (2) or better. The player has detected the Archer when a contact on it is on the player's plot (the existing listening rules create one). Whichever happens first wins that balance row.
- **Firm picture:** the picture's underlying level (not the displayed one) is fix (3) and its last fix is no more than 8 s old. A later, vaguer cue does not refresh it.
- **Hidden awareness:** while only the Archer hunts the player, the threat indicator, alert messages and the shared statistics never move, whatever the Archer's picture is. Leaks to close: the player's mast sighting applies to surface ships only (a submerged Archer is never "sighted"); Archer torpedoes never raise the surface attack level; a hidden group never emits the messages that announce a detection (mast seen, torpedo heard and evading, alert) and never cancels time compression. A test runs three Archer paths, hearing the player, seeing the raised mast, and hearing an incoming torpedo, plus an Archer attack, and asserts the indicator, those messages and the statistics stay quiet.
- **End-of-game summary (my call):** "Undetected" refers to the surface side as today; if the Archer ever reached contact level, the summary adds "Heard by the Archer".
- **Out of action (submarine):** hull points reach zero; it then stops, makes no further decisions, fires nothing, and its noise falls to zero within 20 s.
- **Unchanged (PR 1):** as in PR 1's acceptance test above.
- **Shallow band:** against ships, today's rules exactly: search depth 6 m, seeker hears within 15 m of it, a hit needs the torpedo shallower than 13 m, arming after 300 m of run, all unchanged.
- **Hitting a submarine (any torpedo, Shallow or Deep):** an armed torpedo hits a submarine only when it is inside the submarine's hull box in three dimensions: hull length by beam, and the hull's height centred on the submarine's depth. No radius larger than the hull is used. So a Shallow torpedo at 6 m passes harmlessly over a submarine at 40 m, and one on its deep transit run could hit a submarine it happens to pass through at that depth, which is fair.

## Shared records

Single player, one deterministic simulation step at a time: no two writers ever touch a record at the same moment. Within one step the order is fixed by the existing step function (player, damage, ships and helicopters, sea life, weapons, missiles and defences, then sensing, listening and picture decay). **That order is kept exactly**; new code slots into the existing phases (the Archer's decisions with the ships, its sensing with the existing sensing), so a detection still acts on the next step as today. The only stored record is the existing settings and stars in browser storage, written as today; a new mission adds a key in the same record, last write wins, as now.

## Bad input and half-finished work

- **Stale picture:** the Archer acts only on its own picture; when it decays (same timings as today's), it stops attacking and goes back to searching. It never reads the player's true position.
- **A launch with no depth choice** (old recorded inputs, the random players) is Shallow.
- **A mission ended mid-torpedo:** weapons in the water stop with the mission, as today.
- **Ship kinds the model code does not know** still fall back as today, but the submarine has its own model, so it never falls back to a frigate (a test asserts that).

## Plan critique

A fresh-context reviewer (Opus, high effort) critiqued this plan on 2026-11-27. Its six findings are folded in above: the fair "unchanged" test, the torpedo generalisation moved into PR 1, test names kept, pictures keyed by sensor group, the awareness leaks, and the undefined terms.

## Risk

High for PR 1 (it touches every mission's enemy logic and the torpedo code; a mistake changes all existing play), medium for PR 2 (new behaviour, additive on PR 1). Both get a cross-model review if the owner authorises one.

## Suggestions (not in scope; for the owner's approval only)

- A short recorded playthrough (GIF) of the duel for the owner to judge the feel before publishing.
- A sound cue for the Archer's sprint (its transient), so hearing it is audible as well as plotted.
