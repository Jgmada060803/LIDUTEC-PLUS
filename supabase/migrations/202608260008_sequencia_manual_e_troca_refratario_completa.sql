begin;

-- Sequência da corrida passa a ser digitada pelo usuário (forno + ciclo já
-- são conhecidos e mudam pouco) em vez de sempre auto-incrementar.
create or replace function public.criar_corrida_fusao(
  p_forno_id bigint, p_turno text, p_numero_sequencia integer, p_itens jsonb
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

  if exists(select 1 from public.corridas_fusao where forno_id = p_forno_id and status not in ('TRANSFERIDA','CANCELADA')) then
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
  values (p_forno_id, v_ciclo.id, p_numero_sequencia, v_codigo, current_date, p_turno, auth.uid(), auth.uid())
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
drop function if exists public.criar_corrida_fusao(bigint,text,jsonb);
revoke all on function public.criar_corrida_fusao(bigint,text,integer,jsonb) from public,anon;
grant execute on function public.criar_corrida_fusao(bigint,text,integer,jsonb) to authenticated;

-- Troca de refratário ganha campos próprios (motivo, situação do forno e
-- observações), preenchidos numa tela dedicada — documentam por que/como
-- aquele ciclo foi encerrado.
alter table public.ciclos_refratario_fusao
  add column if not exists situacao_forno text,
  add column if not exists observacoes text;

create or replace function public.trocar_refratario_fusao(
  p_forno_id bigint, p_motivo text default null, p_situacao_forno text default null, p_observacoes text default null
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_novo_numero integer; v_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para registrar troca de refratário.';
  end if;
  update public.ciclos_refratario_fusao set
    encerrado_em = now(),
    motivo_encerramento = nullif(trim(p_motivo),''),
    situacao_forno = nullif(trim(p_situacao_forno),''),
    observacoes = nullif(trim(p_observacoes),'')
  where forno_id = p_forno_id and encerrado_em is null;
  select coalesce(max(numero_ciclo),0)+1 into v_novo_numero from public.ciclos_refratario_fusao where forno_id=p_forno_id;
  insert into public.ciclos_refratario_fusao(forno_id,numero_ciclo,iniciado_por)
  values(p_forno_id,v_novo_numero,auth.uid()) returning id into v_id;
  return v_id;
end;
$$;
drop function if exists public.trocar_refratario_fusao(bigint,text);
revoke all on function public.trocar_refratario_fusao(bigint,text,text,text) from public,anon;
grant execute on function public.trocar_refratario_fusao(bigint,text,text,text) to authenticated;

notify pgrst, 'reload schema';

commit;
