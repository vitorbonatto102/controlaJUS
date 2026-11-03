import { formatDateBR } from "@/lib/formatters";
import styles from "./closing-status-notice.module.css";

export function ClosingStatusNotice({ id, lastDay, today }: {
  id?: string; lastDay: string; canConfirm: boolean; today: string; audience: "manager" | "lawyer";
}) {
  return <div id={id} className={styles.notice} role="status">
    <strong>Fechamento automático · {formatDateBR(lastDay)} às 23h59</strong>
    <p>Desde outubro/2026, os recebimentos registrados são consolidados automaticamente no último dia do mês, no horário de Brasília. Hoje é {formatDateBR(today)}.</p>
    <p>Após o fechamento, o relatório fica disponível para conferência. Use “Corrigir valores” para incluir, corrigir ou estornar recebimentos, com motivo e notificação à outra parte. Os repasses são registrados pelo gestor.</p>
  </div>;
}
