-- Troca o corte por horário (ciclo_inicio/ciclo_fim comparado com
-- hora_fim_vazamento) por uma marcação explícita em cada panela — mais
-- robusto: uma panela com horário digitado fora de ordem (ex.: antes do
-- último lingotamento) não fica esquecida, porque o critério agora é
-- "ainda não foi contabilizada em nenhum lingotamento", não "aconteceu
-- depois de tal horário".

alter table public.panelas_holding
  add column lingotamento_id bigint references public.lingotamentos_vazamento(id);

create or replace function public.iniciar_lingotamento_vazamento()
returns table(id bigint, ciclo_inicio timestamptz, ciclo_fim timestamptz, peso_enviado_kg numeric, peso_consumido_teorico_kg numeric, peso_teorico_kg numeric)
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
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
    ciclo_inicio, ciclo_fim, peso_enviado_kg, peso_consumido_teorico_kg, peso_teorico_kg, criado_por
  ) values (
    v_ciclo_inicio, v_ciclo_fim, v_enviado, v_consumido, greatest(v_enviado - v_consumido, 0), auth.uid()
  ) returning lingotamentos_vazamento.id into v_id;

  update public.panelas_holding
  set lingotamento_id = v_id
  where status = 'VAZADA' and lingotamento_id is null;

  return query select l.id, l.ciclo_inicio, l.ciclo_fim, l.peso_enviado_kg, l.peso_consumido_teorico_kg, l.peso_teorico_kg
    from public.lingotamentos_vazamento l where l.id = v_id;
end;
$$;
