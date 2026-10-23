import type { Closing, Transfer } from "@/lib/finance/data";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import styles from "./wallet.module.css";

const closingLabels: Record<Closing["status"], string> = {
  draft: "Em apuração", closed: "Fechado", partial: "Parcialmente pago", paid: "Pago",
};

export function WalletSettlements({ closings, transfers }: { closings: Closing[]; transfers: Transfer[] }) {
  return <div className={styles.settlements}>
    <section className={styles.panel} aria-labelledby="closings-title"><h2 id="closings-title">Meus fechamentos</h2>
      <p className={styles.subheading}>Histórico completo da carteira, com as correções e os repasses registrados.</p>
      {closings.length ? <div className="table-scroll"><table className={styles.table}><thead><tr>
        <th scope="col">Competência</th><th scope="col">Comissão</th><th scope="col">Já recebido</th><th scope="col">A receber</th><th scope="col">Status</th>
      </tr></thead><tbody>{closings.map((closing) => <tr key={closing.id}>
        <td>{String(closing.reference_month).padStart(2, "0")}/{closing.reference_year}</td>
        <td>{formatBRL(closing.commission_amount + closing.adjustment_amount)}
          {closing.adjustment_amount !== 0 && <small>Corrigido após fechamento</small>}</td>
        <td>{formatBRL(closing.amount_already_transferred)}</td><td>{formatBRL(closing.amount_pending_transfer)}</td>
        <td>{closingLabels[closing.status]}{closing.amount_overpaid > 0 && <small>Excesso a regularizar: {formatBRL(closing.amount_overpaid)}</small>}</td>
      </tr>)}</tbody></table></div> : <div className={styles.empty}>Nenhum fechamento realizado.<p>Os valores aparecerão quando o gestor fechar o período.</p></div>}
    </section>
    <section className={styles.panel} aria-labelledby="transfers-title"><h2 id="transfers-title">Valores recebidos do escritório</h2>
      <p className={styles.subheading}>Valores transferidos à advogada. Estornos permanecem no histórico e não compõem o saldo.</p>
      {transfers.length ? <div className="table-scroll"><table className={styles.table}><thead><tr>
        <th scope="col">Competência</th><th scope="col">Data</th><th scope="col">Valor</th><th scope="col">Situação</th><th scope="col">Observação</th>
      </tr></thead><tbody>{transfers.map((transfer) => {
        const closing = closings.find((item) => item.id === transfer.closing_id);
        return <tr key={transfer.id}>
          <td>{closing ? `${String(closing.reference_month).padStart(2, "0")}/${closing.reference_year}` : "—"}</td>
          <td>{formatDateBR(transfer.payment_date)}</td><td>{formatBRL(transfer.amount)}</td>
          <td>{transfer.reversed_at ? "Estornado" : "Repassado"}{transfer.reversed_at && transfer.reversal_reason &&
            <small>{transfer.reversal_reason}</small>}</td>
          <td><span className={styles.transferNotes}>{transfer.notes || "—"}</span></td>
        </tr>;
      })}</tbody></table></div> : <div className={styles.empty}>Nenhum repasse registrado.</div>}
    </section>
  </div>;
}
