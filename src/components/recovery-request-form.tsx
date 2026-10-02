"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/app/recuperar-acesso/actions";

export function RecoveryRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, { error: null, success: null });
  return <form action={action} className="login-form">
    <label htmlFor="recovery-email">E-mail cadastrado</label>
    <input id="recovery-email" name="email" type="email" autoComplete="email" required />
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {state.success && <p className="success-box" role="status">{state.success}</p>}
    <button type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar link de recuperação"}</button>
  </form>;
}
