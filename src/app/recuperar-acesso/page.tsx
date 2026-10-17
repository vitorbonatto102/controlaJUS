import Link from "next/link";
import { RecoveryRequestForm } from "@/components/recovery-request-form";
import { AuthIntro } from "@/components/brand";

export default function RecoveryPage() {
  return <main className="login-page"><AuthIntro title="Vamos recuperar seu acesso."
    description="Enviaremos um link de uso único para que você escolha uma nova senha." />
    <section className="login-card"><p className="eyebrow">RECUPERAÇÃO</p>
    <h2>Definir nova senha</h2><p>Informe o e-mail da sua conta no escritório.</p>
    <RecoveryRequestForm /><Link className="back-link" href="/login">Voltar ao login</Link>
  </section></main>;
}
