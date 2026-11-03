# Fechamento automático e correções

## Ativar no Supabase

1. Após as migrations anteriores, execute integralmente `supabase/migrations/20261103000200_automatic_closings.sql` no SQL Editor como proprietário do projeto. Ela recupera imediatamente os meses vencidos **a partir de outubro/2026**. Não fecha setembro nem períodos anteriores. Não altera um fechamento já confirmado, mesmo que tenha sido manual. Uma apuração vazia pode ser concluída; apuração com snapshot inesperado aborta a transação para conferência.
2. Habilite **pg_cron** em Integrations → Cron, conforme a [documentação do Supabase](https://supabase.com/docs/guides/cron).
3. Execute `supabase/operations/schedule_automatic_closings.sql`. Ele cria/atualiza o job nomeado, sem duplicar. Não há variável de ambiente ou chave nova. A migration sozinha recupera o histórico, mas **não instala o agendamento**.
4. Publique o código. Nos fechamentos da advogada e do gestor, abra **Visualizar / corrigir valores**. A tela mostra o documento completo e permite baixar o PDF.

O job roda diariamente às **02h59 UTC**, equivalente a **23h59 em Brasília**. A função só encerra o mês corrente quando é o último dia e já são 23h59; nos demais dias apenas recupera meses vencidos. Inclui pagamentos válidos pela data efetiva, usando comissões já registradas, inclusive retenção integral. O último minuto tem um corte: pagamentos que chegarem depois da consolidação precisarão de “Corrigir valores”. Não fecha meses futuros nem realiza repasses automaticamente.

Confira o job em Integrations → Cron e seu histórico de sucesso/erro (`cron.job_run_details`). Se o projeto estiver pausado ou o job falhar, a próxima execução recupera meses vencidos; para recuperar imediatamente, execute `select private.run_automatic_closings();` como proprietário no SQL Editor. Falhas revertem a execução e aparecem no histórico; pagamentos sem comissão impedem fechamento silenciosamente incompleto.

Verificação de outubro:

```sql
select p.full_name, mc.reference_month, mc.reference_year, mc.automatic,
       mc.status, mc.closed_at, mc.office_amount_received, mc.commission_amount
from public.monthly_closings mc join public.profiles p on p.id=mc.lawyer_id
where mc.reference_year=2026 and mc.reference_month=10;
```

`automatic=false` indica fechamento anterior preservado; não apague esse histórico para executar novamente. Valores originais continuam iguais, e correções posteriores aparecem como ajustes. Reexecutar a migration ou o job não duplica fechamentos ou notificações de conclusão.

## Corrigir valores depois de fechar

A advogada corrige apenas o próprio fechamento. O gestor corrige os fechamentos do seu escritório. A secretaria continua operando meses abertos e não recebe novas permissões de comissão ou fechamento. A capacidade extra de admin não amplia o acesso financeiro do cargo.

Em **Corrigir valores**, escolha:

- Corrigir valor/data: estorna o pagamento anterior e cria o substituto com vínculo ao original.
- Incluir recebimento que faltou: selecione a parcela existente e informe o valor realmente recebido.
- Estornar: retira o recebimento dos totais atuais, preservando seu histórico.

A data deve pertencer ao mês consultado, sem data futura. O motivo tem entre 5 e 1.000 caracteres e é obrigatório no banco e na aplicação. Não existe edição livre do total consolidado. A comissão é recalculada pelas regras existentes, inclusive os efeitos da retenção integral em outros recebimentos. Ajustes atualizam o saldo; excesso de repasse permanece identificado para regularização pelo gestor.

A composição original e os logs são imutáveis. O relatório mostra composição original, ajustes e repasses com sua posição atual. Alterações feitas pelas rotinas anteriores do gestor também continuam auditadas e notificadas. A notificação informa autor, antes/depois e motivo: gestor → advogada afetada; advogada → todos os gestores ativos do mesmo escritório, excluindo o próprio autor. O gestor tem **Notificações** no menu lateral.

## Segurança e implementação

O agendador usa uma função privada sem EXECUTE para PUBLIC, anon ou authenticated. Não simula uma pessoa e registra `actor_kind=system`, com usuário nulo permitido somente no evento de fechamento automático. Outros logs exigem usuário. Não há chave privilegiada no navegador nem endpoint público de cron.

As correções usam `correct_closed_values`, com autenticação, perfil ativo, escritório, titularidade, competência e validação dos registros dentro da transação. As cópias privadas das rotinas financeiras só são acessíveis pela RPC validada. RLS e privilégios das tabelas permanecem. Locks financeiros e de competência coordenam pagamentos e fechamento; snapshots confirmados nunca são sobrescritos.

Testes de integração com PostgreSQL local cobrem o corte 23h59, início em outubro, repetição, bloqueio de outros usuários/secretaria, inclusão, substituição, estorno, notificações bilaterais e preservação do snapshot. Nenhum teste cria pagamentos no Supabase de produção.
