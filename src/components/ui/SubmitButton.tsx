"use client";

import { useFormStatus } from "react-dom";

import { buttonPrimary } from "./styles";

/** Disabled while its form is submitting, so a double click can't send twice. */
export default function SubmitButton({
  children,
  pendingLabel,
  className = buttonPrimary,
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-disabled={pending || disabled}>
      {pending ? pendingLabel : children}
    </button>
  );
}
