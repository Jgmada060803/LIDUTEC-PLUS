begin;

-- Até aqui, uma parada programada só nascia "recorrente" (vigencia_fim nulo,
-- indefinida) — a única forma de dar um fim a ela era encerrar depois, a
-- partir de hoje. Agora dá pra já cadastrar com uma data de validade (ex.:
-- uma manutenção preventiva programada só até o fim do mês).
create or replace function public.definir_parada_programada(
  p_area_id bigint,
  p_linha_maquina_id bigint,
  p_equipamento_planejamento_id bigint,
  p_turno text,
  p_tipo_parada_codigo text,
  p_horario_inicial time,
  p_horario_final time,
  p_dias_semana smallint[],
  p_vigencia_inicio date,
  p_vigencia_fim date default null
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_id bigint;
begin
  if not public.usuario_tem_permissao_metas('metas.gerenciar') then
    raise exception 'Usuário sem permissão para gerenciar paradas programadas.';
  end if;
  if p_turno is not null and p_turno not in ('MANHA','TARDE','NOITE') then
    raise exception 'Turno inválido.';
  end if;
  if p_linha_maquina_id is not null and p_equipamento_planejamento_id is not null then
    raise exception 'Selecione apenas uma unidade de trabalho: linha ou equipamento.';
  end if;
  if p_dias_semana is null or array_length(p_dias_semana,1) is null then
    raise exception 'Selecione ao menos um dia da semana.';
  end if;
  if p_vigencia_fim is not null and p_vigencia_fim < p_vigencia_inicio then
    raise exception 'A data de validade não pode ser anterior ao início da vigência.';
  end if;

  update public.paradas_programadas set vigencia_fim = p_vigencia_inicio - 1
  where area_id=p_area_id
    and coalesce(linha_maquina_id,-1)=coalesce(p_linha_maquina_id,-1)
    and coalesce(equipamento_planejamento_id,-1)=coalesce(p_equipamento_planejamento_id,-1)
    and coalesce(turno,'-')=coalesce(p_turno,'-')
    and tipo_parada_codigo=p_tipo_parada_codigo
    and vigencia_fim is null
    and vigencia_inicio < p_vigencia_inicio;

  insert into public.paradas_programadas(
    area_id,linha_maquina_id,equipamento_planejamento_id,turno,tipo_parada_codigo,horario_inicial,horario_final,dias_semana,vigencia_inicio,vigencia_fim,criado_por
  ) values (
    p_area_id,p_linha_maquina_id,p_equipamento_planejamento_id,p_turno,p_tipo_parada_codigo,p_horario_inicial,p_horario_final,p_dias_semana,p_vigencia_inicio,p_vigencia_fim,auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.definir_parada_programada(bigint,bigint,bigint,text,text,time,time,smallint[],date,date) from public,anon;
grant execute on function public.definir_parada_programada(bigint,bigint,bigint,text,text,time,time,smallint[],date,date) to authenticated;
drop function if exists public.definir_parada_programada(bigint,bigint,bigint,text,text,time,time,smallint[],date);

notify pgrst,'reload schema';

commit;
