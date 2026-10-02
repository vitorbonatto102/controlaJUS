import Link from "next/link";
import { ConfirmRecoveryForm } from "@/components/confirm-recovery-form";

export default async function ConfirmRecoveryPage({ searchParams }: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;
  const validLink = type === "recovery" && typeof tokenHash === "string" && tokenHash.length >= 20 && tokenHash.length <= 512;
  return <main className="login-page"><div className="login-intro">
    <div className="brand-mark">CJ</div><p className="eyebrow">ACESSO INTERNO</p>
    <h1>Escolha uma nova senha.</h1><p>Confirme que você abriu o link de recuperação.</p>
  </div><section className="login-card"><p className="eyebrow">RECUPERAÇÃO</p><h2>Confirmar link</h2>
    {validLink ? <><p>Clique abaixo para continuar. O link pode ser usado uma única vez.</p>
      <ConfirmRecoveryForm tokenHash={tokenHash} /></> : <>
      <p className="form-error" role="alert">Link incompleto ou inválido.</p>
      <Link className="row-link" href="/recuperar-acesso">Solicitar outro link</Link></>}
  </section></main>;
}
