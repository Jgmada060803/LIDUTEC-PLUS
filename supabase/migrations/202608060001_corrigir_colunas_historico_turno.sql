begin;

-- Bancos que já possuíam a tabela não recebiam estas colunas porque a
-- migration original utilizava apenas CREATE TABLE IF NOT EXISTS.
alter table public.historico_edicoes_turno_producao
  add column if not exists dados_anteriores jsonb;

alter table public.historico_edicoes_turno_producao
  add column if not exists dados_novos jsonb;

update public.historico_edicoes_turno_producao
set
  dados_anteriores = coalesce(dados_anteriores, '{}'::jsonb),
  dados_novos = coalesce(dados_novos, '{}'::jsonb)
where dados_anteriores is null
   or dados_novos is null;

alter table public.historico_edicoes_turno_producao
  alter column dados_anteriores set default '{}'::jsonb,
  alter column dados_anteriores set not null,
  alter column dados_novos set default '{}'::jsonb,
  alter column dados_novos set not null;

-- Atualiza imediatamente o cache de esquema usado pela API REST.
notify pgrst, 'reload schema';

commit;
