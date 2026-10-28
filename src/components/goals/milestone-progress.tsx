"use client";

import { useEffect, useRef } from "react";
import { contractGoalProgress } from "@/lib/dashboard/goals";
import styles from "./goals.module.css";

export function MilestoneProgress({ count, target, storageKey }: { count: number; target: number; storageKey: string }) {
  const track = useRef<HTMLDivElement>(null);
  const progress = contractGoalProgress(count, target);
  const level = [25, 50, 75, 100].filter((mark) => progress.percentage >= mark).at(-1) ?? 0;
  useEffect(() => {
    // First visit and target changes establish a baseline; reductions never replay a milestone.
    try {
      const key = `repassum:goal-milestone:${storageKey}`;
      const saved = localStorage.getItem(key);
      const previous = saved ? JSON.parse(saved) as { target: number; level: number } : null;
      if (previous?.target === target && level > previous.level && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        track.current?.animate?.([{ opacity: .65, transform: "scaleY(.85)" }, { opacity: 1, transform: "scaleY(1)" }],
          { duration: 550, easing: "ease-out" });
      localStorage.setItem(key, JSON.stringify({ target, level: previous?.target === target ? Math.max(level, previous.level) : level }));
    } catch { /* Storage availability does not affect real progress or persistence in the database. */ }
  }, [level, storageKey, target]);
  return <div className={styles.milestoneArea}>
    <div ref={track} className={styles.progress} role="progressbar" aria-label="Progresso da meta de contratos"
      aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(count, target)} aria-valuetext={`${count} de ${target}; ${progress.percentage}%`}>
      <span style={{ width: `${progress.barPercentage}%` }} />
      {[25, 50, 75, 100].map((mark) => <i key={mark} className={progress.percentage >= mark ? styles.markReached : ""}
        style={{ left: `${mark}%` }} aria-hidden="true" />)}
    </div><ol className={styles.milestones} aria-label="Marcos da meta">
      {[25, 50, 75, 100].map((mark) => <li key={mark} data-reached={progress.percentage >= mark}>
        <span>{mark}%</span><small>{progress.percentage >= mark ? "Alcançado" : "Marco"}</small></li>)}
    </ol>
  </div>;
}
