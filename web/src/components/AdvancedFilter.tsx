'use client';

import { useState, useEffect, useMemo } from 'react';
import { Filter, X, ChevronDown } from 'lucide-react';

interface FilterOption {
  label: string;
  value: string;
}

interface FilterGroup {
  id: string;
  label: string;
  type: 'select' | 'multiselect' | 'date' | 'daterange' | 'text';
  options?: FilterOption[];
  value?: any;
}

interface AdvancedFilterProps {
  filters: FilterGroup[];
  onFilterChange: (filters: Record<string, any>) => void;
  onClear: () => void;
}

export default function AdvancedFilter({ filters, onFilterChange, onClear }: AdvancedFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState<Record<string, any>>(() => 
    filters.reduce((acc, f) => ({ ...acc, [f.id]: f.value }), {})
  );

  const filterSignature = useMemo(() => JSON.stringify(filters.map(f => ({ id: f.id, type: f.type, options: f.options }))), [filters]);

  useEffect(() => {
    setLocalFilters(filters.reduce((acc, f) => ({ ...acc, [f.id]: f.value }), {}));
  }, [filterSignature]);

  const handleFilterChange = (id: string, value: any) => {
    const updated = { ...localFilters, [id]: value };
    setLocalFilters(updated);
    onFilterChange(updated);
  };

  const handleClear = () => {
    const cleared = filters.reduce((acc, f) => ({ ...acc, [f.id]: undefined }), {});
    setLocalFilters(cleared);
    onFilterChange(cleared);
    onClear();
  };

  const activeFilterCount = Object.values(localFilters).filter(v => 
    v !== undefined && v !== '' && (Array.isArray(v) ? v.length > 0 : true)
  ).length;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition border ${
          activeFilterCount > 0
            ? 'bg-violet-600 border-violet-600 text-white'
            : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
        }`}
      >
        <Filter className="h-4 w-4" />
        Filters
        {activeFilterCount > 0 && (
          <span className="bg-violet-500 text-white text-xs px-1.5 py-0.5 rounded-full">
            {activeFilterCount}
          </span>
        )}
        <ChevronDown className={`h-4 w-4 transition ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="fixed left-1/2 -translate-x-1/2 top-24 w-[calc(100vw-2rem)] max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-30 p-4 max-h-[70vh] overflow-y-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:translate-x-0 sm:w-80 sm:max-h-none sm:overflow-visible">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Advanced Filters</h3>
              {activeFilterCount > 0 && (
                <button onClick={handleClear} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                  <X className="h-3 w-3" /> Clear All
                </button>
              )}
            </div>

            <div className="space-y-4">
              {filters.map((filter) => (
                <div key={filter.id}>
                  <label className="block text-xs text-slate-400 mb-1.5">{filter.label}</label>
                  {filter.type === 'select' && (
                    <select
                      value={localFilters[filter.id] || ''}
                      onChange={(e) => handleFilterChange(filter.id, e.target.value || undefined)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                    >
                      <option value="">All</option>
                      {filter.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                  {filter.type === 'multiselect' && (
                    <div className="space-y-1 max-h-32 overflow-y-auto border border-slate-700 rounded-lg p-2">
                      {filter.options?.map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(localFilters[filter.id] || []).includes(opt.value)}
                            onChange={(e) => {
                              const current = localFilters[filter.id] || [];
                              const updated = e.target.checked
                                ? [...current, opt.value]
                                : current.filter((v: string) => v !== opt.value);
                              handleFilterChange(filter.id, updated.length > 0 ? updated : undefined);
                            }}
                            className="rounded"
                          />
                          <span className="text-sm text-white">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {filter.type === 'date' && (
                    <input
                      type="date"
                      value={localFilters[filter.id] || ''}
                      onChange={(e) => handleFilterChange(filter.id, e.target.value || undefined)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                    />
                  )}
                  {filter.type === 'daterange' && (
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={localFilters[filter.id]?.from || ''}
                        onChange={(e) => {
                          const next = { ...(localFilters[filter.id] || {}), from: e.target.value };
                          handleFilterChange(filter.id, next.from || next.to ? { from: next.from || undefined, to: next.to || undefined } : undefined);
                        }}
                        placeholder="From"
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      />
                      <input
                        type="date"
                        value={localFilters[filter.id]?.to || ''}
                        onChange={(e) => {
                          const next = { ...(localFilters[filter.id] || {}), to: e.target.value };
                          handleFilterChange(filter.id, next.from || next.to ? { from: next.from || undefined, to: next.to || undefined } : undefined);
                        }}
                        placeholder="To"
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      />
                    </div>
                  )}
                  {filter.type === 'text' && (
                    <input
                      type="text"
                      value={localFilters[filter.id] || ''}
                      onChange={(e) => handleFilterChange(filter.id, e.target.value || undefined)}
                      placeholder="Search..."
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
