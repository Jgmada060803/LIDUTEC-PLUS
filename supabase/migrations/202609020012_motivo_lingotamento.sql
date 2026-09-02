-- Motivo do lingotamento (pedido explícito) — mesma lista fechada da
-- devolução de panela, mais "SETUP DE METAL".
alter table public.lingotamentos_vazamento add column motivo text;

drop function if exists public.iniciar_lingotamento_vazamento(timestamptz);
create or replace function public.iniciar_lingotamento_vazamento(p_horario timestamptz, p_motivo text)
returns table(id bigint, ciclo_inicio timestamptz, ciclo_fim timestamptz, peso_enviado_kg numeric, peso_consumido_teorico_kg numeric, peso_teorico_kg numeric)
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_aberta record;
  v_enviado numeric;
  v_consumido numeric;
  v_ciclo_inicio timestamptz;
  v_ciclo_fim timestamptz;
  v_id bigint;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar vazamento.';
  end if;
  if p_horario is null then raise exception 'Informe o horário do lingotamento.'; end if;
  if p_horario > now() + interval '30 minutes' then
    raise exception 'O horário do lingotamento não pode ser mais de 30 minutos no futuro.';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then raise exception 'Informe o motivo do lingotamento.'; end if;

  select * into v_aberta from public.panelas_holding
  where status = 'VAZADA' and hora_fim_vazamento is null for update;
  if found then
    if p_horario < v_aberta.hora_inicio_vazamento then
      raise exception 'O horário do lingotamento não pode ser antes do início do vazamento em andamento (%).',
        to_char(v_aberta.hora_inicio_vazamento, 'HH24:MI');
    end if;
    update public.panelas_holding set hora_fim_vazamento = p_horario, atualizado_em = now()
    where panelas_holding.id = v_aberta.id;
  end if;

  select coalesce(sum(p.peso_kg), 0), coalesce(sum(p.quantidade_moldes * pr.peso_cacho_kg), 0),
    min(p.hora_fim_vazamento), max(p.hora_fim_vazamento)
  into v_enviado, v_consumido, v_ciclo_inicio, v_ciclo_fim
  from public.panelas_holding p
  join public.produtos pr on pr.id = p.produto_id
  where p.status = 'VAZADA' and p.lingotamento_id is null;

  if coalesce(v_enviado, 0) = 0 then
    raise exception 'Nenhuma panela vazada desde o último lingotamento — nada para lingotar.';
  end if;

  insert into public.lingotamentos_vazamento(
    ciclo_inicio, ciclo_fim, peso_enviado_kg, peso_consumido_teorico_kg, peso_teorico_kg, motivo, criado_por
  ) values (
    v_ciclo_inicio, v_ciclo_fim, v_enviado, v_consumido, greatest(v_enviado - v_consumido, 0), trim(p_motivo), auth.uid()
  ) returning lingotamentos_vazamento.id into v_id;

  update public.panelas_holding
  set lingotamento_id = v_id
  where status = 'VAZADA' and lingotamento_id is null;

  return query select l.id, l.ciclo_inicio, l.ciclo_fim, l.peso_enviado_kg, l.peso_consumido_teorico_kg, l.peso_teorico_kg
    from public.lingotamentos_vazamento l where l.id = v_id;
end;
$$;

grant execute on function public.iniciar_lingotamento_vazamento(timestamptz, text) to authenticated;

-- Histórico de lingotamentos ganha o motivo também.
drop function if exists public.lingotamentos_recentes(integer);
create or replace function public.lingotamentos_recentes(p_limite integer default 20)
returns table(
  id bigint, ciclo_inicio timestamptz, ciclo_fim timestamptz, peso_teorico_kg numeric,
  peso_real_kg numeric, definido_em timestamptz, forno_destino_codigo text, motivo text
)
language sql stable
set search_path=pg_catalog,public as $$
  select l.id, l.ciclo_inicio, l.ciclo_fim, l.peso_teorico_kg, l.peso_real_kg, l.definido_em, f.codigo, l.motivo
  from public.lingotamentos_vazamento l
  left join public.fornos_fusao f on f.id = l.forno_destino_id
  order by l.ciclo_fim desc
  limit p_limite;
$$;
