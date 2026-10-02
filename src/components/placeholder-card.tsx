export function PlaceholderCard({ title, hint }: { title: string; hint: string }) {
  return <article className="metric-card"><h2>{title}</h2><div className="metric-value">—</div><p>{hint}</p></article>;
}
