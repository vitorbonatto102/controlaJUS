import Link from "next/link";
import { AcceptInviteForm } from "@/components/accept-invite-form";

export default async function ConfirmInvitePage({ searchParams }: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;
  const validLink = type === "invite" && typeof tokenHash === "string" && tokenHash.length >= 20 && tokenHash.length <= 512;
  return <main className="login-page"><div className="login-intro">
    <div className="brand-mark">CJ</div><p className="eyebrow">ACESSO INTERNO</p>
    <h1>Seu convite para o ControlaJUS.</h1>
    <p>Confirme o convite e depois defina sua senha pessoal.</p>
  </div><section className="login-card"><p className="eyebrow">CONVITE</p>
    <h2>Aceitar convite</h2>
    {validLink ? <><p>Confirme abaixo para ativar o link. Ele pode ser usado uma única vez.</p>
      <AcceptInviteForm tokenHash={tokenHash} /></> : <>
      <p className="form-error" role="alert">Link incompleto ou inválido. Solicite um novo convite ao administrador.</p>
      <Link className="row-link" href="/login">Voltar ao login</Link></>}
  </section></main>;
}
