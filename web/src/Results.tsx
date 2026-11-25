import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  Grid2X2,
  Info,
  LockKeyhole,
} from 'lucide-react';
import { id, pct, type Action, type Catalog, type SearchResult } from './types';
export function ActionText({
  action,
  side,
  cat,
  names,
  compact = false,
}: {
  action: Action;
  side: number;
  cat: Catalog;
  names: string[][];
  compact?: boolean;
}) {
  return (
    <div className={'action-text ' + (compact ? 'compact' : '')}>
      {action.description.map((d, i) => {
        const match = d.match(/^(.+?): (.+?) \(target (-?\d+)\)$/);
        if (!match)
          return (
            <div key={i} className="muted">
              {d}
            </div>
          );
        const mega = match[2].includes(' + Mega Evolution');
        const name = match[2].replace(' + Mega Evolution', '');
        const move = cat.moves.find((m) => m.id === id(name));
        const t = +match[3];
        const target =
          t > 0 ? names[1 - side]?.[t - 1] : t < 0 ? names[side]?.[-t - 1] : 'field / auto';
        return (
          <div key={i}>
            <span className="action-slot">
              {side + 1}
              {i === 0 ? 'a' : 'b'}
            </span>
            <span className={'move-dot ' + (move?.type || 'Normal').toLowerCase()} />
            <span className="action-move" title={`${match[1]}: ${name}`}>
              {name}
              {mega && <b className="mega">M</b>}
            </span>
            <ArrowRight size={11} />
            <span className="target" title={target}>
              {target || 'empty slot'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
function Strategies({
  r,
  cat,
  names,
  onUse,
}: {
  r: SearchResult;
  cat: Catalog;
  names: string[][];
  onUse: (a: [string, string]) => void;
}) {
  const [side, setSide] = useState(0),
    [all, setAll] = useState(false),
    [sort, setSort] = useState('frequency'),
    [filter, setFilter] = useState(''),
    [marginal, setMarginal] = useState(false);
  const s = r.solution!;
  const probs = side === 0 ? s.player1 : s.player2;
  const values =
    side === 0
      ? s.player1_action_values
      : s.player2_action_values_in_player1_utility.map((v) => 1 - v);
  const best = Math.max(...values);
  const rows = r.actions[side]
    .map((a, i) => ({ a, p: probs[i], ev: values[i] }))
    .filter(
      (x) =>
        (all || x.p > 0.00001) &&
        x.a.description.join(' ').toLowerCase().includes(filter.toLowerCase()),
    )
    .sort((a, b) => (sort === 'ev' ? b.ev - a.ev : b.p - a.p));
  const marginals = [0, 1].map((slot) => {
    const m = new Map<string, number>();
    r.actions[side].forEach((a, i) =>
      m.set(a.description[slot] || 'pass', (m.get(a.description[slot] || 'pass') || 0) + probs[i]),
    );
    return [...m].sort((a, b) => b[1] - a[1]);
  });
  return (
    <>
      <div className="result-toolbar">
        <div className="segmented">
          <button className={side === 0 ? 'selected' : ''} onClick={() => setSide(0)}>
            Player 1
          </button>
          <button className={side === 1 ? 'selected' : ''} onClick={() => setSide(1)}>
            Player 2
          </button>
        </div>
        <div className="row-tools">
          <input
            aria-label="Filter actions"
            placeholder="Filter move or Pokémon…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select aria-label="Sort strategy" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="frequency">Frequency ↓</option>
            <option value="ev">Expected utility ↓</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Show zeroes
          </label>
          <button
            className={'subtle ' + (marginal ? 'active' : '')}
            onClick={() => setMarginal(!marginal)}
          >
            <BarChart3 size={14} /> Marginals
          </button>
        </div>
      </div>
      {marginal ? (
        <div className="marginals">
          {marginals.map((rows, slot) => (
            <section key={slot}>
              <h3>{names[side][slot] || 'Empty slot'} · marginal distribution</h3>
              <p className="muted">These frequencies omit correlation with its partner’s choice.</p>
              {rows
                .filter((x) => all || x[1] > 0.00001)
                .map(([desc, p]) => (
                  <div className="marginal-row" key={desc}>
                    <span>{desc}</span>
                    <b>{pct(p)}</b>
                    <i style={{ width: pct(p) }} />
                  </div>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className="strategy-head">
            <span>JOINT ACTION · BOTH POKÉMON</span>
            <span>FREQUENCY</span>
            <span>UTILITY</span>
            <span>EV LOSS</span>
            <span />
          </div>
          <div className="strategy-list">
            {rows.map(({ a, p, ev }) => (
              <div className="strategy-row" key={a.index}>
                <ActionText action={a} side={side} cat={cat} names={names} />
                <div className="frequency">
                  <b>{pct(p)}</b>
                  <span>
                    <i className={'p' + side} style={{ width: pct(p) }} />
                  </span>
                </div>
                <strong className="ev">{pct(ev)}</strong>
                <span className="ev-loss">
                  {((best - ev) * 100).toFixed(2)}
                  <small> pp</small>
                </span>
                <button
                  className="icon"
                  aria-label={`Explore action ${a.index + 1}`}
                  title="Use this joint action in Turn explorer"
                  onClick={() => {
                    const opponent = side === 0 ? s.player2 : s.player1;
                    const other = opponent.indexOf(Math.max(...opponent));
                    onUse(
                      side === 0
                        ? [a.choice, r.actions[1][other].choice]
                        : [r.actions[0][other].choice, a.choice],
                    );
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            ))}
            {!rows.length && <p className="empty">No actions match this filter.</p>}
          </div>
          <div className="list-footer">
            {rows.length} of {r.actions[side].length} legal joint actions · utility includes ½ draw
            credit<span>EV loss is relative to the best action against this solved mix.</span>
          </div>
        </>
      )}
    </>
  );
}
function Matrix({ r, cat, names }: { r: SearchResult; cat: Catalog; names: string[][] }) {
  const [full, setFull] = useState(false),
    [selected, setSelected] = useState<[number, number]>([0, 0]),
    [scroll, setScroll] = useState({ x: 0, y: 0 });
  const s = r.solution;
  const indices = (side: number) => {
    const p = side === 0 ? s?.player1 : s?.player2;
    const a = r.actions[side].map((_, i) => i);
    if (p) a.sort((i, j) => p[j] - p[i]);
    return full ? a : a.filter((i) => !p || p[i] > 0.0001).slice(0, 24);
  };
  const rows = indices(0),
    cols = indices(1);
  const width = 34,
    height = 31,
    left = 205,
    top = 55;
  const visibleRows = rows.slice(
    Math.max(0, Math.floor(scroll.y / height) - 1),
    Math.ceil((scroll.y + 410) / height),
  );
  const visibleCols = cols.slice(
    Math.max(0, Math.floor(scroll.x / width) - 1),
    Math.ceil((scroll.x + 1200) / width),
  );
  const cell = r.matrix.cells[selected[0]]?.[selected[1]];
  const color = (v: number | null) =>
    v === null ? '#343b49' : `hsl(${Math.round(12 + v * 140)} 43% ${24 + Math.abs(v - 0.5) * 16}%)`;
  return (
    <>
      <div className="result-toolbar">
        <div>
          <h3>Root action-pair matrix</h3>
          <small className="muted">Rows: Player 1 · Columns: Player 2 · Utility for Player 1</small>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={full}
            onChange={(e) => {
              setFull(e.target.checked);
              setScroll({ x: 0, y: 0 });
            }}
          />
          Full matrix ({r.matrix.rows} × {r.matrix.columns})
        </label>
        <div className="legend">
          <span>0</span>
          <i />
          <span>1</span>
        </div>
      </div>
      <div className="matrix-layout">
        <div
          className="matrix-scroll"
          onScroll={(e) =>
            setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })
          }
        >
          <div
            className="matrix-spacer"
            style={{ width: left + cols.length * width, height: top + rows.length * height }}
          >
            {visibleRows.flatMap((i) =>
              visibleCols.map((j) => {
                const c = r.matrix.cells[i][j];
                const ri = rows.indexOf(i),
                  ci = cols.indexOf(j);
                return (
                  <button
                    key={`${i}-${j}`}
                    className={
                      'heat-cell ' + (selected[0] === i && selected[1] === j ? 'chosen' : '')
                    }
                    style={{
                      left: left + ci * width,
                      top: top + ri * height,
                      width,
                      height,
                      background: color(c.mean),
                    }}
                    aria-label={`Row ${i + 1}, column ${j + 1}, utility ${c.mean === null ? 'unavailable' : pct(c.mean)}`}
                    title={`P1 #${i + 1} / P2 #${j + 1} · ${c.samples} samples · ${c.mean === null ? 'censored / missing' : pct(c.mean)}`}
                    onClick={() => setSelected([i, j])}
                    onMouseEnter={() => setSelected([i, j])}
                  >
                    {c.mean === null ? '·' : Math.round(c.mean * 100)}
                  </button>
                );
              }),
            )}
            {visibleRows.map((i) => (
              <div
                key={'r' + i}
                className="matrix-row-label"
                style={{ left: scroll.x, top: top + rows.indexOf(i) * height, width: left, height }}
              >
                <b>#{i + 1}</b>
                <span>
                  {r.actions[0][i].description
                    .map((d) => d.split(': ')[1]?.split(' (target')[0] || 'pass')
                    .join(' + ')}
                </span>
              </div>
            ))}
            {visibleCols.map((j) => (
              <div
                key={'c' + j}
                className="matrix-col-label"
                style={{ left: left + cols.indexOf(j) * width, top: scroll.y, width, height: top }}
                title={r.actions[1][j].description.join(' + ')}
              >
                #{j + 1}
                <small>{s ? pct(s.player2[j], 0) : 'P2'}</small>
              </div>
            ))}
            <div
              className="matrix-corner"
              style={{ left: scroll.x, top: scroll.y, width: left, height: top }}
            >
              P1 ↓ <span>P2 →</span>
            </div>
          </div>
        </div>
        <aside className="cell-detail">
          <span className="eyebrow">SELECTED ACTION PAIR</span>
          <h3>
            #{selected[0] + 1} <span>×</span> #{selected[1] + 1}
          </h3>
          <ActionText action={r.actions[0][selected[0]]} side={0} cat={cat} names={names} />
          <div className="cell-vs">VS</div>
          <ActionText action={r.actions[1][selected[1]]} side={1} cat={cat} names={names} />
          {cell && (
            <>
              <div className="cell-utility">
                {cell.mean === null ? '—' : pct(cell.mean)}
                <small>estimated P1 utility</small>
              </div>
              <div className="cell-stats">
                <span>Wins / losses / draws</span>
                <b>
                  {cell.wins} / {cell.losses} / {cell.draws}
                </b>
                <span>Samples</span>
                <b>{cell.samples}</b>
                <span>Censored at turn cap</span>
                <b>{cell.truncated}</b>
                <span>95% simultaneous interval</span>
                <b>
                  {pct(cell.utility_interval[0], 0)}–{pct(cell.utility_interval[1], 0)}
                </b>
                <span>Standard error</span>
                <b>{cell.standard_error === null ? '—' : cell.standard_error.toFixed(4)}</b>
              </div>
            </>
          )}
        </aside>
      </div>
      <div className="list-footer">
        {full ? 'All legal actions' : 'Top equilibrium support (up to 24 per side)'} · sorted by
        equilibrium frequency · scroll to inspect
        <span>Cells are virtualized. Hover or select for sampling details.</span>
      </div>
    </>
  );
}
function NodeLock({ r, cat, names }: { r: SearchResult; cat: Catalog; names: string[][] }) {
  const [weights, setWeights] = useState<Record<number, number>>({ 0: 100 }),
    [add, setAdd] = useState('0');
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const values =
    r.matrix.payoff?.map((row) =>
      row.reduce((sum, v, j) => sum + (v * (weights[j] || 0)) / (total || 1), 0),
    ) || [];
  const best = values.length ? values.indexOf(Math.max(...values)) : 0;
  const baseline = r.solution
    ? values.reduce((sum, v, i) => sum + v * r.solution!.player1[i], 0)
    : 0;
  return (
    <div className="lock-layout">
      <section>
        <h3>
          <LockKeyhole size={16} /> Lock Player 2’s distribution
        </h3>
        <p className="muted">
          Set relative weights, then inspect Player 1’s pure best response against that fixed mix.
          This is best-response analysis, distinct from equilibrium solving.
        </p>
        <div className="inline">
          <select
            aria-label="Opponent action to lock"
            value={add}
            onChange={(e) => setAdd(e.target.value)}
          >
            {r.actions[1].map((a) => (
              <option key={a.index} value={a.index}>
                #{a.index + 1} {a.description.join(' + ')}
              </option>
            ))}
          </select>
          <button onClick={() => setWeights({ ...weights, [+add]: 100 })}>Add action</button>
        </div>
        {Object.keys(weights).map((k) => (
          <div className="lock-row" key={k}>
            <ActionText action={r.actions[1][+k]} side={1} cat={cat} names={names} />
            <label>
              Weight
              <input
                type="number"
                min="0"
                max="1000000"
                aria-label={`Weight action ${+k + 1}`}
                value={weights[+k]}
                onChange={(e) =>
                  setWeights({ ...weights, [+k]: Math.max(0, Math.min(1e6, +e.target.value)) })
                }
              />
            </label>
            <b>{pct(weights[+k] / (total || 1))}</b>
            <button
              className="icon"
              aria-label={`Remove lock ${+k + 1}`}
              onClick={() => {
                const w = { ...weights };
                delete w[+k];
                setWeights(w);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </section>
      <aside className="best-response">
        <span className="eyebrow">PLAYER 1 BEST RESPONSE</span>
        {total > 0 ? (
          <>
            <div className="cell-utility">
              {pct(values[best] || 0)}
              <small>utility against locked mix</small>
            </div>
            <ActionText action={r.actions[0][best]} side={0} cat={cat} names={names} />
            <div className="cell-stats">
              <span>Original equilibrium mix vs lock</span>
              <b>{pct(baseline)}</b>
              <span>Improvement from best response</span>
              <b>+{((values[best] - baseline) * 100).toFixed(2)} pp</b>
            </div>
            <p className="muted">
              Uses the estimated root matrix and its continuation policies. Sampling uncertainty
              still applies.
            </p>
          </>
        ) : (
          <p>Add a positive action weight.</p>
        )}
      </aside>
    </div>
  );
}
export default function Results({
  r,
  cat,
  names,
  onUse,
}: {
  r: SearchResult;
  cat: Catalog;
  names: string[][];
  onUse: (a: [string, string]) => void;
}) {
  const [tab, setTab] = useState('strategies');
  const s = r.solution;
  const wld = useMemo(() => {
    if (!s) return [0, 0, 0];
    let out = [0, 0, 0];
    r.matrix.cells.forEach((row, i) =>
      row.forEach((c, j) => {
        const weight = (s.player1[i] * s.player2[j]) / c.samples;
        out[0] += weight * c.wins;
        out[1] += weight * c.draws;
        out[2] += weight * c.losses;
      }),
    );
    return out;
  }, [r, s]);
  return (
    <section className="results" aria-label="Solver results">
      <div className="results-title">
        <div className="inline">
          <span className="live-dot" />
          <h2>{s ? 'Strategy solution' : 'Sampling diagnostics'}</h2>
          <span className="tag">Estimated root game</span>
        </div>
        <span className="muted">
          {(r.runtime.total_ms / 1000).toFixed(2)}s · {r.matrix.samples.toLocaleString()}{' '}
          simulations
        </span>
      </div>
      {s ? (
        <>
          <div className="value-summary">
            <div className="player-value p0">
              <span>PLAYER 1 UTILITY</span>
              <strong>{pct(s.value)}</strong>
            </div>
            <div className="value-center">
              <div className="outcome-bar">
                <i style={{ width: pct(wld[0]) }} />
                <i style={{ width: pct(wld[1]) }} />
                <i style={{ width: pct(wld[2]) }} />
              </div>
              <div className="outcome-labels">
                <span>P1 wins {pct(wld[0])}</span>
                <span>Draws {pct(wld[1])}</span>
                <span>P2 wins {pct(wld[2])}</span>
              </div>
              <p>Terminal utility = win + ½ draw · weighted by the solved strategy pair</p>
            </div>
            <div className="player-value p1">
              <span>PLAYER 2 UTILITY</span>
              <strong>{pct(1 - s.value)}</strong>
            </div>
          </div>
          <div className="quality-strip">
            <span>
              <Check size={13} /> {r.matrix.rows} × {r.matrix.columns} pairs covered
            </span>
            <span>
              Matrix Nash gap <b>{s.nash_gap.toFixed(5)}</b>
            </span>
            <span>
              Iterations <b>{s.iterations.toLocaleString()}</b>
            </span>
            <span title="Conservative simultaneous Monte Carlo bounds, separate from the matrix Nash gap">
              95% utility interval{' '}
              <b>{r.strategy_utility_interval?.map((v) => pct(v, 0)).join('–')}</b>
            </span>
          </div>
        </>
      ) : (
        <div className="diagnostic">
          <Info size={24} />
          <div>
            <h3>No strategy is available for this sample matrix</h3>
            <p>
              {!r.matrix.coverage_complete
                ? 'The time budget ended before all action pairs were sampled. Increase the budget.'
                : 'At least one rollout reached its turn cap. Censored outcomes are not counted as draws. Increase the turn cap or adjust the position.'}
            </p>
            <span>
              {r.matrix.cells
                .flat()
                .filter((c) => c.samples > 0)
                .length.toLocaleString()}{' '}
              / {(r.matrix.rows * r.matrix.columns).toLocaleString()} pairs sampled ·{' '}
              {r.matrix.truncations} censored rollouts
            </span>
          </div>
        </div>
      )}
      <nav className="tabs" aria-label="Result views">
        <button
          className={tab === 'strategies' ? 'active' : ''}
          disabled={!s}
          onClick={() => setTab('strategies')}
        >
          <BarChart3 size={15} /> Joint strategies
        </button>
        <button className={tab === 'matrix' || !s ? 'active' : ''} onClick={() => setTab('matrix')}>
          <Grid2X2 size={15} /> Payoff matrix
        </button>
        <button
          className={tab === 'lock' ? 'active' : ''}
          disabled={!s}
          onClick={() => setTab('lock')}
        >
          <LockKeyhole size={15} /> Node locking
        </button>
      </nav>
      {!s || tab === 'matrix' ? (
        <Matrix r={r} cat={cat} names={names} />
      ) : tab === 'lock' ? (
        <NodeLock r={r} cat={cat} names={names} />
      ) : (
        <Strategies r={r} cat={cat} names={names} onUse={onUse} />
      )}
      <details className="interpretation">
        <summary>
          <Info size={13} /> Interpretation & uncertainty
        </summary>
        <p>
          These values estimate terminal win/loss/draw utility after one joint action pair, followed
          by fixed {r.config.sampling.policies.join(' / ')} policies. The equilibrium applies to
          this estimated root matrix. It is not exact full-game GTO. A small numerical Nash gap does
          not remove Monte Carlo error or continuation-policy bias.
        </p>
        <p>
          Statistical upper bound on gap:{' '}
          {r.nash_gap_upper_confidence_bound === null
            ? 'unavailable'
            : r.nash_gap_upper_confidence_bound.toFixed(4)}
          . Confidence intervals are conservative simultaneous, anytime Hoeffding bounds across
          every cell and sample count.
        </p>
        {r.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
      </details>
    </section>
  );
}
