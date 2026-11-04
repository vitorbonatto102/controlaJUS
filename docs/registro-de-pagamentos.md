# Registro de pagamentos sem juros

Desde 04/11/2026, novos lançamentos devem informar somente o valor pago referente à parcela, excluindo os juros pagos pelo cliente. O formulário mantém o valor contratual e o vencimento pré-preenchidos; pagamentos parciais continuam registrando apenas o principal efetivamente pago.

Os campos da secretaria, das correções do gestor e dos ajustes após fechamento usam a orientação **Valor pago da parcela, sem juros**. Carteira e visão geral identificam a nova regra. A base das comissões permanece sendo o valor registrado em `payments.amount_paid`, conforme a forma de retenção e os percentuais do próprio contrato. Não é substituída automaticamente pelo valor contratual.

O sistema não pode deduzir qual parte de um valor digitado corresponde a juros sem essa informação. Por isso, não subtrai valores presumidos nem limita silenciosamente o pagamento ao valor previsto da parcela. A secretaria deve informar o principal recebido.

Valores históricos permanecem como registrados até uma correção explícita e auditada. Não há revisão em lote de juros antigos nem alteração de multas por presunção.

Para um mês já fechado, a advogada responsável ou o gestor usa **Fechamentos → Visualizar / corrigir valores → Corrigir valores**. A substituição preserva o pagamento original como estornado, cria o registro corrigido, recalcula as comissões e lança os ajustes do fechamento com motivo, auditoria e notificação. O snapshot original permanece imutável.

O relatório é gerado com os valores consolidados atuais, incluindo os ajustes. A composição original pode continuar mostrando o valor anterior, identificado como histórico. Para obter o documento atualizado, emita um novo PDF; arquivos já baixados não são sobrescritos.

Esta atualização de interface não exige migration nem novas permissões. Correções financeiras reais continuam exigindo uma sessão autenticada autorizada ou uma operação administrativa auditada, executada pelo responsável e com sua identificação real.
