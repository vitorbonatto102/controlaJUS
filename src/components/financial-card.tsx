export function FinancialCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return <article className="metric-card financial-card">
    <h2>{title}</h2><div className="metric-value">{value}</div><p>{hint}</p>
  </article>;
}
