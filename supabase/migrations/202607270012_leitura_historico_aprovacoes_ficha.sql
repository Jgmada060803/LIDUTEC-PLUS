begin;

alter table public.aprovacoes_ficha enable row level security;

grant select on public.aprovacoes_ficha to authenticated;

drop policy if exists aprovacoes_ficha_select_revisoes
  on public.aprovacoes_ficha;
create policy aprovacoes_ficha_select_revisoes
  on public.aprovacoes_ficha
  for select
  to authenticated
  using (
    public.usuario_tem_permissao_ficha(
      'revisao.visualizar_historico'
    )
    or public.usuario_tem_permissao_ficha('ficha.visualizar')
  );

commit;
