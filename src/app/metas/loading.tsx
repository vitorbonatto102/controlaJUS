import styles from "@/components/goals/goals.module.css";

export default function GoalsLoading() {
  return <main className={styles.goals} aria-busy="true" aria-live="polite" style={{ padding: 32 }}>
    <h1>Suas metas</h1><p>Carregando seu progresso…</p><div className={styles.loadingBlock} aria-hidden="true" />
  </main>;
}
