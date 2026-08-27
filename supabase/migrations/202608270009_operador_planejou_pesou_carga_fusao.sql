begin;

-- Rastro de "quem planejou" (criado_por/criado_em, novo) e "quem pesou por
-- último" (atualizado_por/atualizado_em, já existia) — antes esses dois
-- campos serviam tanto pra edição de planejado quanto de real, misturando
-- os dois; agora atualizado_por/atualizado_em passam a refletir só a
-- pesagem (real), e editar o planejado não mexe mais neles.
alter table public.corridas_fusao_carga_itens
  add column if not exists criado_por uuid references public.usuarios(id),
  add column if not exists criado_em timestamptz not null default now();

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

  insert into public.corridas_fusao_carga_itens(corrida_id, material_id, quantidade_planejada_kg, estado_fisico, criado_por)
  values (p_corrida_id, p_material_id, p_quantidade_planejada_kg, case when v_material.tipo = 'GUSA' then p_estado_fisico else null end, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.atualizar_planejado_carga_fusao(p_corrida_id bigint, p_item_id bigint, p_quantidade_planejada_kg numeric)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_corrida record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Só é possível editar o planejado de uma corrida aberta.'; end if;
  if coalesce(p_quantidade_planejada_kg, -1) < 0 then raise exception 'Quantidade planejada inválida.'; end if;
  update public.corridas_fusao_carga_itens
  set quantidade_planejada_kg = p_quantidade_planejada_kg
  where corrida_id = p_corrida_id and id = p_item_id;
  if not found then raise exception 'Item de carga não encontrado nesta corrida.'; end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
