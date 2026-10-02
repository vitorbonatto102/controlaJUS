import Link from "next/link";
import { RecoveryRequestForm } from "@/components/recovery-request-form";

export default function RecoveryPage() {
  return <main className="login-page"><div className="login-intro">
    <div className="brand-mark">CJ</div><p className="eyebrow">ACESSO INTERNO</p>
    <h1>Recupere o acesso com seu e-mail.</h1>
    <p>Enviaremos um link de uso único para que você escolha uma nova senha.</p>
  </div><section className="login-card"><p className="eyebrow">RECUPERAÇÃO</p>
    <h2>Definir nova senha</h2><p>Informe o e-mail da sua conta no escritório.</p>
    <RecoveryRequestForm /><Link className="back-link" href="/login">Voltar ao login</Link>
  </section></main>;
}
