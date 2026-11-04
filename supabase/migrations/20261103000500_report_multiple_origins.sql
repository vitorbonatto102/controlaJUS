-- Combina origens em uma única consulta/snapshot, reutilizando a RLS e os filtros existentes.
begin;
create or replace function public.filtered_activity_report_multi(
  p_kind text,p_from date,p_to date,p_lawyer uuid default null,
  p_client text default '',p_cpf text default '',p_origins text[] default '{}',
  p_service text default '',p_status text default 'all'
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_origin text; v_part jsonb; v_result jsonb;
  v_rows jsonb:='[]'::jsonb; v_commissions jsonb:='[]'::jsonb;
begin
  if p_origins is null or cardinality(p_origins)>3 or exists(
    select 1 from unnest(p_origins) origin where origin is null or origin not in ('Cliente próprio','Propriedade Intelectual','Tráfego HP')
  ) then raise exception 'Confira as origens selecionadas' using errcode='22023'; end if;
  -- A chamada original valida autenticação, escritório e titularidade em todos os caminhos.
  for v_origin in select distinct origin from unnest(case when cardinality(p_origins)=0 then array['']::text[] else p_origins end) origin loop
    v_part:=public.filtered_activity_report(p_kind,p_from,p_to,p_lawyer,p_client,p_cpf,v_origin,p_service,p_status);
    v_rows:=v_rows||(v_part->'rows');
    if jsonb_array_length(v_rows)>5000 then
      raise exception 'O relatório ultrapassa 5.000 registros. Reduza o período ou refine os filtros' using errcode='54000'; end if;
    v_commissions:=v_commissions||coalesce(v_part->'commissions','[]'::jsonb);
    v_result:=v_part;
  end loop;
  select coalesce(jsonb_agg(value order by value->>'event_date',value->>'row_id'),'[]'::jsonb) into v_rows from jsonb_array_elements(v_rows);
  v_result:=v_result||jsonb_build_object('rows',v_rows);
  if v_result ? 'commissions' then v_result:=v_result||jsonb_build_object('commissions',v_commissions); end if;
  return v_result;
end;
$$;
revoke all on function public.filtered_activity_report_multi(text,date,date,uuid,text,text,text[],text,text) from public,anon,authenticated;
grant execute on function public.filtered_activity_report_multi(text,date,date,uuid,text,text,text[],text,text) to authenticated;
notify pgrst,'reload schema';
commit;
