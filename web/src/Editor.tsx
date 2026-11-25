import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { api } from './api';
import { clone, id, type Catalog, type Pokemon, type MonView, type Species } from './types';
import { Num, Picker, Sprite, TypeBadge } from './ui';
export function startingSet(sp: Species, cat: Catalog): Pokemon {
  if (sp.presets[0]) return clone(sp.presets[0].set);
  const legal = cat.moves.filter((m) => sp.learnset.includes(m.id));
  return {
    species: sp.name,
    ability:
      Object.values(sp.abilities).find((a) => cat.abilities.some((x) => x.id === id(a))) ||
      Object.values(sp.abilities)[0],
    item: null,
    moves: legal
      .filter((m) => (m.basePower || 0) > 0)
      .slice(0, 4)
      .map((m) => m.name),
    nature: 'Hardy',
    points: [32, 0, 0, 0, 2, 32],
  };
}
const statNames = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
const boostNames = [
  'Attack',
  'Defense',
  'Sp. Attack',
  'Sp. Defense',
  'Speed',
  'Accuracy',
  'Evasion',
];
export default function Editor({
  cat,
  pokemon,
  snapshot,
  side,
  slot,
  onSave,
  onClose,
  onRemove,
}: {
  cat: Catalog;
  pokemon: Pokemon;
  snapshot?: MonView;
  side: number;
  slot: number;
  onSave: (p: Pokemon) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const [p, setP] = useState(() => clone(pokemon)),
    [stats, setStats] = useState<number[]>([]),
    [error, setError] = useState(''),
    [checking, setChecking] = useState(false),
    [preset, setPreset] = useState(
      () =>
        cat.species
          .find((s) => s.id === id(pokemon.species))
          ?.presets.find(
            (s) =>
              JSON.stringify([
                s.set.ability,
                s.set.item,
                s.set.moves,
                s.set.nature,
                s.set.points,
              ]) ===
              JSON.stringify([
                pokemon.ability,
                pokemon.item,
                pokemon.moves,
                pokemon.nature,
                pokemon.points,
              ]),
          )?.id || 'custom',
    );
  const sp = cat.species.find((s) => s.id === id(p.species))!;
  const selected = sp.presets.find((s) => s.id === preset);
  const entryBoosts =
    id(p.species) === id(pokemon.species)
      ? ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'].map(
          (k) => snapshot?.boosts[k] || 0,
        )
      : Array(7).fill(0);
  const total = p.points.reduce((a, b) => a + b, 0);
  const patch = (v: Partial<Pokemon>) => {
    setPreset('custom');
    setP((x) => ({ ...x, ...v }));
  };
  useEffect(() => {
    let valid = true;
    setChecking(true);
    const t = setTimeout(
      () =>
        api<{ stats: number[] }>('validate', p)
          .then((r) => {
            if (valid) {
              setStats(r.stats);
              setError('');
            }
          })
          .catch((e) => {
            if (valid) setError(e.message);
          })
          .finally(() => {
            if (valid) setChecking(false);
          }),
      180,
    );
    return () => {
      clearTimeout(t);
      valid = false;
    };
  }, [p]);
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  const speciesOptions = useMemo(
    () =>
      [...cat.species]
        .sort((a, b) => (a.usage?.rank || 999) - (b.usage?.rank || 999))
        .map((s) => ({
          value: s.name,
          label: s.name,
          detail: `${s.types.join(' / ')}${s.usage ? ` · #${s.usage.rank} · ${s.usage.percent.toFixed(2)}% usage` : ''}`,
          extra: <Sprite name={s.name} />,
        })),
    [cat],
  );
  const usageFor = (key: 'moves' | 'items' | 'abilities', name: string) => {
    const u = sp.usage?.[key].find((x) => x.id === id(name));
    return u ? `${u.percent.toFixed(1)}% · ` : '';
  };
  const moves = cat.moves.filter((m) => sp.learnset.includes(m.id));
  const moveOptions = (index: number) =>
    moves
      .filter((m) => !p.moves.some((n, i) => i !== index && id(n) === m.id))
      .map((m) => ({
        value: m.name,
        label: m.name,
        detail: `${usageFor('moves', m.name)}${m.category} · ${m.basePower || '—'} BP · ${m.accuracy === true ? '—' : m.accuracy}% acc · ${m.pp} PP · priority ${m.priority} — ${m.description}`,
        extra: <TypeBadge type={m.type || 'Normal'} />,
      }));
  async function save() {
    try {
      await api('validate', p);
      onSave(p);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Pokémon editor"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Tab') {
            const focusable = Array.from(
              drawerRef.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]',
              ) || [],
            ).filter((el) => el.getClientRects().length > 0);
            const first = focusable[0],
              last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <div>
            <span className={'eyebrow p' + side}>
              PLAYER {side + 1} · SLOT {slot === 0 ? 'A' : 'B'}
            </span>
            <h2>Edit Pokémon</h2>
          </div>
          <button className="icon" aria-label="Close editor" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="drawer-body">
          <div className="editor-identity">
            <Sprite name={p.species} />
            <div>
              <strong>{p.species}</strong>
              <div className="types">
                {sp.types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
              </div>
              <small>
                {sp.usage
                  ? `#${sp.usage.rank} · ${sp.usage.percent.toFixed(2)}% ladder usage`
                  : 'No usage snapshot available'}
              </small>
            </div>
          </div>
          <Picker
            label="Species"
            value={p.species}
            options={speciesOptions}
            onChange={(name) => {
              const s = cat.species.find((s) => s.name === name)!;
              setP(startingSet(s, cat));
              setPreset(s.presets[0]?.id || 'custom');
            }}
          />
          <section className="preset-box">
            <label>COMPETITIVE PRESET</label>
            <select
              aria-label="Competitive preset"
              value={preset}
              onChange={(e) => {
                const s = sp.presets.find((s) => s.id === e.target.value);
                setPreset(e.target.value);
                if (s) setP(clone(s.set));
              }}
            >
              <option value="custom">Custom / edited set</option>
              {sp.presets.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {selected ? (
              <p>
                {selected.kind === 'published'
                  ? 'Complete published set'
                  : 'Suggested starting set'}
                {selected.source && (
                  <>
                    {' '}
                    ·{' '}
                    <a href={selected.source} target="_blank" rel="noreferrer">
                      View source <ExternalLink size={11} />
                    </a>
                  </>
                )}
                {selected.kind === 'published' && (
                  <small>
                    {selected.occurrences} matching set{selected.occurrences === 1 ? '' : 's'} in
                    the curated pool; not ladder frequency.
                  </small>
                )}
              </p>
            ) : (
              <p>All fields remain editable. Loading a preset replaces this Pokémon’s set.</p>
            )}
          </section>
          <div className="form-grid">
            <Picker
              label="Held item"
              value={p.item || ''}
              options={[
                { value: '', label: 'No item' },
                ...cat.items.map((i) => ({
                  value: i.name,
                  label: i.name,
                  detail: usageFor('items', i.name) + i.description,
                })),
              ]}
              onChange={(v) => patch({ item: v || null })}
            />
            <Picker
              label="Ability"
              value={p.ability}
              options={cat.abilities
                .filter((a) => Object.values(sp.abilities).some((v) => id(v) === a.id))
                .map((a) => ({
                  value: a.name,
                  label: a.name,
                  detail: usageFor('abilities', a.name) + a.description,
                }))}
              onChange={(v) => patch({ ability: v })}
            />
          </div>
          <h3>
            Moves <span>Simulator-legal learnset</span>
          </h3>
          <div className="move-editors">
            {Array.from({ length: 4 }, (_, i) => (
              <div className="move-editor" key={i}>
                <Picker
                  label={`Move ${i + 1}`}
                  value={p.moves[i] || ''}
                  options={[{ value: '', label: 'Empty move slot' }, ...moveOptions(i)]}
                  onChange={(v) => {
                    const m = [...p.moves];
                    m[i] = v;
                    patch({ moves: m.filter(Boolean), pp: null });
                  }}
                />
                {p.moves[i] && (
                  <small>{cat.moves.find((m) => m.id === id(p.moves[i]))?.description}</small>
                )}
              </div>
            ))}
          </div>
          <h3>
            Champions stat points{' '}
            <span className={total > 66 ? 'danger' : ''}>{total} / 66 SP</span>
          </h3>
          <Picker
            label="Nature / stat alignment"
            value={p.nature}
            options={Object.values(cat.natures).map((n) => ({
              value: n.name,
              label: n.name,
              detail: n.plus ? `+${n.plus.toUpperCase()} / −${n.minus?.toUpperCase()}` : 'Neutral',
            }))}
            onChange={(v) => patch({ nature: v })}
          />
          <div className="stat-table">
            <div className="stat-head">
              <span>STAT</span>
              <span>POINTS</span>
              <span>RESULT</span>
            </div>
            {statNames.map((s, i) => (
              <div className="stat-row" key={s}>
                <strong>{s}</strong>
                <input
                  aria-label={`${s} stat points`}
                  type="number"
                  min="0"
                  max="32"
                  value={p.points[i]}
                  onChange={(e) => {
                    const points = [...p.points];
                    points[i] = Math.max(0, Math.min(32, +e.target.value));
                    patch({ points, hp: null });
                  }}
                />
                <input
                  aria-label={`${s} points slider`}
                  type="range"
                  min="0"
                  max="32"
                  value={p.points[i]}
                  onChange={(e) => {
                    const points = [...p.points];
                    points[i] = +e.target.value;
                    patch({ points, hp: null });
                  }}
                />
                <b>{checking ? '…' : stats[i] || '—'}</b>
              </div>
            ))}
          </div>
          <small className="muted">
            Level 50 · max 32 points per stat · calculated by the native engine
          </small>
          <h3>Battle state</h3>
          <div className="form-grid">
            <Num
              label="Current HP"
              value={p.hp ?? stats[0] ?? 0}
              max={stats[0] || 65535}
              onChange={(hp) => patch({ hp })}
            />
            <Num
              label="HP percent"
              value={stats[0] ? Math.round((100 * (p.hp ?? stats[0])) / stats[0]) : 100}
              max={100}
              onChange={(v) => patch({ hp: Math.round(((stats[0] || 1) * v) / 100) })}
            />
            <label>
              Status
              <select
                aria-label="Status"
                value={p.status || ''}
                onChange={(e) => patch({ status: e.target.value || null })}
              >
                <option value="">Healthy</option>
                {[
                  ['brn', 'Burn'],
                  ['par', 'Paralysis'],
                  ['slp', 'Sleep'],
                  ['frz', 'Freeze'],
                  ['psn', 'Poison'],
                  ['tox', 'Toxic'],
                ].map(([v, n]) => (
                  <option value={v} key={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <Num
              label="Active turns"
              value={p.active_turns ?? 1}
              max={65535}
              onChange={(v) => patch({ active_turns: v })}
            />
          </div>
          <details>
            <summary>Advanced state · stages & PP</summary>
            <div className="form-grid pad-top">
              <Num
                label="Sleep / freeze turns"
                value={p.status_turns || 0}
                max={7}
                onChange={(v) => patch({ status_turns: v })}
              />
              <Num
                label="Toxic stage"
                value={p.toxic_stage || 0}
                max={15}
                onChange={(v) => patch({ toxic_stage: v })}
              />
            </div>
            <div className="form-grid">
              {boostNames.map((name, i) => (
                <Num
                  key={name}
                  label={`${name} stage`}
                  value={p.boosts?.[i] ?? entryBoosts[i]}
                  min={-6}
                  max={6}
                  onChange={(v) => {
                    const b = p.boosts ? [...p.boosts] : [...entryBoosts];
                    b[i] = v;
                    patch({ boosts: b });
                  }}
                />
              ))}
            </div>
            <div className="form-grid">
              {p.moves.map((name, i) => {
                const m = moves.find((m) => m.id === id(name));
                const max = m?.max_pp || m?.pp || 99;
                return (
                  <Num
                    key={i}
                    label={`${name} PP`}
                    value={p.pp?.[i] ?? max}
                    max={max}
                    onChange={(v) => {
                      const pp = p.pp
                        ? [...p.pp]
                        : p.moves.map((n) => {
                            const m = moves.find((m) => m.id === id(n));
                            return m?.max_pp || m?.pp || 0;
                          });
                      pp[i] = v;
                      patch({ pp });
                    }}
                  />
                );
              })}
            </div>
            <p className="muted">
              Set HP to 0 for a fainted slot. Mega Evolution and item consumption are preserved when
              advancing turns. To start Mega Evolved, advance a legal Mega action; arbitrary
              volatiles and consumed-item snapshots are not editable here.
            </p>
          </details>
          {sp.usage && (
            <details>
              <summary>Observed ladder spreads · {cat.provenance.usage.month}</summary>
              {sp.usage.spreads.slice(0, 5).map((s) => (
                <p className="spread" key={s.name}>
                  <span>{s.name}</span>
                  <b>{s.percent.toFixed(1)}%</b>
                </p>
              ))}
              <small className="muted">
                Independent spread statistics, not complete team sets. HP / Atk / Def / SpA / SpD /
                Spe.
              </small>
            </details>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
        </div>
        <footer>
          <button className="subtle danger" onClick={onRemove}>
            <Trash2 size={15} /> Empty slot
          </button>
          <button
            className="subtle"
            onClick={() => {
              setP(clone(pokemon));
              setPreset('custom');
            }}
            aria-label="Reset editor"
          >
            <RotateCcw size={15} />
          </button>
          <button className="primary" onClick={save} disabled={checking || !!error}>
            <Save size={15} /> Apply changes
          </button>
        </footer>
      </aside>
    </div>
  );
}
