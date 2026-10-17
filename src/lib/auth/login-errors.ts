import type { AuthError } from "@supabase/supabase-js";

export function getLoginErrorMessage(error: Pick<AuthError, "code" | "status"> | null): string {
  if (error?.code === "invalid_credentials") {
    return "E-mail ou senha inválidos.";
  }

  if (error?.status === 429 || error?.code === "over_request_rate_limit") {
    return "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.";
  }

  if (error?.code === "email_not_confirmed") {
    return "Confirme seu e-mail pelo convite recebido antes de entrar.";
  }

  return "Não foi possível acessar o serviço de autenticação. Tente novamente em instantes ou avise o administrador.";
}
