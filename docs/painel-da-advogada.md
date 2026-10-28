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

Aplicar `supabase/migrations/20261028000100_lawyer_contract_goals.sql` no Supabase após as migrations anteriores. A tabela `lawyer_monthly_goals` guarda uma meta inteira positiva por advogada/mês. O progresso é calculado a partir da data dos contratos cadastrados naquele mês até hoje, inclusive contratos de êxito e início condicionado. O indicador não atesta produção ou assinatura fora do sistema: depende do cadastro correto.

A própria advogada define e edita a quantidade. A RPC `save_my_contract_goal` obtém usuário e escritório da sessão; não aceita identidades vindas do formulário. Não há escrita direta pela API. RLS permite consultar a própria meta e dá à gestão leitura das metas do mesmo escritório. A secretaria, contas inativas e usuários de outro escritório não as consultam. Metas de outros meses são preservadas; não existe meta automática, ranking ou pontuação.

Sem a migration, os indicadores continuam funcionando e o editor de metas aguarda a configuração do banco. Falhas de autorização ou outras falhas de consulta não são tratadas como valores financeiros zerados.

Verificações específicas: `node --import tsx --test tests/lawyer-overview.test.ts tests/contract-goals-db.test.ts`.
