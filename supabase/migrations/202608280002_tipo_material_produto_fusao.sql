begin;

-- "Ferro base" do produto em produção, pro cabeçalho do card da Ponte —
-- vem do parâmetro "Tipo de material" (FV_TIPO_MATERIAL, id 134) na ficha
-- técnica vigente do produto (ex.: Cinzento/Nodular). Função com
-- security definer pra não depender da RLS de fichas_tecnicas (módulo
-- separado, geralmente restrito a Engenharia/Qualidade) — expõe só o
-- texto do parâmetro, nada mais da ficha.
create or replace function public.tipos_material_produtos_fusao()
returns table(produto_id bigint, tipo_material text)
language sql stable security definer set search_path = pg_catalog, public
as $$
  select ft.produto_id, vp.valor_texto
  from public.fichas_tecnicas ft
  join public.valores_parametros vp on vp.ficha_tecnica_id = ft.id and vp.parametro_id = 134
  where ft.vigente = true;
$$;

revoke all on function public.tipos_material_produtos_fusao() from public, anon;
grant execute on function public.tipos_material_produtos_fusao() to authenticated;

notify pgrst, 'reload schema';

commit;
