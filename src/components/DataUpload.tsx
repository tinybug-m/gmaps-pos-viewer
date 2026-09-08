"use client";

import { useRef, useState } from "react";

import { LeadDataError, parseRawLeads } from "@/lib/validation";
import type { RawLead } from "@/types/lead";

export default function DataUpload({
  onUpload,
  onReset,
  isCustom,
  fileName,
}: {
  onUpload: (leads: RawLead[], fileName: string) => void;
  onReset: () => void;
  isCustom: boolean;
  fileName: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const leads = parseRawLeads(text);
      onUpload(leads, file.name);
    } catch (err) {
      setError(err instanceof LeadDataError ? err.message : "Couldn't read that file.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isCustom && fileName && (
          <>
            <span className="text-sm text-slate-500">
              Showing <span className="font-medium text-slate-700">{fileName}</span>
            </span>
            <button
              type="button"
              onClick={onReset}
              className="text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              Reset to sample data
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <UploadIcon />
          Upload JSON
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="max-w-sm text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-4 w-4"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3.75 3.75 0 0 1 4.133 6.08A4.5 4.5 0 0 1 17.25 19.5H6.75Z"
      />
    </svg>
  );
}
