import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import FollowUpBadge from "@/components/FollowUpBadge";
import PipelineBadge from "@/components/PipelineBadge";
import { buttonSecondary, card, input } from "@/components/ui/styles";
import { can } from "@/lib/permissions";
import { QUEUE_SECTION_LABEL, QUEUE_SECTIONS, queueOrder, type QueueSection } from "@/lib/queue";
import { formatDateTime } from "@/lib/time";
import { OUTCOME_LABEL } from "@/lib/workflow";
import { requireViewer } from "@/server/auth/session";
import { ASSIGNABLE_ROLES } from "@/server/dal/assignments";
import { getQueue } from "@/server/dal/leads";
import { listAssignees } from "@/server/dal/users";
import { getDb } from "@/server/db/client";
import type { TeamLead } from "@/types/lead";

export const metadata: Metadata = { title: "Queue" };

const SECTION_ACCENT: Record<QueueSection, string> = {
  overdue: "text-red-800",
  today: "text-amber-800",
  fresh: "text-slate-800",
  inProgress: "text-slate-800",
  later: "text-slate-500",
};

export default async function QueuePage(props: PageProps<"/queue">) {
  const viewer = await requireViewer();
  const db = getDb();
  const { user } = await props.searchParams;
  const viewAll = can(viewer, "leads.viewAll");
  const ownerId = typeof user === "string" && viewAll ? user : viewer.id;

  const [queue, team] = await Promise.all([
    getQueue(db, viewer, ownerId),
    viewAll ? listAssignees(db, viewer) : Promise.resolve(null),
  ]);
  const members = (team ?? []).filter((u) => ASSIGNABLE_ROLES.includes(u.role));
  if (!queue || (ownerId !== viewer.id && !members.some((m) => m.id === ownerId))) notFound();

  const owner = ownerId === viewer.id ? null : members.find((m) => m.id === ownerId)!;
  const total = queueOrder(queue).length;
  const first = queueOrder(queue)[0];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{owner ? `${owner.name}'s queue` : "My queue"}</h1>
          <p className="text-sm text-slate-500">
            {total === 0 ? "Nothing to call." : `${total} open ${total === 1 ? "lead" : "leads"}, in the order to call them.`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {members.length > 0 && (
            <form className="flex items-end gap-2" action="/queue">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Show queue for
                <select name="user" defaultValue={ownerId} className={`${input} w-48`}>
                  {!members.some((m) => m.id === viewer.id) && <option value={viewer.id}>Me</option>}
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id === viewer.id ? `${m.name} (me)` : m.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={buttonSecondary}>
                Show
              </button>
            </form>
          )}
          {first && (
            <Link href={`/leads/${first}`} className="inline-flex items-center rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
              {owner ? "Open first lead →" : "Start calling →"}
            </Link>
          )}
        </div>
      </div>

      {total === 0 && (
        <div className={`${card} px-6 py-10 text-center text-sm text-slate-500`}>
          {owner ? (
            `${owner.name} has no open leads.`
          ) : viewAll ? (
            <>
              No open leads are assigned to you.{" "}
              <Link href="/leads" className="font-medium text-slate-700 underline">
                Browse all leads
              </Link>
            </>
          ) : (
            "No open leads are assigned to you. Ask an admin for more."
          )}
        </div>
      )}

      {QUEUE_SECTIONS.filter((s) => queue[s].length > 0).map((section) => (
        <section key={section} aria-labelledby={`q-${section}`} className="flex flex-col gap-2">
          <h2 id={`q-${section}`} className={`text-sm font-semibold ${SECTION_ACCENT[section]}`}>
            {QUEUE_SECTION_LABEL[section]} ({queue[section].length})
          </h2>
          <ul className={`${card} divide-y divide-slate-100`}>
            {queue[section].map((lead) => (
              <QueueRow key={lead.id} lead={lead} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function QueueRow({ lead }: { lead: TeamLead }) {
  const w = lead.workflow;
  const phone = lead.outreach?.phone;
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <Link href={`/leads/${lead.id}`} className="font-medium text-slate-800 hover:underline">
          {lead.name}
        </Link>
        <p className="text-xs text-slate-500">
          {lead.city}
          {w.attemptCount > 0 && ` · ${w.attemptCount} ${w.attemptCount === 1 ? "call" : "calls"}`}
          {w.lastOutcome && w.lastCallAt && ` · last: ${OUTCOME_LABEL[w.lastOutcome]}, ${formatDateTime(w.lastCallAt)}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <PipelineBadge status={w.pipelineStatus} />
        {w.followUp && <FollowUpBadge dueAt={w.followUp.dueAt} bucket={w.followUp.bucket} />}
        {phone && (
          <a href={`tel:${phone.replace(/\s+/g, "")}`} className="text-sm font-medium tabular-nums text-emerald-800 hover:underline">
            {phone}
          </a>
        )}
        <Link href={`/leads/${lead.id}`} aria-label={`Open ${lead.name}`} className="text-sm font-medium text-slate-600 hover:text-slate-900">
          Open →
        </Link>
      </div>
    </li>
  );
}
