begin;

-- areas_checklist, linhas_maquinas_producao, categorias_parada_producao e
-- setores_responsaveis_parada eram lidas só sob permissões específicas de um único
-- módulo (checklist.visualizar / producao_moldes.visualizar). Com Metas Gerenciais,
-- Tempo de Ciclo Padrão e o novo módulo de Acabamento, essas tabelas viraram
-- catálogos de referência usados por qualquer setor/tela — nomes de área, linha,
-- motivo de parada e setor responsável não são informação sensível.
--
-- Políticas permissivas do Postgres se combinam com OR: as políticas antigas
-- continuam existindo e nada some para quem já enxergava essas tabelas; isto
-- apenas adiciona visibilidade para quem não tinha a permissão específica de
-- Moldagem/checklist.

drop policy if exists areas_checklist_select_catalogo on public.areas_checklist;
create policy areas_checklist_select_catalogo on public.areas_checklist
for select to authenticated using (auth.uid() is not null);

drop policy if exists linhas_maquinas_select_catalogo on public.linhas_maquinas_producao;
create policy linhas_maquinas_select_catalogo on public.linhas_maquinas_producao
for select to authenticated using (auth.uid() is not null);

drop policy if exists categorias_parada_select_catalogo on public.categorias_parada_producao;
create policy categorias_parada_select_catalogo on public.categorias_parada_producao
for select to authenticated using (auth.uid() is not null);

drop policy if exists setores_parada_select_catalogo on public.setores_responsaveis_parada;
create policy setores_parada_select_catalogo on public.setores_responsaveis_parada
for select to authenticated using (auth.uid() is not null);

notify pgrst,'reload schema';

commit;
