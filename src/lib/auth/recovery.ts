export type RecoveryProof = { kind: "token_hash" | "code"; value: string };

export function recoveryRedirectUrl(origin: string | null): string {
  if (!origin) throw new Error("Origem da solicitação ausente.");
  const url = new URL(origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local))) {
    throw new Error("Origem inválida para recuperação de senha.");
  }
  return new URL("/auth/recovery", url.origin).toString();
}

export function parseRecoveryProof({ tokenHash, code, type }: {
  tokenHash: unknown; code: unknown; type: unknown;
}): RecoveryProof | null {
  const valid = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9_-]{20,512}$/.test(value);
  if (tokenHash != null && code != null) return null;
  if (type === "recovery" && valid(tokenHash)) return { kind: "token_hash", value: tokenHash };
  if (tokenHash == null && valid(code) && (type == null || type === "recovery")) return { kind: "code", value: code };
  return null;
}
