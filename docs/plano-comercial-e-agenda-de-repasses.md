# Proposta: participação comercial e agenda de repasses

Status: decisões confirmadas e implementação em `20261103000400_commercial_payouts.sql`. Consulte [o funcionamento e a ativação](comercial-e-repasses.md). O restante deste documento registra o desenho discutido; a implementação usa duas rodadas por origem, com uma data mensal por contrato e pagamentos parciais registrados no histórico.

## Regras informadas para o escritório HP

| Origem | Advogada | Comercial | Gestores |
| --- | --- | --- | --- |
| Cliente próprio | 5% | 0% | 95% |
| Propriedade Intelectual | 50%, condição específica da usuária indicada | 0% | 50% |
| Tráfego HP | 5% | 5% | 90% |

O escopo imediato é acrescentar a reserva comercial no tráfego e configurar a agenda de repasses. As demais origens e percentuais já contratados não serão recalculados automaticamente. Condições de Propriedade Intelectual devem referenciar o UUID da advogada e o escritório, nunca um nome/e-mail fixo no código. A regra de uma advogada não pode virar automaticamente a condição de todas as futuras advogadas.

Os percentuais devem ser gravados no contrato como condições próprias, com regras sugeridas configuráveis por escritório. Alterar um padrão não reescreve contratos antigos. Percentuais e datas serão exibidos para revisão antes de salvar.

## O que existe hoje

- `contract_financial_terms` e `commissions` guardam a participação da advogada e a retenção proporcional/integral.
- A retenção integral consome os primeiros recebimentos até quitar o limite da advogada. Acrescentar apenas um cálculo comercial isolado permitiria reservar o mesmo dinheiro duas vezes.
- O fechamento é mensal por advogada, com snapshot original e ajustes posteriores. Não existe uma programação por origem/contrato para pagar o saldo.
- `commission_transfers` registra pagamentos efetivamente feitos à advogada no fechamento. Não comporta o comercial como beneficiário.
- `transferDeadline` atualmente apresenta um prazo genérico de 30 dias a partir do fechamento. Esse prazo precisa ser substituído pela programação acordada.

## Distribuição dos recebimentos

Separar a geração de direito à comissão da data em que o escritório paga essa comissão. A primeira depende do dinheiro efetivamente recebido e da forma de retenção; a segunda, da agenda acordada.

Na retenção proporcional, a proposta é que cada recebimento válido de tráfego gere 5% da advogada e 5% do comercial, com o restante identificado como participação dos gestores. Valores contratuais continuam sendo somente previsão; o realizado usa `amount_paid`, inclusive multa/juros conforme a regra já existente.

Na retenção integral, falta confirmar a regra conjunta de consumo dos primeiros recebimentos. Se confirmada a divisão igual até os dois limites, um contrato de R$ 10.000,00 terá limite de R$ 500,00 para a advogada e R$ 500,00 para o comercial. Dois recebimentos iniciais de R$ 500,00 reservarão, cada um, R$ 250,00 para cada beneficiário. Se o primeiro recebimento for R$ 2.000,00, reservará somente R$ 500,00 para cada um; o excedente não aumenta os limites. O sistema deve impedir que a soma reservada supere o recebimento.

O cálculo deve ser único no banco, com valores em centavos, ordem determinística por pagamento, tratamento do centavo residual e recálculo auditado de estornos/correções. A projeção do frontend deve reproduzir a regra para que não prometa 100% da primeira parcela à advogada quando ela divide essa retenção com o comercial.

Para contratos de êxito sem valor conhecido, a retenção integral precisa de limites explícitos por beneficiário ou de uma apuração posterior. Não inferir o limite comercial a partir de um valor inexistente.

## Cadastro e revisão — seção 04

Logo após a data da primeira parcela, inserir um bloco **Repasses deste contrato**, visível a quem pode consultar condições financeiras:

- **Previsão do primeiro repasse**: data inicial sugerida a partir do acordo, editável em DD/MM/AAAA. Não será tratada como dinheiro já recebido nem como repasse realizado.
- **Quando o escritório fará o repasse?**: opções compatíveis com a resposta sobre repasse mensal ou antes do fechamento.
- **Em quantas vezes?**: uma ou duas vezes, com duas linhas mostrando percentual e data prevista quando aplicável. A divisão precisa somar 100%.
- **Prazo adicional para Tráfego HP**: proposta de 15 dias sobre cada vencimento de referência, com possibilidade de revisar no contrato. Confirmar se esse é o marco desejado.
- **Resumo da divisão**: advogada, comercial e gestores; forma de retenção; valores previstos e datas. Separar claramente comissão da advogada e reserva comercial.
- **Observação do acordo**: contexto opcional no cadastro; motivo obrigatório para corrigir condições já vigentes.

Para pagamentos condicionados ou êxito sem data, manter **Repasse a programar**. Não inventar a data a partir do primeiro vencimento ausente. Pagamentos do cliente em atraso também não podem gerar uma obrigação realizada antes de haver recebimento; as datas finais precisam considerar a competência em que o valor foi efetivamente recebido.

Na tela de revisão final, mostrar as duas agendas separadamente: parcelas do cliente e repasses do escritório. O usuário pode conferir percentuais e datas antes de confirmar o contrato.

## Fechamento e registro dos repasses

Preservar a consolidação mensal de recebimentos. Dentro dela, mostrar grupos com a agenda aplicável: clientes normais e Tráfego HP. Cada grupo terá valores previstos para a primeira/segunda vez, vencimentos, já pago e saldo.

O fechamento de outubro, por exemplo, não pode transformar tudo em um único saldo com vencimento genérico se os contratos normais e de tráfego têm acordos diferentes. O relatório da advogada mostrará sua participação e as datas dela. O gestor verá também a reserva comercial e o que precisa pagar em cada data.

Cada pagamento efetivamente feito pelo escritório precisa ser associado às obrigações que quita. Um repasse parcial pode liquidar parte da primeira obrigação; não deve ser distribuído arbitrariamente entre origens. Manter pagamento efetivo, estorno e alocações com histórico. Uma previsão vencida não equivale a repasse realizado.

Se for necessário pagar antes do fechamento, será preciso permitir quitação de obrigações ligadas a comissões efetivas ainda não consolidadas e conciliá-las no fechamento posterior, sem contar o pagamento novamente. O fluxo atual aceita repasses somente após um fechamento confirmado; esse ponto depende de resposta.

## Estrutura técnica sugerida

Os nomes abaixo são proposta de modelagem, não tabelas já criadas:

1. Condições financeiras por contrato: percentual comercial, versão do acordo, limites por beneficiário e regra de retenção conjunta. Usar campos separados para não misturar o valor comercial na comissão da advogada.
2. Razão comercial por pagamento: valores gerados/estornados vinculados ao contrato, pagamento e escritório. Beneficiário comercial pode ser uma reserva do escritório até existir cadastro confiável do recebedor, sem criar um usuário fictício.
3. Política de repasse por contrato: início, modalidade, divisão e regras de vencimento, com snapshot da política usada na apuração.
4. Obrigações de repasse: beneficiário, origem financeira, competência, sequência, vencimento, valor consolidado e revisões. As obrigações devem possuir uma chave única de origem/competência/beneficiário/vez para impedir duplicação em reexecuções.
5. Alocações entre pagamentos efetivos do escritório e obrigações: validação de saldo, travas transacionais, estornos e conciliação com `commission_transfers`. O comercial terá seu próprio histórico de pagamentos.

A advogada acessa somente os contratos e repasses dela. O gestor administra dados do próprio escritório. A secretaria continua sem receber percentuais, comissões e repasses internos, inclusive por API. Valores comerciais não serão somados ao saldo a receber da advogada. Todas as novas tabelas precisam de RLS e escrita por RPC validada.

Correções após fechamento mantêm o snapshot original, atualizam ajustes/obrigações e notificam a outra parte com antes/depois e motivo. Um repasse já realizado não pode ser apagado ou remarcado como se nunca tivesse ocorrido.

## Transição dos contratos existentes

Não aplicar automaticamente as novas regras aos contratos de tráfego antigos. O responsável precisa revisar a condição e a data de vigência, com prévia do impacto em recebimentos/comissões já gerados. Fechamentos confirmados e repasses existentes permanecem conciliáveis. Mudanças que alterem valores já consolidados entram como correções auditadas.

## Decisões confirmadas

1. Tráfego: 5% para a advogada e 5% para o comercial. Na retenção integral, os primeiros recebimentos são divididos igualmente até quitar os dois limites.
2. Clientes próprios e outras origens no início do mês (dia 1 como padrão editável). Somente Tráfego HP no dia 15, como dia fixo do calendário. São duas rodadas entre os grupos; não se presume parcelamento automático 50/50 de cada repasse.
3. Retenção integral não é pagamento antecipado pelo escritório. O repasse continua após o fechamento mensal.

Os campos da seção 04 foram ajustados para dia mensal e primeira data a partir da qual os repasses podem ocorrer. O gestor registra pagamentos parciais quando o mesmo repasse for pago em mais de uma vez. Previsões e pagamentos efetivos continuam separados.
