"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import FormMessage from "@/components/ui/FormMessage";
import { buttonDanger, buttonPrimary, buttonSecondary, input } from "@/components/ui/styles";
import { formatDate } from "@/lib/time";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/workflow";
import type { UserDTO } from "@/server/dal/users";

import { resetPasswordAction, updateUserAction } from "./actions";
import TempPassword from "./TempPassword";

type Mode = "view" | "edit" | "confirmDeactivate" | "confirmReset";

/** One user, with inline edit, deactivate/reactivate and password reset. Every change is confirmed first. */
export default function UserRow({ user, isSelf }: { user: UserDTO; isSelf: boolean }) {
  const [mode, setMode] = useState<Mode>("view");
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMode("view");
      after?.();
    });
  }

  const locked = user.lockedUntil !== null && new Date(user.lockedUntil) > new Date();
  const assignedLink = `/leads?status=all&assignee=${user.id}`;

  return (
    <li className={`flex flex-col gap-3 px-4 py-3 ${user.isActive ? "" : "bg-slate-50"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {mode === "edit" ? (
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor={`name-${user.id}`}>
              Name
            </label>
            <input
              id={`name-${user.id}`}
              className={input}
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="sr-only" htmlFor={`role-${user.id}`}>
              Role
            </label>
            <select
              id={`role-${user.id}`}
              className={`${input} sm:w-40`}
              value={role}
              disabled={isSelf}
              title={isSelf ? "You can't change your own role." : undefined}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
              {user.name}
              {isSelf && <span className="text-xs font-normal text-slate-500">(you)</span>}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                {ROLE_LABEL[user.role]}
              </span>
              {!user.isActive && (
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600">Deactivated</span>
              )}
              {user.isActive && user.mustChangePassword && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                  Hasn&apos;t set a password yet
                </span>
              )}
              {locked && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-100">
                  Locked after failed sign-ins
                </span>
              )}
            </p>
            <p className="truncate text-sm text-slate-500">{user.email}</p>
            <p className="text-xs text-slate-500">
              Added {formatDate(new Date(user.createdAt))}
              {user.deactivatedAt && ` · deactivated ${formatDate(new Date(user.deactivatedAt))}`}
              {" · "}
              {user.assignedLeads > 0 ? (
                <Link href={assignedLink} className="text-slate-600 underline hover:text-slate-800">
                  {user.assignedLeads.toLocaleString("en-GB")} assigned lead{user.assignedLeads === 1 ? "" : "s"}
                </Link>
              ) : (
                "no assigned leads"
              )}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {mode === "edit" ? (
            <>
              <button
                type="button"
                className={buttonPrimary}
                disabled={pending || name.trim() === ""}
                onClick={() =>
                  run(() =>
                    updateUserAction({
                      userId: user.id,
                      name: name.trim(),
                      ...(role !== user.role && { role }),
                    }),
                  )
                }
              >
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className={buttonSecondary}
                disabled={pending}
                onClick={() => {
                  setName(user.name);
                  setRole(user.role);
                  setError(null);
                  setMode("view");
                }}
              >
                Cancel
              </button>
            </>
          ) : mode === "view" ? (
            <>
              <button type="button" className={buttonSecondary} onClick={() => setMode("edit")}>
                Edit
              </button>
              {!isSelf && user.isActive && (
                <>
                  <button type="button" className={buttonSecondary} onClick={() => setMode("confirmReset")}>
                    Reset password
                  </button>
                  <button type="button" className={buttonDanger} onClick={() => setMode("confirmDeactivate")}>
                    Deactivate
                  </button>
                </>
              )}
              {!user.isActive && (
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={pending}
                  onClick={() => run(() => updateUserAction({ userId: user.id, isActive: true }))}
                >
                  {pending ? "Reactivating…" : "Reactivate"}
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {mode === "edit" && role !== user.role && (
        <p className="text-sm text-slate-600">
          Changing the role signs {user.name} out everywhere. They&apos;ll see the {ROLE_LABEL[role].toLowerCase()} view
          next time they sign in.
        </p>
      )}

      {mode === "confirmDeactivate" && (
        <div className="flex flex-col gap-2 rounded-md bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-100">
          <p>
            {user.name} will be signed out and can&apos;t sign in again until reactivated. Their calls and notes stay in
            the history.
            {user.assignedLeads > 0 && (
              <>
                {" "}
                <strong>
                  {user.assignedLeads.toLocaleString("en-GB")} lead{user.assignedLeads === 1 ? " is" : "s are"} still
                  assigned to them
                </strong>{" "}
                and won&apos;t be called until you{" "}
                <Link href={assignedLink} className="underline">
                  reassign them
                </Link>
                .
              </>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonDanger}
              disabled={pending}
              onClick={() => run(() => updateUserAction({ userId: user.id, isActive: false }))}
            >
              {pending ? "Deactivating…" : `Deactivate ${user.name}`}
            </button>
            <button type="button" className={buttonSecondary} disabled={pending} onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "confirmReset" && (
        <div className="flex flex-col gap-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200">
          <p>
            {user.name} gets a new one-time password and is signed out everywhere. Their current password stops working
            straight away.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonPrimary}
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await resetPasswordAction(user.id);
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  setMode("view");
                  setTempPassword(result.tempPassword);
                });
              }}
            >
              {pending ? "Resetting…" : "Reset password"}
            </button>
            <button type="button" className={buttonSecondary} disabled={pending} onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <FormMessage error={error} />
      {tempPassword && <TempPassword who={user.name} password={tempPassword} onDismiss={() => setTempPassword(null)} />}
    </li>
  );
}
