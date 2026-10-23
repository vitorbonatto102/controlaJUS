import Link from "next/link";
import { ConfirmRecoveryForm } from "@/components/confirm-recovery-form";
import { AuthIntro } from "@/components/brand";
import { parseRecoveryProof } from "@/lib/auth/recovery";

export default async function ConfirmRecoveryPage({ searchParams }: {
  searchParams: Promise<{ token_hash?: string; type?: string; code?: string }>;
}) {
  const { token_hash: tokenHash, type, code } = await searchParams;
  const proof = parseRecoveryProof({ tokenHash, type, code });
  return <main className="login-page"><AuthIntro title="Escolha uma nova senha."
    description="Confirme que você abriu o link de recuperação." />
    <section className="login-card"><p className="eyebrow">RECUPERAÇÃO</p><h2>Confirmar link</h2>
    {proof ? <><p>Clique abaixo para continuar. O link pode ser usado uma única vez.</p>
      <ConfirmRecoveryForm proof={proof} /></> : <>
      <p className="form-error" role="alert">Link incompleto ou inválido.</p>
      <Link className="row-link" href="/recuperar-acesso">Solicitar outro link</Link></>}
  </section></main>;
}
