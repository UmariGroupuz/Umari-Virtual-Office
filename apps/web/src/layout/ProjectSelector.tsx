// Project selector (UX §3 #5, REQ-061): button + listbox "All Projects", Sellway, Ishkun24, ERP, Ana Market.
// When a project is selected: accent border and an inline clear button.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, FolderKanban, X } from 'lucide-react';
import { ALL_PROJECTS_LABEL, PROJECTS } from '@vo/shared';
import { COPY } from '../copy';
import { cn } from '../lib/cn';
import { useActions, useOffice } from '../lib/runtime';

interface Option {
  id: string | null;
  label: string;
}

const OPTIONS: readonly Option[] = [
  { id: null, label: ALL_PROJECTS_LABEL },
  ...PROJECTS.map((p) => ({ id: p.id, label: p.name })),
];

export function ProjectSelector({ fullWidth = false }: { fullWidth?: boolean }) {
  const projectFilter = useOffice((s) => s.ui.projectFilter);
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selectedIndex = Math.max(
    0,
    OPTIONS.findIndex((o) => o.id === projectFilter),
  );
  const current = OPTIONS[selectedIndex] ?? OPTIONS[0];
  const filtered = projectFilter !== null;

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openList = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };
  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };
  const choose = (index: number) => {
    const option = OPTIONS[index];
    if (option) actions.setProjectFilter(option.id);
    close(true);
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openList();
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(OPTIONS.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(OPTIONS.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn('relative flex items-center', fullWidth ? 'w-full' : 'w-[220px]')}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${COPY.projectSelector.label}: ${current?.label ?? ALL_PROJECTS_LABEL}`}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKeyDown}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-2 rounded-md border bg-bg-sunken pl-2.5 text-sm text-text-primary transition-colors duration-[120ms] hover:border-border-hover',
          filtered ? 'border-accent pr-9' : 'border-border-strong pr-2',
        )}
      >
        <FolderKanban
          aria-hidden="true"
          size={16}
          strokeWidth={1.75}
          className="shrink-0 text-text-secondary"
        />
        <span className="min-w-0 flex-1 truncate text-left">{current?.label}</span>
        {!filtered ? (
          <ChevronDown
            aria-hidden="true"
            size={16}
            strokeWidth={1.75}
            className="shrink-0 text-text-secondary"
          />
        ) : null}
      </button>
      {filtered ? (
        <button
          type="button"
          aria-label={COPY.projectSelector.clear}
          title={COPY.projectSelector.clear}
          onClick={() => actions.setProjectFilter(null)}
          className="absolute right-1 inline-flex size-6 items-center justify-center rounded-sm text-text-secondary hover:bg-raised hover:text-text-primary"
        >
          <X aria-hidden="true" size={14} strokeWidth={1.75} />
        </button>
      ) : null}
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={COPY.projectSelector.label}
          aria-activedescendant={`${listId}-opt-${activeIndex}`}
          onKeyDown={onListKeyDown}
          className="absolute top-full left-0 z-50 mt-1 w-full min-w-[200px] rounded-lg border border-border-subtle bg-raised p-1 shadow-overlay"
        >
          {OPTIONS.map((option, index) => {
            const selected = option.id === projectFilter;
            return (
              <li
                key={option.id ?? 'all'}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={selected}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex h-8 items-center rounded-md px-2.5 text-sm',
                  index === activeIndex
                    ? 'bg-raised-hover text-text-primary'
                    : 'text-text-secondary',
                  selected && 'font-semibold text-accent-text',
                )}
              >
                {option.label}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
