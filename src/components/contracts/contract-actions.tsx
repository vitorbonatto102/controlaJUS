"use client";

import Link from "next/link";
import { useActionState } from "react";
import { deleteLawyerContract } from "@/app/advogada/contratos/actions";
import { emptyActionState } from "@/lib/action-state";
import styles from "./contract-management.module.css";

export function ContractActions({ id, version, hasPayments, showView = true }: {
  id: string; version: string; hasPayments: boolean; showView?: boolean;
}) {
  const [state, action, pending] = useActionState(deleteLawyerContract, emptyActionState);
  return <div><div className={styles.actions}>
    {showView && <Link href={`/advogada/contratos/${id}`}>Visualizar</Link>}
    <Link href={`/advogada/contratos/${id}/editar`}>Editar</Link>
    {hasPayments ? <button className={styles.disabledDelete} type="button" disabled
      title="Contratos com pagamentos registrados devem ser corrigidos pelo gestor.">Excluir</button> :
      <details className={styles.delete}><summary>Excluir</summary><form action={action}>
        <input type="hidden" name="contract_id" value={id} /><input type="hidden" name="version" value={version} />
        <p>O contrato sairá das listagens e previsões. O cliente, o PDF e o histórico de auditoria serão preservados.</p>
        <label>Motivo da exclusão<textarea name="reason" minLength={5} maxLength={1000} required /></label>
        <label className={styles.confirmation}><input name="confirm" type="checkbox" value="yes" required />
          Confirmo a exclusão deste contrato.</label>
        {state.error && <p role="alert">{state.error}</p>}
        <button className={styles.danger} type="submit" disabled={pending}>{pending ? "Excluindo..." : "Confirmar exclusão"}</button>
      </form></details>}
  </div>{hasPayments && <small className={styles.hint}>Exclusão indisponível: há histórico de pagamentos.</small>}</div>;
}
