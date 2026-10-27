import type { ReactNode } from "react";

export default function EmptyState({
  title,
  description,
  onClear,
  children,
}: {
  title: string;
  description: string;
  onClear?: () => void;
  /** Another way out of the empty state, such as a link to the import page. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-6 w-6"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 11a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM21 21l-4.35-4.35" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Clear filters
        </button>
      )}
      {children}
    </div>
  );
}
