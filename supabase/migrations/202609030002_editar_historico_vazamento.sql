-- Edição do histórico de panelas vazadas (pedido explícito) — corrige
-- erro de digitação depois do apontamento. Três RPCs, por tipo de campo:
-- numérico simples (com recálculo de quantidade_moldes quando é molde
-- inicial/final), texto (inoculador) e horário (com validação de ordem
-- entre panelas vizinhas — "respeitar o FIFO" da panela vazadora
-- contínua, mesma regra já aplicada na hora do apontamento original).

create or replace function public.atualizar_campo_vazamento_panela(p_panela_id bigint, p_campo text, p_valor numeric)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_panela record;
  v_anterior numeric;
  v_label text;
  v_novo_inicial integer;
  v_novo_final integer;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_panela from public.panelas_holding where id = p_panela_id;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if v_panela.status <> 'VAZADA' then raise exception 'Só é possível editar panelas já vazadas.'; end if;
  if p_campo not in ('temperatura_vazamento_c', 'inoculante_vazamento_g_s', 'molde_inicial', 'molde_final') then
    raise exception 'Campo inválido.';
  end if;

  v_label := case p_campo
    when 'temperatura_vazamento_c' then 'a temperatura de vazamento'
    when 'inoculante_vazamento_g_s' then 'o inoculante (g/s)'
    when 'molde_inicial' then 'o molde inicial'
    else 'o molde final'
  end;
  v_anterior := case p_campo
    when 'temperatura_vazamento_c' then v_panela.temperatura_vazamento_c
    when 'inoculante_vazamento_g_s' then v_panela.inoculante_vazamento_g_s
    when 'molde_inicial' then v_panela.molde_inicial
    else v_panela.molde_final
  end;

  v_novo_inicial := case when p_campo = 'molde_inicial' then p_valor::integer else v_panela.molde_inicial end;
  v_novo_final := case when p_campo = 'molde_final' then p_valor::integer else v_panela.molde_final end;
  if p_campo in ('molde_inicial', 'molde_final') and v_novo_inicial is not null and v_novo_final is not null
     and v_novo_final < v_novo_inicial then
    raise exception 'O molde final não pode ser menor que o molde inicial.';
  end if;

  execute format('update public.panelas_holding set %I = $1, atualizado_por = auth.uid(), atualizado_em = now() where id = $2', p_campo)
    using p_valor, p_panela_id;

  if p_campo in ('molde_inicial', 'molde_final') then
    update public.panelas_holding
    set quantidade_moldes = case when v_novo_inicial is not null and v_novo_final is not null then v_novo_final - v_novo_inicial + 1 else null end
    where id = p_panela_id;
  end if;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format('alterou %s da panela vazada Nº %s de %s para %s',
    v_label, v_panela.sequencial, coalesce(v_anterior::text, '—'), coalesce(p_valor::text, '—')));
end;
$$;

grant execute on function public.atualizar_campo_vazamento_panela(bigint, text, numeric) to authenticated;

create or replace function public.atualizar_inoculador_vazamento_panela(p_panela_id bigint, p_inoculador text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_panela record;
  v_valor text;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_panela from public.panelas_holding where id = p_panela_id;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if v_panela.status <> 'VAZADA' then raise exception 'Só é possível editar panelas já vazadas.'; end if;
  v_valor := nullif(trim(p_inoculador), '');
  if v_valor is not null and v_valor not in ('MV01', 'MV02') then
    raise exception 'Inoculador inválido.';
  end if;
  update public.panelas_holding
  set inoculador_vazamento = v_valor, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;
  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format('alterou o inoculador da panela vazada Nº %s de %s para %s',
    v_panela.sequencial, coalesce(v_panela.inoculador_vazamento, '—'), coalesce(v_valor, '—')));
end;
$$;

grant execute on function public.atualizar_inoculador_vazamento_panela(bigint, text) to authenticated;

create or replace function public.atualizar_horario_vazamento_panela(p_panela_id bigint, p_campo text, p_horario timestamptz)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_panela record;
  v_anterior record;
  v_posterior record;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_campo not in ('inicio', 'fim') then raise exception 'Campo inválido.'; end if;
  if p_horario is null then raise exception 'Informe o horário.'; end if;
  if p_horario > now() + interval '30 minutes' then
    raise exception 'O horário não pode ser mais de 30 minutos no futuro.';
  end if;

  select * into v_panela from public.panelas_holding where id = p_panela_id for update;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if v_panela.status <> 'VAZADA' then raise exception 'Só é possível editar panelas já vazadas.'; end if;

  if p_campo = 'inicio' then
    if p_horario < v_panela.hora_retirada then
      raise exception 'O início do vazamento não pode ser antes da hora do tratamento.';
    end if;
    if v_panela.hora_fim_vazamento is not null and p_horario >= v_panela.hora_fim_vazamento then
      raise exception 'O início não pode ser depois (ou igual) do fim desta mesma panela.';
    end if;
    select * into v_anterior from public.panelas_holding
    where status = 'VAZADA' and id <> p_panela_id and hora_inicio_vazamento < v_panela.hora_inicio_vazamento
    order by hora_inicio_vazamento desc limit 1;
    if found and v_anterior.hora_fim_vazamento is not null and p_horario < v_anterior.hora_fim_vazamento then
      raise exception 'O início não pode ser antes do fim da panela anterior (ordem do vazamento).';
    end if;
    update public.panelas_holding set hora_inicio_vazamento = p_horario, atualizado_por = auth.uid(), atualizado_em = now()
    where id = p_panela_id;
  else
    if v_panela.hora_fim_vazamento is null then
      raise exception 'Esta panela ainda está em andamento — o fim é definido automaticamente pela próxima panela ou pelo lingotamento.';
    end if;
    if p_horario <= v_panela.hora_inicio_vazamento then
      raise exception 'O fim não pode ser antes (ou igual) do início desta mesma panela.';
    end if;
    select * into v_posterior from public.panelas_holding
    where status = 'VAZADA' and id <> p_panela_id and hora_inicio_vazamento > v_panela.hora_inicio_vazamento
    order by hora_inicio_vazamento asc limit 1;
    if found and p_horario > v_posterior.hora_inicio_vazamento then
      raise exception 'O fim não pode ser depois do início da próxima panela (ordem do vazamento).';
    end if;
    update public.panelas_holding set hora_fim_vazamento = p_horario, atualizado_por = auth.uid(), atualizado_em = now()
    where id = p_panela_id;
  end if;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format('alterou o horário de %s do vazamento da panela Nº %s para %s',
    case p_campo when 'inicio' then 'início' else 'fim' end, v_panela.sequencial, to_char(p_horario, 'DD/MM HH24:MI')));
end;
$$;

grant execute on function public.atualizar_horario_vazamento_panela(bigint, text, timestamptz) to authenticated;
