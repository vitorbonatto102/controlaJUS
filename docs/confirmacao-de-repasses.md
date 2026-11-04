# Recebimento confirmado pela advogada

O fechamento automático continua reunindo tudo o que entrou no mês. O gestor não precisa registrar nem aprovar o recebimento de cada advogada. A própria beneficiária confirma o dinheiro que efetivamente recebeu.

## Ativar

Depois das migrations anteriores, inclusive `20261104000500_personal_participation_reports.sql`, execute integralmente `supabase/migrations/20261104000600_lawyer_payout_receipts.sql` no SQL Editor. A migration é transacional e reaplicável. Publique o código na Vercel. Não há novas variáveis de ambiente, buckets ou alteração do Cron. Ela não registra pagamentos nem converte repasses antigos automaticamente.

## Fluxo

1. A advogada abre **Fechamentos**, escolhe um mês confirmado e seleciona as origens desejadas. Nenhuma origem marcada inclui todas.
2. Clica em **Emitir relatório para repasse**. O sistema salva a composição e o saldo daquele momento. O PDF pode ser baixado e encaminhado manualmente ao gestor.
3. Após o dinheiro entrar na conta, abre esse documento em **Meus relatórios para repasse** e usa **Confirmar meu recebimento**, informando valor e data reais. Pode confirmar apenas uma parte e registrar o restante depois.
4. O saldo do fechamento e da carteira é atualizado. O gestor recebe uma notificação com acesso ao relatório e acompanha os registros, sem segunda aprovação.

O escritório paga cada beneficiário separadamente. A advogada confirma **somente a própria participação**. Nome e valores do comercial/terceiro aparecem no documento como destinação informativa; a confirmação não cria um pagamento para esse beneficiário. Não há transferência bancária ou envio automático do relatório.

Os pagamentos parciais são vinculados aos contratos do relatório proporcionalmente ao saldo disponível de cada um, com conciliação exata de centavos. Não são automaticamente atribuídos ao primeiro contrato da lista. Datas seguem o calendário de Brasília, após a competência fechada e sem data futura.

## Histórico, correção e relatórios sobrepostos

O PDF emitido é imutável: baixar novamente o mesmo documento preserva sua posição original. A tela apresenta separadamente o saldo atual e as confirmações posteriores. Dois relatórios com origens sobrepostas não duplicam a dívida: cada confirmação consulta os saldos reais por contrato e do fechamento, dentro da mesma transação. Reenviar uma confirmação com o mesmo identificador não lança o dinheiro duas vezes.

Se o fechamento sofrer uma correção relevante após a emissão, o relatório antigo permanece consultável e bloqueia novas confirmações até que seja emitido um documento atualizado. O saldo já recebido continua contabilizado. Contratos com mais de uma origem histórica na mesma competência exigem conferência antes da emissão, sem um rateio arbitrário.

Uma confirmação incorreta pode ser desfeita pela própria autora em **Corrigir confirmação**, com motivo. O registro original, a autoria e a correção permanecem no histórico; o gestor é avisado. Depois, a advogada registra os dados corretos. Correções financeiras continuam disponíveis ao gestor nas ferramentas existentes e não reescrevem o relatório emitido.

Repasses antigos são preservados. Quando houver pagamentos legados sem vínculo aos contratos, novas emissões/confirmações ficam bloqueadas para evitar duplicidade. O gestor encontra **Conferir vínculos de repasses anteriores** no fechamento somente quando essa pendência existe. Essa ferramenta vincula dinheiro já registrado, sem exigir que o gestor lance os novos recebimentos de cada advogada.

## Segurança e implementação

`payout_reports` armazena o documento e os saldos na emissão. Somente leitura é concedida à API, com RLS: advogada vê os próprios documentos; gestor vê os do seu escritório; secretaria, outros escritórios e usuários inativos não acessam. A permissão administrativa extra não amplia o escopo financeiro.

As RPCs `issue_payout_report`, `get_payout_report`, `confirm_payout_receipt` e `reverse_own_payout_receipt` validam usuário ativo, cargo, escritório e titularidade no banco. Escritas usam locks financeiros, validações de saldo e chave idempotente. As confirmações reutilizam `commission_transfers` e suas alocações, sem um segundo ledger de comissão. Auditoria e notificações são gravadas na mesma transação. As funções privadas não têm EXECUTE público.

As rotas de PDF autenticam novamente, respeitam o mesmo escopo e usam `private, no-store`. O documento é gerado com a identidade e as fontes locais da Repassum. A prévia local de revisão usa dados fictícios identificados; nenhum teste lança dinheiro em produção.

Validação focada em `tests/payout-receipts-db.test.ts`: isolamento, perfil inativo, secretaria/admin, outro escritório, emissão imutável, recortes, recebimento parcial, centavos, duplicidade, correção, notificações, relatório desatualizado e reaplicação da migration.
