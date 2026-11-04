export function PaymentAmountField({name, defaultValue, correction = false}: {
  name: string; defaultValue?: string; correction?: boolean;
}) {
  return <label>{correction ? "Novo valor da parcela, sem juros (R$)" : "Valor pago da parcela, sem juros (R$)"}
    <input name={name} inputMode="decimal" defaultValue={defaultValue} placeholder="0,00" required />
    <small className="field-hint">Informe apenas o valor pago referente à parcela. Não inclua os juros pagos pelo cliente.</small>
  </label>;
}
