# Gestão dos próprios contratos

## Ativação

No SQL Editor do Supabase, executar apenas a nova migration `supabase/migrations/20261022000300_lawyer_contract_management.sql`, após as migrations anteriores já aplicadas. Pode ser reaplicada. Ela adiciona a exclusão lógica, duas RPCs e os controles de integridade; não remove dados existentes.

## Interface

- **Contratos** no menu da advogada: lista completa, inclusive êxito e início condicionado, com busca por cliente e filtros de origem e forma de pagamento.
- **Visualizar**: dados, parcelas, pagamentos individuais e PDF privado.
- **Editar**: formulário preenchido, revisão de cronograma, motivo obrigatório e substituição opcional do PDF.
- **Excluir**: motivo e confirmação; remove o contrato das listagens/previsões, preservando cliente, documento e auditoria.

## Regras no banco

As RPCs usam o usuário autenticado, a função ativa e o escritório, e só operam sobre contratos da própria advogada. Continuam proibidos UPDATE/DELETE diretos. Cada alteração registra autor, data, campo, antes/depois, motivo e contrato afetado.

Sem pagamentos ou cobranças por parcela, podem ser modificados valores, percentuais, forma de pagamento e cronograma. O cliente vinculado é preservado, pois seu cadastro pode ser compartilhado por outros contratos do escritório.

Com pagamentos (inclusive estornados) ou cobranças vinculadas às parcelas, a edição da advogada limita-se à origem, data e documento. Correções financeiras permanecem com o gestor. Contratos com qualquer histórico de pagamentos não podem ser excluídos pela advogada, preservando comissões, fechamentos e repasses.

A exclusão é lógica e aplicada via política RLS restritiva. Parcelas e consultas operacionais herdam a indisponibilidade do contrato. Triggers impedem novos pagamentos/parcelas no contrato excluído. Locks no contrato serializam a edição com os lançamentos financeiros. A versão enviada pelo formulário impede sobrescrever alterações concorrentes, inclusive correções nas parcelas ou no percentual.

PDFs são enviados diretamente ao Storage privado com o cliente autenticado e limite de 10 MB, sem chave administrativa e sem transitar pelo corpo da Server Action. O banco verifica caminho, escritório e proprietário do upload. Falhas de gravação limpam o novo upload; o documento anterior é preservado.

## Confirmação comercial e metas

Após aplicar `20261028000200_confirmed_contract_goals.sql`, a lista permite filtrar a situação da contratação. No detalhe, **Confirmação da contratação → Atualizar situação da contratação** permite confirmar/assinar com a data efetiva, cancelar ou voltar a aguardar confirmação. A advogada atua somente nos próprios contratos; o gestor atua nos contratos do mesmo escritório, pela seção de correções cadastrais.

A confirmação exige declaração explícita, data real sem futuro, anotação e versão atual do contrato. Nenhuma data é inferida do PDF, do cadastro ou do documento. O histórico é auditado e correções do gestor notificam a advogada. Cancelar a contratação retira sua contagem das metas, preservando os lançamentos financeiros existentes; correções financeiras continuam nos respectivos fluxos. Veja [Metas](metas.md).
