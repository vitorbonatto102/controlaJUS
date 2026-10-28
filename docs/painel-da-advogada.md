# Painel de comando da advogada

A página `/advogada` abre no mês atual, pelo calendário de São Paulo, usando somente contratos, notificações, fechamentos e repasses da usuária autenticada. A Carteira continua disponível para filtros e consultas de outros meses.

## O que os valores representam

- **Minha comissão prevista no mês:** participação nas parcelas com vencimento no mês inteiro, conforme a forma de retenção do contrato. Depende do pagamento dos clientes.
- **Minha comissão gerada no mês:** comissões persistidas de pagamentos ativos, pela data real do recebimento até hoje. Pode aguardar fechamento e repasse.
- **Minha participação em atraso:** estimativa sobre saldos contratuais vencidos, considerando os pagamentos parciais e o limite da retenção integral. Não representa comissão efetiva nem repasse confirmado.
- **A receber em fechamentos confirmados:** saldo pendente dos fechamentos já confirmados, de todos os períodos; a apuração em rascunho não entra nesse total.
- **Repassado para mim neste mês:** repasses ativos pela data do pagamento, até hoje.

O gráfico compara previsão contratual e comissão gerada nos últimos três ou seis meses. A distribuição por origem usa a comissão efetivamente gerada no mês, sem inventar despesas, impostos ou participações de terceiros. Comparações com o mês anterior consideram os mesmos dias decorridos, com ajuste para meses mais curtos. Não há percentual de crescimento quando a base anterior é zero.

## Prioridades e próximos recebimentos

As prioridades são derivadas dos registros: vencimentos de hoje, atrasos, repasses confirmados pendentes, avisos não lidos e contratos aguardando evento. Não são tarefas manuais e não podem ser marcadas como resolvidas para esconder uma pendência financeira. A lista de recebimentos mostra no máximo uma próxima parcela por contrato e distingue o saldo do cliente da participação estimada da advogada.

## Meta de contratos

O cartão compacto mostra a quantidade de contratações efetivamente confirmadas/assinadas neste mês, o objetivo, o progresso e o link **Ver minhas metas** para `/metas`. O financeiro e os vencimentos permanecem no painel.

Aplicar, em ordem, `20261028000100_lawyer_contract_goals.sql` e `20261028000200_confirmed_contract_goals.sql`, após as migrations anteriores. O progresso usa `engagement_status='confirmed'` e a data efetiva `closed_on`, nunca `created_at` ou a data do documento. Contratos antigos/importados aguardam confirmação explícita. Cancelamentos, confirmações desfeitas e exclusões atualizam a contagem.

A meta individual pertence à advogada responsável principal (`contracts.lawyer_id`). A própria advogada define e edita a quantidade. As RPCs obtêm usuário e escritório da sessão; não aceitam identidades vindas do formulário. Não há escrita direta pela API. Veja os escopos, permissões, histórico e ativação em [Metas](metas.md).

Sem a atualização do banco, a página de Metas informa que aguarda configuração. Falhas de autorização ou de consulta não são convertidas em métricas zeradas.
