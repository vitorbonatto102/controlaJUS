"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "@/app/actions";

const initialState: LoginState = { error: "" };

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initialState);
  return <form action={action} className="login-form">
    <label htmlFor="email">E-mail</label>
    <input id="email" name="email" type="email" autoComplete="username" required placeholder="nome@escritorio.com.br" />
    <label htmlFor="password">Senha</label>
    <input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Sua senha" />
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <button type="submit" disabled={pending}>{pending ? "Entrando..." : "Entrar"}</button>
  </form>;
}
