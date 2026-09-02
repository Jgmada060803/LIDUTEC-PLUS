-- Peso teórico do lingotamento nunca pode ser negativo (fisicamente não
-- existe "consumir mais metal do que foi enviado"); quando aparece
-- negativo é sinal de dado ruim em algum lugar (ficha técnica, moldes
-- contados errado), não motivo pra travar o operador do Vazamento de
-- fechar o ciclo — só não deixa exibir/gravar um valor sem sentido.
create or replace function public.iniciar_lingotamento_vazamento()
returns table(id bigint, ciclo_inicio timestamptz, ciclo_fim timestamptz, peso_enviado_kg numeric, peso_consumido_teorico_kg numeric, peso_teorico_kg numeric)
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_ciclo_inicio timestamptz;
  v_ciclo_fim timestamptz := now();
  v_enviado numeric;
  v_consumido numeric;
  v_id bigint;
begin
  if not (public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar')
       or public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar_vazamento')) then
    raise exception 'Usuário sem permissão para lançar vazamento.';
  end if;

  select coalesce(max(l.ciclo_fim), '-infinity'::timestamptz) into v_ciclo_inicio
  from public.lingotamentos_vazamento l;

  select coalesce(sum(p.peso_kg), 0), coalesce(sum(p.quantidade_moldes * pr.peso_cacho_kg), 0)
  into v_enviado, v_consumido
  from public.panelas_holding p
  join public.produtos pr on pr.id = p.produto_id
  where p.status = 'VAZADA' and p.hora_fim_vazamento > v_ciclo_inicio and p.hora_fim_vazamento <= v_ciclo_fim;

  if coalesce(v_enviado, 0) = 0 then
    raise exception 'Nenhuma panela vazada desde o último lingotamento — nada para lingotar.';
  end if;

  insert into public.lingotamentos_vazamento(
    ciclo_inicio, ciclo_fim, peso_enviado_kg, peso_consumido_teorico_kg, peso_teorico_kg, criado_por
  ) values (
    v_ciclo_inicio, v_ciclo_fim, v_enviado, v_consumido, greatest(v_enviado - v_consumido, 0), auth.uid()
  ) returning lingotamentos_vazamento.id into v_id;

  return query select l.id, l.ciclo_inicio, l.ciclo_fim, l.peso_enviado_kg, l.peso_consumido_teorico_kg, l.peso_teorico_kg
    from public.lingotamentos_vazamento l where l.id = v_id;
end;
$$;
