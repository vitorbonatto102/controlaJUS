import Link from "next/link";
import { ConfirmRecoveryForm } from "@/components/confirm-recovery-form";
import { AuthIntro } from "@/components/brand";

export default async function ConfirmRecoveryPage({ searchParams }: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;
  const validLink = type === "recovery" && typeof tokenHash === "string" && tokenHash.length >= 20 && tokenHash.length <= 512;
  return <main className="login-page"><AuthIntro title="Escolha uma nova senha."
    description="Confirme que você abriu o link de recuperação." />
    <section className="login-card"><p className="eyebrow">RECUPERAÇÃO</p><h2>Confirmar link</h2>
    {validLink ? <><p>Clique abaixo para continuar. O link pode ser usado uma única vez.</p>
      <ConfirmRecoveryForm tokenHash={tokenHash} /></> : <>
      <p className="form-error" role="alert">Link incompleto ou inválido.</p>
      <Link className="row-link" href="/recuperar-acesso">Solicitar outro link</Link></>}
  </section></main>;
}
