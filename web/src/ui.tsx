import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Sprites, Icons } from '@pkmn/img';
import { id } from './types';
export function Sprite({ name, className = '' }: { name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [name]);
  return failed ? (
    <span className={'sprite fallback ' + className}>{name.slice(0, 2)}</span>
  ) : (
    <img
      className={'sprite ' + className}
      src={Sprites.getPokemon(name, { gen: 'gen5', protocol: 'https' }).url}
      alt={name}
      onError={() => setFailed(true)}
    />
  );
}
export function ItemIcon({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="item-icon"
      ref={(el) => {
        if (el) el.style.cssText = Icons.getItem(name).style;
      }}
    />
  );
}
export function TypeBadge({ type }: { type: string }) {
  return <span className={'type ' + type.toLowerCase()}>{type}</span>;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
type Option = { value: string; label: string; detail?: string; extra?: ReactNode };
export function Picker({
  label,
  value,
  options,
  onChange,
  placeholder = 'Search…',
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(''),
    [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const filtered = options.filter((o) => id(o.label).includes(id(q))).slice(0, 80);
  useEffect(() => {
    function close(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => {
    if (open)
      ref.current?.querySelector('.picker-options .active')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQ('');
  }
  return (
    <div className="picker" ref={ref}>
      <label>{label}</label>
      <button
        type="button"
        className="select-trigger"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setQ('');
          setActive(0);
        }}
      >
        {options.find((o) => o.value === value)?.label || value || 'None'}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="picker-menu">
          <div className="searchbox">
            <Search size={15} />
            <input
              autoFocus
              role="combobox"
              aria-label={`Search ${label}`}
              aria-expanded="true"
              aria-controls={'options-' + id(label)}
              aria-activedescendant={
                filtered[active] ? 'option-' + id(label) + '-' + active : undefined
              }
              placeholder={placeholder}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive(Math.min(active + 1, filtered.length - 1));
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive(Math.max(0, active - 1));
                }
                if (e.key === 'Enter' && filtered[active]) {
                  e.preventDefault();
                  choose(filtered[active].value);
                }
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
            />
          </div>
          <div className="picker-options" role="listbox" id={'options-' + id(label)}>
            {filtered.map((o, i) => (
              <button
                type="button"
                role="option"
                aria-selected={value === o.value}
                id={'option-' + id(label) + '-' + i}
                className={active === i ? 'active' : ''}
                key={o.value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
              >
                {o.extra}
                <span>
                  <strong>{o.label}</strong>
                  {o.detail && <small>{o.detail}</small>}
                </span>
                {value === o.value && <Check size={14} />}
              </button>
            ))}
            {!filtered.length && <p className="muted pad">No matches in this regulation.</p>}
          </div>
          <small className="picker-hint">↑ ↓ to browse · Enter to select</small>
        </div>
      )}
    </div>
  );
}
export function Num({
  label,
  value,
  onChange,
  min = 0,
  max = 999999,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="number-field">
      {label}
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
      />
    </label>
  );
}
