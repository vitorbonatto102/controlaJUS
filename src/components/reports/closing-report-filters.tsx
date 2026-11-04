import Link from "next/link";
import {OriginFilter} from "./report-filters";
import styles from "./reports.module.css";

export function ClosingReportFilters({id,origins}:{id:string;origins:string[]}) {
  return <section className={styles.filterPanel}>
    <h2>Emitir relatório por origem</h2>
    <p className={styles.hint}>O fechamento mensal continua completo. Escolha uma ou mais origens para consultar e baixar somente os recebimentos e participações desse recorte.</p>
    <form action={`/fechamentos/${id}`} method="get" className={styles.filters} style={{marginTop:18}}>
      <OriginFilter key={origins.join("|")} initial={origins}/>
      <div className={styles.filterActions}><button className="primary-button" type="submit">Aplicar filtro</button>
        <Link href={`/fechamentos/${id}`}>Ver fechamento completo</Link></div>
    </form>
  </section>;
}
