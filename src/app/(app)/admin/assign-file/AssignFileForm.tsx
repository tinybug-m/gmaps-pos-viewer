"use client";

import { useRef, useState, useTransition } from "react";

import FormMessage from "@/components/ui/FormMessage";
import { buttonPrimary, buttonSecondary, input, label } from "@/components/ui/styles";
import type { FileAssignPreview } from "@/server/dal/file-assignments";
import { MAX_IMPORT_BYTES } from "@/lib/validation";

import { commitFileAssignmentAction, previewFileAssignmentAction } from "./actions";

const UNEXPECTED = "Something went wrong. Check your connection, reload the page and try again.";
const TOO_LARGE = "That file is too large to use in one go (3.5 MB). Split it into smaller files.";

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

/**
 * Three steps: check a file against a user (a dry run that writes nothing),
 * review the counts, then confirm. The server re-checks everything on
 * confirm and applies all or nothing, so the preview is only what to expect.
 */
export default function AssignFileForm({ assignees }: { assignees: { id: string; name: string }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [userId, setUserId] = useState("");
  const [preview, setPreview] = useState<FileAssignPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [step, setStep] = useState<"check" | "assign" | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  // A click handler can fire twice before React re-renders with isPending.
  const busy = useRef(false);

  function reset(nextFile: File | null, nextUser: string) {
    setFile(nextFile);
    setUserId(nextUser);
    setPreview(null);
    setConfirming(false);
    setSuccess(null);
    setError(nextFile && nextFile.size > MAX_IMPORT_BYTES ? TOO_LARGE : null);
  }

  function clear() {
    reset(null, "");
    if (fileInput.current) fileInput.current.value = "";
  }

  function run(stepName: "check" | "assign", build: (form: FormData) => Promise<void>) {
    if (busy.current) return;
    if (!file || !userId) {
      setError("Choose a JSON export file and a team member.");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("toUserId", userId);
    busy.current = true;
    setError(null);
    setSuccess(null);
    setStep(stepName);
    startTransition(async () => {
      try {
        await build(form);
      } catch {
        setError(UNEXPECTED);
      } finally {
        busy.current = false;
      }
    });
  }

  function check() {
    run("check", async (form) => {
      const result = await previewFileAssignmentAction(form);
      if (result.ok) setPreview(result.preview);
      else setError(result.message);
    });
  }

  function assign() {
    if (!preview) return;
    run("assign", async (form) => {
      form.set("expectedAssign", String(preview.toAssign));
      const result = await commitFileAssignmentAction(form);
      if (!result.ok) {
        setError(result.message);
        setConfirming(false);
        return;
      }
      const p = result.preview;
      clear();
      setSuccess(`Assigned ${plural(p.toAssign, "lead")} from ${p.fileName} to ${p.assignee.name}.`);
    });
  }

  const targetName = assignees.find((a) => a.id === userId)?.name ?? "";
  const skipped = preview ? preview.ownedByOthers + preview.archived + preview.notImported + preview.invalid + preview.duplicates : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="assign-file" className={label}>
          Export file
        </label>
        <input
          ref={fileInput}
          id="assign-file"
          type="file"
          accept=".json,application/json"
          disabled={isPending}
          onChange={(e) => reset(e.target.files?.[0] ?? null, userId)}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50 disabled:opacity-60"
        />
        <p className="text-xs text-slate-500">The same JSON array the importer takes (up to 3.5 MB and 10,000 records). The file isn&apos;t changed or stored.</p>
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <label htmlFor="assign-user" className={label}>
          Assign to
        </label>
        <select id="assign-user" className={input} value={userId} disabled={isPending} onChange={(e) => reset(file, e.target.value)}>
          <option value="">Choose…</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <FormMessage error={error} success={success} />

      {!preview && (
        <div>
          <button type="button" className={buttonPrimary} disabled={!file || !userId || isPending || error !== null} onClick={check}>
            {isPending && step === "check" ? "Checking…" : "Check file"}
          </button>
        </div>
      )}

      {preview && (
        <section aria-labelledby="assign-preview-title" className="flex flex-col gap-4">
          <div>
            <h2 id="assign-preview-title" className="text-base font-semibold text-slate-800">
              {preview.fileName}: {plural(preview.total, "record")}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">Nothing has been assigned yet. This is what will happen.</p>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="To assign" value={preview.toAssign} hint={`to ${preview.assignee.name}`} />
            <Count label="Already theirs" value={preview.alreadyAssigned} />
            <Count label="Owned by others" value={preview.ownedByOthers} hint="left alone" tone={preview.ownedByOthers ? "warn" : undefined} />
            <Count label="Not imported" value={preview.notImported} hint="skipped" tone={preview.notImported ? "warn" : undefined} />
            <Count label="Archived" value={preview.archived} hint="skipped" tone={preview.archived ? "warn" : undefined} />
            <Count label="Invalid" value={preview.invalid} hint="skipped" tone={preview.invalid ? "warn" : undefined} />
            <Count label="Duplicates" value={preview.duplicates} hint="skipped" tone={preview.duplicates ? "warn" : undefined} />
          </dl>

          {preview.problems.length > 0 && (
            <details className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
              <summary className="cursor-pointer font-medium">{plural(skipped, "row")} will be skipped</summary>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {preview.problems.map((p) => (
                  <li key={p.row}>
                    <span className="font-medium">Row {p.row}:</span> {p.message}
                  </li>
                ))}
              </ul>
              {skipped > preview.problems.length && (
                <p className="mt-2 text-amber-800">…and {(skipped - preview.problems.length).toLocaleString("en-GB")} more.</p>
              )}
            </details>
          )}

          {confirming && (
            <p className="text-sm text-slate-600" aria-live="polite">
              {targetName || preview.assignee.name} will see {plural(preview.toAssign, "lead")} from {preview.fileName} in their
              list straight away. All of them are assigned, or none are.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {confirming ? (
              <button type="button" className={buttonPrimary} disabled={isPending} onClick={assign}>
                {isPending && step === "assign" ? "Assigning…" : `Assign ${plural(preview.toAssign, "lead")} to ${preview.assignee.name}`}
              </button>
            ) : (
              <button type="button" className={buttonPrimary} disabled={preview.toAssign === 0} onClick={() => setConfirming(true)}>
                {preview.toAssign === 0 ? "Nothing to assign" : "Continue"}
              </button>
            )}
            <button type="button" className={buttonSecondary} disabled={isPending} onClick={confirming ? () => setConfirming(false) : clear}>
              {confirming ? "Back" : "Cancel"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Count({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" }) {
  return (
    <div className={`rounded-md px-3 py-2 ring-1 ${tone === "warn" ? "bg-amber-50 ring-amber-100" : "bg-slate-50 ring-slate-200"}`}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-xl font-semibold text-slate-800">{value.toLocaleString("en-GB")}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  );
}
