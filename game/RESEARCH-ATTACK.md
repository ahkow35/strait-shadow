# Research: firing solution and attack options (2026-11-25)

The aim is to make Strait Shadow's attack phase closer to how a modern diesel-electric submarine attacks, using only public sources. Every number in the game stays a game value. In the game no weapon gets a model name: The owner's notes mention Black Shark, Sub-Harpoon and Exocet SM39, but the game says only "heavy torpedo" and "anti-ship missile".

## What is public about the Type 218SG (Invincible class)

| Claim | Status | Source |
|---|---|---|
| 8 × 533 mm torpedo tubes | Official (MINDEF) | [MINDEF fact sheet](https://www.mindef.gov.sg/news-and-events/latest-releases/18feb19_fs/), [Naval News](https://www.navalnews.com/?p=62220) |
| Combat management system built with Atlas Elektronik and ST Electronics; DSTA says its data analytics support decisions | Official / trade press | [DSTA](https://www.dsta.gov.sg/whats-on/spotlight/achieving-new-depths-of-innovation), [Wikipedia](https://en.wikipedia.org/wiki/Invincible-class_submarine) |
| Torpedo type | **Not disclosed.** One heavy torpedo type is linked only by inference: Singapore bought it for the older Archer class. | [Defence Security Asia](https://defencesecurityasia.com/?p=59154), [HandWiki](https://handwiki.org/wiki/Engineering:Invincible-class_submarine) |
| Anti-ship missiles from the tubes | **Not confirmed officially.** Reporting says the tubes "may" fire them. | [Wikipedia](https://en.wikipedia.org/wiki/Invincible-class_submarine), [National Interest](https://nationalinterest.org/node/181540) |
| 2 × 650 mm tubes; a vertical launch airlock | Unverified; one mirror page only. Sources conflict, so the game leaves both out. | [Wikipedia mirror](https://en.wikipedia.com/wiki/RSS_Inimitable), [Deagel](https://www.deagel.com/navies/type%20218sg/a003450) |

Consequence for the game: a missile is a plausible "what if" but not an established fact. The Help text should say so, in the same way it says "Illustrative model. Interior layout is not public."

## Firing solution (target motion analysis, TMA)

- A boat using passive sonar knows only **bearings**. From one straight leg, the target's range, course and speed cannot be worked out. Only after the boat **manoeuvres** (changes course or speed: a "leg", then a "zig") does the problem become solvable. [Wikipedia TMA](https://en.wikipedia.org/wiki/Target_Motion_Analysis), [US patent 5877998](https://patents.google.com/patent/US5877998)
- The classic manual method (Ekelund ranging) takes the rate at which the bearing changes on each of two legs, together with the boat's own speed across the line of sight, and gets the range at the moment of the turn. [US patent 4327500](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4327500)
- Modern systems fit a straight-line target motion to all the bearings and keep refining it as bearings arrive. A target that turns spoils the fit until enough new bearings come in.
- The owner's notes add: classification from engine and propeller sounds (blade count, shaft rate); sea temperature layers bending sound; weapon presets set through a cable before launch.

## Heavy torpedo

- **Presets** that are publicly described: a run-out course and distance before the seeker switches on; a search ceiling and floor; a search pattern (straight, snake, circle). [NavWeaps](https://navweaps.com/Weapons/WTUS_PostWWII.php), [Mark 46 (Wikiwand)](https://www.wikiwand.com/en/articles/Mk_46_torpedo)
- **Wire guidance:** the boat steers the torpedo down the wire, and the torpedo's own sensor data can come back up the wire. A typical attack runs out on the wire to near the target, then searches passively. [Mark 48 (NUWC)](https://www.navsea.navy.mil/Portals/103/Documents/NUWC_Newport/QRpage/MK48.pdf), [BAE Systems](https://www.baesystems.com/dam/jcr:5beea6a6-cbcc-4182-aabe-979c42858785)
- **Swim-out launch:** the torpedo leaves the tube under its own power, so it is quieter than the compressed-air (impulse) launch. [Mark 48 (Wikipedia)](https://Www.Wikipedia.org/wiki/ADCAP)
- **Re-attack** after a miss and **counter-countermeasure** logic are mentioned in public material, but no detail was found. Any game behaviour for them is a game design choice.

## Anti-ship missile from a torpedo tube

- The missile goes out in a sealed capsule. The capsule rises to the surface, then the missile's booster fires. [US patent 6427574](https://patents.google.com/patent/US6427574), [CSIS Missile Threat](https://missilethreat.csis.org/missile/harpoon/)
- Over the horizon the boat needs a good target position, either from its own sensors or from a third party. Without one, the shot is a guess. [USNI Proceedings 1992](https://www.usni.org/magazines/proceedings/1992-06/tomahawk-tactics%E2%80%94-midway-connection), [Naval Submarine League](https://archive.navalsubleague.org/?p=5196)
- A missile breaking the surface and climbing is very conspicuous, so it gives escorts a starting point to search from. This is an inference: no source found states it outright. [Proceedings 2021](https://calhoun.nps.edu/bitstream/handle/10945/67972/Mills-USNIProceedings-10-2021.pdf)

## Gaps

- Torpedo and missile performance figures are deliberately not used. Every number stays a game value.
- No public source describes re-attack logic in detail.

## Missile flight and the frigate's defences (added 2026-11-26)

The owner's notes name the real systems. The game names none of them, and every number in it stays a game value.

- **Flight profile.** NAVAIR describes the missile's flight as a low-level, sea-skimming cruise, ending in a sea-skim or a pop-up manoeuvre. [NAVAIR](https://www.navair.navy.mil/product/Harpoon), [CSIS Missile Threat](https://missilethreat.csis.org/missile/harpoon/)
- **Pop-up height.** Wikipedia gives an early pop-up of about 1,800 m before the dive. Sources disagree on which variants have which mode (CSIS and Wikipedia conflict), so the game makes it a player choice and claims no variant. [Wikipedia](https://en.wikipedia.com/wiki/AGM-84)
- **Submarine launch.** The capsule glides to the surface, its caps are ejected, and the booster fires. The booster separates before sustained flight. [Designation-Systems](https://designation-systems.net/dusrm/m-84.html), [FAS](https://man.fas.org/dod-101/sys/smart/agm-84.htm)
- **Waypoints.** Waypoints are confirmed for ship-launched and later air-launched versions. Nothing found confirms them for the submarine-launched round, so the game leaves them out.
- **The frigate class's defences.**
  - **Anti-air missiles** fired from vertical launchers. The variant mix and cell count differ between sources: 32 cells, or 16 + 16. A 2025 report citing the navy says the class fields only the shorter-range variant, not the longer-range one; confidence is moderate. [Wikipedia](https://en.wikipedia.org/wiki/Formidable-class_frigate), [Army Recognition](https://www.armyrecognition.com/archives/archives-naval-defense/naval-news-navy-2025/breaking-news-first-aster-30-missile-fired-from-singapore-navy-formidable-class-frigate-in-france-destroys-drone), [Naval Technology](https://www.naval-technology.com/projects/formidable/)
  - **A 76 mm fast-firing gun**, plus 25 mm guns. [Naval Technology](https://www.naval-technology.com/projects/formidable/)
- **Soft kill (chaff, decoys, jamming).** This works by giving the seeker a more attractive target, not by destroying the missile.
  - **Distraction** puts a false target out before the missile locks; **seduction** pulls a seeker that is already locked.
  - One source says jamming and decoy launchers account for most successful defeats of anti-ship missiles in naval engagements.
  - Multi-mode seekers can reject decoys.

  [Defense Media Network](https://defensemedianetwork.com/stories/naval-self-protection-solutions-rely-on-interoperable-launchers-and-ammunitio), [AN/SLQ-49 (Wikipedia)](https://Www.Wikipedia.org/wiki/AN/SLQ-49)
- **The frigate class's soft kill.** It has trainable decoy launchers firing radar or infrared decoys, and an electronic support suite. This is from Wikipedia's summary and one trade-press report, with no primary navy source. [Wikipedia](https://en.wikipedia.org/wiki/Formidable-class_frigate), [Naval News](https://www.navalnews.com/?p=38662)
- **Not found:** any public figure for the chance of shooting a missile down or decoying it, for damage by hit location, or for tube reload and swap times. These are all game design choices.
