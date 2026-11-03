"use client";

import { useState } from "react";
import styles from "./reports.module.css";

export function DownloadReport({ href, label = "Baixar PDF" }: { href: string; label?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(href, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Não foi possível emitir o relatório. Tente novamente.");
      }
      if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("Sua sessão pode ter expirado. Entre novamente.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([a-zA-Z0-9._-]+)"/)?.[1] || "repassum-relatorio.pdf";
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível baixar o PDF."); }
    finally { setBusy(false); }
  }
  return <div className={styles.download}><button type="button" onClick={download} disabled={busy} className="secondary-button">
    {busy ? "Gerando PDF…" : label}</button>{error && <p role="alert">{error}</p>}</div>;
}
