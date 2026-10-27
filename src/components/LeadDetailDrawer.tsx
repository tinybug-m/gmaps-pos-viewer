"use client";

import { useEffect, useRef, type ReactNode } from "react";

import CallBadge, { humanize } from "@/components/CallBadge";
import IssueList from "@/components/IssueList";
import PriorityBadge from "@/components/PriorityBadge";
import SourceBadge from "@/components/SourceBadge";
import StatusBadge from "@/components/StatusBadge";
import type { Lead, LeadContactPerson, LeadOutreach } from "@/types/lead";

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
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-6 px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {lead.outreach?.phone && (
              <a
                href={`tel:${lead.outreach.phone.replace(/\s+/g, "")}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                <PhoneIcon />
                Call {lead.outreach.phone}
              </a>
            )}
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

          {lead.outreach && <OutreachSection outreach={lead.outreach} />}

          <dl className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-4">
            <Detail label="SEO Score" value={lead.seoScore === null ? "Not applicable" : `${lead.seoScore} / 100`} />
            <Detail label="SEO Status" value={<StatusBadge status={lead.status} />} />
            <Detail label="Lead Priority" value={<PriorityBadge priority={lead.priority} />} />
            <Detail label="Lead Source" value={<SourceBadge source={lead.source} />} />
            {lead.websiteScore !== null && (
              <Detail label="Website Score" value={`${lead.websiteScore} / 100`} />
            )}
            {lead.websiteIssue && <Detail label="Website Verdict" value={humanize(lead.websiteIssue)} />}
            {lead.rating !== null && (
              <Detail
                label="Google Rating"
                value={
                  <>
                    <span className="text-amber-500" aria-hidden>
                      ★
                    </span>{" "}
                    {lead.rating.toFixed(1)}
                  </>
                }
              />
            )}
            {lead.reviewCount !== null ? (
              <Detail label="Google Reviews" value={lead.reviewCount.toLocaleString()} />
            ) : (
              <Detail
                label="Page Response Time"
                value={lead.responseMs ? `${lead.responseMs.toLocaleString()} ms` : "Not measured"}
              />
            )}
            {lead.niche && <Detail label="Niche" value={humanize(lead.niche)} />}
            {lead.branchCount !== null && <Detail label="Branches" value={lead.branchCount} />}
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

function OutreachSection({ outreach }: { outreach: LeadOutreach }) {
  const people = [
    ...(outreach.decisionMaker ? [{ person: outreach.decisionMaker, isDecisionMaker: true }] : []),
    ...outreach.otherPeople.map((person) => ({ person, isDecisionMaker: false })),
  ];
  // A legal-form note mentioning TPS means "check before you dial", so give it
  // the same callout weight as the crawl-failure notice.
  const legalNeedsCheck = outreach.legalForm !== null && /\bTPS\b|not checked/i.test(outreach.legalForm);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Outreach</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <CallBadge outreach={outreach} />
          {outreach.tier && <span>Tier: {humanize(outreach.tier)}</span>}
          {outreach.confidence && <span>· {humanize(outreach.confidence)} confidence</span>}
        </div>
      </div>

      {outreach.pitchAngle && (
        <div className="rounded-md bg-slate-50 px-3.5 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pitch angle</p>
          <p className="mt-1 text-sm text-slate-800">{outreach.pitchAngle}</p>
        </div>
      )}

      <dl className="flex flex-col gap-3">
        {outreach.callNote && <Detail label="Call note" value={outreach.callNote} />}
        {outreach.askFor && <Detail label="Ask for" value={outreach.askFor} />}
        {outreach.phone && (
          <Detail
            label="Phone"
            value={
              <>
                <a
                  href={`tel:${outreach.phone.replace(/\s+/g, "")}`}
                  className="font-medium tabular-nums text-slate-800 hover:underline"
                >
                  {outreach.phone}
                </a>
                {outreach.phoneOwner && (
                  <span className="mt-0.5 block text-xs text-slate-500">{outreach.phoneOwner}</span>
                )}
              </>
            }
          />
        )}
        {outreach.emails.length > 0 && (
          <Detail
            label={outreach.emails.length === 1 ? "Email" : "Emails"}
            value={
              <ul className="space-y-0.5">
                {outreach.emails.map((email) => (
                  <li key={email}>
                    <a href={`mailto:${email}`} className="text-slate-800 hover:underline">
                      {email}
                    </a>
                  </li>
                ))}
              </ul>
            }
          />
        )}
        <Detail
          label="People"
          value={
            people.length === 0 ? (
              <span className="text-slate-400">No named contacts found</span>
            ) : (
              <ul className="space-y-1.5">
                {people.map(({ person, isDecisionMaker }, i) => (
                  <PersonRow key={`${person.name}-${i}`} person={person} isDecisionMaker={isDecisionMaker} />
                ))}
              </ul>
            )
          }
        />
      </dl>

      {outreach.legalForm && (
        <p
          className={`rounded-md px-3.5 py-2.5 text-xs ${
            legalNeedsCheck ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"
          }`}
        >
          <span className="font-semibold">Legal form:</span> {outreach.legalForm}
        </p>
      )}
    </section>
  );
}

function PersonRow({ person, isDecisionMaker }: { person: LeadContactPerson; isDecisionMaker: boolean }) {
  return (
    <li>
      <span className="font-medium text-slate-800">{person.name}</span>
      {person.role && <span className="text-slate-500"> · {person.role}</span>}
      {isDecisionMaker && (
        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          Decision maker
        </span>
      )}
      {(person.email || person.phone) && (
        <span className="block text-xs text-slate-500">
          {[person.phone, person.email].filter(Boolean).join(" · ")}
        </span>
      )}
    </li>
  );
}

function PhoneIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
      />
    </svg>
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
