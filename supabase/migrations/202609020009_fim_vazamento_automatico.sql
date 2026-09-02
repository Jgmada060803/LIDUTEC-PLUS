-- Uma panela vaza até o início da próxima (ou até o lingotamento) — o
-- operador não sabe o horário de fim na hora que confirma o início, só
-- descobre depois. "Vazar" passa a pedir só o início; o sistema fecha
-- sozinho a panela que estava em aberto (a última sem fim ainda),
-- usando esse início como o fim dela. "Lingotar" passa a exigir que o
-- operador informe o horário real do lingotamento (não confia em "agora"
-- só — pode ter passado um tempo desde que o problema aconteceu de
-- verdade até alguém lançar no sistema), e usa esse horário pra fechar a
-- última panela em aberto também.

drop function if exists public.apontar_vazamento_panela(bigint, timestamptz, timestamptz, numeric, integer, integer, text, numeric, date);
create or replace function public.apontar_vazamento_panela(
  p_panela_id bigint, p_inicio timestamptz, p_temperatura_c numeric,
  p_molde_inicial integer, p_molde_final integer,
  p_inoculador text default null, p_inoculante_g_s numeric default null,
  p_dia_operacional date default null
) returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_panela record;
  v_corrida record;
  v_sequencia integer;
  v_dia date;
  v_codigo_mascarado text;
  v_mais_antiga record;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar vazamento.';
  end if;
  if p_inicio is null then raise exception 'Informe o início do vazamento.'; end if;
  if p_inicio > now() + interval '30 minutes' then
    raise exception 'O horário de início do vazamento não pode ser mais de 30 minutos no futuro.';
  end if;
  if p_molde_inicial is null or p_molde_final is null then raise exception 'Informe o molde inicial e o final.'; end if;
  if p_molde_final < p_molde_inicial then raise exception 'O molde final não pode ser menor que o inicial.'; end if;
  if p_inoculador is not null and p_inoculador not in ('MV01', 'MV02') then
    raise exception 'Inoculador inválido.';
  end if;

  select * into v_panela from public.panelas_holding where id = p_panela_id for update;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if v_panela.status not in ('SAIDA_HOLDING','EM_TRANSITO') then
    raise exception 'Esta panela não está mais aguardando vazamento.';
  end if;

  select sequencial, hora_retirada into v_mais_antiga
  from public.panelas_holding
  where status in ('SAIDA_HOLDING','EM_TRANSITO') and hora_retirada < v_panela.hora_retirada
  order by hora_retirada asc limit 1;
  if found then
    raise exception 'Existe uma panela retirada mais cedo (Nº %, %) ainda aguardando — vaze-a primeiro.',
      v_mais_antiga.sequencial, to_char(v_mais_antiga.hora_retirada, 'HH24:MI');
  end if;

  -- Fecha quem estava vazando antes desta — o fim dela é o início desta.
  update public.panelas_holding
  set hora_fim_vazamento = p_inicio, atualizado_em = now()
  where status = 'VAZADA' and hora_fim_vazamento is null;

  select * into v_corrida from public.corridas_fusao where id = v_panela.holding_corrida_id;

  v_dia := coalesce(p_dia_operacional, p_inicio::date);
  select coalesce(max(sequencial_vazamento), 0) + 1 into v_sequencia
  from public.panelas_holding where vazamento_dia = v_dia;

  v_codigo_mascarado := case
    when length(v_corrida.codigo) <= 6 then v_corrida.codigo
    else left(v_corrida.codigo, length(v_corrida.codigo) - 6)
      || '.' || substr(v_corrida.codigo, length(v_corrida.codigo) - 5, 3)
      || '.' || right(v_corrida.codigo, 3)
  end;

  update public.panelas_holding
  set status = 'VAZADA', sequencial_vazamento = v_sequencia, vazamento_dia = v_dia,
    hora_inicio_vazamento = p_inicio, hora_fim_vazamento = null,
    temperatura_vazamento_c = p_temperatura_c,
    molde_inicial = p_molde_inicial, molde_final = p_molde_final,
    quantidade_moldes = p_molde_final - p_molde_inicial + 1,
    inoculador_vazamento = p_inoculador, inoculante_vazamento_g_s = p_inoculante_g_s,
    atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format(
    'vazou a panela Nº %s do Holding (%s-V%s) — moldes %s a %s (%s moldes)',
    v_panela.sequencial, v_codigo_mascarado, v_sequencia, p_molde_inicial, p_molde_final, p_molde_final - p_molde_inicial + 1
  ));
end;
$$;

grant execute on function public.apontar_vazamento_panela(bigint,timestamptz,numeric,integer,integer,text,numeric,date) to authenticated;

drop function if exists public.iniciar_lingotamento_vazamento();
create or replace function public.iniciar_lingotamento_vazamento(p_horario timestamptz)
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

  select * into v_aberta from public.panelas_holding
  where status = 'VAZADA' and hora_fim_vazamento is null for update;
  if found then
    if p_horario < v_aberta.hora_inicio_vazamento then
      raise exception 'O horário do lingotamento não pode ser antes do início do vazamento em andamento (%).',
        to_char(v_aberta.hora_inicio_vazamento, 'HH24:MI');
    end if;
    update public.panelas_holding set hora_fim_vazamento = p_horario, atualizado_em = now() where id = v_aberta.id;
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

grant execute on function public.iniciar_lingotamento_vazamento(timestamptz) to authenticated;
