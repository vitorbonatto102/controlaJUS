# Formas de retenção da comissão

## Configuração por contrato

No cadastro manual ou por PDF, em **Informações internas**, a advogada responde:

**Como será feito o pagamento das comissões deste contrato?**

- **Retenção proporcional em cada parcela:** comportamento anterior. Cada recebimento gera comissão sobre o valor efetivamente pago, incluindo juros e multa, pelo percentual gravado no contrato.
- **Retenção total no primeiro acerto:** os primeiros recebimentos são destinados integralmente à comissão, limitados à participação contratada. Se o primeiro recebimento não quitar a comissão, a retenção continua nos seguintes; quando o limite é alcançado, os demais recebimentos geram comissão zero. A parcela em que o limite é atingido retém somente o saldo necessário.

O percentual e a forma de retenção são escolhas independentes. O sistema não presume a forma pelo percentual ou pela origem. Contratos existentes permanecem proporcionais; a migration não altera comissões já registradas.

### Contrato com valor definido

O limite da retenção integral é **valor total do contrato × percentual da advogada**, arredondado para centavos.

Exemplo: contrato de R$ 10.000,00, participação de 5% e primeira parcela recebida de R$ 1.000,00. A comissão dessa parcela é R$ 500,00. A comissão dos recebimentos seguintes é zero.

Exemplo: contrato de R$ 10.000,00 e participação de 25%. Com recebimentos de R$ 1.000,00, as comissões são R$ 1.000,00, R$ 1.000,00, R$ 500,00 e então zero. O total retido nunca supera R$ 2.500,00.

### Apenas no êxito, sem valor definido

Quando for escolhida a retenção integral, informe **Limite total da minha comissão (R$)**. Esse limite monetário é a comissão máxima da advogada, separado do percentual cobrado do cliente no êxito. O cadastro continua sem fabricar parcelas, valores do contrato ou vencimentos. O limite fica preparado para os recebimentos quando o êxito e a cobrança forem definidos.

## Previsões e recebimentos

- A previsão contratual distribui a comissão pelas primeiras parcelas do cronograma, em ordem de vencimento. A Carteira passa a usar essa distribuição nos totais mensais, em vez de multiplicar todas as parcelas pelo percentual.
- A previsão do saldo restante desconta as comissões já geradas e considera somente valores contratuais ainda não pagos. Parcelas e comissões já quitadas não são projetadas novamente.
- A comissão efetiva fica persistida por pagamento no PostgreSQL. A retenção integral segue a data real do pagamento, depois `created_at` e UUID para desempate. Um lançamento retroativo pode redistribuir comissões de recebimentos posteriores.
- Estornar ou substituir um recebimento redistribui o limite entre os pagamentos ativos. O pagamento estornado e sua comissão original permanecem no histórico.
- O repasse do escritório para a advogada continua no fluxo de fechamento e registro de repasses pelo gestor. A nova opção não registra uma transferência automaticamente.

## Segurança e correções

Forma e limite ficam em `contract_financial_terms`, com as mesmas políticas RLS que protegem o percentual. A secretaria registra e corrige recebimentos operacionais; não recebe esses dados nem as comissões pela API.

Sem histórico financeiro, a advogada pode editar a forma e o limite ao revisar o contrato. Depois de haver pagamentos, as alterações financeiras continuam restritas ao gestor. O gestor também pode usar **Corrigir forma de comissão**, com motivo obrigatório, auditoria e notificação.

Se uma correção da secretaria afetar comissões de um mês já fechado, o banco recusa toda a operação e exige o gestor. Correções do gestor preservam `monthly_closing_items` e criam ajustes nos fechamentos afetados, inclusive quando a redistribuição altera outro mês. Recebimentos, correções e confirmação de fechamentos são serializados por advogada no banco.

## Aplicação no Supabase

Após as migrations anteriores, incluindo `20261022000600_secretary_notifications.sql`, execute no **SQL Editor** o arquivo:

`supabase/migrations/20261026000100_commission_retention.sql`

Ele é transacional e pode ser reaplicado. Não edite nem reaplique as migrations antigas. Não exige novas variáveis de ambiente, chaves ou buckets. As páginas existentes continuam legíveis antes da migration, com o comportamento proporcional legado; cadastrar ou editar pela nova versão exige a migration.
