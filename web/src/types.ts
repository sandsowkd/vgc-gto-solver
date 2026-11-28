export type Pokemon = {
  species: string;
  ability: string;
  item: string | null;
  moves: string[];
  nature: string;
  points: number[];
  hp?: number | null;
  status?: string | null;
  status_turns?: number;
  toxic_stage?: number;
  boosts?: number[] | null;
  pp?: number[] | null;
  active_turns?: number | null;
};
export type Field = {
  weather: string | null;
  weather_turns: number;
  terrain: string | null;
  terrain_turns: number;
  trick_room: number;
};
export type Conditions = {
  tailwind: number;
  reflect: number;
  light_screen: number;
  aurora_veil: number;
};
export type Position = {
  teams: [Pokemon[], Pokemon[]];
  seed: number;
  field?: Field;
  side_conditions?: [Conditions, Conditions];
  turn?: number;
};
export type Step = { choices: [string, string]; seed: number };
export type Board = { position: Position; history: Step[] };
export type Datum = {
  id: string;
  name: string;
  description?: string;
  type?: string;
  category?: string;
  basePower?: number;
  accuracy?: number | boolean;
  priority?: number;
  pp?: number;
  max_pp?: number;
  noPPBoosts?: boolean;
};
export type Preset = {
  id: string;
  label: string;
  kind: 'published' | 'suggested';
  source: string | null;
  occurrences: number;
  set: Pokemon;
};
export type UsageEntry = { id: string; name: string; percent: number };
export type Species = {
  id: string;
  name: string;
  types: string[];
  baseStats: Record<string, number>;
  abilities: Record<string, string>;
  learnset: string[];
  presets: Preset[];
  usage: null | {
    rank: number;
    percent: number;
    moves: UsageEntry[];
    items: UsageEntry[];
    abilities: UsageEntry[];
    spreads: UsageEntry[];
  };
};
export type Catalog = {
  version: string;
  species: Species[];
  battle_forms?: { id: string; name: string; baseSpecies: string; requiredItems: string[] }[];
  moves: Datum[];
  items: Datum[];
  abilities: Datum[];
  natures: Record<string, { name: string; plus?: string; minus?: string }>;
  limits: { max_threads: number };
  provenance: { usage: { month: string; cutoff: number; battles: number; source: string } };
};
export type Action = { index: number; choice: string; description: string[] };
export type MonView = {
  name: string;
  species: string;
  roster_species: string;
  hp: number;
  maxhp: number;
  types: string[];
  item: string | null;
  ability: string;
  status: string | null;
  boosts: Record<string, number>;
  moves: { id: string; pp: number; maxpp: number }[];
  storedStats: Record<string, number>;
  details?: string;
};
export type Inspection = {
  state: {
    turn: number;
    requestState: 'move' | 'switch' | null;
    field: Record<string, unknown>;
    sides: { pokemon: MonView[]; sideConditions?: Record<string, unknown> }[];
  };
  actions: [Action[], Action[]];
  needs_choice: [boolean, boolean];
  events: string[];
  ended: boolean;
  winner: number | null;
};
export type Cell = {
  samples: number;
  wins: number;
  losses: number;
  draws: number;
  truncated: number;
  mean: number | null;
  completed_mean: number | null;
  standard_error: number | null;
  utility_interval: [number, number];
};
export type Solution = {
  player1: number[];
  player2: number[];
  player1_action_values: number[];
  player2_action_values_in_player1_utility: number[];
  value: number;
  lower_value: number;
  upper_value: number;
  nash_gap: number;
  iterations: number;
  converged: boolean;
};
export type SearchResult = {
  actions: [Action[], Action[]];
  matrix: {
    rows: number;
    columns: number;
    cells: Cell[][];
    payoff: number[][] | null;
    samples: number;
    truncations: number;
    coverage_complete: boolean;
    requested_samples_complete: boolean;
  };
  solution: Solution | null;
  runtime: { total_ms: number };
  strategy_utility_interval: [number, number] | null;
  nash_gap_upper_confidence_bound: number | null;
  warnings: string[];
  config: Config;
};
export type Config = {
  budget_ms: number;
  sampling: {
    samples_per_cell: number;
    max_turns: number;
    seed: number;
    threads: number;
    policies: [string, string];
    confidence: number;
  };
  solver: { iterations: number; tolerance: number; algorithm: string };
};
export type Progress = {
  phase: string;
  pairs: number;
  covered: number;
  samples: number;
  iterations: number;
  nash_gap: number | null;
};
export const id = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
export const clone = <T>(v: T): T => structuredClone(v);
