begin;

-- A leitura das janelas de parada programada agora também alimenta a
-- ilustração (trecho amarelo na linha do tempo) na tela de apontamento,
-- usada por qualquer operador que lança produção — não só por quem tem
-- permissão de gerenciar metas. Mesmo padrão já usado para outros catálogos
-- compartilhados (categorias_parada_producao, setores_responsaveis_parada).
drop policy if exists paradas_programadas_select on public.paradas_programadas;
create policy paradas_programadas_select on public.paradas_programadas
for select to authenticated using(auth.uid() is not null);

commit;
