import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { homeByRole } from "@/lib/auth/roles";
import { LoginForm } from "@/components/login-form";
import { AuthIntro } from "@/components/brand";
import Link from "next/link";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ convite?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.active && profile.office_id) redirect(homeByRole[profile.role]);
  if (profile?.active) redirect("/acesso-pendente");
  const { convite } = await searchParams;

  return <main className="login-page">
    <AuthIntro title="Cada valor, no seu devido lugar."
      description="Acompanhe contratos, recebimentos e repasses com a clareza que a rotina do seu escritório precisa." />
    <section className="login-card" aria-labelledby="login-title">
      <p className="eyebrow">BEM-VINDO DE VOLTA</p>
      <h2 id="login-title">Entrar na plataforma</h2>
      <p>Acesse o ambiente do seu escritório.</p>
      {convite === "invalido" && <p className="form-error" role="alert">Convite inválido ou expirado. Solicite um novo link ao administrador.</p>}
      <LoginForm />
      <Link className="back-link" href="/recuperar-acesso">Esqueci minha senha</Link>
      <p className="login-access-note">Acesso exclusivo para pessoas convidadas pelo escritório.</p>
    </section>
  </main>;
}
