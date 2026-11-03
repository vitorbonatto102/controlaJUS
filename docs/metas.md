# Metas de contratos e acompanhamento da equipe

## Ativação desta alteração

Após as migrations anteriores, execute **somente** `supabase/migrations/20261103000300_document_date_goals.sql` inteiro no SQL Editor do Supabase. Não execute novamente o schema inicial. A migration é transacional e reaplicável; não muda contratos, confirmações, datas ou objetivos já salvos. Não há variáveis de ambiente novas. Ela não foi aplicada automaticamente em produção.

A atualização muda a consulta dos totais existentes: três contratos com contratação datada em outubro/2026 passam a contar em outubro, mesmo cadastrados em novembro e ainda com a situação “Aguardando confirmação”. Não é necessário confirmar um por um. Se a data do documento foi extraída incorretamente, corrija o campo **Data da contratação** no cadastro do contrato.

## Regra de contagem

- A competência vem de `contracts.contract_date`: a data de contratação informada no documento.
- `created_at` (momento do cadastro) e `closed_on` (histórico da confirmação separada) não determinam o mês das metas.
- Entram os contratos cadastrados da responsável principal, inclusive antigos/importados sem confirmação separada. Cancelados (`engagement_status=cancelled`), apagados (`deleted_at`) e datas de contratação futuras ficam fora. Uma data ausente nunca é substituída pela data de hoje.
- Cada contrato conta uma vez por ID. Vários contratantes não multiplicam a contagem.
- Cancelar remove o contrato da contagem. Voltar a “Aguardando confirmação” o reinclui pela data do documento. Confirmar separadamente não muda sua competência.
- Corrigir a data de contratação move a contagem para o mês correto. Não há mudança em parcelas, comissões, pagamentos ou fechamentos financeiros.
- A página de Metas, seu histórico, o cartão da Visão geral e os indicadores comerciais da Carteira usam a mesma regra.

O histórico mantém o calendário de Brasília, os seis meses do gráfico e as metas já salvas. O mês atual compara os mesmos dias decorridos do mês anterior, limitados ao último dia dele. Meses encerrados comparam períodos completos. Médias e recordes começam no primeiro mês com histórico disponível. Meses posteriores sem contratos podem contar zero; antes do início do histórico, a tela informa ausência de referência. Projeções permanecem identificadas como estimativas.

## Advogada

**Metas** continua sendo sua página individual. Escolha o mês e defina/edite apenas a quantidade desejada de contratos. A tela mostra realizados, objetivo, percentual, faltantes, marcos, ritmo e evolução. A antiga lista de cadastros aguardando confirmação foi removida das metas, pois o cadastro já entra pela data do documento.

A confirmação separada continua disponível no contrato como histórico cadastral; a explicação no formulário deixa claro seu efeito sobre a contagem. A situação do processo judicial não determina o fechamento comercial.

## Gestor

O menu passa a mostrar **Metas da equipe**, em `/gestor/metas`. A antiga URL `/metas` redireciona o gestor para essa página, preservando o mês.

O acompanhamento é somente leitura, com filtro de mês e advogada. Apresenta contratos fechados, quantidade de advogadas acompanhadas, metas definidas/alcançadas e uma lista em ordem alfabética com realizados, objetivo, percentual, faltantes e comparação com o mês anterior. Não há ranking nem formulário de meta pessoal/coletiva do gestor. A edição dos objetivos fica com cada advogada.

Contas inativas com contratos ou meta no período continuam disponíveis para consulta histórica. Um objetivo ausente aparece como **Não definida**, sem inventar percentual ou faltantes.

## Acesso e banco

`contract_goal_summary` continua autenticando o escopo individual e o escritório no banco. A advogada recebe somente seus próprios totais e objetivos. O payload declara `count_basis=contract_date`; enquanto a migration não for aplicada, a página avisa que a atualização está pendente.

A nova RPC `team_contract_goals` é autorizada somente ao cargo ativo `manager`, derivando o escritório da sessão. Não aceita parâmetro de escritório nem retorna clientes ou dados financeiros. Advogadas, inclusive com admin extra, e secretarias não podem usá-la. A secretaria deixa de ter o módulo de Metas no menu mesmo quando admin.

As tabelas existentes e suas RLS permanecem. As RPCs administrativas de meta coletiva continuam preservadas para compatibilidade e evolução futura, sem interface de configuração no painel do gestor. Metas individuais continuam salvas pela RPC autenticada `save_my_contract_goal`, com validação, unicidade e auditoria.

## Verificação

Testes focados cobrem três contratos de outubro cadastrados depois, confirmação em outro mês, cancelamento/restauração, correção da data, exclusão, múltiplos contratantes, objetivos existentes, histórico de inativas, reaplicação da migration e isolamento entre usuários/escritórios. Os testes puros conferem também a Visão geral, Carteira, datas futuras e marcos. As prévias visuais usam dados fictícios locais e não são publicadas.
