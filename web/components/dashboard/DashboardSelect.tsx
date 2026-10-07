'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

type Placement = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

const GAP = 6;
const MAX_HEIGHT = 288;

// A dashboard-styled replacement for <select>. The list is portalled to <body> so cards with
// overflow-hidden never clip it, and it opens upwards when there is no room below.
export function Select({ value, onChange, options, ariaLabel, placeholder = 'Select...', disabled, className }: SelectProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const selectedIndex = options.findIndex(option => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - GAP - 8;
    const above = rect.top - GAP - 8;
    const width = Math.max(rect.width, 180);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const up = below < Math.min(MAX_HEIGHT, options.length * 38 + 8) && above > below;
    setPlacement(up
      ? { left, width, bottom: window.innerHeight - rect.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) }
      : { left, width, top: rect.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) });
  }, [options.length]);

  const openList = (index = selectedIndex) => {
    if (disabled || !options.length) return;
    place();
    setActive(index >= 0 ? index : 0);
    setOpen(true);
  };

  const close = (focus = true) => {
    setOpen(false);
    if (focus) buttonRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) close(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const findByText = (key: string) => {
    const now = Date.now();
    typeahead.current = { text: now - typeahead.current.at > 700 ? key : typeahead.current.text + key, at: now };
    const text = typeahead.current.text.toLowerCase();
    // One letter moves to the next match; a longer prefix keeps the current match while it still fits.
    const start = Math.max(0, (open ? active : selectedIndex) + (text.length === 1 ? 1 : 0));
    for (let step = 0; step < options.length; step += 1) {
      const index = (start + step) % options.length;
      const label = options[index].label.toLowerCase();
      if (label.startsWith(text) || label.replace(/^[#(@]+/, '').startsWith(text)) return index;
    }
    return -1;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openList(event.key === 'ArrowUp' && selectedIndex < 0 ? last : selectedIndex);
      } else if (event.key.length === 1 && /\S/.test(event.key)) {
        const match = findByText(event.key);
        if (match >= 0 && options[match].value !== value) onChange(options[match].value);
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActive(index => Math.min(last, index + 1)); break;
      case 'ArrowUp': event.preventDefault(); setActive(index => Math.max(0, index - 1)); break;
      case 'Home': event.preventDefault(); setActive(0); break;
      case 'End': event.preventDefault(); setActive(last); break;
      case 'PageDown': event.preventDefault(); setActive(index => Math.min(last, index + 8)); break;
      case 'PageUp': event.preventDefault(); setActive(index => Math.max(0, index - 8)); break;
      case 'Enter': case ' ': event.preventDefault(); choose(active); break;
      case 'Escape': event.preventDefault(); close(); break;
      case 'Tab': close(false); break;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const match = findByText(event.key);
          if (match >= 0) setActive(match);
        }
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`group inline-flex h-[38px] min-w-0 items-center justify-between gap-2 rounded-md border bg-bg-input px-3 text-left text-sm outline-none transition-colors font-[inherit] focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'border-accent ring-2 ring-accent/25' : 'border-border hover:border-border-light enabled:cursor-pointer'
        } ${className || ''}`}
      >
        <span className={`min-w-0 truncate ${selected ? 'text-text-primary' : 'text-text-muted'}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform duration-150 ${open ? 'rotate-180 text-accent-text' : 'group-hover:text-text-secondary'}`} />
      </button>
      {open && placement && createPortal(
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          style={{ left: placement.left, width: placement.width, top: placement.top, bottom: placement.bottom, maxHeight: placement.maxHeight }}
          className={`fixed z-[300] overflow-y-auto rounded-lg border border-border-light bg-bg-tertiary p-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)] ${
            placement.bottom !== undefined ? 'animate-select-up' : 'animate-select-down'
          }`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={isSelected}
                onPointerMove={() => setActive(index)}
                onPointerDown={event => event.preventDefault()}
                onClick={() => choose(index)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${
                  index === active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary'
                } ${isSelected ? 'font-medium text-text-primary' : ''}`}
              >
                <span className="min-w-0 flex-1 break-words">{option.label}</span>
                <Check size={14} className={`shrink-0 text-accent-text ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </>
  );
}
