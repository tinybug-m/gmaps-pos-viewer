"use client";

import { useEffect, useRef, type ReactNode } from "react";

import LeadDetails from "@/components/LeadDetails";
import type { Lead } from "@/types/lead";

export default function LeadDetailDrawer({
  lead,
  onClose,
  actions,
}: {
  lead: Omit<Lead, "searchText">;
  onClose: () => void;
  /** Extra links or buttons shown under the title, e.g. "Open lead". */
  actions?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Move focus into the panel when it opens and give it back when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="lead-drawer-title">
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40"
      />

      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 id="lead-drawer-title" className="text-lg font-semibold text-slate-800">
              {lead.name}
            </h2>
            <p className="text-sm text-slate-500">
              {lead.category ? `${lead.category} · ` : ""}
              {lead.city}
            </p>
            {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5">
          <LeadDetails lead={lead} />
        </div>
      </div>
    </div>
  );
}
