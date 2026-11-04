import styles from "@/components/reports/reports.module.css";

export default function PayoutLoading() {
  return <main className={styles.page} aria-busy="true"><h1>Relatório para repasse</h1><p>Consultando o documento e os recebimentos da sua conta…</p><div className={styles.loading}/></main>;
}
