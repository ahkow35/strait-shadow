# Stage H: phone "tabletop" mode

The owner asked on 2026-11-23: on a phone the game should be a tabletop-style game, played on a top-down plot with a control strip, instead of the 3D view with many floating panels. They showed a screenshot of another iOS submarine game for the *genre* (a top-down plot with range rings and a console strip along the bottom).

**Do not copy that game's look.** Avoid its brass dials, its stopwatch time dial, its stacked chevron throttle, its skeuomorphic metal console, its layout proportions and its colours. Build from this game's own map and visual language: dark teal, the yellow accent, Barlow-style display type, and the existing map drawing. This is an original game.

Read `DESIGN.md` (hard constraints still apply) and `STAGE-G.md` (the damage model) first.

## Owner's decisions (asked and answered)

1. **Steering: drag a course line.** Touch the plot and drag. A line from the boat shows the new course, and on release the boat turns onto it using the normal turning physics. This replaces the rudder buttons in this mode.
2. **3D: a small inset window.** A live 3D picture of the boat sits in one corner of the plot. Tapping it goes to full-screen 3D (the current phone-sideways layout), where a "Plot" button returns to the table.
3. **Phones only.** iPad and desktop keep the current 3D-first layout.

## Orchestrator's calls (easy to change; list them in the report)

**Detection.**
- Tabletop mode is on when `(pointer:coarse)` matches and `min(screen.width, screen.height) < 600`. This covers phones but not iPads.
- `?table=1` / `?table=0` override it for testing.
- The upright card from the last update stays: tabletop is laid out for sideways phones, and upright still shows "Turn your phone sideways" (with "Play upright anyway", which gets a usable stacked version of the same table).

**The plot fills the screen.** It is the existing tactical map drawing, made the main view:
- centred on the boat, north up;
- range rings with labels;
- contacts drawn as sonar knows them (bearing lines, uncertainty ellipses, classification once known; never more than the sim's contact knowledge);
- torpedo tracks, the wire, decoys and sonobuoys;
- shoals and shrimp beds;
- mission markers.

Give it a tabletop finish: a subtle chart-paper texture and grid, drawn on a canvas. Keep it light enough for 60 fps.

**Plot gestures.**
- One-finger drag sets the course.
- A tap on a contact selects it.
- Pinch zooms. The + and − buttons on the left also zoom.
- Two-finger drag pans, and a Centre button re-centres.
- Show the ordered heading as a dashed line and the current heading as a solid line.

**Course autopilot (render or control layer only; do not change the sim).**
- Each tick it turns the ordered heading into `inp.rudder` (proportional, clamped, and easing near the target).
- The wire-strain rule still applies: hard turns at speed snap wires. The course line warns ("hard turn will cut the wire") while a wire is live.

**Top bar (one thin row):**
- the mission name and clock (tap to expand the objective card);
- heading, depth and speed figures;
- the compact damage cutaway from Stage G (tap opens the damage panel);
- a noise-level bar;
- a ≡ menu button.

**Right edge: the depth column.**
- The existing depth gauge, with its layer and crush lines.
- Shallower and Deeper step buttons above and below it.
- Dragging on the gauge orders a depth.

**Left edge:** the + / − zoom buttons, Centre, and the 3D inset (bottom-left, about 160×100 CSS px).

**Bottom strip, one row of large buttons:**
- Speed: a stepper showing the throttle name, with − and +;
- Silent;
- Decoy (with count);
- Ping;
- Scope;
- 3D;
- Fire (yellow).

Wire L/R appear in the strip only while a wire-guided torpedo is running.

**Selected-contact strip,** above the bottom strip, only when a contact is selected:
- its classification, or "Unknown";
- bearing;
- the estimated range with its ± figure;
- course and speed only if the sim's contact knowledge has them.

Never show a hull number, flag or real ship name.

**≡ menu:**
- Pause;
- time compression (1×/2×/4×);
- Mast;
- the damage panel;
- the sound waterfall (the bearings display);
- Help;
- Sound;
- Quit.

**3D inset.**
- Render the same scene into a scissored viewport of the same renderer: no second WebGL context.
- Lower pixel ratio, and update every other frame if needed.
- It shows bubbles, damage and surfacing.
- Tapping it switches to full 3D.

**Messages and alerts** (torpedo warnings, coach lines) appear as one line at the top of the plot, and must never cover the boat.

**The Help screen** gets a short "Tabletop controls" section in tabletop mode.

## Must hold

- Desktop and iPad behaviour is unchanged: `browser-check.mjs` desktop, live and edge modes pass as before.
- The sim is untouched and `node tests/sim.test.mjs` is fully green.
- Performance: about 60 fps at 844×390 and 932×430 in tabletop mode with the inset on (run the perf mode).
- **New browser checks for tabletop mode** at 844×390 and 932×430, with touch emulation and `?table=1`:
  - the table shows;
  - a drag sets the ordered heading and the boat turns to within 5° of it;
  - pinch or the buttons change zoom;
  - tapping a contact selects it and fills the strip;
  - Fire, Decoy, Ping and Silent work;
  - the depth step buttons order a depth;
  - the inset tap goes to 3D and Plot returns;
  - the ≡ menu opens and closes;
  - no element overlaps another (check the bounding boxes of the top bar, strip, depth column, left buttons, inset and contact strip);
  - every tap target is at least 40 CSS px;
  - no console errors.
- **Screenshots** (look at each one yourself), named `h10` onwards in `game/shots/`:
  - the table at both sizes;
  - mid-drag course line;
  - selected contact;
  - menu open;
  - damage panel open;
  - a torpedo in the water;
  - full 3D with the Plot button;
  - upright with "Play upright anyway".
