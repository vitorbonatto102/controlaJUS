import styles from "@/components/goals/goals.module.css";
export default function TeamGoalsLoading() {
  return <div className={styles.goals} aria-busy="true"><h1>Metas da equipe</h1><p>Consultando as metas e contratações do período…</p><div className={styles.loadingBlock} /></div>;
}
