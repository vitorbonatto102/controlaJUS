"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OverviewIcon } from "./overview-icon";
import styles from "./shell.module.css";

export type QuickSearchItem = { id: string; clientName: string; service: string | null };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function QuickSearch({ items }: { items: QuickSearchItem[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const router = useRouter();
  const term = normalize(query.trim());
  const results = term.length >= 2 ? items.filter((item) => normalize(`${item.clientName} ${item.service ?? ""}`).includes(term)).slice(0, 6) : [];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return <form className={styles.search} role="search" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onSubmit={(event) => { event.preventDefault(); if (results[0]) router.push(`/advogada/contratos/${results[0].id}`); }}>
    <OverviewIcon name="search" size={18} />
    <input ref={input} type="search" value={query} onFocus={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
      aria-label="Buscar meus contratos por cliente ou serviço" aria-describedby={id}
      placeholder="Buscar cliente ou contrato…" />
    <kbd aria-hidden="true">Ctrl K</kbd>
    <span id={id} className="visually-hidden">Digite pelo menos duas letras. Use Tab para acessar os resultados ou Enter para abrir o primeiro contrato.</span>
    {open && term.length >= 2 && <div className={styles.searchResults}>
      {results.length ? <ul>{results.map((item) => <li key={item.id}><Link href={`/advogada/contratos/${item.id}`}>
        <strong>{item.clientName}</strong><span>{item.service || "Serviço não informado"}</span>
      </Link></li>)}</ul> : <p role="status">Nenhum contrato encontrado.</p>}
    </div>}
  </form>;
}
