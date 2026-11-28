import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Solve position' })).toBeEnabled();
}
async function solve(page: Page) {
  await page.getByRole('button', { name: 'Solve position' }).click();
  await expect(page.getByRole('region', { name: 'Solver results' })).toBeVisible({
    timeout: 45000,
  });
}
async function picker(page: Page, label: string, value: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('combobox', { name: 'Search ' + label, exact: true }).fill(value);
  await page
    .getByRole('option', { name: new RegExp(value) })
    .first()
    .click();
}
test('four brought Pokémon switch, replace a knockout and replay on a phone', async ({ page }) => {
  const fixture = resolve(
    process.env.VGC_SOLVER_ROOT ?? process.cwd(),
    'examples/four-v-four.json',
  );
  const position = JSON.parse(readFileSync(fixture, 'utf8'));
  position.teams[0][1].hp = 1;
  position.teams[0][1].item = null;
  position.teams[0].pop();
  await page.addInitScript((position) => {
    if (!localStorage.getItem('vgc-gto-solver.workspace.v2')) {
      localStorage.setItem(
        'vgc-gto-solver.workspace.v2',
        JSON.stringify({ position, history: [] }),
      );
    }
  }, position);
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole('button', { name: 'Add Player 1 reserve' }).click();
  await picker(page, 'Species', 'Clefable');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByRole('button', { name: 'Edit Player 1 reserve Clefable' })).toBeVisible();
  await page.getByRole('button', { name: 'Make Player 1 Charizard lead A' }).click();
  await expect(
    page.getByRole('button', { name: 'Edit Player 1 Charizard', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Make Player 1 Garchomp lead A' }).click();
  await expect(
    page.getByRole('button', { name: 'Edit Player 1 Garchomp', exact: true }),
  ).toBeVisible();

  await page.getByLabel('Turn RNG seed').fill('17');
  await page.getByLabel('Player 1 slot A action').selectOption('switch 3');
  const partner = page.getByLabel('Player 1 slot B action');
  await expect(partner.getByRole('option', { name: /→ Charizard/ })).toHaveCount(0);
  await partner.selectOption('switch 3, move 1 1');
  await page.getByLabel('Player 2 slot A action').selectOption('move 4');
  await page.getByLabel('Player 2 slot B action').selectOption('move 4, move 1 2');
  await page.getByRole('button', { name: 'Advance', exact: true }).click();

  await expect(page.getByText('Player 2 · Waiting', { exact: true })).toBeVisible();
  await page.getByLabel('Inspect Player 1 reserve Garchomp').click();
  await expect(page.getByText(/Dragon Claw · \d+\/\d+ PP/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit Player 1 Charizard', exact: true }),
  ).toBeVisible();
  await solve(page);
  await expect(page.getByRole('heading', { name: 'Strategy solution' })).toBeVisible();
  await page.getByLabel('Player 1 slot B action').selectOption('pass, switch 4');
  await page.getByRole('button', { name: 'Send replacements' }).click();
  await expect(
    page.getByRole('button', { name: 'Edit Player 1 Clefable', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send replacements' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Player 2 · Waiting', { exact: true })).toBeVisible();
  await page.getByLabel('Player 1 slot B action').selectOption('pass, switch 4');
  await page.getByRole('button', { name: 'Send replacements' }).click();
  await expect(
    page.getByRole('button', { name: 'Edit Player 1 Clefable', exact: true }),
  ).toBeVisible();
  await solve(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test('edit all four Pokémon, import six sets, configure field, solve, inspect and replay', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  for (const [side, old, name] of [
    [1, 'Incineroar', 'Charizard'],
    [1, 'Rillaboom', 'Whimsicott'],
    [2, 'Garchomp', 'Tyranitar'],
    [2, 'Gardevoir', 'Gengar'],
  ] as const) {
    await page.getByRole('button', { name: `Edit Player ${side} ${old}`, exact: true }).click();
    await picker(page, 'Species', name);
    await expect(page.getByLabel('Competitive preset')).toBeVisible();
    await page.getByRole('button', { name: 'Apply changes' }).click();
    await expect(
      page.getByRole('button', { name: `Edit Player ${side} ${name}`, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Edit Player 1 Charizard', exact: true }).click();
  await page.getByLabel('Competitive preset').selectOption({ index: 1 });
  await picker(page, 'Held item', 'Charizardite Y');
  await picker(page, 'Ability', 'Blaze');
  await picker(page, 'Move 1', 'Flamethrower');
  await page.getByLabel('HP stat points', { exact: true }).fill('0');
  await page.getByLabel('Spe stat points', { exact: true }).fill('0');
  await page.getByLabel('SpA stat points', { exact: true }).fill('0');
  await page.getByText('Advanced state · stages & PP', { exact: true }).click();
  await page.getByLabel('Flamethrower PP', { exact: true }).fill('1');
  await page.getByLabel('Attack stage', { exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  const cat = await (await request.get('/api/catalog')).json();
  const six = ['Incineroar', 'Rillaboom', 'Garchomp', 'Gardevoir', 'Charizard', 'Whimsicott'].map(
    (n) => cat.species.find((s: any) => s.name === n).presets[0].set,
  );
  const text = six
    .map(
      (p) =>
        `${p.species}${p.item ? ' @ ' + p.item : ''}\nAbility: ${p.ability}\nLevel: 50\n${p.nature} Nature\nSPs: ${p.points.map((n: number, i: number) => n + ' ' + ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'][i]).join(' / ')}\n${p.moves.map((m: string) => '- ' + m).join('\n')}`,
    )
    .join('\n\n');
  await page.getByRole('button', { name: 'Import team', exact: true }).first().click();
  await page.getByLabel('Team import text').fill(text);
  await page.getByRole('button', { name: 'Validate import' }).click();
  await expect(page.locator('.roster button')).toHaveCount(6);
  await page.getByRole('button', { name: 'Place selected Pokémon' }).click();
  await page.getByLabel('Weather', { exact: true }).selectOption('raindance');
  await page.getByLabel('Terrain', { exact: true }).selectOption('electricterrain');
  await page.getByRole('button', { name: 'Field settings' }).click();
  await page.getByLabel('P1 tailwind turns', { exact: true }).fill('2');
  await page.getByLabel('Terrain turns', { exact: true }).fill('4');
  await expect(page.getByRole('button', { name: 'Solve position' })).toBeEnabled();
  await page.getByRole('button', { name: 'Field settings' }).click();
  // This fixture enumerates more than 20,000 action pairs.
  await page.getByRole('button', { name: '30s', exact: true }).click();
  await page.getByText('Advanced solver settings', { exact: false }).click();
  await page.getByLabel('Samples per action pair', { exact: true }).fill('1');
  await solve(page);
  await expect(page.getByRole('heading', { name: 'Strategy solution' })).toBeVisible();
  await expect(page.locator('.strategy-row')).not.toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/strategy-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Player 2', exact: true }).click();
  await page.getByRole('button', { name: 'Marginals', exact: true }).click();
  await expect(page.locator('.marginals')).toBeVisible();
  await page.getByRole('button', { name: 'Payoff matrix', exact: true }).click();
  await expect(page.locator('.heat-cell').first()).toBeVisible();
  await page.getByRole('checkbox', { name: /Full matrix/ }).check();
  await expect(page.locator('.heat-cell')).toHaveCount(await page.locator('.heat-cell').count());
  await page.locator('.heat-cell').first().click();
  await page.screenshot({ path: 'docs/screenshots/matrix-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Node locking', exact: true }).click();
  await page.getByLabel('Weight action 1', { exact: true }).fill('75');
  await expect(page.getByText('PLAYER 1 BEST RESPONSE', { exact: true })).toBeVisible();
  const setup = JSON.parse(
    await page.evaluate(() => localStorage.getItem('vgc-gto-solver.workspace.v2')!),
  );
  await page.getByRole('button', { name: 'Advance', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await expect(page.locator('.battle-log p').first()).toBeVisible();
  await expect(page.getByLabel('Weather turns', { exact: true })).toHaveValue('4');
  await expect(page.getByLabel('Weather turns', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Field settings' }).click();
  await expect(page.getByLabel('P1 tailwind turns', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Field settings' }).click();
  await solve(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(
    JSON.parse(await page.evaluate(() => localStorage.getItem('vgc-gto-solver.workspace.v2')!)),
  ).toEqual(setup);
  await page.getByLabel('Weather', { exact: true }).selectOption('sunnyday');
  await expect(page.getByRole('region', { name: 'Solver results' })).toHaveCount(0);
  await solve(page);
  expect(errors).toEqual([]);
});
test('short budgets, cancellation, validation, persistence, share and mobile layout', async ({
  page,
  request,
}) => {
  await ready(page);
  await page.getByLabel('Custom solve budget seconds').fill('0.001');
  await solve(page);
  await expect(
    page.getByRole('heading', { name: 'No strategy is available for this sample matrix' }),
  ).toBeVisible();
  await expect(page.locator('.strategy-row')).toHaveCount(0);
  await page.getByRole('button', { name: '30s', exact: true }).click();
  await page.getByText('Advanced solver settings', { exact: false }).click();
  await page.getByLabel('Samples per action pair', { exact: true }).fill('4096');
  await page.getByRole('button', { name: 'Solve position' }).click();
  await expect(page.getByRole('button', { name: 'Cancel solve' })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel solve' }).click();
  await expect(page.getByText('Solve cancelled', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Solve position' })).toBeEnabled();
  await page.getByRole('button', { name: 'Import team', exact: true }).first().click();
  await page.getByLabel('Team import text').fill('not a set');
  await page.getByRole('button', { name: 'Validate import' }).click();
  await expect(page.getByRole('alert')).toContainText('Showdown set');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Player 1 Incineroar', exact: true }).click();
  await page.getByLabel('HP stat points', { exact: true }).fill('32');
  await page.getByLabel('Atk stat points', { exact: true }).fill('32');
  await page.getByLabel('Spe stat points', { exact: true }).fill('32');
  await expect(page.getByRole('alert')).toContainText('66 total');
  await expect(page.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close editor' }).click();
  await page.getByRole('button', { name: 'Positions', exact: true }).click();
  await page.getByLabel('Position name').fill('Rain test');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Weather', { exact: true }).selectOption('raindance');
  await page.reload();
  await expect(page.getByLabel('Weather', { exact: true })).toHaveValue('raindance');
  await page.getByRole('button', { name: 'Positions', exact: true }).click();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByLabel('Weather', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Solve position' })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Edit Player 1 Incineroar', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/editor-mobile.png', fullPage: true });
  await expect(page.getByRole('dialog', { name: 'Pokémon editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Close editor' }).click();
  const refused = await request.post('/api/import', { data: { url: 'https://127.0.0.1/secrets' } });
  expect(refused.status()).toBe(422);
  const origin = await request.post('/api/inspect', {
    headers: { Origin: 'https://evil.example' },
    data: {},
  });
  expect(origin.status()).toBe(403);
});
