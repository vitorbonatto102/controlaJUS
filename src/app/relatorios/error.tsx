"use client";
import styles from "@/components/reports/reports.module.css";
export default function ReportsError({ reset }: { reset: () => void; error: Error }) {
  return <main className={styles.page}><h1>Não foi possível carregar os relatórios</h1><p>Ocorreu um problema ao consultar os registros.</p>
    <button type="button" className="secondary-button" onClick={reset}>Tentar novamente</button></main>;
}
