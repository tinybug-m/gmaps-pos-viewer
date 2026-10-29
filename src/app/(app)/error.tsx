"use client";

import Link from "next/link";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useEffect } from "react";

import { buttonPrimary, buttonSecondary, card } from "@/components/ui/styles";

/*
 * Catches anything a page or a form action throws. The common case after a
 * deploy is a tab still running the previous build: its form posts to a
 * server action that no longer exists. Nothing was saved, and only a full
 * reload (new build) fixes it, so say exactly that instead of a generic error.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const stale = unstable_isUnrecognizedActionError(error);

  useEffect(() => {
    if (!stale) console.error(error);
  }, [error, stale]);

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <div role="alert" className={`${card} flex flex-col gap-4 px-6 py-6`}>
        <h1 className="text-lg font-semibold text-slate-800">{stale ? "The app was updated" : "Something went wrong"}</h1>
        <p className="text-sm text-slate-600">
          {stale
            ? "A new version went live while this page was open, so your last entry wasn't saved. Reload the page and enter it again."
            : "This page couldn't load or your last change didn't go through. If you were saving something, check that it went through before entering it again, so nothing is logged twice."}
        </p>
        {error.digest && <p className="font-mono text-xs text-slate-500">Reference: {error.digest}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonPrimary} onClick={() => window.location.reload()}>
            Reload page
          </button>
          {!stale && (
            <button type="button" className={buttonSecondary} onClick={() => retry()}>
              Try again
            </button>
          )}
          <Link href="/" className={buttonSecondary}>
            Go to home
          </Link>
        </div>
      </div>
    </div>
  );
}
