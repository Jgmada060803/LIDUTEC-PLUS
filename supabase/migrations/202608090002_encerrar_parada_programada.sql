begin;

-- Encerra o ciclo vigente de uma parada programada sem precisar cadastrar
-- uma substituta (definir_parada_programada só fecha o ciclo antigo como
-- efeito colateral de criar um novo).
create or replace function public.encerrar_parada_programada(
  p_id bigint,
  p_vigencia_fim date default current_date
) returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_vigencia_inicio date;
begin
  if not public.usuario_tem_permissao_metas('metas.gerenciar') then
    raise exception 'Usuário sem permissão para gerenciar paradas programadas.';
  end if;

  select vigencia_inicio into v_vigencia_inicio
  from public.paradas_programadas
  where id = p_id and vigencia_fim is null
  for update;

  if not found then
    raise exception 'Parada programada não encontrada ou já encerrada.';
  end if;

  if p_vigencia_fim < v_vigencia_inicio then
    raise exception 'A data de encerramento não pode ser anterior ao início da vigência.';
  end if;

  update public.paradas_programadas
  set vigencia_fim = p_vigencia_fim
  where id = p_id;
end;
$$;
revoke all on function public.encerrar_parada_programada(bigint,date) from public,anon;
grant execute on function public.encerrar_parada_programada(bigint,date) to authenticated;

notify pgrst,'reload schema';

commit;
