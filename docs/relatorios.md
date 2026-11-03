# Relatórios da Repassum

## Ativação e uso

1. Após as migrations anteriores, execute **somente** `supabase/migrations/20261103000100_reports.sql` inteiro no SQL Editor do Supabase. A migration é transacional, reaplicável e somente adiciona funções de consulta. Não modifica pagamentos, comissões ou fechamentos. Não foi aplicada automaticamente em produção.
2. Publique o código pelo fluxo existente da Vercel. Não há variáveis de ambiente novas.
3. Em qualquer painel, abra **Relatórios** no menu lateral. Escolha tipo, datas, cliente/CPF, serviço e origem; a secretaria e a gestão também podem selecionar uma advogada, inclusive com histórico de conta inativa.
4. Use **Visualizar relatório** para aplicar os filtros. A prévia mostra 40 registros por página; **Baixar PDF** inclui todos os registros do filtro, até o limite declarado de 5.000. Acima dele, a emissão solicita filtros mais específicos e não entrega um documento parcial.
5. Depois de confirmar um fechamento, o gestor encontra **Emitir relatório do mês (PDF)** no cartão daquele fechamento. A advogada tem **Emitir PDF** na sua tabela de fechamentos. Meses em apuração não emitem o demonstrativo de fechamento.

## O que cada relatório mostra

| Relatório | Base do período | Valores |
| --- | --- | --- |
| Recebimentos | Data efetiva do pagamento | Recebido válido e, para advogada/gestor, comissão efetivamente registrada |
| Parcelas e saldos | Vencimento da parcela | Valor contratual, recebido até a emissão, saldo e situação |
| Contratos | Data do documento | Contratantes, serviço, origem, forma de pagamento e valor conhecido |
| Fechamento mensal | Competência confirmada | Composição original, ajustes posteriores, repasses e saldo consolidado |

Datas usam DD/MM/AAAA e o calendário de America/Sao_Paulo. Pagamentos estornados ou com data futura não entram nos recebimentos. No relatório de parcelas, pagamentos fora do período de vencimento podem atualizar o saldo; a data de posição está explícita. “Em atraso” inclui parcelas com saldo positivo e vencimento anterior a hoje, mesmo quando houve pagamento parcial.

O nome e o CPF pesquisam qualquer contratante do contrato sem multiplicar valores por pessoa. Nomes e serviços são buscas literais parciais; CPF é exato, com 11 dígitos. Os valores a apurar em contratos de êxito não são inventados. A data do documento não prova assinatura/fechamento comercial.

A comissão dos recebimentos vem da tabela `commissions`, com o valor efetivo já calculado pelo sistema. Não há recálculo proporcional que ignore retenção integral, multa ou juros. Um pagamento sem comissão registrada aparece como **A apurar** e fica fora do total de comissões, com uma nota explicativa.

## Fechamento completo e histórico

O demonstrativo mensal usa `monthly_closing_items` como composição original, não uma reconstrução a partir dos pagamentos atuais. Correções ficam em seção separada, conforme `closing_adjustments`. O resumo soma os totais originais aos ajustes. Repasses estornados ficam visíveis no histórico e fora do total repassado. A posição dos repasses é a da emissão, não uma promessa de que já estavam pagos na data do fechamento.

O relatório do fechamento é integral, por advogada/competência. Não distribui repasses ou ajustes arbitrariamente entre clientes. Para um recorte por cliente, origem, serviço ou datas específicas, use os relatórios de registros da central. O snapshot antigo não contém serviço/CPF; esses campos não são inventados ou preenchidos com cadastros atuais no demonstrativo histórico.

## Controle de acesso

| Perfil | Relatórios filtrados | Fechamento mensal |
| --- | --- | --- |
| Advogada, inclusive admin | Apenas contratos, parcelas, pagamentos e comissões vinculados à própria conta | Apenas seus fechamentos confirmados |
| Secretaria, inclusive admin | Dados operacionais do próprio escritório; sem percentual, comissão ou repasse | Sem acesso |
| Gestor | Dados do próprio escritório, com filtro de advogada e comissões | Fechamentos confirmados do próprio escritório |

As rotas de prévia e PDF autenticam novamente e derivam o escopo do perfil ativo. IDs enviados por URL nunca ampliam o acesso. Uma advogada que forja o filtro de outra é recusada; links de fechamentos de terceiros não entregam dados. A permissão extra de admin não amplia o escopo financeiro do cargo.

As funções `filtered_activity_report` e `closed_month_report` são **SECURITY INVOKER**, executadas com todas as RLS existentes, além de validação explícita de escritório e titularidade. Somente `authenticated` pode executá-las. Não usam service role, chave secreta ou uma view que contorne as RLS. O payload da secretaria não contém dados de comissões e a função de fechamento recusa esse cargo no banco.

Recebimentos e comissões são consultados no mesmo snapshot SQL; o mesmo vale para composição, ajustes e repasses de um fechamento. O resultado JSON evita a truncagem padrão de 1.000 linhas da API, com limite explícito de 5.000. Falhas de permissão ou consulta não são convertidas em totais zero.

PDFs são gerados sob demanda em Node.js, sem persistência pública. Downloads e erros usam `Cache-Control: private, no-store`, variam por Cookie e não expõem erros SQL internos. O botão apresenta erros e sessão expirada sem abrir uma página de falha genérica.

## Modelo visual e deploy

O PDF usa A4 (paisagem para parcelas), logo oficial da Repassum, cores petróleo/verde, fontes Inter locais, resumos, cabeçalhos repetidos, paginação e rodapé. Quebras de linha e registros extensos são paginados; as fontes completas preservam acentos e glifos compostos. As fontes estáticas em `src/lib/reports/assets` são derivadas da Inter já licenciada no projeto e acompanham a OFL. O PNG do logo é uma exportação do SVG existente.

`pdf-lib` e `@pdf-lib/fontkit` fazem a geração, sem navegador headless ou instalação de Python no deploy. Fontes e logo estão em `outputFileTracingIncludes` do Next para acompanhar as rotas na Vercel. As ferramentas locais de renderização/conversão ficam fora do código publicado.

As duas rotas de PDF reservam até 300 segundos para relatórios extensos. Esse limite é compatível com Fluid Compute, habilitado por padrão na Vercel, inclusive no Hobby. Se o projeto antigo estiver com Fluid Compute desativado, habilite-o antes do deploy. Consulte a [configuração de duração da Vercel](https://vercel.com/docs/functions/configuring-functions/duration). O teste local de capacidade gerou 5.000 registros em cerca de 50 segundos; esse tempo não é uma garantia de desempenho em produção.

## Verificação

Testes focados: `tests/reports.test.ts` (datas, escopo, comissões reais, privacidade e texto do PDF multipágina) e `tests/reports-db.test.ts` (RLS, admin adicional, outro escritório, contratantes adicionais, pagamentos futuros/estornados, composição histórica, correções e repasses). Lint, tipagem e build completam a validação. Os exemplos de revisão usam somente dados fictícios identificados e não aparecem na produção.
