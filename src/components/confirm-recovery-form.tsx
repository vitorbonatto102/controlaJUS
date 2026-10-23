"use client";

import { useActionState } from "react";
import { confirmRecovery } from "@/app/auth/recovery/actions";
import type { RecoveryProof } from "@/lib/auth/recovery";

export function ConfirmRecoveryForm({ proof }: { proof: RecoveryProof }) {
  const [state, action, pending] = useActionState(confirmRecovery, { error: null });
  return <form action={action} className="login-form">
    <input type="hidden" name={proof.kind} value={proof.value} />
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <button type="submit" disabled={pending}>{pending ? "Confirmando…" : "Continuar para nova senha"}</button>
  </form>;
}
