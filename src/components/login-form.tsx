"use client";

import { useActionState, useState } from "react";
import { signIn, type LoginState } from "@/app/actions";
import styles from "./login-form.module.css";

const initialState: LoginState = { error: "" };

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initialState);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordToggleLabel = passwordVisible ? "Ocultar senha" : "Mostrar senha";
  return <form action={action} className="login-form">
    <label htmlFor="email">E-mail</label>
    <input id="email" name="email" type="email" autoComplete="username" required placeholder="nome@escritorio.com.br" />
    <label htmlFor="password">Senha</label>
    <div className={styles.passwordField}>
      <input id="password" name="password" type={passwordVisible ? "text" : "password"}
        className={styles.passwordInput} autoComplete="current-password" required placeholder="Sua senha" />
      <button type="button" className={styles.passwordToggle} aria-label={passwordToggleLabel}
        title={passwordToggleLabel} aria-controls="password" aria-pressed={passwordVisible}
        onClick={() => setPasswordVisible((visible) => !visible)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {passwordVisible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <button type="submit" disabled={pending}>{pending ? "Entrando..." : "Entrar"}</button>
  </form>;
}
