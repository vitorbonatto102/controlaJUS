import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRecoveryProof, recoveryRedirectUrl } from "../src/lib/auth/recovery";

test("recuperação retorna à rota absoluta da aplicação, sem aceitar origens relativas ou inseguras", () => {
  assert.equal(recoveryRedirectUrl("https://repassum.vercel.app"), "https://repassum.vercel.app/auth/recovery");
  assert.equal(recoveryRedirectUrl("http://localhost:3001"), "http://localhost:3001/auth/recovery");
  for (const origin of [null, "controlajus.vercel.app", "https://example.com/caminho", "http://example.com", "https://user:pass@example.com", "https://example.com/?redirect=outro"])
    assert.throws(() => recoveryRedirectUrl(origin));
});

test("recuperação aceita hash do template personalizado e código PKCE sem misturar credenciais", () => {
  const tokenHash = "a".repeat(64);
  const code = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseRecoveryProof({ tokenHash, code: undefined, type: "recovery" }), { kind: "token_hash", value: tokenHash });
  assert.deepEqual(parseRecoveryProof({ tokenHash: null, code, type: undefined }), { kind: "code", value: code });
  assert.equal(parseRecoveryProof({ tokenHash, code, type: "recovery" }), null);
  assert.equal(parseRecoveryProof({ tokenHash, code: null, type: "invite" }), null);
  assert.equal(parseRecoveryProof({ tokenHash: null, code: [code, code], type: "recovery" }), null);
  assert.equal(parseRecoveryProof({ tokenHash: "curto", code: null, type: "recovery" }), null);
});
