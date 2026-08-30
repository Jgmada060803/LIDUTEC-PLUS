begin;

-- Histórico de alterações estava incompleto: transferências e panelas do
-- Holding não geravam nenhum registro. Pedido explícito: "ajustes que
-- foram realizados no geral" precisam aparecer ali, incluindo a
-- transferência com o mesmo nível de detalhe da tela de confirmação.

-- Criar panela já loga a retirada; e passa a aceitar FeSiMg Liga 1/4 como
-- parâmetro (a tela agora mostra esses dois campos já na hora de criar,
-- pré-preenchidos com o valor da última panela — mas editáveis antes de
-- confirmar). Os demais campos herdados continuam vindo só do banco.
create or replace function public.criar_panela_holding(
  p_holding_corrida_id bigint, p_peso_kg numeric, p_hora_retirada timestamptz,
  p_fesimg_liga1_kg numeric default null, p_fesimg_liga4_kg numeric default null
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_forno record;
  v_ultima record;
  v_sequencia integer;
  v_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if coalesce(p_peso_kg, 0) <= 0 then raise exception 'Informe um peso maior que zero.'; end if;
  if p_hora_retirada is null then raise exception 'Informe o horário da retirada.'; end if;

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

  insert into public.panelas_holding(
    holding_corrida_id, sequencial, produto_id, hora_retirada, peso_kg,
    temperatura_c, carbono_equivalente, fesimg_liga1_kg, fesimg_liga4_kg,
    inoculante_kg, silicio_kg, grafite_kg, sucata_cobertura_kg, criado_por
  ) values (
    p_holding_corrida_id, v_sequencia, v_corrida.produto_id, p_hora_retirada, p_peso_kg,
    v_ultima.temperatura_c, v_ultima.carbono_equivalente, p_fesimg_liga1_kg, p_fesimg_liga4_kg,
    v_ultima.inoculante_kg, v_ultima.silicio_kg, v_ultima.grafite_kg, v_ultima.sucata_cobertura_kg, auth.uid()
  ) returning id into v_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (p_holding_corrida_id, auth.uid(), format('retirou a panela Nº %s do Holding (%s kg)', v_sequencia, p_peso_kg));

  return v_id;
end;
$$;

revoke all on function public.criar_panela_holding(bigint,numeric,timestamptz) from public, anon;
revoke all on function public.criar_panela_holding(bigint,numeric,timestamptz,numeric,numeric) from public, anon;
grant execute on function public.criar_panela_holding(bigint,numeric,timestamptz,numeric,numeric) to authenticated;
drop function if exists public.criar_panela_holding(bigint,numeric,timestamptz);

-- Edição de qualquer campo da panela (inclui peso e as duas ligas de
-- FeSiMg, que é o "peso de liga" citado) passa a registrar de/para.
create or replace function public.atualizar_campo_panela_holding(
  p_panela_id bigint, p_campo text, p_valor numeric
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_panela record;
  v_anterior numeric;
  v_label text;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_panela from public.panelas_holding where id = p_panela_id;
  if not found then raise exception 'Panela não encontrada.'; end if;
  if p_campo not in (
    'peso_kg','temperatura_c','carbono_equivalente','fesimg_liga1_kg','fesimg_liga4_kg',
    'inoculante_kg','silicio_kg','grafite_kg','sucata_cobertura_kg'
  ) then
    raise exception 'Campo inválido.';
  end if;
  if p_campo = 'peso_kg' and coalesce(p_valor, 0) <= 0 then
    raise exception 'Peso precisa ser maior que zero.';
  end if;

  v_label := case p_campo
    when 'peso_kg' then 'o peso'
    when 'temperatura_c' then 'a temperatura'
    when 'carbono_equivalente' then 'o CE'
    when 'fesimg_liga1_kg' then 'o FeSiMg Liga 1'
    when 'fesimg_liga4_kg' then 'o FeSiMg Liga 4'
    when 'inoculante_kg' then 'o inoculante'
    when 'silicio_kg' then 'o silício'
    when 'grafite_kg' then 'o grafite'
    else 'a sucata de cobertura'
  end;
  v_anterior := case p_campo
    when 'peso_kg' then v_panela.peso_kg
    when 'temperatura_c' then v_panela.temperatura_c
    when 'carbono_equivalente' then v_panela.carbono_equivalente
    when 'fesimg_liga1_kg' then v_panela.fesimg_liga1_kg
    when 'fesimg_liga4_kg' then v_panela.fesimg_liga4_kg
    when 'inoculante_kg' then v_panela.inoculante_kg
    when 'silicio_kg' then v_panela.silicio_kg
    when 'grafite_kg' then v_panela.grafite_kg
    else v_panela.sucata_cobertura_kg
  end;

  execute format('update public.panelas_holding set %I = $1, atualizado_por = auth.uid(), atualizado_em = now() where id = $2', p_campo)
    using p_valor, p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format('alterou %s da panela Nº %s de %s para %s',
    v_label, v_panela.sequencial, coalesce(v_anterior::text, '—'), coalesce(p_valor::text, '—')));
end;
$$;

revoke all on function public.atualizar_campo_panela_holding(bigint,text,numeric) from public, anon;
grant execute on function public.atualizar_campo_panela_holding(bigint,text,numeric) to authenticated;

create or replace function public.atualizar_hora_retirada_panela_holding(
  p_panela_id bigint, p_hora_retirada timestamptz
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_panela record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_hora_retirada is null then raise exception 'Informe o horário da retirada.'; end if;
  select * into v_panela from public.panelas_holding where id = p_panela_id;
  if not found then raise exception 'Panela não encontrada.'; end if;

  update public.panelas_holding set hora_retirada = p_hora_retirada, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_panela_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (v_panela.holding_corrida_id, auth.uid(), format('alterou o horário de retirada da panela Nº %s', v_panela.sequencial));
end;
$$;

revoke all on function public.atualizar_hora_retirada_panela_holding(bigint,timestamptz) from public, anon;
grant execute on function public.atualizar_hora_retirada_panela_holding(bigint,timestamptz) to authenticated;

-- Temperatura programada também é um "ajuste" que precisa aparecer.
create or replace function public.atualizar_temperatura_programada_fusao(
  p_corrida_id bigint, p_temperatura_c numeric
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_corrida record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Só é possível informar isso numa corrida aberta.'; end if;

  update public.corridas_fusao
  set temperatura_programada_c = p_temperatura_c, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (p_corrida_id, auth.uid(), format('atualizou a temperatura programada para %s',
    case when p_temperatura_c is null then '—' else p_temperatura_c::text || ' °C' end));
end;
$$;

revoke all on function public.atualizar_temperatura_programada_fusao(bigint,numeric) from public, anon;
grant execute on function public.atualizar_temperatura_programada_fusao(bigint,numeric) to authenticated;

-- Transferência passa a registrar dos dois lados (origem perdeu, destino
-- recebeu), com o mesmo detalhe (quantidade, forno/corrida do outro lado)
-- que já aparece na tela de confirmação.
create or replace function public.transferir_metal_fusao(
  p_corrida_origem_id bigint, p_forno_destino_id bigint, p_quantidade_kg numeric
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_origem record;
  v_destino record;
  v_forno_origem record;
  v_forno_destino record;
  v_disponivel numeric;
  v_saldo_destino numeric;
  v_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if coalesce(p_quantidade_kg, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;

  select * into v_origem from public.corridas_fusao where id = p_corrida_origem_id for update;
  if not found then raise exception 'Corrida de origem não encontrada.'; end if;
  if v_origem.status <> 'ABERTA' then raise exception 'A corrida de origem precisa estar aberta.'; end if;
  if v_origem.forno_id = p_forno_destino_id then raise exception 'O forno destino precisa ser diferente do forno de origem.'; end if;

  v_disponivel := public.volume_atual_forno_fusao(v_origem.forno_id);
  if p_quantidade_kg > v_disponivel then
    raise exception 'Quantidade maior que o volume disponível no forno (% kg).', v_disponivel;
  end if;

  select * into v_destino from public.corridas_fusao where forno_id = p_forno_destino_id and status = 'ABERTA';
  if not found then raise exception 'O forno destino não tem corrida aberta.'; end if;

  select * into v_forno_destino from public.fornos_fusao where id = p_forno_destino_id;
  if v_forno_destino.capacidade_kg is not null then
    v_saldo_destino := public.volume_atual_forno_fusao(p_forno_destino_id) + p_quantidade_kg;
    if v_saldo_destino > v_forno_destino.capacidade_kg then
      raise exception 'A transferência ultrapassa a capacidade do forno destino (% kg de % kg).', v_saldo_destino, v_forno_destino.capacidade_kg;
    end if;
  end if;

  select * into v_forno_origem from public.fornos_fusao where id = v_origem.forno_id;

  insert into public.transferencias_fusao(corrida_origem_id, corrida_destino_id, quantidade_kg, registrado_por)
  values (p_corrida_origem_id, v_destino.id, p_quantidade_kg, auth.uid())
  returning id into v_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao) values
    (p_corrida_origem_id, auth.uid(), format('transferiu %s kg para %s (corrida %s)', p_quantidade_kg, v_forno_destino.codigo, v_destino.codigo)),
    (v_destino.id, auth.uid(), format('recebeu %s kg do forno %s (corrida %s)', p_quantidade_kg, v_forno_origem.codigo, v_origem.codigo));

  return v_id;
end;
$$;

-- Editar/remover transferência também precisam aparecer no histórico.
create or replace function public.editar_transferencia_fusao(p_transferencia_id bigint, p_quantidade_kg numeric)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_transferencia record;
  v_origem record;
  v_destino record;
  v_disponivel numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if coalesce(p_quantidade_kg, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;

  select * into v_transferencia from public.transferencias_fusao where id = p_transferencia_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  select * into v_origem from public.corridas_fusao where id = v_transferencia.corrida_origem_id;
  select * into v_destino from public.corridas_fusao where id = v_transferencia.corrida_destino_id;
  if v_origem.status <> 'ABERTA' or v_destino.status <> 'ABERTA' then
    raise exception 'Só é possível editar a transferência enquanto a corrida de origem e a de destino estiverem abertas.';
  end if;

  v_disponivel := public.volume_atual_forno_fusao(v_origem.forno_id) + v_transferencia.quantidade_kg;
  if p_quantidade_kg > v_disponivel then
    raise exception 'Quantidade maior que o volume disponível no forno (% kg).', v_disponivel;
  end if;

  update public.transferencias_fusao set quantidade_kg = p_quantidade_kg where id = p_transferencia_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao) values
    (v_origem.id, auth.uid(), format('alterou a transferência para %s de %s kg para %s kg', v_destino.codigo, v_transferencia.quantidade_kg, p_quantidade_kg)),
    (v_destino.id, auth.uid(), format('alterou a transferência recebida de %s de %s kg para %s kg', v_origem.codigo, v_transferencia.quantidade_kg, p_quantidade_kg));
end;
$$;

create or replace function public.remover_transferencia_fusao(p_transferencia_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_transferencia record;
  v_origem record;
  v_destino record;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_transferencia from public.transferencias_fusao where id = p_transferencia_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  select * into v_origem from public.corridas_fusao where id = v_transferencia.corrida_origem_id;
  select * into v_destino from public.corridas_fusao where id = v_transferencia.corrida_destino_id;
  if v_origem.status <> 'ABERTA' or v_destino.status <> 'ABERTA' then
    raise exception 'Só é possível remover a transferência enquanto a corrida de origem e a de destino estiverem abertas.';
  end if;
  delete from public.transferencias_fusao where id = p_transferencia_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao) values
    (v_origem.id, auth.uid(), format('removeu a transferência de %s kg para %s', v_transferencia.quantidade_kg, v_destino.codigo)),
    (v_destino.id, auth.uid(), format('removeu a transferência recebida de %s kg de %s', v_transferencia.quantidade_kg, v_origem.codigo));
end;
$$;

notify pgrst, 'reload schema';

commit;
