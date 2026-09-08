import type { IssueSeverity, ParsedIssue } from "@/types/lead";

interface IssueRule {
  test: RegExp;
  severity: IssueSeverity;
  /** Stable, human-readable category label used for grouping and the issue filter. */
  label: string;
}

// Order matters: first match wins. Crawl and critical signals are checked before
// milder optimization-level phrasing that could otherwise overlap.
const ISSUE_RULES: IssueRule[] = [
  { test: /unreachable|fetch failed|operation was aborted|returned http \d/i, severity: "crawl", label: "Website could not be crawled" },
  { test: /missing page title/i, severity: "critical", label: "Missing page title" },
  { test: /missing meta description/i, severity: "critical", label: "Missing meta description" },
  { test: /marked noindex/i, severity: "critical", label: "Marked noindex" },
  { test: /missing h1 heading/i, severity: "important", label: "Missing H1 heading" },
  { test: /no canonical url/i, severity: "important", label: "No canonical URL" },
  { test: /very slow response time/i, severity: "important", label: "Very slow response time" },
  { test: /very little text content/i, severity: "important", label: "Very little text content" },
  { test: /low text content/i, severity: "optimization", label: "Low text content" },
  { test: /h1 headings found/i, severity: "optimization", label: "Multiple H1 headings" },
  { test: /image\(s\) without alt text/i, severity: "optimization", label: "Images missing alt text" },
  { test: /title length is/i, severity: "optimization", label: "Title length not ideal" },
  { test: /meta description length is/i, severity: "optimization", label: "Meta description length not ideal" },
  { test: /slow response time/i, severity: "optimization", label: "Slow response time" },
];

const RESPONSE_MS_RE = /response time \((\d+)ms\)/i;

function matchRule(text: string): IssueRule | undefined {
  return ISSUE_RULES.find((r) => r.test.test(text));
}

/** "No major issues detected" carries no real signal and is dropped. */
export function parseIssue(text: string): ParsedIssue | null {
  if (/no major issues detected/i.test(text)) return null;
  const rule = matchRule(text);
  return { text, severity: rule?.severity ?? "optimization" };
}

/** The stable category label for an issue, used to group filter options across records. */
export function issueTemplateLabel(text: string): string {
  return matchRule(text)?.label ?? text;
}

export function extractResponseMs(text: string): number | null {
  const match = RESPONSE_MS_RE.exec(text);
  return match ? Number(match[1]) : null;
}

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  critical: "Critical",
  important: "Important",
  optimization: "Optimization",
  crawl: "Crawl issue",
};

export const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  crawl: 0,
  critical: 1,
  important: 2,
  optimization: 3,
};

export const SEVERITY_DOT_CLASS: Record<IssueSeverity, string> = {
  critical: "bg-red-500",
  important: "bg-amber-500",
  optimization: "bg-slate-400",
  crawl: "bg-violet-500",
};

export const SEVERITY_TEXT_CLASS: Record<IssueSeverity, string> = {
  critical: "text-red-700",
  important: "text-amber-700",
  optimization: "text-slate-600",
  crawl: "text-violet-700",
};
