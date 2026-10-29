"use client";

import { useState } from "react";

import { buttonSecondary } from "@/components/ui/styles";

/** A one-time password, shown once. It isn't stored in clear anywhere, so it can't be shown again. */
export default function TempPassword({ who, password, onDismiss }: { who: string; password: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
      <p>
        One-time password for <span className="font-medium">{who}</span>. Give it to them in person or over a private
        channel. They&apos;ll choose their own when they first sign in. It won&apos;t be shown again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-white px-2 py-1 font-mono text-base tracking-wide ring-1 ring-amber-200 select-all">
          {password}
        </code>
        <button
          type="button"
          className={buttonSecondary}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              setCopied(true);
              setCopyFailed(false);
            } catch {
              setCopied(false);
              setCopyFailed(true);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="text-sm font-medium text-amber-800 hover:text-amber-950" onClick={onDismiss}>
          Done
        </button>
      </div>
      {copyFailed && <p className="text-xs">Couldn&apos;t copy automatically. Select the password above and copy it by hand.</p>}
    </div>
  );
}
