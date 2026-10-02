import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { homeByRole } from "@/lib/auth/roles";
import { LoginForm } from "@/components/login-form";
import Link from "next/link";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ convite?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.active) redirect(homeByRole[profile.role]);
  const { convite } = await searchParams;

  return <main className="login-page">
    <div className="login-intro">
      <div className="brand-mark">CJ</div>
      <p className="eyebrow">PLATAFORMA INTERNA</p>
      <h1>Gestão do escritório, em um só lugar.</h1>
      <p>Contratos, recebimentos e acompanhamento financeiro com acesso adequado a cada função.</p>
    </div>
    <section className="login-card" aria-labelledby="login-title">
      <p className="eyebrow">BEM-VINDO DE VOLTA</p>
      <h2 id="login-title">Entrar na plataforma</h2>
      <p>Use suas credenciais de acesso.</p>
      {convite === "invalido" && <p className="form-error" role="alert">Convite inválido ou expirado. Solicite um novo link ao administrador.</p>}
      <LoginForm />
      <Link className="back-link" href="/recuperar-acesso">Esqueci minha senha</Link>
    </section>
  </main>;
}
