begin;

insert into public.categorias_parada_producao(codigo,nome)
values
 ('RH','RH'),
 ('TREINAMENTO','Treinamento'),
 ('QUEBRA_EQUIPAMENTO','Quebra de equipamento'),
 ('ESPERA_PONTE_ROLANTE','Espera de ponte rolante'),
 ('ESPERA_INSPECAO','Espera de inspeção')
on conflict(codigo) do update set nome=excluded.nome;

commit;
