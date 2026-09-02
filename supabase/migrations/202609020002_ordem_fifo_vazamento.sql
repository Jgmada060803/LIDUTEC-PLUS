-- FIFO no Vazamento: a panela retirada mais cedo do Holding tem que ser
-- vazada primeiro — o operador não pode vazar uma panela mais nova
-- "pulando a frente" de outra mais antiga ainda aguardando. Reforça no
-- servidor (não só na tela) pra não depender de ninguém não clicar errado.
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
