begin;

-- Pedido explícito: corrida só tem 2 status (Aberta/Fechada) — sem
-- "Cancelada". No lugar de cancelar, uma corrida aberta por engano agora se
-- EXCLUI de vez (só permitido sem pesagem/transferência registrada; com
-- dado real, precisa ser fechada normalmente, nunca apagada).
-- Aproveitando a limpeza, zera os dados de teste de novo e guarda o último
-- número real de corrida praticado por forno (sem precisar de uma corrida
-- "semente" fake pra isso) — próxima corrida sai F1 248, F2 13, H1 51, H2 122.

delete from public.transferencias_fusao;
delete from public.corridas_fusao; -- cascade: carga_itens, pesagens_ponte_log, mensagens, alteracoes

alter table public.ciclos_refratario_fusao
  add column if not exists numero_sequencia_inicial integer not null default 0;

update public.ciclos_refratario_fusao c
set numero_sequencia_inicial = v.numero
from (values ('F1',247), ('F2',12), ('H1',50), ('H2',121)) as v(codigo, numero)
join public.fornos_fusao f on f.codigo = v.codigo
where c.forno_id = f.id and c.encerrado_em is null;

alter table public.corridas_fusao
  add column if not exists saldo_forno_no_fechamento_kg numeric;

-- Sequência passa a considerar o número inicial do ciclo quando ainda não
-- existe nenhuma corrida real nele (em vez de sempre começar do zero).
create or replace function public.criar_corrida_fusao(
  p_forno_id bigint, p_turno text, p_data_operacional date, p_produto_id bigint,
  p_inicio timestamp with time zone, p_itens jsonb default '[]'::jsonb
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_ciclo record;
  v_forno record;
  v_sequencia integer;
  v_codigo text;
  v_corrida_id bigint;
  v_sobra numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_turno not in ('MANHA','TARDE','NOITE') then raise exception 'Turno inválido.'; end if;
  if p_data_operacional is null then raise exception 'Informe a data operacional.'; end if;
  if p_produto_id is null then raise exception 'Informe o produto.'; end if;
  if p_inicio is null then raise exception 'Informe o horário de início.'; end if;
  if not exists(select 1 from public.produtos where id = p_produto_id) then raise exception 'Produto inválido.'; end if;

  if exists(
    select 1 from jsonb_to_recordset(coalesce(p_itens,'[]'::jsonb)) as item(material_id bigint, quantidade_planejada_kg numeric, estado_fisico text)
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

  v_sobra := public.volume_atual_forno_fusao(p_forno_id);

  select * into v_ciclo from public.ciclos_refratario_fusao where forno_id = p_forno_id and encerrado_em is null for update;
  if not found then
    insert into public.ciclos_refratario_fusao(forno_id, numero_ciclo, iniciado_por)
    values (p_forno_id, 1, auth.uid())
    returning * into v_ciclo;
  end if;

  select coalesce(max(numero_sequencia), v_ciclo.numero_sequencia_inicial) + 1 into v_sequencia
  from public.corridas_fusao where ciclo_refratario_id = v_ciclo.id;
  v_codigo := v_forno.codigo || lpad(v_ciclo.numero_ciclo::text, 3, '0') || lpad(v_sequencia::text, 3, '0');

  insert into public.corridas_fusao(forno_id, ciclo_refratario_id, numero_sequencia, codigo, data_operacional, turno, produto_id, inicio, sobra_inicial_kg, criado_por, atualizado_por)
  values (p_forno_id, v_ciclo.id, v_sequencia, v_codigo, p_data_operacional, p_turno, p_produto_id, p_inicio, v_sobra, auth.uid(), auth.uid())
  returning id into v_corrida_id;

  insert into public.corridas_fusao_carga_itens(corrida_id, material_id, quantidade_planejada_kg, estado_fisico)
  select v_corrida_id, item.material_id, item.quantidade_planejada_kg,
    case when material.tipo = 'GUSA' then item.estado_fisico else null end
  from rows from (
    jsonb_to_recordset(coalesce(p_itens,'[]'::jsonb)) as (material_id bigint, quantidade_planejada_kg numeric, estado_fisico text)
  ) with ordinality as item(material_id, quantidade_planejada_kg, estado_fisico, ord)
  join public.materiais_fusao material on material.id = item.material_id
  where item.material_id is not null and item.quantidade_planejada_kg >= 0
  order by item.ord;

  return v_corrida_id;
end;
$$;

-- Fechar corrida agora congela o saldo do forno naquele instante — uma
-- corrida fechada não deve mais "mudar" na tela conforme o forno segue
-- sendo usado depois (pedido explícito).
create or replace function public.fechar_corrida_fusao(
  p_corrida_id bigint, p_versao bigint, p_fim timestamp with time zone
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_movimentado numeric;
  v_saldo numeric;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  if p_fim is null then raise exception 'Informe o horário de fim.'; end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id for update;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.versao <> p_versao then
    raise exception 'CONFLITO_RASCUNHO: a corrida foi atualizada por outro usuário.' using errcode = '40001';
  end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Esta corrida não está aberta.'; end if;

  select
    coalesce((select sum(quantidade_realizada_kg) from public.corridas_fusao_carga_itens where corrida_id = p_corrida_id), 0)
    + coalesce((select sum(quantidade_kg) from public.transferencias_fusao where corrida_destino_id = p_corrida_id), 0)
    + coalesce((select sum(quantidade_kg) from public.transferencias_fusao where corrida_origem_id = p_corrida_id), 0)
  into v_movimentado;
  if v_movimentado <= 10000 then
    raise exception 'É preciso movimentar mais de 10.000 kg (carregado + transferido) antes de fechar a corrida. Movimentado até agora: % kg.', v_movimentado;
  end if;

  v_saldo := public.volume_atual_forno_fusao(v_corrida.forno_id);

  update public.corridas_fusao
  set status = 'FECHADA', fim = p_fim, saldo_forno_no_fechamento_kg = v_saldo,
    versao = versao + 1, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;
end;
$$;

-- Sem "Cancelada": corrida aberta por engano se exclui de vez (só sem
-- pesagem/transferência registrada — com dado real, tem que ser fechada).
drop function if exists public.cancelar_corrida_fusao(bigint, bigint);

create or replace function public.excluir_corrida_fusao(p_corrida_id bigint, p_versao bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_corrida record; v_tem_dado boolean;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id for update;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.versao <> p_versao then
    raise exception 'CONFLITO_RASCUNHO: a corrida foi atualizada por outro usuário.' using errcode = '40001';
  end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Só é possível excluir uma corrida aberta.'; end if;
  select exists(
    select 1 from public.corridas_fusao_carga_itens where corrida_id = p_corrida_id and coalesce(quantidade_realizada_kg,0) > 0
    union all
    select 1 from public.transferencias_fusao where corrida_origem_id = p_corrida_id or corrida_destino_id = p_corrida_id
  ) into v_tem_dado;
  if v_tem_dado then
    raise exception 'Esta corrida já tem pesagem ou transferência registrada — não é possível excluir, feche-a normalmente.';
  end if;
  delete from public.corridas_fusao where id = p_corrida_id;
end;
$$;

revoke all on function public.excluir_corrida_fusao(bigint,bigint) from public, anon;
grant execute on function public.excluir_corrida_fusao(bigint,bigint) to authenticated;

-- Sem status Cancelada, essa condição nunca mais exclui nada — limpa.
create or replace function public.volume_atual_forno_fusao(p_forno_id bigint)
returns numeric language sql stable set search_path = pg_catalog, public as $$
  select
    coalesce((
      select sum(item.quantidade_realizada_kg)
      from public.corridas_fusao_carga_itens item
      join public.corridas_fusao corrida on corrida.id = item.corrida_id
      where corrida.forno_id = p_forno_id
    ), 0)
    + coalesce((
      select sum(transferencia.quantidade_kg)
      from public.transferencias_fusao transferencia
      join public.corridas_fusao destino on destino.id = transferencia.corrida_destino_id
      where destino.forno_id = p_forno_id
    ), 0)
    - coalesce((
      select sum(transferencia.quantidade_kg)
      from public.transferencias_fusao transferencia
      join public.corridas_fusao origem on origem.id = transferencia.corrida_origem_id
      where origem.forno_id = p_forno_id
    ), 0)
    - coalesce((
      select sum(coalesce(corrida.escoria_kg, 0) + coalesce(corrida.lingote_kg, 0) + coalesce(corrida.ajuste_kg, 0))
      from public.corridas_fusao corrida
      where corrida.forno_id = p_forno_id
    ), 0);
$$;

notify pgrst, 'reload schema';

commit;
