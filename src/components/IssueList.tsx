import { SEVERITY_DOT_CLASS, SEVERITY_LABEL, SEVERITY_ORDER } from "@/lib/issues";
import type { ParsedIssue } from "@/types/lead";

export default function IssueList({ issues }: { issues: ParsedIssue[] }) {
  if (issues.length === 0) {
    return <p className="text-sm text-slate-500">No technical SEO issues detected.</p>;
  }

  const sorted = [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return (
    <ul className="space-y-2">
      {sorted.map((issue, i) => (
        <li key={`${issue.text}-${i}`} className="flex items-start gap-2.5 text-sm">
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[issue.severity]}`}
            aria-hidden
          />
          <span className="text-slate-700">
            {issue.text}
            <span className="ml-2 text-xs font-medium text-slate-500">
              {SEVERITY_LABEL[issue.severity]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
