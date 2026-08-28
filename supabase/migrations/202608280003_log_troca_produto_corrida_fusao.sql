begin;

-- Trocar o produto da corrida (mesmo já aberta) também entra no histórico
-- de alterações, igual planejado/real/exclusão — consistência com o resto.
create or replace function public.atualizar_produto_corrida_fusao(p_corrida_id bigint, p_produto_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_corrida record;
  v_produto_antigo text;
  v_produto_novo text;
begin
  if not public.usuario_tem_permissao_producao_fusao('producao_fusao.lancar') then
    raise exception 'Usuário sem permissão para lançar produção de fusão.';
  end if;
  select * into v_corrida from public.corridas_fusao where id = p_corrida_id;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_corrida.status <> 'ABERTA' then raise exception 'Só é possível trocar o produto de uma corrida aberta.'; end if;

  select codigo into v_produto_novo from public.produtos where id = p_produto_id;
  if v_produto_novo is null then raise exception 'Produto inválido.'; end if;
  select codigo into v_produto_antigo from public.produtos where id = v_corrida.produto_id;

  update public.corridas_fusao set produto_id = p_produto_id, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_corrida_id;

  insert into public.corridas_fusao_alteracoes(corrida_id, autor_id, descricao)
  values (p_corrida_id, auth.uid(), format('alterou produto de %s para %s', coalesce(v_produto_antigo, '—'), v_produto_novo));
end;
$$;

notify pgrst, 'reload schema';

commit;
