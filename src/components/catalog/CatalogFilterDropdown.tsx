'use client';

import { ChevronDown } from 'lucide-react';
import {
  CATALOG_FILTER_ALL,
  type CatalogFilterKind,
} from '@/lib/catalogFilters';

export default function CatalogFilterDropdown({
  kind,
  label,
  value,
  options,
  isOpen,
  onToggle,
  onSelect,
}: {
  kind: CatalogFilterKind;
  label: string;
  value: string;
  options: string[];
  isOpen: boolean;
  onToggle: (kind: CatalogFilterKind) => void;
  onSelect: (value: string) => void;
}) {
  const selectedLabel = value === CATALOG_FILTER_ALL ? 'All' : value;

  return (
    <div className="relative z-[120] min-w-0 flex-1 md:max-w-[260px]" data-catalog-filter-menu>
      <button
        type="button"
        onClick={() => onToggle(kind)}
        aria-expanded={isOpen}
        className="group flex h-11 w-full items-center justify-between gap-3 rounded-full border border-white/20 bg-white/[0.08] px-4 text-left shadow-[0_14px_32px_rgba(0,0,0,0.22)] backdrop-blur-lg transition-all duration-300 hover:border-cyan-200/40 hover:bg-white/[0.12] md:h-12 md:px-5"
      >
        <span className="min-w-0">
          <span className="block text-[9px] font-black uppercase tracking-[0.24em] text-cyan-100/60">
            {label}
          </span>
          <span className="block truncate text-[12px] font-black uppercase tracking-[0.12em] text-white md:text-sm">
            {selectedLabel}
          </span>
        </span>
        <ChevronDown
          size={17}
          className={`shrink-0 text-white/70 transition-transform duration-300 ${
            isOpen ? 'rotate-180 text-cyan-100' : 'group-hover:text-white'
          }`}
        />
      </button>

      <div
        className={`absolute left-0 top-[calc(100%+0.6rem)] z-[130] w-full overflow-hidden rounded-3xl border border-white/20 bg-[#09101D]/95 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl transition-all duration-300 md:w-[min(34rem,calc(100vw-5rem))] ${
          isOpen
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-2 opacity-0'
        }`}
      >
        <div className="grid max-h-72 gap-1 overflow-y-auto p-2 [scrollbar-color:rgba(125,211,252,0.55)_rgba(255,255,255,0.08)] [scrollbar-width:thin] md:max-h-[22rem] md:grid-cols-2">
          <button
            type="button"
            onClick={() => onSelect(CATALOG_FILTER_ALL)}
            className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-[12px] font-black uppercase tracking-[0.14em] transition-colors md:col-span-2 ${
              value === CATALOG_FILTER_ALL
                ? 'bg-white text-[#07101C]'
                : 'text-white/80 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            All
          </button>

          {options.map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => onSelect(option)}
              className={`mt-1 flex w-full items-center rounded-2xl px-4 py-3 text-left text-[12px] font-bold transition-colors ${
                value === option
                  ? 'bg-cyan-300/95 text-[#07101C]'
                  : 'text-white/75 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <span className="truncate">{option}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
