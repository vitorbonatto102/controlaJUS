-- Execute depois da migration 20261103000200, como postgres no SQL Editor.
-- Habilite pg_cron em Integrations > Cron antes de executar.
-- cron usa UTC: 02:59 UTC = 23:59 do dia anterior em Brasília.
select cron.schedule('repassum-monthly-closings','59 2 * * *',
  'select private.run_automatic_closings();');
-- Recupera imediatamente meses vencidos desde outubro/2026, sem duplicar confirmados.
select private.run_automatic_closings();
-- Verificação: select jobid,jobname,schedule,active from cron.job where jobname='repassum-monthly-closings';
-- Histórico: select * from cron.job_run_details order by start_time desc limit 20;
