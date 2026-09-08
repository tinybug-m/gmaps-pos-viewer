"use client";

import { useEffect, useRef, useState } from "react";

export default function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(option: string) {
    const next = new Set(selected);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange(next);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium ${
          selected.size > 0
            ? "border-slate-400 bg-slate-50 text-slate-900"
            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
        }`}
      >
        {label}
        {selected.size > 0 && (
          <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white">
            {selected.size}
          </span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1.5 max-h-72 w-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg">
          {options.length === 0 && <p className="px-2 py-2 text-sm text-slate-400">No options</p>}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="mb-1 w-full rounded px-2 py-1.5 text-left text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Clear selection
            </button>
          )}
          {options.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.has(option)}
                onChange={() => toggle(option)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
