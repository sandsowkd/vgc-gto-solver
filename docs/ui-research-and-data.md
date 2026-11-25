# UI research, data provenance and reuse

Research performed 2026-11-24. These references informed interaction design; their branding and proprietary source were not copied.

| Reference | Findings / decisions |
| --- | --- |
| [DexDB calculator](https://dexdb.io/calc/) and [sources](https://dexdb.io/sources/) | Inspected the live dark calculator, battle board, collapsible set/stats, HP controls, usage selectors and Champions SP. Its sources describe Smogon and Champions Battle Data. Used the compact, immediately editable calculator concept; built original layout/styles. |
| [Showdown teambuilder](https://play.pokemonshowdown.com/teambuilder) and [client source](https://github.com/smogon/pokemon-showdown-client) | Inspected team library/import flow and client source license. Client is AGPL-3.0, distinct from MIT simulator. No client code copied. Used independently MIT @pkmn/sets for text serialization. |
| [ChompLab](https://chomplab.app/) | Inspected live tools/workspace and public Champions calculator description. SP 32/stat, 66 total, local teams/imports, dense calculator workflow. Adopted progressive disclosure and local persistence. |
| [GTO Wizard](https://gtowizard.com/) | Studied public solver/study presentation: joint strategy frequencies, EV comparison and matrix inspection. Built original frequency rows and utility/uncertainty summary; no claim to full-game GTO. |
| [Pikalytics](https://www.pikalytics.com/) | Inspected Regulation M-C usage/team discovery and public data presentation. Kept usage ranking useful in selectors and provenance visible. No proprietary Pikalytics data copied. |
| [React Pokémon VGC calculator](https://github.com/huydamm/PokemonVGC-Calculator) at c19da559368cdf156320276c76bc0d4138679ae7 | Read MIT source/services/package dependencies. Uses React/TS/Vite, @pkmn/{sets,img,smogon,dex,data}, @smogon/calc. Champions Battle Data API exposes marginal moves/items/abilities/spreads; that app combines top marginals. We chose complete published sets where available and label any generated default as suggested. No source copied. |
| [Smogon damage calculator](https://github.com/smogon/damage-calc) | MIT calculator source/dependency reviewed. A second battle/damage engine would create disagreement with the existing native mechanics, so it was not added. |

## Authoritative format and descriptions

`data/gen9championsvgc2026regmc.json` remains the authority, pinned to Pokémon Showdown `3a766f2cfb5e51c1e428cfe87d0dba91a8f01640` and Ninjask `8a59175f3915771285cd16fce5d7f788610ff242`. `data/manifest.json` retains the original provenance. The UI catalog includes 293 selectable non-battle-only species/forms. Mega forms are reached with native Mega actions. On startup, native move/item/ability support filters selectors and native complete-set validation filters presets. Every submitted editor/import set is validated again.

Descriptions are short text from the pinned Showdown `data/text/{moves,items,abilities}` exports (MIT), taking Champions-specific text when available. They are informational; engine behavior and support determine simulations. Names, types, power, accuracy, priority, PP, learnsets and natures come from the pinned export.

## Complete presets

The pinned [Ninjask pool](https://github.com/dcabatin/Ninjask/tree/8a59175f3915771285cd16fce5d7f788610ff242/pools) includes **766** packed published six-mon teams with matching MC identifiers. Its build script identifies the [VGCPastes Champions M-C sheet](https://docs.google.com/spreadsheets/d/1axlwmzPA49rYkqXh7zHvAtSP-TKbM0ijGYBPRflLSWw/edit#gid=2001945654). Metadata downloaded 2026-11-24 joins those identifiers to author names and original PokePaste URLs; newer sheet teams are not silently added to the pinned pool.

Pool sets with no recorded stat allocation (all-zero points) are excluded from published presets.
The catalog chooses up to four most repeated **complete, identical sets** per species, retaining species, item, ability, all moves, nature and SP together. Each set links to its published paste and credits the sheet's author. “Occurrences” means count in this curated pool, not usage percentage, tournament success or a representative popularity estimate. Generated defaults for species absent from this pool use legal starting choices and are explicitly labelled **suggested**. No complete observed claim is made for those defaults. The resulting catalog has **565 presets**: see exact split in PROGRESS.md.

These are factual game configurations and source/author metadata, not copied player reports or analysis prose. VGCPastes/team authors have not supplied one uniform blanket license for every submitted team. Attribution is retained; this repository does not claim those underlying contributions are MIT or grant rights it does not own. Review those terms before bulk redistribution/commercial reuse of the snapshot.

## Usage snapshot

Source: [Smogon October 2026 Regulation M-C, 1500 cutoff](https://www.smogon.com/stats/2026-10/chaos/gen9championsvgc2026regmc-1500.json), **1,649,648 battles**. Downloaded 2026-11-24. The catalog records the original SHA-256, regulation, month and cutoff. Only aggregated factual statistics are used, without Smogon analysis prose. The [@pkmn/smogon documentation](https://github.com/pkmn/smogon) identifies usage statistics as public domain and distinguishes copyrighted analysis material.

Species usage sums the base species and its battle forms; rankings are computed over pinned selectable base species. Move/item/ability/spread percentages divide the category's weighted count by the grouped ability total (a Pokémon can have four moves, so move percentages need not sum to 100). Spreads retain actual nature/SP combinations from the snapshot. Marginals are independent, displayed as statistics rather than recombined “observed sets.” Mega-only abilities may appear in snapshot marginals but are filtered out of a base form's editable legal ability selector.

The snapshot is local: normal species/preset edits and solving need no data-service calls. A different regulation must get its own versioned snapshot, not a silent fallback to another format. DexDB and the React reference also use [Champions Battle Data](https://championsbattledata.com/); its live marginal API was investigated, but it is not a runtime dependency or an unlicensed fallback in this app.

Rebuild with a pinned reference checkout plus the downloaded raw usage JSON and sheet metadata:

```sh
node scripts/build_web_data.mjs /path/usage.json data/preset-sources.json
```

The committed metadata JSON maps each MC identifier to `{author, paste}`. The generator reads the pinned packed pool and Showdown text files under `.cache/reference/`; it never relies on an unspecified current regulation. The served catalog revalidates all resulting presets natively.

## Libraries and artwork

- [@pkmn/sets](https://github.com/pkmn/ps/tree/main/sets), MIT: Showdown-compatible text parsing/export. A thin explicit SP adapter rejects ordinary EVs unless the user confirms they already mean SP. It never divides/multiplies EVs.
- [@pkmn/img](https://github.com/pkmn/ps/tree/main/img), MIT code: sprite URL resolution and item sheet offsets. The old standalone `github.com/pkmn/img` reference now resolves through the ps monorepo; used the actual package/source. Artwork loads from `play.pokemonshowdown.com`, with text fallbacks. The MIT code license does not transfer ownership of Pokémon artwork.
- React / React DOM, Vite, Lucide React, TypeScript, Playwright and Prettier retain their upstream licenses. Exact versions are in package-lock.json; complete Rust dependencies are in Cargo.lock. Axum/Tokio/reqwest/tower-http provide native HTTP infrastructure. Original solver algorithms and terminal utility semantics are preserved.
- Barlow / Barlow Condensed / IBM Plex Mono load via Google Fonts under their upstream open-font licenses, with system fallbacks. No artwork/fonts are represented as original project IP.

See THIRD_PARTY_NOTICES.md and docs/licenses/ for retained notices. The owner has not selected a project-wide license for original source.
