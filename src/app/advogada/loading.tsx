export default function LoadingLawyer() {
  return <main className="dashboard-main" aria-live="polite"><p>Carregando seus contratos...</p>
    <div className="card-grid lawyer-cards">{Array.from({ length: 5 }, (_, index) =>
      <div className="skeleton-card" key={index} />)}</div></main>;
}
