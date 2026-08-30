begin;

-- Capacidade do forno (kg) — opcional (Fusor pode não ter). Usada pra
-- validar a transferência de metal e pro modal de confirmação no front
-- mostrar "saldo após / capacidade" antes de confirmar.
alter table public.fornos_fusao
  add column if not exists capacidade_kg numeric;

create or replace function public.salvar_forno_fusao(
  p_id bigint, p_codigo text, p_nome text, p_tipo text,
  p_limite_atencao integer default 100, p_limite_critico integer default 150,
  p_ativo boolean default true, p_carro integer default null,
  p_capacidade_kg numeric default null
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id bigint;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.configurar') then
    raise exception 'Usuário sem permissão para configurar cadastros de fusão.';
  end if;
  if p_tipo not in ('FUSAO','HOLDING') then raise exception 'Tipo de forno inválido.'; end if;
  if p_carro is not null and p_carro not in (1,2) then raise exception 'Carro inválido.'; end if;
  if p_capacidade_kg is not null and p_capacidade_kg <= 0 then raise exception 'Capacidade precisa ser maior que zero.'; end if;
  if p_id is null then
    insert into public.fornos_fusao(codigo,nome,tipo,limite_atencao_corridas,limite_critico_corridas,ativo,carro,capacidade_kg)
    values(trim(p_codigo),trim(p_nome),p_tipo,coalesce(p_limite_atencao,100),coalesce(p_limite_critico,150),coalesce(p_ativo,true),p_carro,p_capacidade_kg)
    returning id into v_id;
  else
    update public.fornos_fusao set codigo=trim(p_codigo),nome=trim(p_nome),tipo=p_tipo,
      limite_atencao_corridas=coalesce(p_limite_atencao,100),limite_critico_corridas=coalesce(p_limite_critico,150),
      ativo=coalesce(p_ativo,true),carro=p_carro,capacidade_kg=p_capacidade_kg
    where id=p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Transferência passa a validar a capacidade do forno destino (quando
-- cadastrada) — bloqueia se o saldo depois da transferência estourar.
create or replace function public.transferir_metal_fusao(
  p_corrida_origem_id bigint, p_forno_destino_id bigint, p_quantidade_kg numeric
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_origem record;
  v_destino record;
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

  insert into public.transferencias_fusao(corrida_origem_id, corrida_destino_id, quantidade_kg, registrado_por)
  values (p_corrida_origem_id, v_destino.id, p_quantidade_kg, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
