"use client";

import { useEffect } from "react";

import IssueList from "@/components/IssueList";
import PriorityBadge from "@/components/PriorityBadge";
import SourceBadge from "@/components/SourceBadge";
import StatusBadge from "@/components/StatusBadge";
import type { Lead } from "@/types/lead";

export default function LeadDetailDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40"
      />

      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{lead.name}</h2>
            <p className="text-sm text-slate-500">{lead.city}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-6 px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {lead.websiteUrl ? (
              <a
                href={lead.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Visit website
                <ExternalIcon />
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3.5 py-2 text-sm font-medium text-slate-400">
                No website
              </span>
            )}
            <a
              href={lead.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {lead.source === "trustpilot" ? "Search on Google Maps" : "Open in Google Maps"}
              <ExternalIcon />
            </a>
            {lead.trustpilotUrl && (
              <a
                href={lead.trustpilotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open on Trustpilot
                <ExternalIcon />
              </a>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-4">
            <Detail label="SEO Score" value={lead.seoScore === null ? "Not applicable" : `${lead.seoScore} / 100`} />
            <Detail label="SEO Status" value={<StatusBadge status={lead.status} />} />
            <Detail label="Lead Priority" value={<PriorityBadge priority={lead.priority} />} />
            <Detail label="Lead Source" value={<SourceBadge source={lead.source} />} />
            {lead.reviewCount !== null ? (
              <Detail label="Google Reviews" value={lead.reviewCount.toLocaleString()} />
            ) : (
              <Detail
                label="Page Response Time"
                value={lead.responseMs ? `${lead.responseMs.toLocaleString()} ms` : "Not measured"}
              />
            )}
          </dl>

          {lead.status === "NO_WEBSITE" && (
            <p className="rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-800">
              This business has no website listed on Google Maps. That makes it a <strong>build</strong>{" "}
              opportunity rather than a fix — often an easier pitch than SEO cleanup work.
            </p>
          )}

          {lead.crawlFailed && (
            <p className="rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-800">
              This site could not be crawled automatically, so its SEO signals are unknown. Treat as{" "}
              <strong>manual review</strong> rather than a confirmed SEO problem.
            </p>
          )}

          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              {lead.status === "NO_WEBSITE"
                ? "Opportunity"
                : lead.crawlFailed
                  ? "Crawl details"
                  : "Technical SEO opportunities"}
            </h3>
            <IssueList issues={lead.issues} />
            {!lead.crawlFailed && lead.status !== "NO_WEBSITE" && lead.issues.length > 0 && (
              <p className="mt-4 text-xs text-slate-400">
                These are technical/on-page signals detected by an automated scan, not a guarantee of
                search ranking performance.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{value}</dd>
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-8 8M6 10.5V18h7.5" />
    </svg>
  );
}
