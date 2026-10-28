# Metas de contratos

## Ativação no projeto existente

1. No Supabase → SQL Editor, execute `supabase/migrations/20261028000200_confirmed_contract_goals.sql` inteiro. Ele depende de `20261028000100_lawyer_contract_goals.sql` e das migrations anteriores já aplicadas. Não execute novamente o schema inicial.
2. A migration é transacional e reaplicável: preserva metas e confirmações, sem confirmar registros por inferência. Não requer variáveis de ambiente novas.
3. Após publicar o código, entre em **Metas** no menu. Escolha o mês atual ou um anterior e clique em **Criar uma meta**. Para editar, use **Editar meta**. O único campo é a quantidade inteira de contratos (1 a 10.000).
4. Para contratos já cadastrados, abra **Contratos → Visualizar → Confirmação da contratação**. Confirme apenas contratações reais, informando a data verdadeira, inclusive quando antiga. O módulo mostra até seis cadastros pendentes com atalhos; a lista completa pode ser filtrada pela situação.

O código foi verificado em PostgreSQL local via PGlite. A migration precisa ser aplicada no Supabase do ambiente; não foi executada automaticamente em produção.

## Regra de contagem

- `engagement_status`: `unconfirmed` (aguardando confirmação), `confirmed` (confirmada/assinada), `cancelled` (cancelada).
- `closed_on`: data efetiva obrigatória apenas para confirmados; vazia nos demais estados. Não é `contract_date` (documento) nem `created_at` (cadastro). Datas futuras são rejeitadas no banco.
- Cadastros antigos, importações e novos contratos começam aguardando confirmação. Não se presume que upload de PDF significa assinatura.
- Um contrato não excluído conta uma única vez no mês de `closed_on`. Cancelar, desfazer a confirmação, corrigir sua data ou excluir logicamente recalcula as métricas na próxima consulta. O formulário atualiza as páginas relacionadas após salvar.
- A atribuição individual usa a **advogada responsável principal**, `contracts.lawyer_id`. Contratantes adicionais são clientes do mesmo contrato, não responsáveis comerciais. Uma futura equipe com vários profissionais por contrato deverá manter essa atribuição explícita.
- O coletivo soma os contratos do escritório sem junção com participantes, evitando multiplicação por contratante. Não existe soma dos totais individuais para calcular o coletivo.
- A confirmação comercial não altera parcelas, pagamentos, comissões ou repasses existentes. Os fluxos financeiros continuam separados.

## Escopos e segurança

| Perfil | Meta individual | Meta coletiva |
| --- | --- | --- |
| Advogada | Consulta e edita a própria | Sem acesso, salvo se admin |
| Gestor | Leitura das metas individuais já permitida pelo sistema | Consulta o agregado do escritório |
| Qualquer cargo com `is_office_admin` | Mantém as permissões do cargo | Consulta e configura a meta do próprio escritório |
| Secretaria sem admin | Sem acesso | Sem acesso |

A tabela existente `lawyer_monthly_goals` mantém unicidade advogada/mês. A nova `office_monthly_goals` mantém unicidade escritório/mês. Ambas usam RLS e proíbem escrita direta por usuários da API. Metas são salvas por RPC, derivando as identidades da sessão, com validação, lock transacional, upsert e auditoria.

`contract_goal_summary` retorna somente agregados no escopo permitido, sem IDs ou nomes de clientes de colegas. Usuários inativos e outros escritórios são bloqueados. A confirmação usa `set_contract_engagement`, autorizada apenas ao responsável principal ou ao gestor do escritório; requer motivo e versão para evitar sobrescrever alterações concorrentes. Um trigger impede alterações de situação fora desse fluxo pela aplicação. Auditoria imutável registra antes/depois; correções do gestor notificam a responsável.

## Calendário, histórico e projeções

O mês atual e o limite de datas usam **America/Sao_Paulo**. Datas de fechamento são `DATE`, sem conversão que desloque o dia. A comparação do mês atual usa os mesmos dias decorridos do mês anterior, limitados ao último dia dele. Meses encerrados comparam períodos completos. Janeiro/dezembro e anos bissextos são contemplados.

Antes do primeiro mês com fechamento confirmado, não se presume histórico zero: comparativos e médias ficam indisponíveis. A média usa os três meses completos anteriores somente quando os três já pertencem ao histórico iniciado pelas confirmações. Meses posteriores ao início do histórico sem confirmações contam zero. O histórico depende da conferência dos registros antigos: importações ainda pendentes não entram.

O gráfico mostra os seis meses até o selecionado, com quantidade confirmada e meta quando definida. Ausência de meta não vira meta zero. A melhor marca anterior considera todos os meses anteriores com fechamentos confirmados.

O realizado fica separado das estimativas. O ritmo necessário divide o que falta pelos dias corridos restantes **após hoje**; no último dia, a interface informa que fechamentos de hoje ainda contam. A projeção utiliza o ritmo dos dias decorridos do mês atual e não representa garantia. Não há projeção para períodos encerrados.

## Marcos e experiência

Marcos de 25%, 50%, 75% e 100%, sem pontos ou rankings. Percentuais são truncados para não anunciar um marco antes de atingi-lo. O destaque de melhor marca aparece apenas com uma referência anterior real.

Uma microanimação sutil ocorre ao superar um marco já observado neste navegador. A primeira visita e a edição do objetivo estabelecem uma referência, evitando celebrar redução artificial de meta; marcos não se repetem após queda e recuperação da contagem. `prefers-reduced-motion` desativa movimento. Esse estado visual local não participa da persistência ou da contagem real.

Há estados sem meta, sem histórico, de carregamento, falha com tentativa novamente e atualização do banco pendente. Não são usados dados fictícios em produção. A interface usa a identidade existente e inclui tabela acessível dos valores do gráfico.

## Verificação

`npm run lint`, `npm run typecheck`, `npm run build` e testes focados em `tests/goals.test.ts`, `tests/confirmed-goals-db.test.ts`, `tests/contract-goals-db.test.ts`, `tests/lawyer-overview.test.ts` e `tests/wallet.test.ts`.
