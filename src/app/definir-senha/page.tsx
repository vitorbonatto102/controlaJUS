import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/set-password-form";
import { createClient } from "@/lib/supabase/server";

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims?.sub) redirect("/login?convite=invalido");
  return <main className="login-page"><div className="login-intro">
    <div className="brand-mark">CJ</div><p className="eyebrow">ACESSO INTERNO</p>
    <h1>Bem-vindo(a) ao ControlaJUS.</h1><p>Defina sua senha para acessar a plataforma.</p>
  </div><section className="login-card"><p className="eyebrow">SENHA</p>
    <h2>Definir senha</h2><p>Escolha uma senha de pelo menos 6 caracteres. O Supabase aplica a política configurada no projeto.</p>
    <SetPasswordForm /></section></main>;
}
