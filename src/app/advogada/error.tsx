"use client";

export default function LawyerError({ reset }: { error: Error; reset: () => void }) {
  return <main className="simple-page"><section className="workspace-panel">
    <p className="eyebrow">NÃO FOI POSSÍVEL CARREGAR</p>
    <h1>Ocorreu um problema ao consultar seus dados.</h1>
    <p>Tente novamente. Se o problema continuar, procure o administrador.</p>
    <button className="primary-button" type="button" onClick={reset}>Tentar novamente</button>
  </section></main>;
}
