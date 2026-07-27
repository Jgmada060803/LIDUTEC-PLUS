begin;

alter table public.aprovacoes_ficha
  add column if not exists usuario_id uuid
    references public.usuarios(id);

commit;
