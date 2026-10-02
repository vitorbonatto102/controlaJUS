"use client";

import { useActionState } from "react";
import { confirmRecovery } from "@/app/auth/recovery/actions";

export function ConfirmRecoveryForm({ tokenHash }: { tokenHash: string }) {
  const [state, action, pending] = useActionState(confirmRecovery, { error: null });
  return <form action={action} className="login-form">
    <input type="hidden" name="token_hash" value={tokenHash} />
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <button type="submit" disabled={pending}>{pending ? "Confirmando…" : "Continuar para nova senha"}</button>
  </form>;
}
