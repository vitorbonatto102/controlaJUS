"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { reportLabels, reportStatuses, type ReportFilters, type ReportKind } from "@/lib/reports/model";
import { formatDateBR } from "@/lib/formatters";
import { ORIGINS } from "@/lib/contracts/validation";
import styles from "./reports.module.css";

function DateField({ name, label, initial }: { name: string; label: string; initial: string }) {
  const [value, setValue] = useState(initial);
  return <label>{label}<input name={name} value={value} inputMode="numeric" placeholder="DD/MM/AAAA" maxLength={10}
    required pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" onChange={event => setValue(event.target.value.replace(/\D/g, "").slice(0, 8)
      .replace(/^(\d{2})(\d)/, "$1/$2").replace(/^(\d{2}\/\d{2})(\d)/, "$1/$2"))} /></label>;
}

function OriginFilter({ initial }: { initial: string[] }) {
  const [selected, setSelected] = useState(initial);
  const dropdown = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdown.current?.contains(event.target)) dropdown.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const label = selected.length === 0 ? "Todas as origens" : selected.length === 1 ? selected[0] : `${selected.length} origens selecionadas`;
  return <div className={styles.originField}><span id="report-origin-label">Origem</span>
    <details ref={dropdown} className={styles.originDropdown} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); dropdown.current?.removeAttribute("open"); dropdown.current?.querySelector("summary")?.focus(); }
    }}>
      <summary aria-labelledby="report-origin-label report-origin-selection"><span id="report-origin-selection">{label}</span></summary>
      <div className={styles.originOptions}>
        <fieldset><legend>Selecione uma ou mais origens</legend>{ORIGINS.map(origin =>
          <label key={origin}><input type="checkbox" name="origem" value={origin} checked={selected.includes(origin)}
            onChange={event => setSelected(current => event.target.checked ? [...current, origin] : current.filter(value => value !== origin))} />{origin}</label>)}</fieldset>
        <div className={styles.originActions}><button type="button" onClick={() => setSelected([...ORIGINS])}>Selecionar todas</button>
          <button type="button" onClick={() => setSelected([])}>Limpar seleção</button></div>
        <p>Sem seleção, todas as origens são incluídas.</p>
      </div>
    </details>
  </div>;
}
export function ReportFiltersForm({ filters, lawyers, canSelectLawyer, dateValues }: { filters: ReportFilters;
  lawyers: { id: string; full_name: string }[]; canSelectLawyer: boolean; dateValues?: { from: string; to: string } }) {
  const [kind, setKind] = useState(filters.kind), [status, setStatus] = useState(filters.status);
  return <section className={styles.filterPanel} aria-labelledby="report-filters-title"><h2 id="report-filters-title">Escolha o que deseja consultar</h2>
    <form action="/relatorios" method="get" className={styles.filters}>
      <label>Tipo de relatório<select name="tipo" value={kind} onChange={event => {
        const next = event.target.value as ReportKind; setKind(next); if (next !== "installments") setStatus("all");
      }}>{Object.entries(reportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <DateField name="de" label="Data inicial" initial={dateValues?.from ?? formatDateBR(filters.from)} />
      <DateField name="ate" label="Data final" initial={dateValues?.to ?? formatDateBR(filters.to)} />
      {canSelectLawyer && <label>Advogada<select name="advogada" defaultValue={filters.lawyerId}>
        <option value="">Todas as advogadas</option>{lawyers.map(lawyer => <option key={lawyer.id} value={lawyer.id}>{lawyer.full_name}</option>)}
      </select></label>}
      <label>Cliente<input name="cliente" type="search" defaultValue={filters.client} maxLength={160} placeholder="Nome de qualquer contratante" /></label>
      <label>CPF do cliente<input name="cpf" defaultValue={filters.cpf} maxLength={14} inputMode="numeric" placeholder="000.000.000-00" /></label>
      <OriginFilter initial={filters.origins} />
      <label>Serviço contratado<input name="servico" type="search" defaultValue={filters.service} maxLength={180} placeholder="Nome da ação ou serviço" /></label>
      <label>Situação da parcela<select name="situacao" value={status} disabled={kind !== "installments"} onChange={event => setStatus(event.target.value as ReportFilters["status"])}>
        {Object.entries(reportStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <div className={styles.filterActions}><button type="submit" className="primary-button">Visualizar relatório</button><Link href="/relatorios">Limpar filtros</Link></div>
    </form><p className={styles.hint}>{kind === "payments" ? "O período considera a data efetiva de cada pagamento válido." : kind === "installments"
      ? "O período considera o vencimento. Saldos e situações refletem os recebimentos registrados até hoje." : "O período considera a data do documento contratual."}</p>
  </section>;
}
