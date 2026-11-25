# Third-party code and data

vgc-gto-solver links Ninjask at `8a59175f3915771285cd16fce5d7f788610ff242`, MIT, copyright
2026 David Cabatingan and contributors. Preserve [its license](docs/licenses/ninjask-MIT.txt)
when redistributing its code or a binary containing it.

Ninjask's battle logic ports Pokémon Showdown. Bundled `data/gen9championsvgc2026regmc.json`
was exported from Showdown `3a766f2cfb5e51c1e428cfe87d0dba91a8f01640`. Preserve
[Showdown's MIT notice](docs/licenses/pokemon-showdown-MIT.txt), copyright 2011–2026
Guangcong Luo and other contributors. See `data/manifest.json` for provenance/checksum.

Cargo.lock records the complete Rust dependency graph. Rayon, clap, serde and serde_json
and their transitive dependencies retain their own upstream license terms. Python/NumPy/
SciPy and Node/Showdown are research tools, not runtime requirements for the Rust CLI.
The web catalog adds attributed factual set/statistics snapshots described below; official
artwork is loaded externally. No sounds or Showdown client source are bundled.

Pokémon and related names are trademarks of their respective owners. This fan research project
is not affiliated with or endorsed by Nintendo, Creatures, GAME FREAK, The Pokémon Company
or Pokémon Showdown.

This file documents dependencies; it does not license vgc-gto-solver's original source. The owner
has not yet chosen a project-wide license. Public GitHub availability alone does not grant
a general redistribution license to the original work.

## Browser application and snapshots

`@pkmn/sets` 7.0.0 and `@pkmn/img` 0.3.5 are MIT, copyright 2020–2026 pkmn contributors;
retain [the notice](docs/licenses/pkmn-ps-MIT.txt). React and React DOM are MIT, copyright Meta
Platforms, Inc. and affiliates; retain [their notice](docs/licenses/react-MIT.txt). Lucide React
is ISC (with its retained Feather attribution); see [its notice](docs/licenses/lucide-ISC.txt).
Vite/Prettier are MIT; TypeScript and Playwright are Apache-2.0 development tools. Axum,
Tokio, tower-http and reqwest retain their upstream MIT/Apache terms. Exact dependency graphs
are recorded in package-lock.json and Cargo.lock; preserve dependency license notices when
redistributing bundles/binaries.

`data/web-catalog.json` derives factual metadata/descriptions from the pinned MIT Showdown
export, aggregated public-domain Smogon usage statistics, and source-attributed published
VGCPastes configurations. It includes 415 published presets and 150 clearly labelled suggested
starting sets. Published team configurations do not have one uniform blanket contributor
license; we retain author/source attribution and do not claim to relicense them. See
[provenance and limitations](docs/ui-research-and-data.md) before redistribution.

Sprites and item artwork are loaded from Pokémon Showdown; no official artwork is bundled
in source. The @pkmn/img software license does not license Pokémon intellectual property.
Browser screenshots include that third-party artwork for illustrating the actual interface.
Barlow, Barlow Condensed and IBM Plex Mono load through Google Fonts under their respective
open-font licenses, with system font fallbacks. Showdown **client** code is AGPL-3.0 and was
not copied; the distinct simulator/data MIT notices above still apply.
