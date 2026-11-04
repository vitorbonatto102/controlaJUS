# Relatórios da Repassum

Além dos demonstrativos abaixo, a advogada pode emitir um **Relatório para repasse** a partir de um mês fechado. Esse documento preserva o saldo na emissão e permite confirmar recebimentos posteriores, sem alterar o PDF. Veja [configuração e uso](confirmacao-de-repasses.md). O gestor acompanha as confirmações; a participação do comercial continua separada.

## Ativação e uso

1. Após as migrations anteriores, execute **somente** `supabase/migrations/20261103000100_reports.sql` inteiro no SQL Editor do Supabase. A migration é transacional, reaplicável e somente adiciona funções de consulta. Não modifica pagamentos, comissões ou fechamentos. Não foi aplicada automaticamente em produção.
2. Publique o código pelo fluxo existente da Vercel. Não há variáveis de ambiente novas.
3. Em qualquer painel, abra **Relatórios** no menu lateral. Escolha tipo, datas, cliente/CPF, serviço e origem; a secretaria e a gestão também podem selecionar uma advogada, inclusive com histórico de conta inativa.
4. Use **Visualizar relatório** para aplicar os filtros. A prévia mostra 40 registros por página; **Baixar PDF** inclui todos os registros do filtro, até o limite declarado de 5.000. Acima dele, a emissão solicita filtros mais específicos e não entrega um documento parcial.
5. Após o fechamento automático (desde outubro/2026), ambos têm **Visualizar / corrigir valores** e a opção de baixar PDF. Meses em apuração não emitem o demonstrativo. Ative a rotina conforme [fechamento automático](fechamento-automatico.md).

Para habilitar a seleção de várias origens em uma instalação existente, execute somente `supabase/migrations/20261103000500_report_multiple_origins.sql`, após as migrations anteriores. É uma função de leitura reaplicável, sem alteração de registros ou permissões das tabelas. Não há novas variáveis de ambiente.

No filtro **Origem**, abra a seta e marque uma ou mais opções. Use **Selecionar todas** ou **Limpar seleção** conforme necessário; nenhuma opção marcada inclui todas as origens. Clique em **Visualizar relatório** para aplicar. A seleção permanece na paginação e no PDF, que identifica as origens escolhidas.

## O que cada relatório mostra

Para os relatórios financeiros de participação, aplique a migration `20261104000500_personal_participation_reports.sql` após as anteriores. A nova `financial_activity_report` valida cargo ativo, escritório e titularidade antes de reunir as condições protegidas e a reserva real do terceiro. A secretaria é recusada nessa função e continua usando as consultas operacionais com RLS, sem comissões ou nomes de beneficiários. A nova `closed_month_participation_report` reutiliza a validação e a reconciliação do fechamento confirmado.

Advogada e gestor recebem o nome do terceiro/comercial e sua destinação, além da participação da advogada e do escritório. Valores do cronograma são previsões; valores de recebimentos usam os ledgers persistidos. Uma participação ausente aparece como **A apurar**, sem estimativa apresentada como dinheiro efetivo. Na retenção inicial, a visão pessoal da advogada retém apenas parcelas com participação pendente ou recebimentos relevantes no histórico; o gestor conserva o cronograma e todos os recebimentos do escritório.

| Relatório | Base do período | Valores |
| --- | --- | --- |
| Recebimentos | Data efetiva do pagamento | Recebido válido e, para advogada/gestor, comissão efetivamente registrada |
| Parcelas e saldos | Vencimento da parcela | Valor contratual, recebido até a emissão, saldo e situação |
| Contratos | Data do documento | Contratantes, serviço, origem, forma de pagamento e valor conhecido |
| Fechamento mensal | Competência confirmada | Composição original, ajustes posteriores, repasses e saldo consolidado |

Datas usam DD/MM/AAAA e o calendário de America/Sao_Paulo. Pagamentos estornados ou com data futura não entram nos recebimentos. No relatório de parcelas, pagamentos fora do período de vencimento podem atualizar o saldo; a data de posição está explícita. “Em atraso” inclui parcelas com saldo positivo e vencimento anterior a hoje, mesmo quando houve pagamento parcial.

O nome e o CPF pesquisam qualquer contratante do contrato sem multiplicar valores por pessoa. Nomes e serviços são buscas literais parciais; CPF é exato, com 11 dígitos. Os valores a apurar em contratos de êxito não são inventados. A data do documento não prova assinatura/fechamento comercial.

A comissão dos recebimentos vem da tabela `commissions`, com o valor efetivo já calculado pelo sistema e a forma de retenção do contrato. Desde 04/11/2026, novos lançamentos devem excluir os juros pagos pelo cliente. Não há subtração automática de valores presumidos nem alteração retroativa dos demais pagamentos. Um pagamento sem comissão registrada aparece como **A apurar** e fica fora do total de comissões, com uma nota explicativa.

## Fechamento completo e histórico

O demonstrativo mensal usa `monthly_closing_items` como composição original, não uma reconstrução a partir dos pagamentos atuais. Correções ficam em seção separada, conforme `closing_adjustments`. O resumo soma os totais originais aos ajustes. Repasses estornados ficam visíveis no histórico e fora do total repassado. A posição dos repasses é a da emissão, não uma promessa de que já estavam pagos na data do fechamento.

O fechamento é integral, por advogada/competência. Após `20261104000300_closing_origin_reports.sql`, a página do mês confirmado permite selecionar múltiplas origens para consultar e baixar um recorte desse mesmo fechamento, tanto para a advogada quanto para o gestor. A composição efetiva soma snapshots e ajustes vinculados a pagamentos, com recebimentos, participação da advogada, terceiro/comercial e identificação dos beneficiários. Retenção não é comprovação de repasse pago. O histórico completo e os pagamentos permanecem no fechamento integral.

A origem capturada no fechamento prevalece sobre mudanças cadastrais posteriores, inclusive nas substituições de pagamentos. Ajustes legados sem referência confiável exigem conferência; não são distribuídos arbitrariamente. Um recorte não entrega registros das origens excluídas em seu payload. Para cliente, serviço ou datas específicas, continuam disponíveis os relatórios de registros da central. Serviço e CPF ausentes do snapshot histórico não são inventados.

## Controle de acesso

| Perfil | Relatórios filtrados | Fechamento mensal |
| --- | --- | --- |
| Advogada, inclusive admin | Apenas contratos, parcelas, pagamentos e comissões vinculados à própria conta | Apenas seus fechamentos confirmados |
| Secretaria, inclusive admin | Dados operacionais do próprio escritório; sem percentual, comissão ou repasse | Sem acesso |
| Gestor | Dados do próprio escritório, com filtro de advogada e comissões | Fechamentos confirmados do próprio escritório |

As rotas de prévia e PDF autenticam novamente e derivam o escopo do perfil ativo. IDs enviados por URL nunca ampliam o acesso. Uma advogada que forja o filtro de outra é recusada; links de fechamentos de terceiros não entregam dados. A permissão extra de admin não amplia o escopo financeiro do cargo.

As funções `filtered_activity_report` e `closed_month_report` são **SECURITY INVOKER**, executadas com todas as RLS existentes, além de validação explícita de escritório e titularidade. Somente `authenticated` pode executá-las. Não usam service role, chave secreta ou uma view que contorne as RLS. O payload da secretaria não contém dados de comissões e a função de fechamento recusa esse cargo no banco.

Recebimentos e comissões são consultados no mesmo snapshot SQL; o mesmo vale para composição, ajustes e repasses de um fechamento. O resultado JSON evita a truncagem padrão de 1.000 linhas da API, com limite explícito de 5.000. Falhas de permissão ou consulta não são convertidas em totais zero.

A função `filtered_activity_report_multi` combina as origens selecionadas no mesmo snapshot, reutilizando a consulta original com **SECURITY INVOKER**. O limite de 5.000 considera a soma dos registros selecionados. Repetir uma origem não duplica valores; os limites por cargo, advogada e escritório continuam sendo verificados no banco.

A nova `closed_month_origin_report` é **SECURITY DEFINER** para reunir as destinações contratuais protegidas, com validação explícita de usuário ativo, papel, escritório e titularidade antes de qualquer leitura. Somente advogada e gestor podem executá-la; secretaria é recusada. A advogada recebe apenas seus próprios fechamentos e os beneficiários vinculados a eles, sem acesso direto ao ledger comercial. Nenhuma chave privilegiada é usada pelo frontend. O relatório completo legado continua sendo `SECURITY INVOKER`.

PDFs são gerados sob demanda em Node.js, sem persistência pública. Downloads e erros usam `Cache-Control: private, no-store`, variam por Cookie e não expõem erros SQL internos. O botão apresenta erros e sessão expirada sem abrir uma página de falha genérica.

## Modelo visual e deploy

O PDF usa A4 (paisagem para parcelas), logo oficial da Repassum, cores petróleo/verde, fontes Inter locais, resumos, cabeçalhos repetidos, paginação e rodapé. Quebras de linha e registros extensos são paginados; as fontes completas preservam acentos e glifos compostos. As fontes estáticas em `src/lib/reports/assets` são derivadas da Inter já licenciada no projeto e acompanham a OFL. O PNG do logo é uma exportação do SVG existente.

`pdf-lib` e `@pdf-lib/fontkit` fazem a geração, sem navegador headless ou instalação de Python no deploy. Fontes e logo estão em `outputFileTracingIncludes` do Next para acompanhar as rotas na Vercel. As ferramentas locais de renderização/conversão ficam fora do código publicado.

As duas rotas de PDF reservam até 300 segundos para relatórios extensos. Esse limite é compatível com Fluid Compute, habilitado por padrão na Vercel, inclusive no Hobby. Se o projeto antigo estiver com Fluid Compute desativado, habilite-o antes do deploy. Consulte a [configuração de duração da Vercel](https://vercel.com/docs/functions/configuring-functions/duration). O teste local de capacidade gerou 5.000 registros em cerca de 50 segundos; esse tempo não é uma garantia de desempenho em produção.

## Verificação

Testes focados: `tests/reports.test.ts` (datas, escopo, comissões reais, privacidade e texto do PDF multipágina) e `tests/reports-db.test.ts` (RLS, admin adicional, outro escritório, contratantes adicionais, pagamentos futuros/estornados, composição histórica, correções e repasses). Lint, tipagem e build completam a validação. Os exemplos de revisão usam somente dados fictícios identificados e não aparecem na produção.
