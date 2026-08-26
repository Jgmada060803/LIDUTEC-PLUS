begin;

-- ==========================================================================
-- Status da corrida vira só Aberta/Fechada/Cancelada (era Planejada->
-- Carregando->Elaboração->Pronta->Transferida) — pedido explícito de
-- simplificação. Fechada pode ser reaberta (volta pra Aberta) pra corrigir.
-- ==========================================================================
alter table public.corridas_fusao drop constraint if exists corridas_fusao_status_check;
update public.corridas_fusao set status = 'ABERTA' where status in ('PLANEJADA','CARREGANDO','ELABORACAO','PRONTA');
update public.corridas_fusao set status = 'FECHADA' where status = 'TRANSFERIDA';
alter table public.corridas_fusao add constraint corridas_fusao_status_check check (status in ('ABERTA','FECHADA','CANCELADA'));
alter table public.corridas_fusao alter column status set default 'ABERTA';

create or replace function public.criar_corrida_fusao(
  p_forno_id bigint, p_turno text, p_data_operacional date, p_numero_sequencia integer, p_itens jsonb
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_ciclo record;
  v_forno record;
  v_codigo text;
  v_corrida_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if p_data_operacional is null then raise exception 'Informe a data operacional.'; end if;
  if coalesce(p_numero_sequencia, 0) <= 0 then raise exception 'Informe o número da corrida.'; end if;
  if jsonb_array_length(coalesce(p_itens,'[]'::jsonb)) = 0 then raise exception 'Informe ao menos um material na carga.'; end if;

  if exists(
    select 1 from jsonb_to_recordset(p_itens) as item(material_id bigint, quantidade_planejada_kg numeric, estado_fisico text)
    join public.materiais_fusao material on material.id = item.material_id
    where material.tipo = 'GUSA' and item.estado_fisico is null
  ) then
    raise exception 'Informe se o gusa está sólido ou líquido.';
  end if;

  select * into v_forno from public.fornos_fusao where id = p_forno_id and ativo for update;
  if not found then raise exception 'Forno inválido.'; end if;

  if exists(select 1 from public.corridas_fusao where forno_id = p_forno_id and status = 'ABERTA') then
    raise exception 'Já existe uma corrida em andamento neste forno.';
  end if;

  select * into v_ciclo from public.ciclos_refratario_fusao where forno_id = p_forno_id and encerrado_em is null for update;
  if not found then
    insert into public.ciclos_refratario_fusao(forno_id, numero_ciclo, iniciado_por)
    values (p_forno_id, 1, auth.uid())
    returning * into v_ciclo;
  end if;

  if exists(select 1 from public.corridas_fusao where ciclo_refratario_id = v_ciclo.id and numero_sequencia = p_numero_sequencia) then
    raise exception 'Já existe uma corrida com esse número neste ciclo.';
  end if;

  v_codigo := v_forno.codigo || lpad(v_ciclo.numero_ciclo::text, 3, '0') || lpad(p_numero_sequencia::text, 3, '0');

  insert into public.corridas_fusao(forno_id, ciclo_refratario_id, numero_sequencia, codigo, data_operacional, turno, criado_por, atualizado_por)
  values (p_forno_id, v_ciclo.id, p_numero_sequencia, v_codigo, p_data_operacional, p_turno, auth.uid(), auth.uid())
  returning id into v_corrida_id;

  insert into public.corridas_fusao_carga_itens(corrida_id, material_id, quantidade_planejada_kg, estado_fisico)
  select v_corrida_id, item.material_id, item.quantidade_planejada_kg,
    case when material.tipo = 'GUSA' then item.estado_fisico else null end
  from jsonb_to_recordset(p_itens) as item(material_id bigint, quantidade_planejada_kg numeric, estado_fisico text)
  join public.materiais_fusao material on material.id = item.material_id
  where item.material_id is not null and item.quantidade_planejada_kg >= 0;

  return v_corrida_id;
end;
$$;

-- Substitui avancar_status_corrida_fusao (5 estados) por 3 ações diretas.
create or replace function public.fechar_corrida_fusao(p_corrida_id bigint, p_versao bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_corrida record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id for update;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.versao <> p_versao then
    raise exception 'CONFLITO_RASCUNHO: a corrida foi atualizada por outro usuário.' using errcode = '40001';
  end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Esta corrida não está aberta.'; end if;
  update public.corridas_fusao set status = 'FECHADA', versao = versao + 1, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;
end;
$$;
revoke all on function public.fechar_corrida_fusao(bigint,bigint) from public,anon;
grant execute on function public.fechar_corrida_fusao(bigint,bigint) to authenticated;

create or replace function public.reabrir_corrida_fusao(p_corrida_id bigint, p_versao bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_corrida record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id for update;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.versao <> p_versao then
    raise exception 'CONFLITO_RASCUNHO: a corrida foi atualizada por outro usuário.' using errcode = '40001';
  end if;
  if v_corrida.status <> 'FECHADA' then raise exception 'Esta corrida não está fechada.'; end if;
  if exists(select 1 from public.corridas_fusao where forno_id = v_corrida.forno_id and status = 'ABERTA' and id <> v_corrida.id) then
    raise exception 'Já existe outra corrida aberta neste forno.';
  end if;
  update public.corridas_fusao set status = 'ABERTA', versao = versao + 1, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;
end;
$$;
revoke all on function public.reabrir_corrida_fusao(bigint,bigint) from public,anon;
grant execute on function public.reabrir_corrida_fusao(bigint,bigint) to authenticated;

create or replace function public.cancelar_corrida_fusao(p_corrida_id bigint, p_versao bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_corrida record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id for update;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.versao <> p_versao then
    raise exception 'CONFLITO_RASCUNHO: a corrida foi atualizada por outro usuário.' using errcode = '40001';
  end if;
  if v_corrida.status = 'CANCELADA' then raise exception 'Esta corrida já foi cancelada.'; end if;
  update public.corridas_fusao set status = 'CANCELADA', versao = versao + 1, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;
end;
$$;
revoke all on function public.cancelar_corrida_fusao(bigint,bigint) from public,anon;
grant execute on function public.cancelar_corrida_fusao(bigint,bigint) to authenticated;

drop function if exists public.avancar_status_corrida_fusao(bigint,text,bigint);

-- ==========================================================================
-- Ponte: cada forno pertence a um carro (ponte rolante) — a tela da ponte
-- separa os pedidos de material por carro em vez de mostrar tudo junto.
-- ==========================================================================
alter table public.fornos_fusao add column if not exists carro integer check (carro in (1,2));

create or replace function public.salvar_forno_fusao(
  p_id bigint, p_codigo text, p_nome text, p_tipo text,
  p_limite_atencao integer default 100, p_limite_critico integer default 150, p_ativo boolean default true,
  p_carro integer default null
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.configurar') then
    raise exception 'Usuário sem permissão para configurar cadastros de fusão.';
  end if;
  if p_tipo not in ('FUSAO','HOLDING') then raise exception 'Tipo de forno inválido.'; end if;
  if p_carro is not null and p_carro not in (1,2) then raise exception 'Carro inválido.'; end if;
  if p_id is null then
    insert into public.fornos_fusao(codigo,nome,tipo,limite_atencao_corridas,limite_critico_corridas,ativo,carro)
    values(trim(p_codigo),trim(p_nome),p_tipo,coalesce(p_limite_atencao,100),coalesce(p_limite_critico,150),coalesce(p_ativo,true),p_carro)
    returning id into v_id;
  else
    update public.fornos_fusao set codigo=trim(p_codigo),nome=trim(p_nome),tipo=p_tipo,
      limite_atencao_corridas=coalesce(p_limite_atencao,100),limite_critico_corridas=coalesce(p_limite_critico,150),
      ativo=coalesce(p_ativo,true),carro=p_carro
    where id=p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;
drop function if exists public.salvar_forno_fusao(bigint,text,text,text,integer,integer,boolean);
revoke all on function public.salvar_forno_fusao(bigint,text,text,text,integer,integer,boolean,integer) from public,anon;
grant execute on function public.salvar_forno_fusao(bigint,text,text,text,integer,integer,boolean,integer) to authenticated;

notify pgrst, 'reload schema';

commit;
