"use client";
import styles from "@/components/reports/reports.module.css";

export default function PayoutError({retry}:{retry:()=>void}) {
  return <main className={styles.page}><h1>Não foi possível carregar o relatório</h1><p>Tente novamente. Se o problema continuar, peça ao administrador para conferir a atualização do banco.</p>
    <button className="secondary-button" onClick={retry}>Tentar novamente</button></main>;
}
