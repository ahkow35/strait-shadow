# Strait Shadow: design brief

This is a playable submarine game built from the Type 218SG cutaway page. It is written for the builder agent. The owner said: "be unreasonably ambitious, make it a game for me to play". All open choices below were made by the orchestrating session, and the owner opted out of design questions.

## 1. What it is

You command a Type 218SG-style submarine in a fictional patrol area of open sea. Formidable-class frigates and their Seahawk helicopters (the opposing force) hunt you.
- **Core loop:** listen, stay quiet, find a firing position, shoot, evade.
- **Win conditions:** each mission has its own (reach a point unseen, hit a target, survive).
- **Who and where:** the owner, on a MacBook in Safari or Chrome, and on an iPhone in Safari.
- **Both styles of play must work:** sneaking around and fighting are each viable.

## 2. Hard constraints (verbatim from the owner's standing rules; never break)

- **One self-contained HTML file.**
  - Three.js r128 comes from `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`.
  - Fonts come from Google Fonts only.
  - Everything else is inline. No other network calls.
- **No invented specifications.** Use class names only, hedged.
  - No weapon model names (no torpedo or missile type designations).
  - Any number shown on screen (speed, depth, range, tube count, reload time) is a game value. The help screen says once: "All numbers are game values, not real specifications."
  - No hull numbers and no flags or ensigns.
- **The on-screen note "Illustrative model. Interior layout is not public."** must appear on the title screen. It is fine to also add "Fictional scenario."
- **Original game.** Do not copy any existing game's name, art, UI, levels or music. "Strait Shadow" was checked as unused.
- **Damage is non-gory.**
  - A torpedo hit makes a water column and a shudder.
  - A ship that is "out of action" stops, lists slightly and trails smoke. Optionally it settles lower in the water over about 20 seconds.
  - No people are shown hurt.
  - The player's boat has hull integrity, shown as 3 segments. Losing all of it ends the mission with "Boat lost (simulated)", and the player can retry.
- **Smooth on laptop and phone.** 60 fps on a MacBook; playable on an iPhone. Cap particles, and use simple materials for distant ships.
- **Safari and iPhone details.**
  - Do not use Tab as a control.
  - Call `preventDefault` on Space and the arrow keys.
  - The canvas has `touch-action:none`.
  - Audio starts only after the first tap or click (the Start button).
  - `localStorage` access is wrapped in try/catch, and the game works without it.
  - Respect `prefers-reduced-motion` (no camera shake).
- **No secrets, no tracking, no analytics.**

## 3. Reuse from the existing page

Source: `src/type-218sg-cutaway.source.html`. It is read-only; copy code out of it, never edit it. It contains:
- **Graphics and materials:**
  - the sub hull model;
  - the sea surface shader with its plain-look fallback;
  - underwater fog and light rays, the seabed and rocks;
  - the `seaLit` materials;
  - the particle pool;
  - the Formidable-class frigate (`buildHunt`, rebuilt from photos);
  - the Seahawk helicopter with its rotor and dipping sonar;
  - the torpedo model.
- **Effects and audio:** the strike effect (`blast`/`splash`/`plume`) and the WebAudio sound helpers.

Leave out the crew figures, the interior cutaway and the divers: no interiors in the game.

**The scrolling problem.** The cutaway keeps the sub at the origin pointing +x, and scrolls the sea along x only (`S.travel`, `seaStep`, `waves`, `seaFloor.position.x`, the `uXb` bow-wave uniform). The game needs free 2D movement. Recommended approach:
- Simulate in world coordinates (metres, x/z plane, y up, sea surface at y=0, depth negative).
- Render with a floating origin at the player's sub.
- Feed the sea shader a 2D offset (`ox`,`oz`) instead of a 1D travel value.
- Rotate only the sub mesh by heading.
- The bow-wave uniform must take heading into account, or be replaced with a simpler wake.

## 4. Architecture (required)

**The simulation is pure JavaScript, kept separate from the drawing.**
- It lives in its own `<script id="sim">` block with no `THREE` and no DOM access.
- It exports `createSim({mission, seed, difficulty})`, returning an object with `step(dt, input)`, `state` and `events`.
- **Fixed timestep:** 1/30 s steps, accumulated from the frame time.
- **Seeded random:** use mulberry32 or similar. Never use `Math.random` inside the sim.
- **The renderer only reads `sim.state`.** It draws the state and plays the `events` (for example: torpedo launched, hit, ping, drop, contact gained).

**Input** is one object: `{rudder:-1..1, throttle:0..4, depthCmd:metres, fire:bool, decoy:bool, ping:bool, mast:bool, wire:-1..1, ...}`. Keyboard and touch both produce this object.

**Test hook:** with `?test=1`, set `window.__G = {sim, createSim, input, stepFrames(n)}`. In test mode, `requestAnimationFrame` is not used for the sim; tests drive the steps.

**Node tests** go in `game/tests/sim.test.mjs`. The test reads the HTML, extracts the `<script id="sim">` text, and evaluates it with `new Function`. Run it with `node game/tests/sim.test.mjs`. Required cases:
1. For each mission, a scripted "competent player" policy wins (with a fixed seed, and with 5 random seeds at least 4 of 5 wins).
2. An idle player (no input) loses, or fails the objective, in every combat mission within its time limit.
3. Every run reaches a win or lose state within its time limit. Fuzz 200 random-input runs per mission: no NaN in the state, no exception, always terminates.
4. Balance check: firing at the first contact can beat the helicopter's torpedo. Silent running plus going deep and slow reduces detection measurably (print the detection rates).
5. Print a short balance table: win rate per mission for the scripted player and for a random player.

## 5. Gameplay systems (game values, tune freely)

- **Movement.**
  - Throttle steps: All stop, Slow, Half, Full, Flank. Speed eases toward the set value. Rudder turn rate drops as speed drops.
  - Depth: surface, periscope depth, then down to a deep limit. Depth changes smoothly.
  - Seabed depth varies, with shoals: hitting the bottom damages the boat, and shallow water limits diving.
  - Optional light current.
- **Noise model.**
  - The boat's noise level depends on speed (it rises steeply above Half), cavitation (fast and shallow), firing (a loud spike), active pings (very loud), a raised mast (visible to radar and the eye at periscope depth) and Silent running (caps speed at Slow, cuts noise).
  - The HUD shows a clear "how loud am I" meter.
- **Thermal layer.** A layer at a seeded depth makes the frigate's hull sonar much worse at hearing a boat below it. The helicopter's dipping sonar can be lowered below the layer, which is the counterplay.
- **Detection.** Each sensor turns signal versus distance into a chance of contact per second.
  - Sensors: the frigate's hull sonar (passive and active), the dipping sonar, sonobuoys dropped by the helicopter, radar and eyes (for a mast or a surfaced boat).
  - Enemy knowledge goes through states, shown subtly to the player through enemy behaviour and audio cues:
    - unaware;
    - suspicious (a bearing only);
    - searching (an area);
    - tracking (a position);
    - attacking.
- **Enemy behaviour.**
  - **Frigate:** patrol, then sprint and drift, then active pinging when tracking.
    - It launches its helicopter.
    - When in range, it fires lightweight torpedoes from deck launchers.
    - It turns away from incoming torpedoes, and can drop or tow a decoy (game value).
  - **Helicopter:** flies a search pattern, dips sonar at points around the last known position, drops sonobuoys, and drops a homing torpedo (on a parachute, as already built) when tracking. It has limited fuel and returns to rearm.
- **Player sensors.**
  - **Passive sonar:** contacts appear as bearings with uncertainty. A bearing-over-time strip (a simple "waterfall": one line of dots per second) helps. Bearings narrow into an estimated position after a few legs of manoeuvring (bearing-only tracking, kept simple).
  - **Active ping:** gives an exact position for 10 s, but is very loud.
  - **Periscope or mast at periscope depth:** gives a visual and an exact position for surface ships, but risks radar detection.
- **Weapons.**
  - Heavyweight torpedoes: a game value of 6 ready, plus reloads with a reload timer.
  - Each torpedo is wire-guided while the wire is intact: the player can nudge its course.
  - It switches to self-homing near the target (an enable range set as a game value).
  - Torpedoes can be decoyed.
  - Countermeasures are noisemaker decoys (game value: 4).
- **Damage.**
  - Frigate: 2 hits put it out of action. Helicopter: cannot be hit.
  - Player: 3 hull segments. A hit removes 1 or 2, and a near miss from a decoyed torpedo removes 0. Hitting the seabed removes 1.

## 6. Missions (campaign, unlocked in order, saved in localStorage)

1. **Shakedown** (tutorial). Drive to waypoints, dive under the layer, use the periscope, and fire at a target hulk. On-screen coaching prompts. Cannot be lost except by grounding.
2. **Through the Gate.** Slip past one frigate's patrol line to an exit zone without being tracked for more than N seconds. Merchant ships in a shipping lane give noise cover: shadowing one masks you.
3. **First Blood.** Find and put one frigate out of action. Its helicopter is airborne.
4. **Hunted.** You start detected. Survive 6 minutes against one frigate and two helicopters, or put the frigate out of action. Decoys and the layer are essential.
5. **Strait Shadow** (final). Two frigates escort a high-value ship through the area: put the high-value ship out of action and escape.

Also include **Free Patrol**, an endless mode with escalating waves and a high score.

Each mission shows a briefing card (objective, plain tips) and a debrief card that shows:
- time;
- the stealth rating;
- hits;
- torpedoes used;
- 1 to 3 stars.

## 7. Screens and controls

- **Title screen:**
  - the game name;
  - the illustrative note;
  - Start;
  - a mission list with stars;
  - Free Patrol;
  - Controls/Help;
  - a difficulty setting (Relaxed/Standard/Hard);
  - a sound toggle.
- **Main 3D view.**
  - **Chase camera** behind and above the boat, with mouse or touch drag to orbit. It goes under water and on the surface, as in the cutaway.
  - **Tactical map** (key M, or a button): a full-screen 2D canvas overlay. It shows:
    - the player's track;
    - contact bearings and estimated positions with uncertainty ellipses;
    - torpedoes;
    - waypoints;
    - the layer depth readout;
    - the shoals.
  - The map pauses the game in Relaxed mode only.
  - **Periscope view** (key V, only at periscope depth): a circular mask view from the mast, with mast exposure risk.
- **HUD:**
  - compass and heading;
  - depth against the layer (a vertical gauge);
  - speed and throttle;
  - the noise meter;
  - hull integrity;
  - torpedoes and decoys;
  - a mini sonar bearing ring;
  - objective text;
  - an alert line ("Torpedo in the water, bearing 140!").
- **Keyboard:**

  | Key | Action |
  | --- | --- |
  | W/S or ↑/↓ | throttle |
  | A/D or ←/→ | rudder |
  | Q/E | depth up/down |
  | Space | fire |
  | X | decoy |
  | P | ping |
  | M | map |
  | V | periscope |
  | R | raise or lower the mast |
  | C | silent running |
  | , and . | steer the wire |
  | Esc | pause |
  | H | help |

- **Touch:** a left thumb pad for rudder and throttle, a right-side vertical depth slider, and buttons for Fire, Decoy, Ping, Map, Periscope and Silent. Buttons are at least 44 px and stay clear of the iPhone home bar (use `env(safe-area-inset-*)`).
- **Audio** (WebAudio, synthesised, nothing downloaded):
  - ambient sea;
  - own propeller (rises with speed);
  - sonar pings (ours and theirs);
  - helicopter rotor when close and shallow;
  - torpedo motor whine with a Doppler-like pitch;
  - launch;
  - explosion;
  - hull creak at depth;
  - an alarm for an incoming torpedo.
- **Pause menu:** Resume, Restart, Help, Quit to title.

## 8. Build order (deliver in stages; each stage stays playable and passes its tests)

1. **Stage A, a playable slice:**
   - free movement in the open sea (the floating-origin sea shader working);
   - one frigate and one helicopter with the detection states;
   - player torpedoes (homing, no wire yet);
   - enemy helicopter torpedoes;
   - win and lose;
   - the HUD basics;
   - keyboard and touch;
   - the sim tests passing.

   Report back after Stage A. Stop here and wait.
2. **Stage B:** wire guidance, decoys, the thermal layer, sonobuoys, frigate torpedoes, the tactical map, the bearing waterfall, the periscope.
3. **Stage C:** all missions, Free Patrol, briefing and debrief cards, stars and saving, difficulty, full audio, merchant ships, polish.

## 9. Files

- Write the game to `game/strait-shadow.html`. Tests go in `game/tests/`, and scratch files in `game/tmp/` (delete them before reporting).
- Do NOT touch `src/`, `site/` or `preview/`. Do not publish, push or deploy anything, and make no network calls except loading Three.js and fonts in the browser.

## 10. Checking in a browser (machine notes)

- **Headless Chrome only works with the sandbox off.**
  - Chrome path: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
  - Use `--headless=new --remote-debugging-port=<port> --user-data-dir=<absolute path under game/tmp> --window-size=1280,800`, with `--use-angle=swiftshader --enable-unsafe-swiftshader` for repeatable screenshots, or `--use-angle=metal` for real frame rate.
  - Serve the page locally with `python3 -m http.server <port> --bind 127.0.0.1`.
  - Drive the page from node 24 (it has a global `WebSocket`) through the DevTools protocol: `Runtime.evaluate` and `Page.captureScreenshot`.
- **Never** put `$(...)` or backticks in a sandbox-off Bash command. Put the logic in a script file and run the file.
- Do not start `sleep` longer than 10 s in a command.
- Before reporting each stage, take screenshots at 1280×800 and 500×900 and look at them yourself.

## 11. Report format (each stage)

Give:
- what works;
- the test output, verbatim;
- the screenshot paths;
- known gaps;
- any spec-like number you were unsure about.

Keep the report under 400 words.
