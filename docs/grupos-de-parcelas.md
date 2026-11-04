# Parcelas com valores distintos

Após as migrations anteriores, execute integralmente `supabase/migrations/20261104000700_installment_groups.sql` no Supabase e publique o código. É transacional e reaplicável, sem novas variáveis de ambiente. Não altera valores nem cronogramas de contratos existentes.

Na seção **04 · Forma de pagamento**, ao selecionar **Parcelado**, informe a quantidade e o valor das primeiras parcelas. Use **Adicionar parcelas** para incluir outro grupo, com quantidade e valor próprios. É possível remover grupos antes da revisão. O mesmo recurso está disponível no cadastro manual, na conferência após a leitura do PDF e na edição financeira permitida do contrato.

Exemplo: **6 × R$ 150,00 + 20 × R$ 250,00** gera **26 parcelas**, totalizando **R$ 5.900,00**. O sétimo vencimento ocorre no mês seguinte ao sexto, sem reiniciar a contagem. A data da primeira parcela ancora todo o cronograma, com ajuste ao último dia nos meses mais curtos.

O valor total do contrato continua sendo informado e conferido. Se a soma não corresponder, a revisão identifica a diferença e bloqueia a confirmação. A entrada permanece separada. O campo opcional da última parcela ajusta apenas o último item de todo o cronograma. Há limite de 120 parcelas regulares, além da entrada.

Para início condicionado, os grupos são preservados sem inventar datas ou criar parcelas antecipadamente. Quando o primeiro vencimento for conhecido, a edição recupera os grupos e gera o cronograma. Contratos apenas no êxito continuam sem parcelas.

`contracts.installment_groups` guarda os grupos ordenados em centavos (`count`, `amount_cents`). Uma lista vazia representa o formato uniforme anterior. `installment_count` armazena a quantidade total e `installment_amount` o valor inicial; o cronograma persistido mantém o valor contratual de cada parcela. Nenhum recebimento efetivo é presumido.

As novas RPCs `create_lawyer_contract_v8` e `edit_lawyer_contract_v6` reutilizam as regras existentes de comissão, contratantes, autoria, versão e escritório. O banco confere os grupos, as quantidades, valores, ordem, vencimentos e total. RLS permanece igual. Contratos com histórico de pagamentos ou cobranças por parcela continuam protegidos contra reconstrução financeira pela advogada; alterações permitidas preservam auditoria.

Testes focados em `tests/installment-groups.test.ts` cobrem grupos, entrada, centavos, calendário, início condicionado, recuperação na edição, adulteração de valores/datas, autoria, auditoria, isolamento e reaplicação da migration.
