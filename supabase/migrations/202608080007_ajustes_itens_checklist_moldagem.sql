begin;

-- "Cinco moldes da peça estrela realizados" (M01/06) ganha opção Não aplicável.
update public.itens_checklist item
set permite_na = true
from public.modelos_checklist modelo
where item.modelo_id = modelo.id
  and modelo.codigo = 'M01'
  and item.codigo = '06';

-- Itens numéricos sem faixa cadastrada hoje pedem um julgamento manual
-- (Conforme/Não conforme) além do valor. Para "Compressibilidade encontrada"
-- (M02/04) isso não faz sentido — só o valor lançado já basta.
alter table public.itens_checklist add column if not exists apenas_valor boolean not null default false;

update public.itens_checklist item
set apenas_valor = true
from public.modelos_checklist modelo
where item.modelo_id = modelo.id
  and modelo.codigo = 'M02'
  and item.codigo = '04';

-- Para checklists que se repetem dentro do turno (início de turno, intervalo
-- e futuramente setup), guarda a que horário planejado aquela execução
-- pertence — permite montar a tela em colunas por horário sem ambiguidade
-- de "a qual coluna esse lançamento pertence" (não dá pra confiar só no
-- horário real de preenchimento, que pode atrasar).
alter table public.execucoes_checklist add column if not exists horario_previsto timestamptz;

create or replace function public.salvar_execucao_checklist(
  p_modelo_id bigint,
  p_data_operacional date,
  p_turno text,
  p_produto_id bigint,
  p_equipamento text,
  p_corrida text,
  p_observacao text,
  p_respostas jsonb,
  p_horario_previsto timestamptz default null
) returns bigint
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_modelo public.modelos_checklist%rowtype;
  v_execucao_id bigint;
  v_item public.itens_checklist%rowtype;
  v_resposta jsonb;
  v_resultado text;
  v_valor numeric;
  v_resposta_id bigint;
  v_total_itens integer;
  v_total_respostas integer;
  v_tem_desvio boolean:=false;
  v_tem_critico boolean:=false;
begin
  if not public.usuario_tem_permissao_checklist('checklist.preencher') then
    raise exception 'Usuário sem permissão para preencher checklists.';
  end if;
  if p_turno not in('MANHA','TARDE','NOITE') then
    raise exception 'Turno inválido.';
  end if;
  select * into v_modelo from public.modelos_checklist
  where id=p_modelo_id and ativo=true;
  if not found then raise exception 'Modelo de checklist não encontrado.'; end if;
  if v_modelo.produto_obrigatorio and p_produto_id is null then
    raise exception 'Informe o produto.';
  end if;
  if v_modelo.equipamento_obrigatorio and nullif(trim(p_equipamento),'') is null then
    raise exception 'Informe o equipamento.';
  end if;
  if v_modelo.corrida_obrigatoria and nullif(trim(p_corrida),'') is null then
    raise exception 'Informe a corrida.';
  end if;
  if jsonb_typeof(coalesce(p_respostas,'[]'::jsonb))<>'array' then
    raise exception 'Respostas inválidas.';
  end if;
  select count(*) into v_total_itens from public.itens_checklist
  where modelo_id=p_modelo_id and ativo=true;
  select count(distinct (answer->>'item_id')::bigint) into v_total_respostas
  from jsonb_array_elements(coalesce(p_respostas,'[]'::jsonb)) answer;
  if v_total_itens=0 or v_total_respostas<>v_total_itens then
    raise exception 'Responda todos os itens do checklist.';
  end if;

  insert into public.execucoes_checklist(
    modelo_id,data_operacional,turno,produto_id,equipamento,corrida,
    observacao,operador_id,modelo_versao,status,horario_previsto
  ) values (
    p_modelo_id,coalesce(p_data_operacional,current_date),p_turno,p_produto_id,
    nullif(trim(p_equipamento),''),nullif(trim(p_corrida),''),
    nullif(trim(p_observacao),''),auth.uid(),v_modelo.versao,'EM_PREENCHIMENTO',p_horario_previsto
  ) returning id into v_execucao_id;

  for v_resposta in select value from jsonb_array_elements(p_respostas)
  loop
    select * into v_item from public.itens_checklist
    where id=(v_resposta->>'item_id')::bigint
      and modelo_id=p_modelo_id and ativo=true;
    if not found then raise exception 'Item de checklist inválido.'; end if;
    v_resultado:=nullif(v_resposta->>'resultado','');
    v_valor:=nullif(v_resposta->>'valor_numero','')::numeric;
    if v_item.tipo_resposta='NUMERO' then
      if v_valor is null then raise exception 'Informe o valor de %.',v_item.descricao; end if;
      if v_item.valor_minimo is not null or v_item.valor_maximo is not null then
        v_resultado:=case when
          (v_item.valor_minimo is null or v_valor>=v_item.valor_minimo) and
          (v_item.valor_maximo is null or v_valor<=v_item.valor_maximo)
          then 'CONFORME' else 'NAO_CONFORME' end;
      elsif v_item.apenas_valor then
        v_resultado:='CONFORME';
      elsif v_resultado not in('CONFORME','NAO_CONFORME') then
        raise exception 'Informe o resultado da avaliação de %.',v_item.descricao;
      end if;
    elsif v_item.tipo_resposta='TEXTO' then
      if nullif(trim(v_resposta->>'valor_texto'),'') is null then
        raise exception 'Preencha o item %.',v_item.descricao;
      end if;
      v_resultado:='CONFORME';
    elsif v_resultado not in('CONFORME','NAO_CONFORME','NAO_APLICAVEL') then
      raise exception 'Selecione o resultado de %.',v_item.descricao;
    end if;
    if v_resultado='NAO_APLICAVEL' and not v_item.permite_na then
      raise exception 'O item % não permite Não aplicável.',v_item.descricao;
    end if;
    if v_resultado='NAO_CONFORME' and (
      nullif(trim(v_resposta->>'observacao'),'') is null or
      nullif(trim(v_resposta->>'acao_imediata'),'') is null
    ) then raise exception 'Informe desvio e ação imediata de %.',v_item.descricao;
    end if;

    insert into public.respostas_checklist(
      execucao_id,item_id,resultado,valor_numero,valor_texto,observacao,
      acao_imediata,respondido_por
    ) values(
      v_execucao_id,v_item.id,v_resultado,v_valor,
      nullif(trim(v_resposta->>'valor_texto'),''),
      nullif(trim(v_resposta->>'observacao'),''),
      nullif(trim(v_resposta->>'acao_imediata'),''),auth.uid()
    ) returning id into v_resposta_id;

    if v_item.tipo_resposta='NUMERO' and v_item.gera_carta then
      insert into public.medicoes_checklist(
        execucao_id,resposta_id,item_id,produto_id,equipamento,valor,
        limite_minimo,valor_alvo,limite_maximo,conforme
      ) values(
        v_execucao_id,v_resposta_id,v_item.id,p_produto_id,
        nullif(trim(p_equipamento),''),v_valor,v_item.valor_minimo,
        v_item.valor_alvo,v_item.valor_maximo,v_resultado='CONFORME'
      );
    end if;
    if v_resultado='NAO_CONFORME' then
      v_tem_desvio:=true;
      if v_item.critico then v_tem_critico:=true; end if;
    end if;
  end loop;

  update public.execucoes_checklist set
    status=case when v_tem_critico then 'AGUARDANDO_SUPERVISOR'
                when v_tem_desvio then 'NAO_CONFORME' else 'CONFORME' end,
    concluido_em=now()
  where id=v_execucao_id;
  return v_execucao_id;
end;
$$;

drop function if exists public.salvar_execucao_checklist(bigint,date,text,bigint,text,text,text,jsonb);
revoke all on function public.salvar_execucao_checklist(bigint,date,text,bigint,text,text,text,jsonb,timestamptz) from public,anon;
grant execute on function public.salvar_execucao_checklist(bigint,date,text,bigint,text,text,text,jsonb,timestamptz) to authenticated;

notify pgrst,'reload schema';

commit;
