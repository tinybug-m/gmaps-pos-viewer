import { PIPELINE_LABEL, type PipelineStatus } from "@/lib/workflow";

// The same low-saturation palette as the SEO status badges. Closed states
// that need no more work fade to slate; "do not call" stays red because
// calling it again is the one mistake that matters.
const PIPELINE_STYLES: Record<PipelineStatus, string> = {
  new: "bg-slate-100 text-slate-600",
  in_progress: "bg-sky-50 text-sky-700",
  callback: "bg-amber-50 text-amber-800",
  interested: "bg-emerald-50 text-emerald-800",
  closed_won: "bg-emerald-100 text-emerald-900",
  closed_lost: "bg-slate-100 text-slate-500",
  invalid: "bg-slate-100 text-slate-500",
  do_not_call: "bg-red-50 text-red-800",
};

export default function PipelineBadge({ status }: { status: PipelineStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${PIPELINE_STYLES[status]}`}
    >
      {PIPELINE_LABEL[status]}
    </span>
  );
}
