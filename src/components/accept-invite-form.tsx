"use client";

import { useActionState } from "react";
import { acceptInvite } from "@/app/auth/confirm/actions";

export function AcceptInviteForm({ tokenHash }: { tokenHash: string }) {
  const [state, action, pending] = useActionState(acceptInvite, { error: null });
  return <form action={action} className="login-form">
    <input type="hidden" name="token_hash" value={tokenHash} />
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <button type="submit" disabled={pending}>{pending ? "Confirmando…" : "Aceitar convite"}</button>
  </form>;
}
