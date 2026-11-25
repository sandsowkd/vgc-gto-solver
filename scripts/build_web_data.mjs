// Rebuild the versioned UI snapshot from the pinned simulator pool and explicitly supplied downloads.
// Usage: node scripts/build_web_data.mjs /path/usage.json /path/vgcpastes-metadata.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  root = '.cache/reference/showdown/dist/data/text/';
const d = JSON.parse(fs.readFileSync('data/gen9championsvgc2026regmc.json'));
const usage = JSON.parse(fs.readFileSync(process.argv[2]));
const meta = JSON.parse(fs.readFileSync(process.argv[3]));
const id = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const index = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
const moves = index(d.moves),
  items = index(d.items),
  abilities = index(d.abilities),
  species = index(d.species);
const texts = {};
for (const [key, exportKey] of [
  ['moves', 'MovesText'],
  ['items', 'ItemsText'],
  ['abilities', 'AbilitiesText'],
])
  texts[key] = require(`${process.cwd()}/${root}${key}.js`)[exportKey];
const describe = (a, key) =>
  a.map((x) => ({
    ...x,
    description:
      texts[key][x.id]?.champions?.shortDesc ||
      texts[key][x.id]?.shortDesc ||
      texts[key][x.id]?.desc ||
      '',
  }));
const sets = {};
const lines = fs
  .readFileSync('.cache/reference/ninjask/pools/vgcpastes-regmc.txt', 'utf8')
  .trim()
  .split('\n');
const ids = fs
  .readFileSync('.cache/reference/ninjask/pools/vgcpastes-regmc.txt.ids', 'utf8')
  .trim()
  .split('\n');
for (let i = 0; i < lines.length; i++)
  for (const chunk of lines[i].split(']')) {
    const f = chunk.split('|'),
      sp = species[id(f[1] || f[0])];
    if (!sp || sp.battleOnly) continue;
    const set = {
      species: sp.name,
      ability: abilities[id(f[3])]?.name || Object.values(sp.abilities)[0],
      item: items[id(f[2])]?.name || null,
      moves: f[4]
        .split(',')
        .map((m) => moves[id(m)]?.name)
        .filter(Boolean),
      nature: f[5] || 'Hardy',
      points: Array.from({ length: 6 }, (_, j) => Number(f[6]?.split(',')[j] || 0)),
    };
    if (set.points.every((p) => p === 0)) continue; // Pool entries without a recorded spread are not complete competitive presets.
    const key = JSON.stringify(set);
    const store = (sets[sp.id] ??= new Map());
    if (store.has(key)) {
      store.get(key).occurrences++;
      continue;
    }
    const source = meta[ids[i]];
    store.set(key, {
      id: ids[i] + '-' + sp.id,
      label: `${source?.author || 'VGCPastes'} · ${ids[i]}`,
      kind: 'published',
      occurrences: 1,
      source: source?.paste || null,
      team_id: ids[i],
      set,
    });
  }
const grouped = {};
for (const [name, u] of Object.entries(usage.data)) {
  const key = id(species[id(name)]?.baseSpecies || name);
  const g = (grouped[key] ??= { usage: 0, Abilities: {}, Items: {}, Spreads: {}, Moves: {} });
  g.usage += u.usage;
  for (const category of ['Abilities', 'Items', 'Spreads', 'Moves'])
    for (const [n, count] of Object.entries(u[category]))
      g[category][n] = (g[category][n] || 0) + count;
}
const ranked = Object.entries(grouped)
  .filter(([key]) => species[key] && !species[key].battleOnly)
  .sort((a, b) => b[1].usage - a[1].usage);
const rank = Object.fromEntries(ranked.map(([n, u], i) => [n, { ...u, rank: i + 1 }]));
const cat = d.species
  .filter((s) => !s.battleOnly && d.learnsets[s.id]?.length)
  .map((s) => {
    const u = rank[s.id];
    const denominator = u ? Object.values(u.Abilities).reduce((a, b) => a + b, 0) : 1;
    const category = (k) =>
      u
        ? Object.entries(u[k])
            .sort((a, b) => b[1] - a[1])
            .slice(0, k === 'Moves' ? 30 : 12)
            .map(([name, count]) => ({ id: id(name), name, percent: (100 * count) / denominator }))
        : [];
    const presets = [...(sets[s.id]?.values() || [])]
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 4);
    if (!presets.length) {
      let chosen = category('Moves')
        .map((x) => x.id)
        .filter((m) => d.learnsets[s.id].includes(m));
      if (!chosen.length)
        chosen = d.learnsets[s.id].filter(
          (m) => moves[m]?.basePower > 0 && s.types.includes(moves[m].type),
        );
      chosen = [...new Set([...chosen, 'protect', ...d.learnsets[s.id]])]
        .filter((m) => d.learnsets[s.id].includes(m))
        .slice(0, 4);
      presets.push({
        id: 'suggested-' + s.id,
        label: 'Suggested legal starting set',
        kind: 'suggested',
        occurrences: 0,
        source: null,
        set: {
          species: s.name,
          ability: Object.values(s.abilities)[0],
          item: null,
          moves: chosen.map((m) => moves[m].name),
          nature: 'Hardy',
          points: [32, 0, 0, 0, 2, 32],
        },
      });
    }
    return {
      ...s,
      learnset: d.learnsets[s.id],
      presets,
      usage: u
        ? {
            rank: u.rank,
            percent: 100 * u.usage,
            moves: category('Moves'),
            items: category('Items'),
            abilities: category('Abilities'),
            spreads: category('Spreads'),
          }
        : null,
    };
  });
const result = {
  version: '2026-11-24.1',
  format: d.format,
  species: cat,
  battle_forms: d.species
    .filter((s) => s.isMega)
    .map((s) => ({
      id: s.id,
      name: s.name,
      baseSpecies: s.baseSpecies,
      requiredItems: s.requiredItems || [s.requiredItem],
    })),
  moves: describe(d.moves, 'moves'),
  items: describe(d.items, 'items'),
  abilities: describe(d.abilities, 'abilities'),
  natures: d.natures,
  provenance: {
    usage: {
      source: 'https://www.smogon.com/stats/2026-10/chaos/gen9championsvgc2026regmc-1500.json',
      month: '2026-10',
      cutoff: 1500,
      battles: usage.info['number of battles'],
      aggregation:
        'Base species plus battle-only forms. Category percentages divide weighted counts by the grouped ability count.',
      sha256: crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'),
    },
    presets: {
      pool_commit: '8a59175f3915771285cd16fce5d7f788610ff242',
      teams: lines.length,
      source:
        'https://docs.google.com/spreadsheets/d/1axlwmzPA49rYkqXh7zHvAtSP-TKbM0ijGYBPRflLSWw/edit#gid=2001945654',
      note: 'Complete published team sets; occurrences count this curated pool, not ladder usage. Team authors retain any applicable rights.',
    },
    descriptions:
      'Pokémon Showdown pinned text, MIT; informational, native simulator determines mechanics.',
  },
};
fs.writeFileSync('data/web-catalog.json', JSON.stringify(result));
console.log(
  `${cat.length} species; ${cat.reduce((n, s) => n + s.presets.length, 0)} candidate presets (native validation also applied at serving time)`,
);
