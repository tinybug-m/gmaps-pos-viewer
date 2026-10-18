import PriorityBadge from "@/components/PriorityBadge";
import SourceBadge from "@/components/SourceBadge";
import StatusBadge from "@/components/StatusBadge";
import { SEVERITY_ORDER } from "@/lib/issues";
import type { Lead } from "@/types/lead";

export default function LeadTableRow({
  lead,
  onSelect,
}: {
  lead: Lead;
  onSelect: () => void;
}) {
  const sortedIssues = [...lead.issues].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  const primaryIssues = sortedIssues.filter((i) => i.severity !== "crawl");
  const shown = primaryIssues.slice(0, 2);
  const remaining = primaryIssues.length - shown.length;

  return (
    <tr
      onClick={onSelect}
      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
    >
      <td className="whitespace-nowrap px-4 py-3">
        <PriorityBadge priority={lead.priority} />
      </td>
      <td className="px-4 py-3">
        <p className="font-medium text-slate-800">{lead.name}</p>
        <p className="text-xs text-slate-400">{lead.city}</p>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        {lead.seoScore === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <>
            <span className="font-semibold tabular-nums text-slate-800">{lead.seoScore}</span>
            <span className="text-slate-400">/100</span>
          </>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge status={lead.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <SourceBadge source={lead.source} />
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {lead.status === "NO_WEBSITE" ? (
          <span className="italic text-teal-800">
            No website found{lead.reviewCount !== null ? ` — ${lead.reviewCount} Google reviews` : ""}
          </span>
        ) : lead.crawlFailed ? (
          <span className="italic text-sky-700">Site could not be crawled — manual review</span>
        ) : primaryIssues.length === 0 ? (
          <span className="text-slate-400">No issues detected</span>
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
              <span className="text-xs font-medium text-slate-400">+{remaining} more</span>
            )}
          </>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
        {lead.responseMs ? `${lead.responseMs.toLocaleString()} ms` : "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()}>
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
          <span className="text-sm text-slate-400">No website</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <a
          href={lead.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-800"
        >
          Maps
          <ExternalIcon />
        </a>
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
