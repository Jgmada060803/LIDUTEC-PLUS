begin;

-- Linha 2 do Acabamento tem 10 postos (08 a 17), não 11 — corrige o cadastro
-- desativando o posto 18 sem apagar (evita quebrar qualquer parada que já
-- tenha sido lançada referenciando esse id).
update public.postos_equipamentos_acabamento set ativo=false where codigo='POSTO_18';

-- Setor "ADM" e motivo "Absenteísmo", usados no registro automático de parada
-- por posto quando o operador informa menos gente presente do que o planejado.
insert into public.setores_responsaveis_parada(codigo,nome) values ('ADM','ADM')
on conflict(codigo) do update set nome=excluded.nome;

insert into public.categorias_parada_producao(codigo,nome) values ('ABSENTEISMO','Absenteísmo')
on conflict(codigo) do update set nome=excluded.nome;

commit;
