import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { getLoginErrorMessage } from "../src/lib/auth/login-errors";

test("login só informa credenciais inválidas quando o Auth retorna invalid_credentials", () => {
  assert.equal(getLoginErrorMessage(new AuthApiError("Invalid login credentials", 400,
    "invalid_credentials")), "E-mail ou senha inválidos.");
});

test("falhas de rede, servidor e configuração não são apresentadas como senha inválida", () => {
  const unavailable = "Não foi possível acessar o serviço de autenticação. Tente novamente em instantes ou avise o administrador.";
  for (const error of [new AuthRetryableFetchError("fetch failed: ENOTFOUND", 0),
    new AuthApiError("Database unavailable", 503, "unexpected_failure"),
    new AuthApiError("Invalid API key", 401, undefined), null]) {
    assert.equal(getLoginErrorMessage(error), unavailable);
  }
});

test("limite de tentativas orienta aguardar sem expor a resposta interna", () => {
  assert.match(getLoginErrorMessage(new AuthApiError("internal details", 429,
    "over_request_rate_limit")), /Aguarde alguns minutos/);
});

test("convite não confirmado orienta concluir a confirmação do e-mail", () => {
  assert.match(getLoginErrorMessage(new AuthApiError("Email not confirmed", 400,
    "email_not_confirmed")), /Confirme seu e-mail/);
});
