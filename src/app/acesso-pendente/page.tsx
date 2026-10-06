import { signOut } from "@/app/actions";

export default function PendingPage() {
  return <main className="simple-page"><section className="workspace-panel">
    <p className="eyebrow">ACESSO PENDENTE</p><h1>Seu acesso ainda não foi ativado.</h1>
    <p>Peça ao admin do seu escritório para definir seu cargo, vincular você ao escritório e ativar seu usuário.</p>
    <form action={signOut}><button type="submit">Sair</button></form>
  </section></main>;
}
