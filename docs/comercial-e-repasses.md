# Comercial e agenda de repasses

## Ativação

Depois das migrations anteriores, execute **somente** `supabase/migrations/20261103000400_commercial_payouts.sql` inteiro no SQL Editor do Supabase. A migration é transacional e reaplicável. Não requer variável de ambiente ou novo job Cron. O fechamento automático já configurado passa a capturar as condições de repasse e a reserva comercial dos novos recebimentos.

Nenhum SQL foi aplicado automaticamente ao Supabase de produção. Publique o código pelo fluxo existente. As telas mantêm consultas legadas durante a transição, e a agenda aparece depois da atualização do banco.

Para a atualização de identificação do comercial, execute somente `supabase/migrations/20261103000600_commercial_recipient.sql` após as anteriores. Não preenche nomes fictícios, não recalcula valores antigos e não requer novas variáveis.

## Regra confirmada

Novos contratos de **Tráfego HP** usam 5% para a advogada e 5% para o comercial. Na retenção proporcional, cada recebimento efetivo gera os dois percentuais. Na integral, a soma dos dois limites é preenchida com os primeiros recebimentos, metade para cada parte, sem reservar o mesmo dinheiro duas vezes.

Exemplo: contrato de R$ 10.000,00 → R$ 500,00 para a advogada e R$ 500,00 para o comercial. Primeiro recebimento de R$ 500,00 → R$ 250,00 para cada um. Segundo de R$ 500,00 → mais R$ 250,00 para cada. Recebimentos seguintes ficam para a participação dos gestores, pois os limites foram quitados. Um recebimento maior que os dois limites reserva somente o necessário e deixa o restante para os gestores.

Valores efetivos usam `amount_paid`. A divisão integral usa arredondamento cumulativo, inclusive para centavos ímpares. A reserva comercial fica fora do saldo a receber da advogada. As condições de outras origens e os percentuais já salvos não foram alterados. Propriedade Intelectual continua usando o percentual do próprio contrato; não existe regra por nome ou e-mail da usuária no código.

Em contratos somente no êxito, a retenção integral continua exigindo o limite manual. No tráfego, o valor informado é o limite de cada beneficiário; não é inventado um valor total do contrato. O formulário explica isso antes da confirmação.

Ao selecionar **Cliente próprio**, o formulário sugere **5%**; em **Propriedade Intelectual**, **50%**. Ambos permitem personalização. Os valores já salvos são preservados ao abrir uma edição; a sugestão só muda quando a origem é selecionada. Tráfego continua com 5% + 5% e pede o **nome de quem receberá a comissão do comercial** (texto, sem exigir usuário ou criar um novo cargo).

O beneficiário fica nas condições financeiras protegidas do contrato e aparece na revisão final, nos detalhes do contrato e na agenda/relatório do gestor. A secretaria não recebe esse campo. O nome é capturado nos novos fechamentos; mudar o contrato não troca a identificação de snapshots ou pagamentos já registrados. Para fechamentos antigos sem nome capturado, a agenda usa o nome informado no contrato. O histórico do repasse copia a identificação na observação do pagamento.

Contratos antigos permanecem sem nome até identificação real. O gestor pode preencher em **Correções cadastrais → Revisar comercial e datas de repasse**, com motivo e auditoria. A advogada pode editar antes de haver pagamentos; depois, a revisão fica com o gestor. A identificação precisa estar preenchida antes de registrar novos repasses comerciais.

## Datas e revisão do contrato

Na seção **04 · Forma de pagamento**, após a primeira parcela, há **Repasses deste contrato**:

- Dia mensal do repasse: padrão 1 para clientes próprios/outras origens, 15 para Tráfego HP; editável entre 1 e 31.
- Primeiro repasse a partir de: limite inicial opcional, no formato DD/MM/AAAA.
- Resumo na revisão final com a reserva e as condições escolhidas.

São duas rodadas do escritório por origem, não uma divisão automática de cada repasse em 50%/50%. O gestor pode registrar o pagamento de um saldo em partes, conforme o que efetivamente acontecer. A comissão é retida primeiro, mas paga após o fechamento.

A previsão é no mês seguinte à competência em que o cliente pagou, não ao vencimento original da parcela. Se o cliente atrasar, o fechamento do recebimento real determina a competência. O dia 31 é limitado ao último dia do mês quando necessário, inclusive fevereiro bissexto. A data inicial é um limite mínimo; não antecipa o repasse para antes da competência encerrada. Pagamentos condicionados/êxito não criam comissões nem repasses sem recebimento.

## Conferir e registrar

Em **Fechamentos → Visualizar / corrigir valores**, a **Agenda de repasses** mostra, por contrato, beneficiário, previsão, valor consolidado, pago identificado e saldo. O gestor abre **Registrar / vincular repasse** e informa o valor e a data reais, sem data futura. Repasses comerciais exigem identificar o beneficiário na observação.

O pagamento à advogada continua atualizando `commission_transfers` e os totais do fechamento. Sua alocação identifica qual contrato foi quitado. O comercial tem um histórico próprio, com estorno auditado, e não reduz o saldo da advogada. Um estorno da transferência da advogada mantém suas alocações históricas e retira seu efeito dos valores pagos.

Repasses antigos sem contrato não são distribuídos arbitrariamente. A agenda exibe **aguardando vínculo**; o gestor seleciona o pagamento existente e o contrato e informa o motivo. Isso não cria novo pagamento. Antes de registrar nova saída para a advogada, o sistema exige identificar os repasses antigos daquele fechamento. Os totais históricos permanecem preservados.

## Contratos antigos e correções

Os contratos antigos recebem reserva comercial zero, preservando suas condições financeiras. Para aplicar 5% + 5% a um contrato de tráfego já movimentado: no gestor, selecione a advogada, abra o contrato em **Correções cadastrais** e use **Revisar comercial e datas de repasse**. A participação da advogada deve estar em 5%. Informe o motivo e confira os efeitos nos fechamentos. Não é necessário recadastrar o contrato.

A revisão recalcula as comissões atuais e lança os ajustes correspondentes. A composição original dos meses confirmados permanece imutável. Excesso já pago fica identificado para regularização. Os cálculos da Carteira e os cards do gestor também distinguem a reserva comercial.

As datas capturadas no fechamento permanecem estáveis ao mudar o padrão do contrato. Para corrigir a previsão de um mês específico, o gestor usa **Revisar data prevista** na agenda, com motivo e notificação. A previsão é compartilhada pelos beneficiários daquele contrato; as datas reais dos pagamentos não mudam.

Fechamentos legados recebem apenas uma referência de calendário em tabela separada (dia 1 ou 15), sem editar seus snapshots ou transformar pagamentos antigos em novos. Reaplicar a migration preserva as revisões dessas datas.

## Dados, relatórios e acesso

Novas estruturas: `commercial_commissions`, `commercial_closing_adjustments`, `commission_transfer_allocations`, `commercial_transfers` e `closing_payout_dates`. As condições ficam em `contract_financial_terms`; os novos snapshots registram a reserva comercial, dia e data inicial. A agenda é derivada da composição original mais ajustes, nunca de uma divisão arbitrária do saldo global. Inconsistência por ajuste antigo sem contrato identificado gera erro para conferência, não total parcial silencioso.

As tabelas têm RLS e nenhuma escrita direta para usuários da API. RPCs verificam cargo ativo, escritório, titularidade, competência e saldo, com locks financeiros. A advogada recebe só os itens dela; nem admin extra amplia o escopo. A secretaria não recebe percentuais, reservas ou repasses. Valores e pagamentos comerciais detalhados ficam restritos ao gestor, inclusive nos logs de pagamento comercial. Condições contratuais da própria carteira permanecem visíveis à advogada para revisão.

O relatório em tela e o PDF incluem a agenda e os repasses identificados. O gestor também recebe o histórico comercial. A consulta do PDF usa o mesmo snapshot SQL para composição, ajustes, agenda e pagamentos. Valores pagos sem identificação aparecem com ressalva, pois já fazem parte do total repassado e não devem ser pagos novamente.

Não existe transferência bancária automática: registrar um repasse significa anotar dinheiro efetivamente pago pelo escritório.

## Verificação

Testes focados cobrem retenção proporcional/integral, centavos, limites conjuntos, calendários, pagamentos parciais, alocação de repasses antigos, estornos, correções após fechamento, preservação do snapshot e isolamento entre cargos/escritórios. Prévia web e PDFs são revisados com dados fictícios, sem gravar pagamentos no Supabase de produção.
