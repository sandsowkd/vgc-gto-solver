import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Import,
  Info,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Share2,
  ShieldCheck,
  Square,
  Sun,
  Swords,
  Undo2,
  Upload,
} from 'lucide-react';
import { api } from './api';
import {
  clone,
  id,
  type Board,
  type Catalog,
  type Config,
  type Field,
  type Inspection,
  type MonView,
  type Pokemon,
  type Progress,
  type SearchResult,
  type Conditions,
} from './types';
import { ItemIcon, Modal, Num, Sprite, TypeBadge } from './ui';
import Editor, { startingSet } from './Editor';
import Results from './Results';
import { exportTeam, importTeam } from './imports';
const emptyConditions = (): Conditions => ({
  tailwind: 0,
  reflect: 0,
  light_screen: 0,
  aurora_veil: 0,
});
const defaultConfig: Config = {
  budget_ms: 5000,
  sampling: {
    samples_per_cell: 32,
    max_turns: 256,
    seed: 1,
    threads: 0,
    policies: ['greedy', 'greedy'],
    confidence: 0.95,
  },
  solver: { iterations: 50000, tolerance: 0.001, algorithm: 'regret_matching_plus' },
};
const storageKey = 'vgc-gto-solver.workspace.v2';
function example(cat: Catalog): Board {
  const pick = (name: string) =>
    startingSet(
      cat.species.find((s) => s.name === name)!,
      cat,
    );
  return {
    position: {
      teams: [
        [pick('Incineroar'), pick('Rillaboom')],
        [
          { ...pick('Garchomp'), hp: 100 },
          { ...pick('Gardevoir'), hp: 100 },
        ],
      ],
      seed: 1,
    },
    history: [],
  };
}
function loadInitial(cat: Catalog): Board {
  try {
    const raw = location.hash.startsWith('#position=')
      ? decodeURIComponent(location.hash.slice(10))
      : localStorage.getItem(storageKey);
    if (!raw) return example(cat);
    const b = JSON.parse(raw) as Board;
    if (
      !b?.position ||
      !Array.isArray(b.history) ||
      b.history.length > 80 ||
      !Array.isArray(b.position.teams) ||
      b.position.teams.length !== 2
    )
      return example(cat);
    for (const team of b.position.teams) {
      if (!Array.isArray(team) || team.length > 2) return example(cat);
      for (const p of team)
        if (
          !p ||
          !cat.species.some((s) => s.id === id(p.species || '')) ||
          typeof p.ability !== 'string' ||
          !Array.isArray(p.moves) ||
          p.moves.some((m) => typeof m !== 'string') ||
          !Array.isArray(p.points) ||
          p.points.length !== 6 ||
          p.points.some((v) => !Number.isFinite(v))
        )
          return example(cat);
    }
    return b;
  } catch {
    return example(cat);
  }
}

function displayName(
  cat: Catalog,
  kind: 'items' | 'abilities' | 'moves',
  v: string | null | undefined,
) {
  return v ? cat[kind].find((x) => x.id === id(v))?.name || v : 'None';
}
function Card({
  p,
  mon,
  side,
  slot,
  cat,
  onEdit,
  locked,
}: {
  p?: Pokemon;
  mon?: MonView;
  side: number;
  slot: number;
  cat: Catalog;
  onEdit: () => void;
  locked: boolean;
}) {
  const sp = p ? cat.species.find((s) => s.id === id(p.species)) : undefined;
  const name = mon?.species || p?.species;
  const hp = mon?.hp ?? p?.hp ?? 0,
    max = mon?.maxhp || 0;
  const types = mon?.types || sp?.types || [];
  const moves = mon?.moves.map((m) => m.id) || p?.moves || [];
  const boosted = Object.entries(mon?.boosts || {}).filter(([, v]) => v !== 0);
  return (
    <button
      className={
        'pokemon-card side-' +
        side +
        (!p ? ' empty-card' : '') +
        (hp === 0 && mon ? ' fainted' : '')
      }
      aria-label={
        p ? `Edit Player ${side + 1} ${p.species}` : `Add Player ${side + 1} slot ${slot + 1}`
      }
      onClick={onEdit}
      disabled={locked}
    >
      {!p ? (
        <>
          <Plus size={25} />
          <strong>Empty slot {slot === 0 ? 'A' : 'B'}</strong>
          <span>Add Pokémon</span>
        </>
      ) : (
        <>
          <div className="card-top">
            <span className="slot-id">
              P{side + 1}
              {slot === 0 ? 'A' : 'B'}
            </span>
            <span className="card-species">{name}</span>
            <Pencil size={13} />
          </div>
          <div className="card-main">
            <Sprite name={name!} />
            <div className="card-info">
              <div className="types">
                {types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
                {mon?.status && <span className="status-badge">{mon.status}</span>}
              </div>
              <strong className="ability-name">
                {displayName(cat, 'abilities', mon?.ability || p.ability)}
              </strong>
              <div className="item-name">
                {(mon ? mon.item : p.item) && (
                  <ItemIcon name={displayName(cat, 'items', mon ? mon.item : p.item)} />
                )}
                <span>{displayName(cat, 'items', mon ? mon.item : p.item)}</span>
              </div>
              <small>{p.nature} · Lv. 50</small>
            </div>
          </div>
          <div className="health">
            <div>
              <span>{hp === 0 && mon ? 'FAINTED' : 'HP'}</span>
              <b>
                {mon ? hp : '—'} <small>/ {max || '—'}</small>
              </b>
              <span>{max ? Math.round((hp / max) * 100) : 100}%</span>
            </div>
            <i>
              <span
                className={hp / max < 0.21 ? 'low' : hp / max < 0.51 ? 'mid' : ''}
                style={{ width: `${max ? (hp / max) * 100 : 100}%` }}
              />
            </i>
          </div>
          <div className="card-moves">
            {moves.map((m, i) => {
              const mv = cat.moves.find((x) => x.id === id(m));
              return (
                <span
                  key={i}
                  title={`${mv?.description || ''}${mon ? ` · ${mon.moves[i].pp}/${mon.moves[i].maxpp} PP` : ''}`}
                >
                  <i className={'move-dot ' + (mv?.type || 'Normal').toLowerCase()} />
                  {mv?.name || m}
                </span>
              );
            })}
          </div>
          <div className="card-bottom">
            <span>
              {boosted.length
                ? boosted.map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k.toUpperCase()}`).join(' · ')
                : 'No stat changes'}
            </span>
            <span>
              {name?.includes('-Mega')
                ? 'MEGA EVOLVED'
                : sp?.usage
                  ? `#${sp.usage.rank} usage`
                  : ''}
            </span>
          </div>
        </>
      )}
    </button>
  );
}
function ImportDialog({
  side,
  cat,
  onClose,
  onApply,
}: {
  side: number;
  cat: Catalog;
  onClose: () => void;
  onApply: (p: Pokemon[]) => void;
}) {
  const [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [roster, setRoster] = useState<Pokemon[]>([]),
    [chosen, setChosen] = useState<number[]>([]);
  async function parse() {
    setBusy(true);
    setError('');
    try {
      let source = text;
      if (/^https?:\/\//i.test(text.trim())) {
        source = (await api<{ text: string }>('import', { url: text.trim() })).text;
        setText(source);
      }
      const mons = importTeam(source, cat, confirm);
      await Promise.all(mons.map((p) => api('validate', p)));
      setRoster(mons);
      setChosen(mons.slice(0, 2).map((_, i) => i));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Import Player ${side + 1} team`} onClose={onClose} wide>
      <div className="modal-body">
        <p className="muted">
          Paste a Showdown export, a Champions set with <code>SPs:</code>, or a{' '}
          <code>https://pokepast.es/…</code> link. Imports are validated by the pinned Champions
          engine.
        </p>
        <textarea
          aria-label="Team import text"
          rows={10}
          placeholder={
            'Garchomp @ Clear Amulet\nAbility: Rough Skin\nLevel: 50\nSPs: 32 Atk / 2 SpD / 32 Spe\nJolly Nature\n- Earthquake\n- Dragon Claw\n- Rock Slide\n- Protect'
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRoster([]);
          }}
        />
        <label className="check import-confirm">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I confirm any “EVs” numbers are already Champions stat points.
        </label>
        <small className="muted">
          No EV-to-SP conversion. Limits remain 32 per stat / 66 total. Custom IVs and Tera fields
          are rejected.
        </small>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {roster.length > 0 && (
          <>
            <h3>
              Select up to two active Pokémon <span>{chosen.length} / 2</span>
            </h3>
            <div className="roster">
              {roster.map((p, i) => (
                <button
                  aria-pressed={chosen.includes(i)}
                  key={i}
                  className={chosen.includes(i) ? 'selected' : ''}
                  onClick={() =>
                    setChosen(
                      chosen.includes(i)
                        ? chosen.filter((x) => x !== i)
                        : chosen.length < 2
                          ? [...chosen, i]
                          : chosen,
                    )
                  }
                >
                  <Sprite name={p.species} />
                  <span>
                    {p.species}
                    <small>{p.item || 'No item'}</small>
                  </span>
                  {chosen.includes(i) && <Check size={16} />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <footer>
        <button onClick={onClose}>Cancel</button>
        {roster.length ? (
          <button
            className="primary"
            disabled={!chosen.length}
            onClick={() => onApply(chosen.map((i) => roster[i]))}
          >
            Place selected Pokémon <ArrowRight size={15} />
          </button>
        ) : (
          <button className="primary" disabled={busy || !text.trim()} onClick={parse}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Import size={15} />} Validate
            import
          </button>
        )}
      </footer>
    </Modal>
  );
}
function SavedDialog({
  board,
  onLoad,
  onClose,
  notify,
}: {
  board: Board;
  onLoad: (b: Board) => void;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(''),
    [saved, setSaved] = useState<Record<string, Board>>(() => {
      try {
        return JSON.parse(localStorage.getItem('vgc-gto-solver.saved.v1') || '{}');
      } catch {
        return {};
      }
    }),
    [error, setError] = useState('');
  function update(v: Record<string, Board>) {
    setSaved(v);
    localStorage.setItem('vgc-gto-solver.saved.v1', JSON.stringify(v));
  }
  return (
    <Modal title="Saved positions" onClose={onClose}>
      <div className="modal-body">
        <div className="inline">
          <input
            aria-label="Position name"
            placeholder="Name this position…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() => {
              update({ ...saved, [name.trim()]: clone(board) });
              setName('');
              notify('Position saved locally');
            }}
          >
            <Save size={15} />
            Save
          </button>
        </div>
        <p className="muted">Positions and seeded turn history stay in this browser.</p>
        {Object.entries(saved).map(([n, b]) => (
          <div className="saved-row" key={n}>
            <span>
              <strong>{n}</strong>
              <small>
                {b.position.teams
                  .flat()
                  .map((p) => p.species)
                  .join(' · ')}
              </small>
            </span>
            <button
              onClick={() => {
                onLoad(clone(b));
                onClose();
              }}
            >
              Load
            </button>
            <button
              className="icon danger"
              aria-label={`Delete ${n}`}
              onClick={() => {
                const v = { ...saved };
                delete v[n];
                update(v);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <label className="file-button">
          <Upload size={15} />
          Import position JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              try {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 1048576) throw new Error('Position exceeds 1 MiB');
                const b = JSON.parse(await f.text());
                await api('inspect', b);
                onLoad(b);
                onClose();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
function download(board: Board) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vgc-gto-solver-position.json';
  a.click();
  URL.revokeObjectURL(url);
}
function Workspace({ cat }: { cat: Catalog }) {
  const [board, setBoard] = useState<Board>(() => loadInitial(cat)),
    [inspection, setInspection] = useState<Inspection | null>(null),
    [inspectBusy, setInspectBusy] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [editor, setEditor] = useState<[number, number] | null>(null),
    [importSide, setImportSide] = useState<number | null>(null),
    [modal, setModal] = useState(''),
    [config, setConfig] = useState<Config>(defaultConfig),
    [result, setResult] = useState<SearchResult | null>(null),
    [job, setJob] = useState<number | null>(null),
    [starting, setStarting] = useState(false),
    [progress, setProgress] = useState<Progress | null>(null),
    [elapsed, setElapsed] = useState(0),
    [choices, setChoices] = useState<[string, string]>(['', '']),
    [turnSeed, setTurnSeed] = useState(1),
    [advanceBusy, setAdvanceBusy] = useState(false),
    [showField, setShowField] = useState(false);
  const version = useRef(0),
    jobRef = useRef<number | null>(null),
    turnRef = useRef<HTMLElement>(null);
  const notify = useCallback((s: string) => {
    setToast(s);
    setTimeout(() => setToast(''), 3500);
  }, []);
  const change = useCallback((b: Board) => {
    version.current++;
    if (jobRef.current !== null) {
      void api(`jobs/${jobRef.current}/cancel`, {});
      jobRef.current = null;
      setJob(null);
    }
    setBoard(b);
    setResult(null);
    setProgress(null);
    setError('');
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(board));
    } catch {
      notify('Browser storage is full; export this position to keep it.');
    }
    const controller = new AbortController();
    setInspectBusy(true);
    setInspection(null);
    const timer = setTimeout(
      () =>
        api<Inspection>('inspect', board, controller.signal)
          .then((v) => {
            setInspection(v);
            setError('');
            setChoices(v.actions.map((a) => a[0]?.choice || '') as [string, string]);
          })
          .catch((e) => {
            if (e.name !== 'AbortError') setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setInspectBusy(false);
          }),
      60,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [board, notify]);
  useEffect(() => {
    if (job === null) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const start = performance.now();
    const tick = setInterval(() => setElapsed(performance.now() - start), 100);
    async function poll() {
      try {
        const v = await api<{
          status: string;
          progress: Progress;
          result: SearchResult | null;
          error: string | null;
        }>(`jobs/${job}`);
        if (disposed) return;
        setProgress(v.progress);
        if (v.status === 'complete') {
          setResult(v.result);
          setJob(null);
          jobRef.current = null;
          notify('Solve complete');
        } else if (v.status === 'error' || v.status === 'cancelled') {
          if (v.error && v.status !== 'cancelled') setError(v.error);
          setJob(null);
          jobRef.current = null;
        } else timer = setTimeout(poll, 300);
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          setJob(null);
          jobRef.current = null;
        }
      }
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [job, notify]);
  async function solve() {
    setError('');
    setStarting(true);
    setResult(null);
    setElapsed(0);
    const v = version.current;
    try {
      const r = await api<{ id: number }>('solve', { board, config });
      if (v !== version.current) {
        await api(`jobs/${r.id}/cancel`, {});
        return;
      }
      jobRef.current = r.id;
      setJob(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function cancel() {
    if (jobRef.current !== null) {
      await api(`jobs/${jobRef.current}/cancel`, {});
      jobRef.current = null;
    }
    setJob(null);
    setProgress(null);
    notify('Solve cancelled');
  }
  function updatePokemon(side: number, slot: number, p: Pokemon | null) {
    const b = clone(board);
    if (p) b.position.teams[side][slot] = p;
    else b.position.teams[side].splice(slot, 1);
    b.position.teams[side] = b.position.teams[side].filter(Boolean);
    b.history = [];
    change(b);
    setEditor(null);
  }
  const locked = board.history.length > 0;
  const names = inspection
    ? inspection.state.sides.map((s) => s.pokemon.map((p) => p.species))
    : board.position.teams.map((t) => t.map((p) => p.species));
  function actualField(): Field {
    const f = inspection?.state.field as
      | {
          weather?: string | null;
          terrain?: string | null;
          weatherState?: { duration?: number };
          terrainState?: { duration?: number };
          pseudoWeather?: Record<string, { duration?: number }>;
        }
      | undefined;
    return (
      (!locked && board.position.field) || {
        weather: f?.weather || null,
        weather_turns: f?.weatherState?.duration || 0,
        terrain: f?.terrain || null,
        terrain_turns: f?.terrainState?.duration || 0,
        trick_room: f?.pseudoWeather?.trickroom?.duration || 0,
      }
    );
  }
  const field = actualField();
  const liveConditions = inspection?.state.sides.map((side) => {
    const get = (key: string) =>
      (side.sideConditions?.[key] as { duration?: number } | undefined)?.duration || 0;
    return {
      tailwind: get('tailwind'),
      reflect: get('reflect'),
      light_screen: get('lightscreen'),
      aurora_veil: get('auroraveil'),
    };
  }) as [Conditions, Conditions] | undefined;
  const conditions = locked
    ? liveConditions || [emptyConditions(), emptyConditions()]
    : board.position.side_conditions || liveConditions || [emptyConditions(), emptyConditions()];
  function updateField(v: Partial<Field>) {
    const b = clone(board);
    b.position.field = { ...actualField(), ...v };
    change(b);
  }
  async function advance() {
    setAdvanceBusy(true);
    setError('');
    try {
      const step = { choices, seed: turnSeed };
      await api<Inspection>('advance', { board, step });
      const b = clone(board);
      b.history.push(step);
      change(b);
      notify('Turn advanced by the native engine');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdvanceBusy(false);
    }
  }
  const busy = job !== null || starting;
  function setSettings(c: Config) {
    version.current++;
    setConfig(c);
    setResult(null);
  }
  return (
    <>
      <header className="app-header">
        <a href={import.meta.env.BASE_URL} className="brand" aria-label="vgc-gto-solver home">
          <span className="brand-mark">
            V<span>G</span>
          </span>
          <strong>
            vgc-gto-solver<small>STRATEGY WORKSPACE</small>
          </strong>
        </a>
        <div className="format-badge">
          <ShieldCheck size={15} />
          <span>
            CHAMPIONS <b>REG M-C</b>
          </span>
          <ChevronDown size={12} />
        </div>
        <div className="header-right">
          <span className="engine-status">
            <i /> Native engine online
          </span>
          <a
            className="icon"
            href="https://github.com/sandsowkd/vgc-gto-solver"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
          >
            <GitBranch size={18} />
          </a>
        </div>
      </header>
      <main>
        <div className="workspace-top">
          <div>
            <div className="eyebrow">FULL INFORMATION · NO RESERVES</div>
            <h1>
              Battle workspace{' '}
              <span>Turn {inspection?.state.turn || board.position.turn || 1}</span>
            </h1>
          </div>
          <div className="workspace-actions">
            <button onClick={() => setModal('saved')}>
              <FolderOpen size={15} />
              Positions
            </button>
            <button
              className="icon"
              aria-label="Export position JSON"
              title="Export position JSON"
              onClick={() => download(board)}
            >
              <Download size={16} />
            </button>
            <button
              aria-label="Copy share link"
              onClick={async () => {
                const link =
                  location.origin +
                  location.pathname +
                  '#position=' +
                  encodeURIComponent(JSON.stringify(board));
                if (link.length > 16000) {
                  notify('History is too long for a share link. Export JSON instead.');
                  return;
                }
                try {
                  await navigator.clipboard.writeText(link);
                  notify('Position link copied');
                } catch {
                  notify('Clipboard unavailable. Export JSON instead.');
                }
              }}
            >
              <Share2 size={14} />
              <span>Share</span>
            </button>
            <button
              className="icon"
              aria-label="Reset example"
              title="Reset to example position"
              onClick={() => {
                change(example(cat));
                location.hash = '';
                notify('Example position restored');
              }}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>
        <section className="battle-board" aria-label="Battle board">
          <div className="sides-head">
            <div className="side-label p0">
              <span>01</span>
              <strong>PLAYER 1</strong>
              <small>Your side</small>
              <button onClick={() => setImportSide(0)} disabled={locked}>
                <Import size={13} />
                Import team
              </button>
              <button
                className="icon"
                title="Export Player 1 team"
                aria-label="Export Player 1 team"
                onClick={() => setModal('export0')}
              >
                <Copy size={13} />
              </button>
            </div>
            <div className="side-label p1">
              <span>02</span>
              <strong>PLAYER 2</strong>
              <small>Opponent</small>
              <button onClick={() => setImportSide(1)} disabled={locked}>
                <Import size={13} />
                Import team
              </button>
              <button
                className="icon"
                title="Export Player 2 team"
                aria-label="Export Player 2 team"
                onClick={() => setModal('export1')}
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
          <div className="board-cards">
            {[0, 1].map((side) => (
              <div className={'team-cards team-' + side} key={side}>
                {[0, 1].map((slot) => (
                  <Card
                    key={slot}
                    p={board.position.teams[side][slot]}
                    mon={inspection?.state.sides[side]?.pokemon[slot]}
                    side={side}
                    slot={slot}
                    cat={cat}
                    locked={locked}
                    onEdit={() => setEditor([side, slot])}
                  />
                ))}
              </div>
            ))}
            <div className="versus">
              <Swords size={17} />
            </div>
          </div>
          <div className="field-bar">
            <span className="field-label">
              <Sun size={14} /> FIELD
            </span>
            <label>
              Weather
              <select
                aria-label="Weather"
                disabled={locked}
                value={field.weather || ''}
                onChange={(e) =>
                  updateField({
                    weather: e.target.value || null,
                    weather_turns: e.target.value ? 5 : 0,
                  })
                }
              >
                <option value="">Clear</option>
                {[
                  ['sunnyday', 'Sun'],
                  ['raindance', 'Rain'],
                  ['sandstorm', 'Sandstorm'],
                  ['snow', 'Snow'],
                ].map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {field.weather && (
              <Num
                label="Weather turns"
                disabled={locked}
                value={field.weather_turns}
                max={8}
                onChange={(v) => updateField({ weather_turns: v })}
              />
            )}
            <label>
              Terrain
              <select
                aria-label="Terrain"
                disabled={locked}
                value={field.terrain || ''}
                onChange={(e) =>
                  updateField({
                    terrain: e.target.value || null,
                    terrain_turns: e.target.value ? 5 : 0,
                  })
                }
              >
                <option value="">None</option>
                {[
                  ['grassyterrain', 'Grassy'],
                  ['electricterrain', 'Electric'],
                  ['psychicterrain', 'Psychic'],
                  ['mistyterrain', 'Misty'],
                ].map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                disabled={locked}
                checked={field.trick_room > 0}
                onChange={(e) => updateField({ trick_room: e.target.checked ? 5 : 0 })}
              />
              Trick Room
            </label>
            <button
              className={'subtle field-more ' + (showField ? 'active' : '')}
              onClick={() => setShowField(!showField)}
            >
              <Settings2 size={14} />
              Field settings
              <ChevronDown size={12} />
            </button>
          </div>
          {showField && (
            <fieldset className="advanced-field" disabled={locked}>
              <div className="form-grid">
                <Num
                  label="Terrain turns"
                  value={field.terrain_turns}
                  max={8}
                  onChange={(v) => updateField({ terrain_turns: v })}
                />
                <Num
                  label="Trick Room turns"
                  value={field.trick_room}
                  max={5}
                  onChange={(v) => updateField({ trick_room: v })}
                />
                <Num
                  label="Current turn"
                  value={board.position.turn || 1}
                  min={1}
                  max={10000}
                  onChange={(v) => {
                    const b = clone(board);
                    b.position.turn = v;
                    change(b);
                  }}
                />
              </div>
              <div className="conditions">
                {[0, 1].map((side) => (
                  <section key={side}>
                    <h3 className={'p' + side}>Player {side + 1} side conditions</h3>
                    <div className="form-grid">
                      {(['tailwind', 'reflect', 'light_screen', 'aurora_veil'] as const).map(
                        (key) => (
                          <Num
                            key={key}
                            label={`P${side + 1} ${key.replaceAll('_', ' ')} turns`}
                            max={key === 'tailwind' ? 4 : 8}
                            value={conditions[side][key]}
                            onChange={(v) => {
                              const b = clone(board);
                              b.position.side_conditions = clone(conditions) as [
                                Conditions,
                                Conditions,
                              ];
                              b.position.side_conditions[side][key] = v;
                              change(b);
                            }}
                          />
                        ),
                      )}
                    </div>
                  </section>
                ))}
              </div>
              <small className="muted">
                Durations are remaining turns. Leaving field controls untouched preserves entry
                abilities.
              </small>
            </fieldset>
          )}
          {locked && (
            <div className="history-notice">
              <GitBranch size={14} />
              <span>
                Exploring engine history · {board.history.length} decision
                {board.history.length === 1 ? '' : 's'}. Return to setup to edit the starting teams
                and field.
              </span>
              <button
                onClick={() => {
                  const b = clone(board);
                  b.history = [];
                  change(b);
                }}
              >
                Return to setup
              </button>
            </div>
          )}
        </section>
        <section className="solve-panel">
          <div className="solve-main">
            <div className="budget">
              <span className="control-label">
                <Clock3 size={13} />
                SOLVE BUDGET
              </span>
              <div className="segmented">
                {[1, 2, 5, 10, 30].map((t) => (
                  <button
                    disabled={busy}
                    key={t}
                    className={config.budget_ms === t * 1000 ? 'selected' : ''}
                    onClick={() => setSettings({ ...config, budget_ms: t * 1000 })}
                  >
                    {t}s
                  </button>
                ))}
                <label className="custom-budget">
                  <input
                    aria-label="Custom solve budget seconds"
                    disabled={busy}
                    type="number"
                    min=".001"
                    max="60"
                    step=".1"
                    value={config.budget_ms / 1000}
                    onChange={(e) =>
                      setSettings({
                        ...config,
                        budget_ms: Math.max(1, Math.min(60000, Math.round(+e.target.value * 1000))),
                      })
                    }
                  />
                  <span>s</span>
                </label>
              </div>
            </div>
            <div className="solve-context">
              <span>
                <Activity size={14} />
                {inspection
                  ? `${inspection.actions[0].length} × ${inspection.actions[1].length}`
                  : '—'}{' '}
                <small>joint actions</small>
              </span>
              <span>
                {config.sampling.samples_per_cell} <small>samples / pair requested</small>
              </span>
            </div>
            {busy ? (
              <button className="cancel-button" onClick={cancel} disabled={starting}>
                <Square size={15} />
                Cancel solve
              </button>
            ) : (
              <button
                className="primary solve-button"
                onClick={solve}
                disabled={inspectBusy || !inspection || inspection.ended}
              >
                <Play size={16} fill="currentColor" />
                Solve position<span>↵</span>
              </button>
            )}
          </div>
          <details className="solver-settings">
            <summary>
              <Settings2 size={13} /> Advanced solver settings{' '}
              <span>
                {config.sampling.policies[0]} continuation · RM
                {config.solver.algorithm.endsWith('plus') ? '+' : ''} · seed {config.sampling.seed}
              </span>
            </summary>
            <fieldset disabled={busy}>
              <div className="settings-grid">
                <Num
                  label="Samples per action pair"
                  value={config.sampling.samples_per_cell}
                  min={1}
                  max={4096}
                  onChange={(v) =>
                    setSettings({
                      ...config,
                      sampling: { ...config.sampling, samples_per_cell: v },
                    })
                  }
                />
                <Num
                  label="Simulation seed"
                  value={config.sampling.seed}
                  max={4294967295}
                  onChange={(v) =>
                    setSettings({ ...config, sampling: { ...config.sampling, seed: v } })
                  }
                />
                <Num
                  label="Threads (0 = auto)"
                  value={config.sampling.threads}
                  max={cat.limits.max_threads}
                  onChange={(v) =>
                    setSettings({ ...config, sampling: { ...config.sampling, threads: v } })
                  }
                />
                <Num
                  label="Rollout turn cap"
                  value={config.sampling.max_turns}
                  min={1}
                  max={512}
                  onChange={(v) =>
                    setSettings({ ...config, sampling: { ...config.sampling, max_turns: v } })
                  }
                />
                {[0, 1].map((side) => (
                  <label key={side}>
                    Player {side + 1} continuation
                    <select
                      aria-label={`Player ${side + 1} continuation`}
                      value={config.sampling.policies[side]}
                      onChange={(e) => {
                        const policies = [...config.sampling.policies] as [string, string];
                        policies[side] = e.target.value;
                        setSettings({ ...config, sampling: { ...config.sampling, policies } });
                      }}
                    >
                      <option value="greedy">Greedy damage baseline</option>
                      <option value="tactical">Tactical heuristic</option>
                      <option value="random">Uniform random</option>
                    </select>
                  </label>
                ))}
                <label>
                  Algorithm
                  <select
                    aria-label="Solver algorithm"
                    value={config.solver.algorithm}
                    onChange={(e) =>
                      setSettings({
                        ...config,
                        solver: { ...config.solver, algorithm: e.target.value },
                      })
                    }
                  >
                    <option value="regret_matching_plus">Regret matching+</option>
                    <option value="regret_matching">Regret matching</option>
                  </select>
                </label>
                <Num
                  label="Matrix iterations"
                  value={config.solver.iterations}
                  min={100}
                  max={500000}
                  onChange={(v) =>
                    setSettings({ ...config, solver: { ...config.solver, iterations: v } })
                  }
                />
                <Num
                  label="Nash gap tolerance"
                  value={config.solver.tolerance}
                  min={0}
                  max={1}
                  step={0.0001}
                  onChange={(v) =>
                    setSettings({ ...config, solver: { ...config.solver, tolerance: v } })
                  }
                />
              </div>
              <p className="muted">
                A budget is a soft sampling deadline. An already-started rollout completes unless
                cancelled. More samples reduce Monte Carlo noise; continuation policies still
                introduce model bias.
              </p>
            </fieldset>
          </details>
          {busy && (
            <div className="solve-progress" role="status">
              <div>
                <LoaderCircle size={16} className="spin" />
                <strong>
                  {starting
                    ? 'Starting native solve…'
                    : progress?.phase === 'solving'
                      ? 'Minimizing matrix regret…'
                      : 'Simulating complete battles…'}
                </strong>
                <span>{(elapsed / 1000).toFixed(1)}s elapsed</span>
              </div>
              <progress max={progress?.pairs || 1} value={progress?.covered || 0} />
              <small>
                {progress?.covered.toLocaleString() || 0} /{' '}
                {progress?.pairs.toLocaleString() || '—'} pairs covered ·{' '}
                {progress?.samples.toLocaleString() || 0} simulations
                {progress?.iterations
                  ? ` · ${progress.iterations.toLocaleString()} iterations · gap ${progress.nash_gap?.toFixed(5)}`
                  : ''}
              </small>
            </div>
          )}
        </section>
        {error && (
          <div className="error main-error" role="alert">
            <Info size={17} />
            <span>{error}</span>
            <button className="subtle" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}
        {result ? (
          <Results
            r={result}
            cat={cat}
            names={names}
            onUse={(a) => {
              setChoices(a);
              turnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              notify('Joint actions loaded in Turn explorer');
            }}
          />
        ) : (
          !busy && (
            <section className="results-placeholder">
              <div className="placeholder-grid">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <div>
                <h2>Your next decision, quantified.</h2>
                <p>
                  Configure the battle above, then solve to explore correlated joint strategies,
                  expected utility, and the root payoff matrix.
                </p>
                <small>
                  <Info size={12} /> Fixed continuation policies · Monte Carlo estimates · Full
                  information
                </small>
              </div>
            </section>
          )
        )}
        <section className="turn-explorer" ref={turnRef}>
          <header>
            <div>
              <h2>
                <GitBranch size={17} />
                Turn explorer <span>Native simulation</span>
              </h2>
              <p>
                Choose both sides’ actions before advancing. Undo replays the same seeded history.
              </p>
            </div>
            <div className="inline">
              <button
                disabled={!locked}
                onClick={() => {
                  const b = clone(board);
                  b.history.pop();
                  change(b);
                }}
              >
                <Undo2 size={14} />
                Undo
              </button>
              <button
                disabled={!locked}
                onClick={() => {
                  const b = clone(board);
                  b.history = [];
                  change(b);
                }}
              >
                <RotateCcw size={14} />
                Restart
              </button>
            </div>
          </header>
          {inspection?.ended ? (
            <div className="battle-ended">
              {inspection.winner === null
                ? 'Battle ended in a draw'
                : `Player ${inspection.winner + 1} wins`}{' '}
              · Undo or restart to explore another line.
            </div>
          ) : (
            <div className="turn-controls">
              {[0, 1].map((side) => (
                <label key={side} className={'p' + side}>
                  PLAYER {side + 1} JOINT ACTION
                  <select
                    aria-label={`Player ${side + 1} turn action`}
                    value={choices[side]}
                    disabled={!inspection}
                    onChange={(e) => {
                      const c = [...choices] as [string, string];
                      c[side] = e.target.value;
                      setChoices(c);
                    }}
                  >
                    {inspection?.actions[side].map((a) => (
                      <option key={a.index} value={a.choice}>
                        #{a.index + 1} {a.description.join(' + ')}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <Num label="Turn RNG seed" value={turnSeed} max={4294967295} onChange={setTurnSeed} />
              <button
                className="advance-button"
                disabled={!inspection || advanceBusy || busy}
                onClick={advance}
              >
                {advanceBusy ? <LoaderCircle size={15} className="spin" /> : <Swords size={15} />}
                Advance
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {inspection?.events.length ? (
            <details className="battle-log" open>
              <summary>Battle events · {board.history.length} seeded decisions</summary>
              <div>
                {inspection.events
                  .filter(
                    (l) => l.split('|').some((part) => part.trim()) && !l.startsWith('|request'),
                  )
                  .map((l, i) => (
                    <p key={i}>{l.split('|').filter(Boolean).join(' · ')}</p>
                  ))}
              </div>
            </details>
          ) : (
            <div className="no-events">
              Turn events will appear here after you advance the battle.
            </div>
          )}
        </section>
        <footer className="app-footer">
          <span>
            <span className="live-dot" /> vgc-gto-solver <b>RESEARCH PREVIEW</b>
          </span>
          <span>
            Data snapshot {cat.version} ·{' '}
            <button onClick={() => setModal('sources')}>Sources & interpretation</button>
          </span>
          <span>
            Saved automatically in this browser <Check size={12} />
          </span>
        </footer>
      </main>
      {editor && (
        <Editor
          key={editor.join('-')}
          cat={cat}
          side={editor[0]}
          slot={editor[1]}
          snapshot={inspection?.state.sides[editor[0]]?.pokemon[editor[1]]}
          pokemon={
            board.position.teams[editor[0]][editor[1]] ||
            startingSet(
              cat.species.find((s) => s.name === 'Garchomp')!,
              cat,
            )
          }
          onClose={() => setEditor(null)}
          onSave={(p) => updatePokemon(editor[0], editor[1], p)}
          onRemove={() => updatePokemon(editor[0], editor[1], null)}
        />
      )}
      {importSide !== null && (
        <ImportDialog
          cat={cat}
          side={importSide}
          onClose={() => setImportSide(null)}
          onApply={(p) => {
            const b = clone(board);
            b.position.teams[importSide] = p;
            b.history = [];
            change(b);
            setImportSide(null);
            notify('Team imported and validated');
          }}
        />
      )}
      {modal === 'saved' && (
        <SavedDialog board={board} onLoad={change} onClose={() => setModal('')} notify={notify} />
      )}
      {modal.startsWith('export') && (
        <Modal
          title={`Export Player ${Number(modal.slice(-1)) + 1} team`}
          onClose={() => setModal('')}
        >
          <div className="modal-body">
            <p className="muted">
              Champions SPs are exported explicitly. This exports the starting sets; use JSON to
              preserve turn history.
            </p>
            <textarea
              aria-label="Team export text"
              rows={16}
              readOnly
              value={exportTeam(board.position.teams[Number(modal.slice(-1))])}
            />
            <button
              className="primary"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  exportTeam(board.position.teams[Number(modal.slice(-1))]),
                );
                notify('Team export copied');
              }}
            >
              <Copy size={14} />
              Copy team
            </button>
          </div>
        </Modal>
      )}
      {modal === 'sources' && (
        <Modal title="Data & interpretation" onClose={() => setModal('')}>
          <div className="modal-body prose">
            <p>
              The engine uses the pinned <b>Champions 2026 Regulation M-C</b> snapshot from Ninjask
              / Pokémon Showdown. This is a fixed research format, not an automatic live rules
              update.
            </p>
            <p>
              Complete presets come from the published VGCPastes team pool pinned with Ninjask. Each
              preset links to its team source. Counts describe this curated pool; they are not
              population usage estimates.
            </p>
            <p>
              Usage percentages:{' '}
              <a href={cat.provenance.usage.source} target="_blank" rel="noreferrer">
                Smogon {cat.provenance.usage.month} / 1500 cutoff
              </a>
              , {cat.provenance.usage.battles.toLocaleString()} battles. Moves, items, abilities,
              and spreads are independent marginals.
            </p>
            <p>
              Sprites and item artwork: Pokémon Showdown via MIT <code>@pkmn/img</code>; Pokémon
              artwork belongs to its respective owners. Text import/export uses MIT{' '}
              <code>@pkmn/sets</code>. The app requires network access for artwork only; game data
              and presets are bundled locally.
            </p>
            <p>
              Utility is win + ½ draw. Root equilibria depend on the chosen continuation policies; a
              small matrix Nash gap does not establish full-game optimality or tournament strength.
            </p>
            <p>
              Replay keeps engine state. Editing a replayed position returns to its setup; arbitrary
              current-state volatiles and consumed-item snapshots are not editable in this version.
            </p>
            <a href="https://github.com/sandsowkd/vgc-gto-solver" target="_blank" rel="noreferrer">
              Project, sources & licensing <ExternalLink size={12} />
            </a>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </>
  );
}
export default function App() {
  const [cat, setCat] = useState<Catalog | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api<Catalog>('catalog')
      .then(setCat)
      .catch((e) => setError(e.message));
  }, []);
  return cat ? (
    <Workspace cat={cat} />
  ) : (
    <div className="boot">
      <span className="brand-mark">VG</span>
      <h1>vgc-gto-solver</h1>
      {error ? (
        <>
          <p role="alert">Could not connect to the native backend.</p>
          <code>npm run dev</code>
          <p className="muted">{error}</p>
          <button onClick={() => location.reload()}>Retry connection</button>
        </>
      ) : (
        <p>
          <LoaderCircle className="spin" size={16} />
          Loading the Champions workspace…
        </p>
      )}
    </div>
  );
}
