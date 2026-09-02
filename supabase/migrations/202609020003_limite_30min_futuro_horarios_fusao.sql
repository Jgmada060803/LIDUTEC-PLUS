-- Trava horários digitados (hora do tratamento no Holding, início/fim do
-- vazamento) que estourem mais de 30 minutos no futuro em relação ao
-- horário real do servidor — pedido explícito, evita erro de digitação
-- (ex.: hora errada) passar batido.

create or replace function public.criar_panela_holding(
  p_holding_corrida_id bigint, p_peso_kg numeric, p_hora_retirada timestamptz,
  p_fesimg_liga1_kg numeric default null, p_fesimg_liga4_kg numeric default null
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_forno record;
  v_ultima record;
  v_analise record;
  v_sequencia integer;
  v_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if coalesce(p_peso_kg, 0) <= 0 then raise exception 'Informe um peso maior que zero.'; end if;
  if p_hora_retirada is null then raise exception 'Informe o horário da retirada.'; end if;
  if p_hora_retirada > now() + interval '30 minutes' then
    raise exception 'O horário da retirada não pode ser mais de 30 minutos no futuro.';
  end if;

  select * into v_corrida from public.corridas_fusao where id = p_holding_corrida_id for update;
  if not found then raise exception 'Corrida do Holding não encontrada.'; end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'A corrida do Holding precisa estar aberta.'; end if;

  select * into v_forno from public.fornos_fusao where id = v_corrida.forno_id;
  if v_forno.tipo <> 'HOLDING' then raise exception 'Esta corrida não é de um Holding.'; end if;

  select coalesce(max(sequencial), 0) + 1 into v_sequencia
  from public.panelas_holding where holding_corrida_id = p_holding_corrida_id;

  select panela.* into v_ultima
  from public.panelas_holding panela
  join public.corridas_fusao corrida on corrida.id = panela.holding_corrida_id
  where corrida.forno_id = v_forno.id and panela.status <> 'REJEITADA'
  order by panela.criado_em desc limit 1;

  select * into v_analise from public.analises_termicas_holding
  where forno_id = v_forno.id order by medido_em desc limit 1;

  insert into public.panelas_holding(
    holding_corrida_id, sequencial, produto_id, hora_retirada, peso_kg,
    temperatura_c, carbono_equivalente, fesimg_liga1_kg, fesimg_liga4_kg,
    inoculante_kg, silicio_kg, grafite_kg, sucata_cobertura_kg, criado_por
  ) values (
    p_holding_corrida_id, v_sequencia, v_corrida.produto_id, p_hora_retirada, p_peso_kg,
    v_ultima.temperatura_c, v_analise.carbono_equivalente, p_fesimg_liga1_kg, p_fesimg_liga4_kg,
    v_ultima.inoculante_kg, v_ultima.silicio_kg, v_ultima.grafite_kg, v_ultima.sucata_cobertura_kg, auth.uid()
  ) returning id into v_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (p_holding_corrida_id, auth.uid(), format('retirou a panela Nº %s do Holding (%s kg)', v_sequencia, p_peso_kg));

  return v_id;
end;
$$;

create or replace function public.atualizar_hora_retirada_panela_holding(p_panela_id bigint, p_hora_retirada timestamptz)
returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_panela record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_hora_retirada is null then raise exception 'Informe o horário da retirada.'; end if;
  if p_hora_retirada > now() + interval '30 minutes' then
    raise exception 'O horário da retirada não pode ser mais de 30 minutos no futuro.';
  end if;
  select * into v_panela from public.panelas_holding where id = p_panela_id;
  if not found then raise exception 'Panela não encontrada.'; end if;

  update public.panelas_holding set hora_retirada = p_hora_retirada, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format('alterou o horário de retirada da panela Nº %s', v_panela.sequencial));
end;
$$;

create or replace function public.apontar_vazamento_panela(
  p_panela_id bigint, p_inicio timestamptz, p_fim timestamptz, p_temperatura_c numeric,
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
  if p_inicio is null or p_fim is null then raise exception 'Informe início e fim do vazamento.'; end if;
  if p_inicio > now() + interval '30 minutes' then
    raise exception 'O horário de início do vazamento não pode ser mais de 30 minutos no futuro.';
  end if;
  if p_fim > now() + interval '30 minutes' then
    raise exception 'O horário de fim do vazamento não pode ser mais de 30 minutos no futuro.';
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
    hora_inicio_vazamento = p_inicio, hora_fim_vazamento = p_fim,
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
