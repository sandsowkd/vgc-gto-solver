import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importTeam, exportTeam } from '../web/src/imports';
import type { Catalog } from '../web/src/types';
const cat = JSON.parse(readFileSync('data/web-catalog.json', 'utf8')) as Catalog;
const text =
  'Garchomp @ Clear Amulet\nAbility: Rough Skin\nLevel: 50\nSPs: 32 Atk / 2 SpD / 32 Spe\nJolly Nature\n- Earthquake\n- Protect';
test('SP import/export round trip retains Champions points and set identity', () => {
  const team = importTeam(text, cat);
  expect(team[0].points).toEqual([0, 32, 0, 0, 2, 32]);
  expect(importTeam(exportTeam(team), cat)).toEqual(team);
});
test('main-series EVs require explicit confirmation and are never converted', () => {
  expect(() => importTeam(text.replace('SPs:', 'EVs:'), cat)).toThrow('Confirm');
  expect(importTeam(text.replace('SPs:', 'EVs:'), cat, true)[0].points).toEqual([
    0, 32, 0, 0, 2, 32,
  ]);
  expect(() => importTeam(text.replace('32 Atk', '252 Atk'), cat, true)).toThrow('SP limits');
});
test('malformed imports and unsupported state cannot silently become valid sets', () => {
  for (const value of [
    '',
    'not a pokemon',
    text.replace('Garchomp', 'Pikabogus'),
    text + '\nIVs: 0 Atk',
    text + '\nTera Type: Fire',
    text.replace('Level: 50', 'Level: 100'),
  ])
    expect(() => importTeam(value, cat)).toThrow();
});

test('Mega team labels normalize to base species only with the matching stone', () => {
  const paste =
    'Gardevoir-Mega @ Gardevoirite\nAbility: Trace\nSPs: 32 HP / 32 SpA / 2 Spe\nModest Nature\n- Hyper Voice\n- Protect';
  expect(importTeam(paste, cat)[0].species).toBe('Gardevoir');
  expect(() => importTeam(paste.replace('Gardevoirite', 'Life Orb'), cat)).toThrow(
    'matching Mega Stone',
  );
});
