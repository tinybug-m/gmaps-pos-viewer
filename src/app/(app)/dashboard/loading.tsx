/** Shown while the dashboard's numbers load, so switching the date range gives feedback. */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading dashboard…
      </span>
      <div className="h-7 w-40 animate-pulse rounded bg-slate-200" aria-hidden />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" aria-hidden />
    </div>
  );
}
