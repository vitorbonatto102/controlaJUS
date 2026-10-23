import { formatDateBR } from "@/lib/formatters";
import styles from "./closing-status-notice.module.css";

export function ClosingStatusNotice({ id, lastDay, canConfirm, today, audience }: {
  id?: string; lastDay: string; canConfirm: boolean; today: string; audience: "manager" | "lawyer";
}) {
  return <div id={id} className={`${styles.notice} ${canConfirm ? styles.available : ""}`} role="status">
    <strong>{canConfirm ? (audience === "manager" ? "Período liberado para fechamento" : "Aguardando confirmação do gestor") :
      `Em apuração · confirmação a partir de ${formatDateBR(lastDay)}`}</strong>
    <p>{canConfirm ? (audience === "manager" ? "Confira os recebimentos, marque a conferência e confirme o fechamento abaixo." :
      "O período já pode ser fechado. O gestor precisa conferir e confirmar os valores para concluir a apuração.") :
      `O mês ainda não terminou. Hoje é ${formatDateBR(today)}, no horário de Brasília. A confirmação fica disponível no último dia do mês.`}</p>
    <p>{audience === "manager" ? "Depois da confirmação, abra Registrar repasse neste fechamento para informar o pagamento à advogada." :
      "O gestor confirma o fechamento e registra os repasses. Você acompanha os valores e o histórico nesta página."}</p>
  </div>;
}
