# Simulator investigation

Investigated 2026-11-24 by reading and executing the actual source. Upstream claims are not
substitutes for NashDex's tests. All revision links below are frozen for reproducibility.

## Decision and pins

Use [Ninjask v0.4.1 at 8a59175](https://github.com/dcabatin/Ninjask/tree/8a59175f3915771285cd16fce5d7f788610ff242)
as a Rust library. It ports [Showdown at 3a766f2](https://github.com/smogon/pokemon-showdown/tree/3a766f2cfb5e51c1e428cfe87d0dba91a8f01640).
Cargo pins the full engine revision and locks transitive dependencies. The full Reg M-C export
is bundled with a SHA-256 and exporter provenance in `data/manifest.json`; runtime needs no
network, Python or Node. Rust 1.100.0 is pinned separately.

The engine's intended format is `gen9championsvgc2026regmc`: doubles, bring six/pick four,
Champions stat points, Mega Evolution, no Terastallization. NashDex deliberately uses one or two
Pokémon per side, bypassing tournament roster-size validation for its restricted no-reserve game.
This does not make a two-mon team a tournament-legal roster. M-B/OTS/singles/custom exports are
described upstream but were not integrated or validated here; no support for future regulations
or exact equivalence to the official game is claimed.

## Source findings and experiments

| Question | Finding and inspected source |
| --- | --- |
| Two-mon initialization? | Yes. `Battle::from_sets_rng`/`from_teams_rng` builds a side with the supplied mons; `choose_team` caps its pick to available mons. Tests execute 2v2, 2v1 and 1v1. Doubles retains two active slots; empty/fainted slots produce Pass. |
| Arbitrary states? | Public `Battle`, `Side`, `Mon` and `Field` fields allow controlled state construction. `Battle::from_projection` imports the engine/Showdown projection at a request boundary. It rejects queued mid-turn actions and unsupported condition IDs. NashDex accepts nonterminal move-boundary projections only, validates roster/counts/stats/PP/support, and also offers typed HP/status/stage/PP/field overrides and exact choice replay. |
| Cloning? | `Battle: Clone`, with an `Arc<Dex>` sharing immutable interned data. State vectors and owned scratch/log data are copied. Logging is disabled and startup logs cleared for rollouts. Actual clone and rollout measurements are in `docs/benchmarks.md`. |
| Serialization? | `projection()` exports canonical JSON, not a serde serialization of the whole Rust object. The normal xoshiro RNG is not restored by projection import; import accepts a new seed. Advanced histories should use teams plus replay, which preserves all engine state. No claim of arbitrary mid-turn or universal lossless checkpoint restore. |
| Hashing? | `BattleStateKey` has Eq/Hash, excluding RNG position, logs and diagnostics. It includes a retained shared-Dex pointer identity. It is useful inside one process and shared Dex allocation, not a portable content hash or player information-set key. Tests verify clone independence and a pending-choice key change. Transposition caching is not yet implemented. |
| Legal joint actions? | `joint_choices` combines each slot's exact `slot_options`, preserving forced actions, target locations, move PP/disable/lock, Struggle, fainted slots and at most one Mega per side. `player_choices` instead preserves hidden disables; NashDex intentionally uses true legality for perfect information. Every enumerated action in the principal fixture is checked through the text choice parser. |
| Simultaneous execution? | `choose_structured` submits one side and commits only when all required sides have selected. It trusts structured input, so NashDex feeds it only simulator-enumerated actions. Both policies choose before either side is submitted. Voluntary switches are excluded and rosters cannot contain reserves. Forced revival requests can still refer to the two existing mons. |
| Target representation? | `SlotChoice::Move { slot, target, mega }`: move slot is zero-based; targets 1/2 are enemy slots, -1/-2 own slots, 0 auto/spread/self. The simulator is authoritative for targeting and execution; policy damage estimates use these fields heuristically. |
| Randomness? | Normal `Rng` is seeded xoshiro256++; reference mode uses Showdown's `sodium,<hex>` generator with matching draw order. NashDex derives independent streams for each cell/sample and each policy. Fixed-work matrices are identical with one or two threads in tests. |
| Exact chance outcomes? | Yes, an **experimental** `enumerate_outcomes[_within]` API and text wrappers replay explicit chance paths and merge matching state keys. `Precise` preserves accuracy/crits/all damage rolls. Default path cap is 20,000; overflow is an error. `DamageEndpoints` is an approximation and is not used by NashDex. A tiny forced-win endgame is verified using Precise probability mass and terminal outcomes. Full-turn branching makes this unsuitable as the default matrix estimator. |
| Entity representation? | Species, moves, items and abilities are interned integer IDs into `Dex` loaded from JSON. `MonSet.points` is six Champions stat points. HP=`base+points+75`; other stats start at `base+points+20` before nature. Main-series EV spreads are rejected (32/stat, 66 total). Engine move/category/target types are enums; persistent effects use typed state. |
| Damage oracle? | `calc`/`calc_all` use the engine's own damage code in read-only probe mode, exposing 16 normal/critical rolls, accuracy, expected damage and KO chance. `order_odds` accounts for priority/speed effects. Policies cache these results per slot option; the state-preservation test covers all baseline calls. |
| Teams bundled? | Upstream has four verification teams and a separate 766-team VGCPastes pool with provenance IDs, dated November 4, 2026. The latter is not part of its Rust crate. NashDex does not redistribute that player-authored pool; example teams here are authored illustrative sets checked against the pinned learnsets. |
| Team import? | Rust `parse_packed` accepts Showdown's packed strings, not human-readable paste text or URLs. The upstream Node harness uses `Teams.import`/`Teams.pack`; its Python layer has further helpers. NashDex supports structured JSON and packed teams, with no runtime URL fetcher or human-text importer. |

Relevant inspected engine files: `src/battle/{mod,choices,choose_text,enumerate,state_key}.rs`,
`src/state/*`, `src/{rng,calc,outcome}.rs`, `src/projection/{mod,import}.rs`,
`src/dex/{mod,types,team,support}.rs`, `refsim/{server,export_format}.js`, and `pools/README.md`.

## Actual validation

- `examples/audit_simulator.rs` inspected support against the **bundled data**: 510/510 moves,
  166/166 items, 221/224 abilities. Unsupported abilities are Gulp Missile, Ice Face and Shields
  Down. Upstream associates them with formes outside the legal Reg M-C roster. NashDex rejects
  unsupported requested entities, including in advanced projections.
- `scripts/validate_showdown.py`: 15 seeded complete games, three authored matchups including
  a mirrored speed-tie fixture, **183 full-state comparisons after individual choice inputs**.
  All matched, including the reference RNG state. Fixtures include damaging/protection/spread/
  ally-support moves, weather, accuracy rolls, Mega Evolution, Fake Out and Intimidate. This
  is a representative differential check, not exhaustive validation of every interaction.
- Tests additionally cover 1v1/2v1, stat-point arithmetic, forced/fainted actions, exact tiny
  chance enumeration, clone/projection behavior, legal target variants, Protect, priority,
  speed ties, damage rolls, policy isolation, truncation and cross-thread reproducibility.
- The pinned Showdown crashes when directly starting a **one-mon-per-side doubles** fixture
  (`forceSwitchFlag` on null in `Battle.runAction`). Differential games therefore start with
  two mons per side and naturally reach endgames. Ninjask's direct 1v1 initialization is covered
  locally. We did not patch either dependency to hide this reference limitation.
- `benchmarks/results.json` contains actual clone, enumeration, throughput, thread scaling,
  budget, seed-stability and playing-strength measurements. No upstream advertised speed was
  used as a NashDex benchmark.

Reference setup creates a CommonJS scope in ignored `.cache/reference/package.json`. This
prevents an enclosing workspace with `type: module` from reinterpreting the upstream Node
harness. No tracked simulator source or enclosing workspace configuration is modified.

## Other resources investigated

- [Pokémon Showdown data](https://github.com/smogon/pokemon-showdown/tree/3a766f2cfb5e51c1e428cfe87d0dba91a8f01640/data):
  built locally at the reference revision; its Champions rules/scripts and team packing were
  inspected and its format exporter executed. It is the differential oracle and data source,
  not the production hot loop. Its simulator is the practical fallback if Ninjask exposes a
  material mechanics mismatch; replacing a currently matching engine was not justified.
- [Smogon damage calculator](https://github.com/smogon/damage-calc): inspected as a potential
  independent damage reference. It is a calculator, not a complete simultaneous battle simulator;
  no pinned Champions adapter was validated here. Prefer the full Showdown comparison for now.
- [Smogon statistics](https://www.smogon.com/stats/): public dated competitive usage/chaos reports
  can guide future matchup sampling and set priors. No stats snapshot is ingested or claimed to
  define the evaluation distribution in this version.
- [PokePaste](https://pokepast.es/): team sharing in Showdown export format. A later importer can
  fetch paste text, preserve provenance, convert using a pinned parser and validate the points/
  regulation before simulation. URL/PokePaste imports are intentionally deferred.
- [DexDB calculator](https://dexdb.io/calc/): inspected its public Champions feature/mechanics
  description. It is a useful manual cross-check, not a pinned programmatic oracle or dependency;
  its browser calculator requires JavaScript and was not used to generate benchmark claims.

## Licensing and remaining limits

Ninjask declares MIT; its `NOTICE` identifies Showdown code/data as MIT and includes Showdown's
copyright/permission notice. Both exact notices are retained in `docs/licenses/` and identified
in `THIRD_PARTY_NOTICES.md`. The curated VGCPastes pool has separate player/source attribution
and was not vendored. No official artwork or media is included. No blanket NashDex license has
been selected on the owner's behalf; the repository therefore needs an explicit licensing
decision before it can be advertised as generally reusable open-source software.

The support checker is an upstream declaration of implemented mechanics, not a proof. Complex
Transform/Illusion/revival/move-copy/condition histories need wider differential fixtures.
Projection import/export covers modeled boundary state and has format-specific assumptions;
replay is the better reproduction artifact. Only one pinned Showdown is tested. Parity with
that implementation is not independent verification of the official game. See the roadmap for
broader mechanics validation and competitive set sourcing before stronger research claims.
