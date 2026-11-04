# Retenção, terceiros e repasses

## Ativação desta atualização

Depois das migrations já aplicadas, execute no SQL Editor do Supabase, nesta ordem e cada arquivo inteiro:

1. `supabase/migrations/20261104000200_explicit_retention_allocation.sql`
2. `supabase/migrations/20261104000300_closing_origin_reports.sql`

São transacionais e reaplicáveis. Não requerem novas variáveis, bucket ou job Cron. Não foram aplicadas automaticamente em produção. Não reaplique os arquivos antigos. Publique o código pelo fluxo existente depois de atualizar o banco.

## Cadastro

O percentual da advogada continua editável. Cliente próprio sugere 5%, Propriedade Intelectual sugere 50% e Tráfego HP sugere 5% para a advogada e 5% para o comercial. Não há regra por nome ou e-mail.

A pergunta sobre retenção é obrigatória e começa sem resposta, em qualquer origem:

- **Proporcionalmente em todas as parcelas:** cada recebimento gera a participação percentual escolhida. Em Tráfego HP, o percentual comercial também é editável e exige nome quando positivo.
- **Nas primeiras parcelas, até quitar a participação:** o limite da advogada é o total do contrato × seu percentual. Em contratos apenas no êxito, sem valor definido, ela informa seu limite monetário manualmente.

Na segunda opção, é obrigatório escolher se os primeiros recebimentos serão destinados somente à participação da advogada ou divididos com **um único terceiro/comercial**. Para dividir, informe nome e **valor TOTAL em reais a quitar ao terceiro**, não valor por parcela. Essa opção também existe fora do tráfego.

O tráfego oferece uma sugestão de total do comercial calculada pelo percentual, mas o total informado e confirmado no formulário é o limite efetivo. A soma das duas participações não pode superar o valor conhecido do contrato. O nome e o limite aparecem na revisão final e nos detalhes protegidos do contrato.

Exemplo: contrato de R$ 10.000,00, advogada com 5% (R$ 500,00) e comercial com total de R$ 500,00. Um recebimento de R$ 500,00 destina R$ 250,00 a cada pessoa. O seguinte de R$ 500,00 quita os dois limites. Recebimentos posteriores não geram essas participações novamente. Um recebimento maior reserva apenas o saldo necessário; o restante fica para o escritório.

Com limites diferentes, a divisão segue a proporção desses totais, com arredondamento cumulativo em centavos. Isso vale para comissões persistidas e previsões da Carteira. Não há duplicação do mesmo dinheiro.

## Fechamento e relatórios

Atualização do controle pessoal: após as migrations anteriores, execute somente `supabase/migrations/20261104000500_personal_participation_reports.sql` inteiro. Não modifica contratos, parcelas, pagamentos ou fechamentos. Publique também o código atualizado; não requer mudança no Cron ou nas variáveis de ambiente.

Na retenção inicial, a Carteira, os próximos recebimentos e os alertas da advogada consideram somente parcelas com participação restante ou histórico de recebimentos que geraram participação. O cronograma completo continua com a secretaria e o gestor. Após quitar os limites, permanecem as parcelas históricas; as seguintes, exclusivas do escritório, saem do controle pessoal. O saldo de repasses já gerados continua nos fechamentos até ser pago. Estornos e correções podem fazer a participação voltar à previsão.

Exemplo: total de R$ 6.000,00, 24 parcelas de R$ 250,00, advogada com limite de R$ 300,00 e terceiro com R$ 300,00. As duas primeiras destinam R$ 125,00 para cada pessoa; a terceira destina R$ 50,00 para cada uma e R$ 150,00 ao escritório. As demais 21 parcelas continuam no cronograma operacional, sem gerar nova participação. A distribuição segue a ordem real dos recebimentos, portanto adiantamentos ou pagamentos fora da ordem podem mudar quais parcelas geram a retenção.

A central de relatórios agora identifica o terceiro pelo nome e demonstra valores da advogada, do terceiro e do escritório. Parcelas mostram previsão contratual; recebimentos mostram valores efetivamente registrados. Contratos mostram os limites totais ou percentuais, conforme a forma de retenção. A secretaria continua recebendo somente o relatório operacional, sem participações ou beneficiários.

O fechamento automático continua único por advogada e mês, reunindo os recebimentos daquele mês. O cadastro não pergunta dia nem data inicial de repasse e não presume dia 1 ou 15 pela origem.

No fechamento confirmado, advogada e gestor podem selecionar várias origens em **Emitir relatório por origem**. Por exemplo, Cliente próprio + Propriedade Intelectual em um relatório e Tráfego HP em outro. Tela e PDF usam a mesma seleção e mostram recebimentos, participação da advogada, valor destinado ao terceiro e nome de cada beneficiário.

Esses são recortes do mesmo fechamento, sem abrir outra competência. Valores retidos não comprovam repasse pago. Os pagamentos efetivos ficam no fechamento completo. O gestor pode registrá-los em partes, com valor e data reais; não existe transferência bancária automática.

O relatório completo mantém composição original, ajustes auditados e histórico de repasses. Os recortes mostram a composição efetiva, somando ajustes vinculados a cada pagamento. A origem capturada no fechamento é preservada em substituições posteriores, mesmo que a origem cadastral do contrato seja alterada. Ajustes antigos sem referência confiável exigem conferência, em vez de distribuição arbitrária de valores.

No relatório pessoal do fechamento, recebimentos exclusivos do escritório após a retenção ficam fora da composição exibida. Os totais originais do mês e o saldo de repasses permanecem preservados e identificados. O gestor mantém a composição integral e os ajustes. O nome do terceiro aparece também junto do valor em cada linha, além do resumo por beneficiário.

## Correções, legado e acesso

Contratos antigos não são recalculados ou convertidos automaticamente. Condições, snapshots, datas antigas e datas revisadas permanecem armazenados como histórico, sem campos de calendário na nova tela. Antes de haver pagamentos, a advogada pode editar o contrato. Depois, o gestor pode revisar a destinação em **Correções cadastrais → Revisar destinação ao terceiro/comercial**, com motivo, auditoria e notificação. A revisão recalcula comissões e cria ajustes nos meses afetados sem alterar os snapshots confirmados.

O limite explícito fica em `contract_financial_terms.third_party_upfront_limit`, com a escolha em `upfront_distribution`. O ledger técnico `commercial_commissions` atende o único terceiro/comercial, inclusive quando a origem não é tráfego. As tabelas financeiras continuam sem escrita direta pela API e protegidas por RLS.

A RPC `closed_month_origin_report` valida autenticação, cargo ativo, escritório e titularidade antes de ler dados protegidos. Advogadas recebem apenas seus fechamentos e as destinações contratuais correspondentes. A secretaria não recebe percentuais, comissões, beneficiários ou fechamentos. A permissão administrativa extra não amplia o escopo financeiro. Recortes não carregam registros das origens excluídas, nem o demonstrativo completo oculto no payload.

As verificações focadas cobrem limites iguais/diferentes, centavos, terceiros de outras origens, edição e estornos, correções após fechamento por gestor/advogada, autoria, RLS e isolamento entre escritórios. As prévias locais usam dados fictícios.
