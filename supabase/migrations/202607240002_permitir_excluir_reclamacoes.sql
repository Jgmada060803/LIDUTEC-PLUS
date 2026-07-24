begin;

create policy reclamacoes_delete
  on public.reclamacoes_cliente
  for delete
  to authenticated
  using (
    public.usuario_tem_permissao_reclamacao(
      'reclamacao.gerenciar'
    )
  );

create policy reclamacoes_anexos_delete
  on public.reclamacoes_anexos
  for delete
  to authenticated
  using (
    public.usuario_tem_permissao_reclamacao(
      'reclamacao.gerenciar'
    )
  );

create policy reclamacoes_storage_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'reclamacoes-cliente'
    and public.usuario_tem_permissao_reclamacao(
      'reclamacao.gerenciar'
    )
  );

grant delete on public.reclamacoes_cliente to authenticated;
grant delete on public.reclamacoes_anexos to authenticated;

commit;
