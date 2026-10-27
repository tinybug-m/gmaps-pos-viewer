/** Shown while the first page of leads loads. Filter changes keep the current list on screen instead. */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading leads…
      </span>
      <div className="flex flex-col gap-2" aria-hidden>
        <div className="h-7 w-40 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" aria-hidden />
      <div className="h-96 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" aria-hidden />
    </div>
  );
}
