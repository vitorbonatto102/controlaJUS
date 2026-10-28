"use client";

import styles from "@/components/goals/goals.module.css";

export default function GoalsError({ reset }: { error: Error; reset: () => void }) {
  return <main className={styles.setup}><h1>Não foi possível carregar suas metas</h1>
    <p>Ocorreu um problema ao consultar o progresso. Tente novamente.</p>
    <button className="secondary-button" type="button" onClick={reset}>Tentar novamente</button></main>;
}
