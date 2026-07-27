begin;

-- O fluxo atual registra APROVADA/REJEITADA, enquanto instalações mais
-- antigas podem ter criado a restrição apenas com APROVADO/REPROVADO.
alter table public.aprovacoes_ficha
  drop constraint if exists aprovacoes_ficha_status_check;

alter table public.aprovacoes_ficha
  add constraint aprovacoes_ficha_status_check
  check (
    status in (
      'PENDENTE',
      'APROVADA',
      'REJEITADA',
      'APROVADO',
      'REPROVADO',
      'REPROVADA'
    )
  );

commit;
