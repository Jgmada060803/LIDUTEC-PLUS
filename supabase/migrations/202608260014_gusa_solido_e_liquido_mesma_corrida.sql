begin;

-- Gusa pode entrar na mesma corrida sólido E líquido — são 2 itens
-- distintos, não o mesmo material duas vezes. A trava única era só por
-- (corrida, material), que impedia isso; passa a considerar o estado
-- físico também. Pesagem (atualizar/adicionar) passa a mirar o item pelo
-- próprio id (chave primária) em vez de (corrida, material), já que agora
-- material sozinho não identifica mais uma linha única. Mesma assinatura
-- de tipos de antes (bigint,bigint,numeric) — create or replace já
-- substitui a função, sem precisar de drop nem gerar sobrecarga nova.
alter table public.corridas_fusao_carga_itens drop constraint if exists corridas_fusao_carga_itens_corrida_id_material_id_key;
create unique index if not exists corridas_fusao_carga_itens_corrida_material_estado_uidx
  on public.corridas_fusao_carga_itens(corrida_id, material_id, coalesce(estado_fisico, '-'));

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

  if exists(
    select 1 from public.corridas_fusao_carga_itens
    where corrida_id = p_corrida_id and material_id = p_material_id
      and coalesce(estado_fisico,'-') = coalesce(p_estado_fisico,'-')
  ) then
    raise exception 'Este material (nesse estado) já está na carga desta corrida.';
  end if;

  insert into public.corridas_fusao_carga_itens(corrida_id, material_id, quantidade_planejada_kg, estado_fisico)
  values (p_corrida_id, p_material_id, p_quantidade_planejada_kg, case when v_material.tipo = 'GUSA' then p_estado_fisico else null end)
  returning id into v_id;
  return v_id;
end;
$$;

-- p_material_id renomeado (na prática) pra "identifica o item" — mesmo
-- tipo bigint, só passa a receber o id da linha de corridas_fusao_carga_itens.
create or replace function public.atualizar_pesagem_carga_fusao(
  p_corrida_id bigint, p_material_id bigint, p_quantidade_realizada_kg numeric
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_quantidade_realizada_kg is not null and p_quantidade_realizada_kg < 0 then
    raise exception 'Quantidade realizada não pode ser negativa.';
  end if;
  update public.corridas_fusao_carga_itens
  set quantidade_realizada_kg = p_quantidade_realizada_kg, atualizado_por = auth.uid(), atualizado_em = now()
  where corrida_id = p_corrida_id and id = p_material_id;
  if not found then raise exception 'Item de carga não encontrado nesta corrida.'; end if;
end;
$$;

create or replace function public.adicionar_pesagem_carga_fusao(
  p_corrida_id bigint, p_material_id bigint, p_quantidade_kg numeric
) returns numeric language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_total numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if coalesce(p_quantidade_kg, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  update public.corridas_fusao_carga_itens
  set quantidade_realizada_kg = coalesce(quantidade_realizada_kg, 0) + p_quantidade_kg,
    atualizado_por = auth.uid(), atualizado_em = now()
  where corrida_id = p_corrida_id and id = p_material_id
  returning quantidade_realizada_kg into v_total;
  if not found then raise exception 'Item de carga não encontrado nesta corrida.'; end if;
  return v_total;
end;
$$;

notify pgrst, 'reload schema';

commit;
