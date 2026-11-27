# Strait Shadow

A browser submarine game in a busy strait, plus the illustrated Type 218SG-style cutaway page it grew from.

Play: https://ubuntu-waffle-25w3.here.now/game/ (cutaway: https://ubuntu-waffle-25w3.here.now/)

Illustrative model. Interior layout is not public. Fictional scenario. Every number in the game is a game value.

## Layout

- `game/strait-shadow.html`: the whole game, one self-contained file (Three.js r128 from cdnjs).
- `game/DESIGN.md`, `game/STAGE-*.md`, `game/RESEARCH-ATTACK.md`: the design and each stage's spec.
- `game/tests/`: `node tests/sim.test.mjs` (simulation, about 100 s) and `node tests/browser-check.mjs <mode>` (headless Chrome).
- `site/`: what is published. `site/game/` adds the home-screen app files (manifest, offline cache, icons).
- `src/`: the cutaway page's source stages. `preview/`: earlier versions kept for rollback.
