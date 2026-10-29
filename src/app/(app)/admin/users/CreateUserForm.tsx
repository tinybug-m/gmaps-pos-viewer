"use client";

import { useActionState, useState } from "react";

import FormMessage from "@/components/ui/FormMessage";
import SubmitButton from "@/components/ui/SubmitButton";
import { input, label } from "@/components/ui/styles";
import { ROLE_LABEL, ROLES } from "@/lib/workflow";

import { createUserAction, type CreateUserState } from "./actions";
import TempPassword from "./TempPassword";

export default function CreateUserForm() {
  const [state, action] = useActionState<CreateUserState, FormData>(createUserAction, { error: null, created: null });
  // Hide the password once dismissed; a new submission brings a new state object.
  const [dismissed, setDismissed] = useState<CreateUserState | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-user-name" className={label}>
            Name
          </label>
          <input
            id="new-user-name"
            name="name"
            required
            maxLength={100}
            autoComplete="off"
            defaultValue={state.values?.name}
            className={input}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-user-email" className={label}>
            Email
          </label>
          <input
            id="new-user-email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            defaultValue={state.values?.email}
            className={input}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-user-role" className={label}>
            Role
          </label>
          <select id="new-user-role" name="role" defaultValue={state.values?.role ?? "caller"} className={input}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton pendingLabel="Creating…">Create user</SubmitButton>
      </form>
      <FormMessage error={state.error} />
      {state.created && dismissed !== state && (
        <TempPassword
          who={`${state.created.name} (${state.created.email})`}
          password={state.created.tempPassword}
          onDismiss={() => setDismissed(state)}
        />
      )}
    </div>
  );
}
