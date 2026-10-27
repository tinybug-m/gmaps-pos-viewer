"use client";

import { useActionState } from "react";

import FormMessage from "@/components/ui/FormMessage";
import SubmitButton from "@/components/ui/SubmitButton";
import { input, label } from "@/components/ui/styles";

import { changePasswordAction, type PasswordState } from "./actions";

const FIELDS = [
  { name: "currentPassword", label: "Current password", autoComplete: "current-password" },
  { name: "newPassword", label: "New password", autoComplete: "new-password", hint: "At least 12 characters." },
  { name: "confirmPassword", label: "Repeat new password", autoComplete: "new-password" },
];

export default function PasswordForm({ email }: { email: string }) {
  const [state, action] = useActionState<PasswordState, FormData>(changePasswordAction, { error: null, success: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Lets password managers save the new password against the right account. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      {FIELDS.map((f) => (
        <div key={f.name} className="flex flex-col gap-1.5">
          <label htmlFor={f.name} className={label}>
            {f.label}
          </label>
          <input
            id={f.name}
            name={f.name}
            type="password"
            autoComplete={f.autoComplete}
            required
            minLength={f.name === "currentPassword" ? undefined : 12}
            aria-describedby={f.hint ? `${f.name}-hint` : undefined}
            className={input}
          />
          {f.hint && (
            <p id={`${f.name}-hint`} className="text-xs text-slate-500">
              {f.hint}
            </p>
          )}
        </div>
      ))}
      <FormMessage error={state.error} success={state.success} />
      <SubmitButton pendingLabel="Saving…">Change password</SubmitButton>
    </form>
  );
}
