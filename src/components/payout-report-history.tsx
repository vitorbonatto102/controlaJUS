import Link from "next/link";
import type {PayoutReportSummary} from "@/lib/finance/payout-report-data";
import {formatBRL,formatDateBR} from "@/lib/formatters";
export function PayoutReportHistory({reports,available}:{reports:PayoutReportSummary[];available:boolean}){
  return <section className="workspace-panel"><h2>Meus relatórios para repasse</h2>
    <p>Emita o relatório no mês fechado, usando as origens desejadas. Depois de receber, abra-o aqui para confirmar o valor.</p>
    {!available?<p>A emissão e a confirmação de recebimentos aguardam a atualização do banco pelo administrador.</p>:!reports.length?<p>Nenhum relatório para repasse emitido. Abra um fechamento confirmado para começar.</p>:
      <><div className="table-scroll"><table className="data-table"><thead><tr><th>Competência</th><th>Emissão</th><th>Relatório</th><th>Origens</th><th>A receber na emissão</th><th>Ação</th></tr></thead>
        <tbody>{reports.map(report=><tr key={report.id}><td>{String(report.reference_month).padStart(2,"0")}/{report.reference_year}</td><td>{formatDateBR(new Date(report.created_at))}</td><td>{report.id.slice(0,8)}</td>
          <td>{report.origins.length?report.origins.join(" · "):"Todas as origens"}</td><td>{formatBRL(report.amount_due)}</td>
          <td><Link href={`/repasses/${report.id}`}>Visualizar / confirmar recebimento</Link></td></tr>)}</tbody></table></div><p>Últimos 50 relatórios emitidos. Cada confirmação respeita o saldo real do fechamento, mesmo quando há relatórios com origens sobrepostas.</p></>}
  </section>;
}
