import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import FollowUpBadge from "@/components/FollowUpBadge";
import LeadDetails from "@/components/LeadDetails";
import PipelineBadge from "@/components/PipelineBadge";
import { card } from "@/components/ui/styles";
import { can } from "@/lib/permissions";
import { nextInQueue, queueOrder } from "@/lib/queue";
import { formatDateTime } from "@/lib/time";
import { isTerminal, OUTCOME_LABEL } from "@/lib/workflow";
import { requireViewer } from "@/server/auth/session";
import { getLeadActivity } from "@/server/dal/activity";
import { getLeadForViewer, getQueue } from "@/server/dal/leads";
import { getDb } from "@/server/db/client";

import CallLogger from "./CallLogger";
import { FollowUpPanel, NoteForm, StatusChanger } from "./LeadControls";
import Timeline from "./Timeline";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage(props: PageProps<"/leads/[id]">) {
  const viewer = await requireViewer();
  const { id } = await props.params;
  const db = getDb();
  const now = new Date();
  // Someone else's lead and a lead that doesn't exist look the same: 404.
  const [lead, activity] = await Promise.all([getLeadForViewer(db, viewer, id, now), getLeadActivity(db, viewer, id)]);
  if (!lead || !activity) notFound();

  const w = lead.workflow;
  const ref = { assignedTo: w.assignee?.id ?? null };
  const terminal = isTerminal(w.pipelineStatus);
  const editable = !w.archived;
  const canLog = editable && can(viewer, "lead.logCall", ref) && (!terminal || viewer.role === "admin");
  const canStatus = editable && can(viewer, "lead.changeStatus", ref);
  const canFollowUp = editable && !terminal && can(viewer, "lead.manageFollowUp", ref);
  const canNote = editable && can(viewer, "lead.addNote", ref);

  // "Next" walks the queue of whoever owns this lead, so an admin covering for a caller follows their order.
  const queue = w.assignee && canLog ? await getQueue(db, viewer, w.assignee.id, now) : null;
  const nextLeadId = queue ? nextInQueue(queueOrder(queue), lead.id) : null;
  const backHref = viewer.role === "caller" ? "/queue" : "/leads";

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link href={backHref} className="text-sm text-slate-500 hover:text-slate-800">
            ← {viewer.role === "caller" ? "My queue" : "All leads"}
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">{lead.name}</h1>
          <p className="text-sm text-slate-500">
            {lead.category ? `${lead.category} · ` : ""}
            {lead.city}
          </p>
        </div>
        {nextLeadId && (
          <Link href={`/leads/${nextLeadId}`} className="self-start text-sm font-medium text-slate-700 hover:text-slate-900">
            Skip to next lead →
          </Link>
        )}
      </div>

      <dl className={`${card} grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 lg:grid-cols-5`}>
        <Stat label="Status" value={<PipelineBadge status={w.pipelineStatus} />} />
        <Stat
          label="Assigned to"
          value={w.assignee ? `${w.assignee.name}${w.assignee.isActive ? "" : " (deactivated)"}` : <span className="text-slate-500">Unassigned</span>}
        />
        <Stat label="Calls" value={activity.liveCalls} />
        <Stat
          label="Last call"
          value={
            w.lastCallAt ? (
              <>
                {w.lastOutcome && OUTCOME_LABEL[w.lastOutcome]}
                <span className="block text-xs text-slate-500">{formatDateTime(w.lastCallAt)}</span>
              </>
            ) : (
              <span className="text-slate-500">Never</span>
            )
          }
        />
        <Stat
          label="Follow-up"
          value={w.followUp ? <FollowUpBadge dueAt={w.followUp.dueAt} bucket={w.followUp.bucket} /> : <span className="text-slate-500">None</span>}
        />
      </dl>

      {w.archived && (
        <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">This lead is archived. Its history is read-only.</p>
      )}
      {w.reviewRequested && can(viewer, "lead.addFeedback") && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Waiting for review. Leave feedback below to clear it from the review list.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Keyed by lead so drafts never follow "Save & next" onto another lead; a refresh of the same lead keeps them. */}
        <div key={lead.id} className="flex flex-col gap-6 lg:order-2">
          {canLog && (
            <CallLogger
              leadId={lead.id}
              version={w.version}
              status={w.pipelineStatus}
              role={viewer.role}
              nextLeadId={nextLeadId}
            />
          )}
          {terminal && !canLog && can(viewer, "lead.logCall", ref) && (
            <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">
              This lead is closed. Ask an admin if it should be reopened.
            </p>
          )}
          {canStatus && <StatusChanger key={`${w.pipelineStatus}-${w.version}`} leadId={lead.id} version={w.version} status={w.pipelineStatus} role={viewer.role} />}
          {canFollowUp && <FollowUpPanel leadId={lead.id} status={w.pipelineStatus} openFollowUp={activity.openFollowUp} />}
          {canNote && <NoteForm leadId={lead.id} canFeedback={can(viewer, "lead.addFeedback")} assigneeName={w.assignee?.name ?? null} />}
          <Timeline entries={activity.entries} canVoid={can(viewer, "entries.void")} />
        </div>
        <div className={`${card} order-first p-4 lg:order-1`}>
          <LeadDetails lead={lead} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{value}</dd>
    </div>
  );
}
