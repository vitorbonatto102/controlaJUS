import type { InstallmentGroupInput } from "@/lib/contracts/installment-groups";
import { parseMoneyBR } from "@/lib/contracts/finance";
import { formatBRL } from "@/lib/formatters";
import styles from "./installment-groups.module.css";

export function InstallmentGroupsFields({firstCount, groups, onChange}: {
  firstCount: string; groups: InstallmentGroupInput[]; onChange: (groups: InstallmentGroupInput[]) => void;
}) {
  const update = (index: number, key: keyof InstallmentGroupInput, value: string) =>
    onChange(groups.map((group, position) => position === index ? {...group, [key]: value} : group));
  return <div className={styles.groups}>
    {groups.map((group, index) => <fieldset className={styles.group} key={index}><legend>Grupo {index + 2}</legend>
      <div className={styles.fields}><label>Quantidade de parcelas do grupo {index + 2}
        <input type="number" min="1" max="120" value={group.count} onChange={event=>update(index,"count",event.target.value)}/></label>
        <label>Valor de cada parcela do grupo {index + 2} (R$)<input inputMode="decimal" value={group.amount}
          onChange={event=>update(index,"amount",event.target.value)} onBlur={()=>{
            const cents=parseMoneyBR(group.amount);if(cents!==null)update(index,"amount",formatBRL(cents/100));
          }}/></label>
        <button className="text-button" type="button" onClick={()=>onChange(groups.filter((_,position)=>position!==index))}
          aria-label={`Remover grupo ${index + 2}`}>Remover</button></div>
    </fieldset>)}
    <button className="secondary-button" type="button" disabled={groups.length>=119}
      onClick={()=>onChange([...groups,{count:"",amount:""}])}>+ Adicionar parcelas</button>
    <p className="field-hint">Adicione um grupo quando a quantidade ou o valor mudar. Os grupos seguem a ordem acima, mês a mês, sem reiniciar os vencimentos.</p>
    {groups.length>0&&<p className={styles.summary}>{[firstCount,...groups.map(group=>group.count)].every(count=>/^\d+$/.test(count))?
      `${Number(firstCount)+groups.reduce((sum,group)=>sum+Number(group.count),0)} parcelas no total · limite de 120`:
      "Preencha a quantidade e o valor de todos os grupos."}</p>}
  </div>;
}
