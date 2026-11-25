# Third-party code and data

NashDex links Ninjask at `8a59175f3915771285cd16fce5d7f788610ff242`, MIT, copyright
2026 David Cabatingan and contributors. Preserve [its license](docs/licenses/ninjask-MIT.txt)
when redistributing its code or a binary containing it.

Ninjask's battle logic ports Pokémon Showdown. Bundled `data/gen9championsvgc2026regmc.json`
was exported from Showdown `3a766f2cfb5e51c1e428cfe87d0dba91a8f01640`. Preserve
[Showdown's MIT notice](docs/licenses/pokemon-showdown-MIT.txt), copyright 2011–2026
Guangcong Luo and other contributors. See `data/manifest.json` for provenance/checksum.

Cargo.lock records the complete Rust dependency graph. Rayon, clap, serde and serde_json
and their transitive dependencies retain their own upstream license terms. Python/NumPy/
SciPy and Node/Showdown are research tools, not runtime requirements for the Rust CLI.
No third-party team corpus, official sprites, artwork, sounds or other official assets is included.

Pokémon and related names are trademarks of their respective owners. This fan research project
is not affiliated with or endorsed by Nintendo, Creatures, GAME FREAK, The Pokémon Company
or Pokémon Showdown.

This file documents dependencies; it does not license NashDex's original source. The owner
has not yet chosen a project-wide license. Public GitHub availability alone does not grant
a general redistribution license to the original work.
