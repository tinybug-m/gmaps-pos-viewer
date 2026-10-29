/** Shown while a queue loads, so switching to another person's queue gives feedback. */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading queue…
      </span>
      <div className="flex flex-col gap-2" aria-hidden>
        <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-64 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="h-16 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" aria-hidden />
      <div className="h-64 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" aria-hidden />
    </div>
  );
}
