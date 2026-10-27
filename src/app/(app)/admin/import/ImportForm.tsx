"use client";

import { useRef, useState, useTransition } from "react";

import FormMessage from "@/components/ui/FormMessage";
import { buttonPrimary, buttonSecondary, label } from "@/components/ui/styles";
import type { ImportPreview } from "@/server/dal/imports";
import { MAX_IMPORT_BYTES } from "@/lib/validation";

import { commitImportAction, previewImportAction } from "./actions";

const UNEXPECTED = "Something went wrong. Check your connection, reload the page and try again.";

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

/**
 * Two steps: check a file (a dry run that writes nothing), then import it.
 * The server validates the file again on import, so the check is only a
 * preview of what will happen.
 */
export default function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [step, setStep] = useState<"check" | "import" | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function clear() {
    choose(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function choose(next: File | null) {
    setFile(next);
    setPreview(null);
    setSuccess(null);
    setError(next && next.size > MAX_IMPORT_BYTES ? "That file is too large to import in one go (3.5 MB). Split it into smaller files." : null);
  }

  function upload(): FormData | null {
    if (!file) {
      setError("Choose a JSON export file to import.");
      return null;
    }
    const form = new FormData();
    form.set("file", file);
    return form;
  }

  function check() {
    const form = upload();
    if (!form) return;
    setError(null);
    setSuccess(null);
    setStep("check");
    startTransition(async () => {
      try {
        const result = await previewImportAction(form);
        if (result.ok) setPreview(result.preview);
        else setError(result.message);
      } catch {
        setError(UNEXPECTED);
      }
    });
  }

  function commit() {
    const form = upload();
    if (!form) return;
    setError(null);
    setStep("import");
    startTransition(async () => {
      try {
        const result = await commitImportAction(form);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const p = result.preview;
        setSuccess(
          `Imported ${p.fileName}: ${plural(p.inserted, "new lead")}, ${plural(p.updated, "lead")} updated, ${p.unchanged.toLocaleString("en-GB")} unchanged.`,
        );
        setFile(null);
        setPreview(null);
        if (fileInput.current) fileInput.current.value = "";
      } catch {
        setError(UNEXPECTED);
      }
    });
  }

  const changes = preview ? preview.inserted + preview.updated : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="import-file" className={label}>
          Export file
        </label>
        <input
          ref={fileInput}
          id="import-file"
          type="file"
          accept=".json,application/json"
          disabled={isPending}
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
          aria-describedby="import-file-hint"
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50 disabled:opacity-60"
        />
        <p id="import-file-hint" className="text-xs text-slate-500">
          A JSON array of businesses, as exported by the crawler (up to 3.5 MB and 10,000 records). The file isn&apos;t
          changed or stored.
        </p>
      </div>

      <FormMessage error={error} success={success} />

      {!preview && (
        <div>
          <button type="button" className={buttonPrimary} disabled={!file || isPending || error !== null} onClick={check}>
            {isPending && step === "check" ? "Checking…" : "Check file"}
          </button>
        </div>
      )}

      {preview && (
        <section aria-labelledby="import-preview-title" className="flex flex-col gap-4">
          <div>
            <h2 id="import-preview-title" className="text-base font-semibold text-slate-800">
              {preview.fileName}: {plural(preview.total, "record")}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">Nothing has been imported yet. This is what importing will do.</p>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Count label="New" value={preview.inserted} hint="added as unassigned" />
            <Count label="Changed" value={preview.updated} hint="imported data refreshed" />
            <Count label="Unchanged" value={preview.unchanged} />
            <Count label="Invalid" value={preview.invalid} hint="skipped" tone={preview.invalid ? "warn" : undefined} />
            <Count
              label="Duplicates"
              value={preview.duplicates}
              hint="skipped"
              tone={preview.duplicates ? "warn" : undefined}
            />
          </dl>

          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Assignments, pipeline status, calls and notes on existing leads are never changed by an import.</li>
            {preview.archived > 0 && (
              <li>{plural(preview.archived, "record matches an archived lead", "records match archived leads")}, which stay archived.</li>
            )}
          </ul>

          {preview.problems.length > 0 && (
            <details className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
              <summary className="cursor-pointer font-medium">
                {plural(preview.invalid + preview.duplicates, "row")} will be skipped
              </summary>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {preview.problems.map((p) => (
                  <li key={p.row}>
                    <span className="font-medium">Row {p.row}:</span> {p.message}
                  </li>
                ))}
              </ul>
              {preview.invalid + preview.duplicates > preview.problems.length && (
                <p className="mt-2 text-amber-800">
                  …and {(preview.invalid + preview.duplicates - preview.problems.length).toLocaleString("en-GB")} more.
                </p>
              )}
            </details>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={buttonPrimary} disabled={isPending || changes === 0} onClick={commit}>
              {isPending && step === "import"
                ? "Importing…"
                : changes === 0
                  ? "Nothing to import"
                  : `Import ${plural(changes, "lead")}`}
            </button>
            <button type="button" className={buttonSecondary} disabled={isPending} onClick={clear}>
              Cancel
            </button>
            {changes === 0 && (
              <p className="text-sm text-slate-500">Every valid record in this file is already imported and up to date.</p>
            )}
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
