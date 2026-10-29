import CallBadge from "@/components/CallBadge";
import FollowUpBadge from "@/components/FollowUpBadge";
import PipelineBadge from "@/components/PipelineBadge";
import PriorityBadge from "@/components/PriorityBadge";
import SourceBadge from "@/components/SourceBadge";
import StatusBadge from "@/components/StatusBadge";
import { SEVERITY_ORDER } from "@/lib/issues";
import { formatDate, formatDateTime } from "@/lib/time";
import { OUTCOME_LABEL } from "@/lib/workflow";
import type { TeamLead } from "@/types/lead";

export default function LeadTableRow({
  lead,
  showOutreach,
  showAssignee,
  onSelect,
  selected,
  onToggleSelected,
}: {
  lead: TeamLead;
  showOutreach: boolean;
  showAssignee: boolean;
  onSelect: () => void;
  /** Only passed when the table is selectable. */
  selected?: boolean;
  onToggleSelected?: () => void;
}) {
  const w = lead.workflow;
  const sortedIssues = [...lead.issues].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  const primaryIssues = sortedIssues.filter((i) => i.severity !== "crawl");
  const shown = primaryIssues.slice(0, 2);
  const remaining = primaryIssues.length - shown.length;

  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${selected ? "bg-sky-50/60" : ""}`}
    >
      {onToggleSelected && (
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select ${lead.name}`}
            checked={selected ?? false}
            onChange={onToggleSelected}
            className="h-4 w-4 rounded border-slate-300 accent-slate-800"
          />
        </td>
      )}
      <td className="whitespace-nowrap px-4 py-3">
        <PriorityBadge priority={lead.priority} />
      </td>
      <td className="min-w-48 px-4 py-3">
        {/* A real button so keyboard users can open the details too; the row click is a shortcut. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="text-left font-medium text-slate-800 hover:underline"
        >
          {lead.name}
        </button>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
          <span>
            {lead.category ? `${lead.category} · ` : ""}
            {lead.city}
          </span>
          {lead.source === "trustpilot" && <SourceBadge source={lead.source} />}
        </p>
        {lead.rating !== null && (
          <p className="text-xs text-slate-500">
            <span className="text-amber-500" aria-hidden>
              ★
            </span>{" "}
            <span className="tabular-nums">{lead.rating.toFixed(1)}</span>
            {lead.reviewCount !== null && (
              <span className="text-slate-500"> ({lead.reviewCount.toLocaleString()})</span>
            )}
          </p>
        )}
      </td>
      {showOutreach && (
        <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {lead.outreach ? (
            <div className="flex flex-col items-start gap-1">
              <CallBadge outreach={lead.outreach} />
              {lead.outreach.phone && (
                <a
                  href={`tel:${lead.outreach.phone.replace(/\s+/g, "")}`}
                  className="text-xs font-medium tabular-nums text-slate-600 hover:text-slate-800"
                >
                  {lead.outreach.phone}
                </a>
              )}
            </div>
          ) : (
            <span className="text-slate-500">—</span>
          )}
        </td>
      )}
      <td className="whitespace-nowrap px-4 py-3">
        {lead.seoScore === null ? (
          <span className="text-slate-500">—</span>
        ) : (
          <>
            <span className="font-semibold tabular-nums text-slate-800">{lead.seoScore}</span>
            <span className="text-slate-500">/100</span>
          </>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge status={lead.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex flex-col items-start gap-1">
          <PipelineBadge status={w.pipelineStatus} />
          <span className="text-xs text-slate-500">
            {w.attemptCount === 0
              ? "Not called yet"
              : `${w.attemptCount} ${w.attemptCount === 1 ? "call" : "calls"}${w.lastOutcome ? ` · ${OUTCOME_LABEL[w.lastOutcome]}` : ""}`}
          </span>
          {w.reviewRequested && <span className="text-xs font-medium text-violet-700">Awaiting review</span>}
        </div>
      </td>
      {showAssignee && (
        <td className="whitespace-nowrap px-4 py-3 text-sm">
          {w.assignee ? (
            <span className="flex flex-col">
              <span className="text-slate-700">{w.assignee.name}</span>
              {!w.assignee.isActive && (
                <span className="text-xs font-medium text-amber-700">Deactivated: reassign</span>
              )}
            </span>
          ) : (
            <span className="text-slate-500">Unassigned</span>
          )}
        </td>
      )}
      <td className="whitespace-nowrap px-4 py-3">
        {w.followUp ? <FollowUpBadge dueAt={w.followUp.dueAt} bucket={w.followUp.bucket} /> : <span className="text-slate-500">—</span>}
      </td>
      <td className="hidden whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-600 xl:table-cell">
        {w.lastCallAt ? <time dateTime={w.lastCallAt.toISOString()}>{formatDateTime(w.lastCallAt)}</time> : <span className="text-slate-500">Never</span>}
      </td>
      <td className="hidden whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-600 xl:table-cell">
        <time dateTime={w.addedAt.toISOString()}>{formatDate(w.addedAt)}</time>
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {lead.status === "NO_WEBSITE" ? (
          <span className="italic text-teal-800">
            No website found
            {lead.reviewCount !== null && lead.rating === null ? ` — ${lead.reviewCount} Google reviews` : ""}
          </span>
        ) : lead.crawlFailed ? (
          <span className="italic text-sky-700">Site could not be crawled — manual review</span>
        ) : lead.outreach?.pitchAngle && primaryIssues.length === 0 ? (
          <span className="text-slate-600">{lead.outreach.pitchAngle}</span>
        ) : primaryIssues.length === 0 ? (
          <span className="text-slate-500">No issues detected</span>
        ) : (
          <>
            <ul className="space-y-0.5">
              {shown.map((issue, i) => (
                <li key={i} className="truncate">
                  {issue.text}
                </li>
              ))}
            </ul>
            {remaining > 0 && (
              <span className="text-xs font-medium text-slate-500">+{remaining} more</span>
            )}
          </>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-4 py-3 xl:table-cell" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-start gap-1">
          {lead.websiteUrl ? (
            <a
              href={lead.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-800"
            >
              Website
              <ExternalIcon />
            </a>
          ) : (
            <span className="text-sm text-slate-500">No website</span>
          )}
          <a
            href={lead.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            Maps
            <ExternalIcon />
          </a>
        </div>
      </td>
    </tr>
  );
}

function ExternalIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-8 8M6 10.5V18h7.5" />
    </svg>
  );
}
