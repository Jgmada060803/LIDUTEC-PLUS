begin;

-- Permite incluir um material novo na carga de uma corrida já ABERTA (ex.:
-- percebeu que vai precisar de mais um material depois de já ter enviado
-- a solicitação inicial). Não mexe nos itens já existentes.
create or replace function public.adicionar_item_carga_fusao(
  p_corrida_id bigint, p_material_id bigint, p_quantidade_planejada_kg numeric, p_estado_fisico text default null
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_material record;
  v_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Só é possível incluir material numa corrida aberta.'; end if;
  if coalesce(p_quantidade_planejada_kg, -1) < 0 then raise exception 'Informe a quantidade planejada.'; end if;

  select * into v_material from public.materiais_fusao where id = p_material_id;
  if not found then raise exception 'Material inválido.'; end if;
  if v_material.tipo = 'GUSA' and p_estado_fisico is null then
    raise exception 'Informe se o gusa está sólido ou líquido.';
  end if;

  if exists(select 1 from public.corridas_fusao_carga_itens where corrida_id = p_corrida_id and material_id = p_material_id) then
    raise exception 'Este material já está na carga desta corrida.';
  end if;

  insert into public.corridas_fusao_carga_itens(corrida_id, material_id, quantidade_planejada_kg, estado_fisico)
  values (p_corrida_id, p_material_id, p_quantidade_planejada_kg, case when v_material.tipo = 'GUSA' then p_estado_fisico else null end)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.adicionar_item_carga_fusao(bigint,bigint,numeric,text) from public,anon;
grant execute on function public.adicionar_item_carga_fusao(bigint,bigint,numeric,text) to authenticated;

notify pgrst, 'reload schema';

commit;
