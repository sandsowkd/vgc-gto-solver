import { Teams, Sets } from '@pkmn/sets';
import { id, type Catalog, type Pokemon } from './types';
const stats = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export function importTeam(text: string, cat: Catalog, confirmSmallEVs = false): Pokemon[] {
  if (text.length > 100000) throw new Error('Team text exceeds 100,000 characters.');
  if (!text.trim() || !/^\s*-\s*\S/m.test(text))
    throw new Error('Paste a Showdown set with at least one move.');
  if (/^\s*EVs:/im.test(text) && !confirmSmallEVs)
    throw new Error(
      'This export uses EVs. Confirm that these numbers are Champions stat points, or replace EVs: with SPs:. Main-series EV spreads are not converted.',
    );
  if (/^\s*IVs:/im.test(text) && !/^\s*IVs:\s*(?:31\s+\w+(?:\s*\/\s*)?)+\s*$/im.test(text))
    throw new Error('Custom IVs are unsupported by the Champions engine. Remove the IVs line.');
  if (/^\s*(Tera Type|Dynamax Level|Gigantamax):/im.test(text))
    throw new Error(
      'Tera / Dynamax fields are unsupported in this Champions format. Remove those lines.',
    );
  for (const line of text.split('\n')) {
    const level = line.match(/^\s*Level:\s*(\d+)/i);
    if (level && Number(level[1]) !== 50) throw new Error('Champions sets must use level 50.');
  }
  const parsed = Teams.importTeam(text.replace(/^\s*(?:SPs|Stat Points):/gim, 'EVs:'))?.team;
  if (!parsed?.length || parsed.length > 6) throw new Error('Import between one and six Pokémon.');
  return parsed.map((s) => {
    const form = cat.battle_forms?.find((p) => p.id === id(s.species || s.name || ''));
    if (form && !form.requiredItems.some((item) => id(item) === id(s.item || '')))
      throw new Error(
        `${form.name} requires its matching Mega Stone. Import the base species or correct the held item.`,
      );
    const sp = cat.species.find((p) => p.id === id(form?.baseSpecies || s.species || s.name || ''));
    if (!sp) throw new Error(`Unsupported species: ${s.species || s.name}`);
    if (form && s.ability && !Object.values(sp.abilities).some((a) => id(a) === id(s.ability!)))
      throw new Error(
        `${form.name} lists a post-Mega ability. Set its pre-Mega ability to ${Object.values(sp.abilities).join(' or ')} before importing; the engine applies its Mega ability on evolution.`,
      );
    const points = stats.map((k) => s.evs?.[k] || 0);
    if (points.some((x) => x > 32) || points.reduce((a, b) => a + b, 0) > 66)
      throw new Error(
        'Champions SP limits: 32 per stat, 66 total. Main-series EVs are not converted.',
      );
    if (!s.moves?.length) throw new Error(`${sp.name} has no moves.`);
    return {
      species: sp.name,
      ability: s.ability || Object.values(sp.abilities)[0],
      item: s.item || null,
      moves: s.moves,
      nature: s.nature || 'Hardy',
      points,
    };
  });
}
export function exportTeam(team: Pokemon[]): string {
  return team
    .map((p) =>
      Sets.exportSet({
        name: p.species,
        species: p.species,
        item: p.item || '',
        ability: p.ability,
        nature: p.nature,
        level: 50,
        moves: p.moves,
        evs: {
          hp: p.points[0],
          atk: p.points[1],
          def: p.points[2],
          spa: p.points[3],
          spd: p.points[4],
          spe: p.points[5],
        },
      }),
    )
    .join('\n\n')
    .replace(/^EVs:/gm, 'SPs:');
}
