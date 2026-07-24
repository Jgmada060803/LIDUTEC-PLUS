begin;

create or replace function public.substituir_permissoes_perfil(
  p_perfil_id bigint,
  p_permissao_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_total integer;
begin
  delete from public.perfil_permissoes
  where perfil_id=p_perfil_id;

  insert into public.perfil_permissoes(perfil_id,permissao_id)
  select p_perfil_id,id
  from public.permissoes
  where id=any(coalesce(p_permissao_ids,'{}'::bigint[]))
    and ativo=true;

  get diagnostics v_total=row_count;
  return v_total;
end;
$$;

revoke all on function public.substituir_permissoes_perfil(bigint,bigint[])
from public,anon,authenticated;
grant execute on function public.substituir_permissoes_perfil(bigint,bigint[])
to service_role;

commit;
