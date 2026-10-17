import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/set-password-form";
import { createClient } from "@/lib/supabase/server";
import { AuthIntro } from "@/components/brand";

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims?.sub) redirect("/login?convite=invalido");
  return <main className="login-page"><AuthIntro title="Bem-vindo(a) à Repassum."
    description="Defina sua senha para acessar a plataforma." />
    <section className="login-card"><p className="eyebrow">SENHA</p>
    <h2>Definir senha</h2><p>Escolha uma senha de pelo menos 6 caracteres. O Supabase aplica a política configurada no projeto.</p>
    <SetPasswordForm /></section></main>;
}
