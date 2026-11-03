import styles from "@/components/reports/reports.module.css";
export default function ReportsLoading() {
  return <main className={styles.page} aria-busy="true"><h1>Relatórios</h1><p>Consultando os registros permitidos para sua conta…</p><div className={styles.loading} /></main>;
}
