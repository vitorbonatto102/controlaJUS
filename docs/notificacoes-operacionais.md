# Notificações operacionais

## Ativação

Após as migrations anteriores, inclusive `20261022000500_contract_service.sql`, executar somente `supabase/migrations/20261022000600_secretary_notifications.sql` no SQL Editor do Supabase. O arquivo é reaplicável. A versão publicada na Vercel não executa SQL automaticamente.

## Avisos gerados

A central da advogada passa a receber:

- Pagamento registrado pela secretaria: autora, cliente de referência, serviço, parcela, valor recebido e data.
- Pagamento alterado: um único aviso com autora, valores/datas anteriores e novos e motivo.
- Pagamento excluído: autora, valor, data e motivo, preservando o histórico do recebimento.
- Cobrança, retorno do cliente, renegociação ou anotação registrados pela secretaria e vinculados a um contrato: autora e resumo do conteúdo.

Os avisos existentes de correções do gestor continuam funcionando. Os novos eventos oferecem links para o pagamento ou anotação dentro dos detalhes do contrato, onde a advogada também pode consultar o histórico de cobrança. Datas e horas são exibidas no fuso de São Paulo.

Os avisos são gerados para eventos posteriores à ativação. Notas gerais de cliente sem contrato permanecem no fluxo operacional, respeitando sua restrição de acesso. A central é consultada ao abrir/atualizar a página; esta alteração não adiciona atualização em tempo real.

## Transação e segurança

Os recebimentos são notificados a partir da auditoria protegida do banco. O trigger é adiado até o fim da transação para reconhecer o vínculo do pagamento substituto: uma edição não é apresentada como exclusão seguida de novo recebimento. A unicidade por destinatária, tipo e registro impede duplicação. Operações revertidas não deixam avisos. Os triggers não alteram os cálculos, as comissões ou as rotinas de correção.

O aviso é direcionado à advogada responsável, no escritório do contrato. A RLS permite à destinatária consultar os próprios avisos, e ao gestor consultar os do escritório. A secretaria não recebe acesso a notificações financeiras internas do gestor. A criação direta de notificações pela API continua bloqueada; marcar como lida continua restrito à própria destinatária.

Os links são resolvidos com a sessão autenticada e RLS. Se um registro deixar de estar acessível, a notificação preserva sua mensagem sem oferecer um link para ele.
