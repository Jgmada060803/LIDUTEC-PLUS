begin;

-- Temperatura programada (setpoint) do Holding — associada à corrida
-- (período do forno), ajustável quantas vezes precisar enquanto ABERTA.
-- Não é uma "saída" (não mexe no saldo do forno) e não precisa de
-- auditoria em corridas_fusao_alteracoes (é um ajuste de operação
-- corriqueiro, não um evento estrutural como escória/lingote/produto).
alter table public.corridas_fusao
  add column if not exists temperatura_programada_c numeric;

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
end;
$$;

revoke all on function public.atualizar_temperatura_programada_fusao(bigint,numeric) from public, anon;
grant execute on function public.atualizar_temperatura_programada_fusao(bigint,numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
