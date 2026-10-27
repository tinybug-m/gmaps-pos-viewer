import { sortLeads } from "@/lib/sort";
import { isTerminal } from "@/lib/workflow";
import type { TeamLead } from "@/types/lead";

/**
 * A caller's working order. Promised callbacks come first (overdue, then
 * due today), then leads nobody has called yet (best prospects first), then
 * leads already in progress (longest since the last call first). Callbacks
 * booked for a later day wait at the end. Closed leads aren't in the queue.
 */
export const QUEUE_SECTIONS = ["overdue", "today", "fresh", "inProgress", "later"] as const;
export type QueueSection = (typeof QUEUE_SECTIONS)[number];

export const QUEUE_SECTION_LABEL: Record<QueueSection, string> = {
  overdue: "Overdue callbacks",
  today: "Callbacks due today",
  fresh: "Not called yet",
  inProgress: "In progress",
  later: "Callbacks booked for later",
};

export type Queue = Record<QueueSection, TeamLead[]>;

function sectionOf(lead: TeamLead): QueueSection | null {
  const w = lead.workflow;
  if (w.archived || isTerminal(w.pipelineStatus)) return null;
  if (w.followUp) return w.followUp.bucket === "upcoming" ? "later" : w.followUp.bucket;
  return w.attemptCount === 0 ? "fresh" : "inProgress";
}

const byDue = (a: TeamLead, b: TeamLead) =>
  a.workflow.followUp!.dueAt.getTime() - b.workflow.followUp!.dueAt.getTime() || a.name.localeCompare(b.name);

const byLastCall = (a: TeamLead, b: TeamLead) =>
  (a.workflow.lastCallAt?.getTime() ?? 0) - (b.workflow.lastCallAt?.getTime() ?? 0) || a.name.localeCompare(b.name);

export function buildQueue(leads: TeamLead[]): Queue {
  const queue: Queue = { overdue: [], today: [], fresh: [], inProgress: [], later: [] };
  for (const lead of leads) {
    const section = sectionOf(lead);
    if (section) queue[section].push(lead);
  }
  queue.overdue.sort(byDue);
  queue.today.sort(byDue);
  queue.later.sort(byDue);
  queue.inProgress.sort(byLastCall);
  // Sorts are stable: order by SEO priority, then let the call-list grade win.
  queue.fresh = sortLeads(sortLeads(sortLeads(queue.fresh, { key: "score", direction: "asc" }), { key: "priority", direction: "asc" }), {
    key: "call",
    direction: "asc",
  });
  return queue;
}

export function queueOrder(queue: Queue): string[] {
  return QUEUE_SECTIONS.flatMap((s) => queue[s].map((l) => l.id));
}

/** The lead after `currentId` in queue order; the first one if `currentId` isn't queued. Null when nothing else is left. */
export function nextInQueue(order: string[], currentId: string): string | null {
  const i = order.indexOf(currentId);
  const rest = i === -1 ? order : [...order.slice(i + 1), ...order.slice(0, i)];
  return rest.find((id) => id !== currentId) ?? null;
}
