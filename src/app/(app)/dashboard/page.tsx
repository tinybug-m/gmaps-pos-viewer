import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import PipelineBadge from "@/components/PipelineBadge";
import { card } from "@/components/ui/styles";
import { formatDateTime, RANGE_KEYS, RANGE_LABEL, type RangeKey } from "@/lib/time";
import { ROLE_LABEL } from "@/lib/workflow";
import { requireViewer } from "@/server/auth/session";
import {
  getDashboard,
  listFeedbackFor,
  listOverdueFollowUps,
  listReviewQueue,
  type PersonMetrics,
  type TeamTotals,
} from "@/server/dal/metrics";
import { getDb } from "@/server/db/client";

export const metadata: Metadata = { title: "Dashboard" };

const rangeParam = z.enum(RANGE_KEYS).catch("today");

const pct = (part: number, whole: number) => (whole === 0 ? "–" : `${Math.round((part / whole) * 100)}%`);

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const viewer = await requireViewer();
  const db = getDb();
  const range: RangeKey = rangeParam.parse((await props.searchParams).range);
  const now = new Date();

  const [dashboard, review, overdue, feedback] = await Promise.all([
    getDashboard(db, viewer, range, now),
    listReviewQueue(db, viewer),
    listOverdueFollowUps(db, viewer, now),
    listFeedbackFor(db, viewer),
  ]);
  const team = dashboard.scope === "team";
  const t = dashboard.totals;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{team ? "Team dashboard" : "My numbers"}</h1>
          <p className="text-sm text-slate-500">Activity figures cover {RANGE_LABEL[range].toLowerCase()} (UK time). Workload figures are as of now.</p>
        </div>
        <nav aria-label="Date range" className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-sm">
          {RANGE_KEYS.map((key) => (
            <Link
              key={key}
              href={key === "today" ? "/dashboard" : `/dashboard?range=${key}`}
              aria-current={key === range ? "page" : undefined}
              className={`rounded px-3 py-1.5 font-medium ${key === range ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {RANGE_LABEL[key]}
            </Link>
          ))}
        </nav>
      </div>

      <Kpis totals={t} team={team} />

      {team && <PeopleTable people={dashboard.people} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {review && (
          <Panel title="Waiting for review" count={t.awaitingReview} empty="Nothing to review.">
            {review.map((r) => (
              <li key={r.leadId} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${r.leadId}`} className="font-medium text-slate-800 hover:underline">
                    {r.name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {r.assignee?.name ?? "Unassigned"} · since {formatDateTime(r.requestedAt)}
                  </p>
                </div>
                <PipelineBadge status={r.status} />
              </li>
            ))}
          </Panel>
        )}

        <Panel title={team ? "Overdue follow-ups" : "My overdue follow-ups"} count={t.overdue} empty="No overdue follow-ups.">
          {overdue.map((f) => (
            <li key={f.followUpId} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <Link href={`/leads/${f.leadId}`} className="font-medium text-slate-800 hover:underline">
                  {f.name}
                </Link>
                {team && <p className="text-xs text-slate-500">{f.assignee?.name ?? "Unassigned"}</p>}
              </div>
              <span className="text-xs font-medium tabular-nums text-red-800">Due {formatDateTime(f.dueAt)}</span>
            </li>
          ))}
        </Panel>

        {!team && (
          <Panel title="Feedback for me" count={feedback.length} empty="No feedback yet.">
            {feedback.map((f) => (
              <li key={f.noteId} className="flex flex-col gap-1 px-4 py-3">
                <p className="text-xs text-slate-500">
                  {f.author} on{" "}
                  {f.stillYours ? (
                    <Link href={`/leads/${f.leadId}`} className="font-medium text-slate-700 hover:underline">
                      {f.leadName}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-700">{f.leadName}</span>
                  )}{" "}
                  · {formatDateTime(f.at)}
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-800">{f.body}</p>
              </li>
            ))}
          </Panel>
        )}
      </div>

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">How these numbers are counted</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>Calls are credited to whoever made them, even if the lead has since been reassigned. Voided calls are left out.</li>
          <li>
            Leads contacted counts each lead once, however many times it was called. The team figure counts a lead once even if
            several people called it.
          </li>
          <li>Connects are calls that reached someone: anything except no answer, busy or voicemail.</li>
          <li>Interested and Won count leads moved to that status in the range, credited to whoever moved them.</li>
          <li>Open leads exclude closed, invalid and do-not-call leads. Not called yet means no call has ever been logged.</li>
          <li>Overdue follow-ups belong to whoever the lead is assigned to now.</li>
        </ul>
      </details>
    </div>
  );
}

function Kpis({ totals: t, team }: { totals: TeamTotals; team: boolean }) {
  const items: { label: string; value: number; hint?: string; alert?: boolean }[] = [
    { label: "Calls", value: t.calls },
    { label: "Leads contacted", value: t.leadsContacted },
    { label: "Connects", value: t.connects, hint: `${pct(t.connects, t.calls)} of calls` },
    { label: "Interested", value: t.interested },
    { label: "Won", value: t.won },
    { label: "Open leads", value: t.openLeads, hint: `${t.untouched} not called yet` },
    { label: "Overdue follow-ups", value: t.overdue, alert: t.overdue > 0 },
    ...(team
      ? [
          { label: "Unassigned", value: t.unassigned, hint: "open leads with no owner" },
          { label: "Waiting for review", value: t.awaitingReview },
        ]
      : []),
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className={`${card} px-4 py-3`}>
          <dt className="text-xs font-medium text-slate-500">{i.label}</dt>
          <dd className={`mt-1 text-2xl font-semibold tabular-nums ${i.alert ? "text-red-800" : "text-slate-800"}`}>{i.value}</dd>
          {i.hint && <dd className="text-xs text-slate-500">{i.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

function PeopleTable({ people }: { people: PersonMetrics[] }) {
  const cols = ["Calls", "Leads contacted", "Connects", "Interested", "Won", "Open leads", "Not called yet", "Overdue"];
  return (
    <section aria-labelledby="people" className="flex flex-col gap-2">
      <h2 id="people" className="text-sm font-semibold text-slate-800">
        By person
      </h2>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">
                Name
              </th>
              {cols.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 text-right">
                  {c}
                </th>
              ))}
              <th scope="col" className="px-4 py-2">
                Last activity
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="px-4 py-6 text-center text-slate-500">
                  No callers yet.
                </td>
              </tr>
            )}
            {people.map((p) => (
              <tr key={p.id} className={p.isActive ? "" : "text-slate-500"}>
                <th scope="row" className="px-4 py-2 text-left font-medium">
                  {p.role === "supervisor" ? (
                    p.name
                  ) : (
                    <Link href={`/queue?user=${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                  )}
                  {p.role !== "caller" && <span className="ml-1.5 text-xs font-normal text-slate-500">{ROLE_LABEL[p.role]}</span>}
                  {!p.isActive && <span className="ml-1.5 text-xs font-normal">(deactivated)</span>}
                </th>
                {[p.calls, p.leadsContacted, p.connects, p.interested, p.won, p.openLeads, p.untouched].map((v, i) => (
                  <td key={i} className="px-3 py-2 text-right tabular-nums">
                    {v}
                  </td>
                ))}
                <td className={`px-3 py-2 text-right tabular-nums ${p.overdue > 0 ? "font-medium text-red-800" : ""}`}>{p.overdue}</td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-500">{p.lastActivityAt ? formatDateTime(p.lastActivityAt) : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Panel({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-slate-800">
        {title} ({count})
      </h2>
      <ul className={`${card} divide-y divide-slate-100`}>
        {children.length === 0 ? <li className="px-4 py-6 text-center text-sm text-slate-500">{empty}</li> : children}
      </ul>
      {count > children.length && <p className="text-xs text-slate-500">Showing the first {children.length}.</p>}
    </section>
  );
}
