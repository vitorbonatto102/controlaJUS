"use client";

import { useActionState } from "react";
import { setInitialPassword } from "@/app/definir-senha/actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setInitialPassword, { error: null, success: null });
  return <form className="login-form" action={action}>
    <label htmlFor="new-password">Nova senha</label>
    <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={6} maxLength={128} required />
    <label htmlFor="confirm-password">Confirmar senha</label>
    <input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={6} maxLength={128} required />
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <button type="submit" disabled={pending}>{pending ? "Salvando…" : "Definir senha"}</button>
  </form>;
}
