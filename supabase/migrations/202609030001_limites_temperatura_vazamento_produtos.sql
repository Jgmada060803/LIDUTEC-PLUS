-- Faixa de temperatura de liberação da panela de vazamento, por produto,
-- lida direto da ficha técnica vigente (parâmetro 188, grupo TEMPERATURAS)
-- — mesmo padrão já usado em tipos_material_produtos_fusao() (parâmetro
-- 134). Usada pra colorir a coluna "Temp. vazamento" no histórico do
-- Vazamento (pedido explícito): perto do limite (até 5°C) = amarelo,
-- fora da faixa = vermelho.
create or replace function public.limites_temperatura_vazamento_produtos()
returns table(produto_id bigint, temp_minima numeric, temp_maxima numeric)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select ft.produto_id, vp.valor_minimo, vp.valor_maximo
  from public.fichas_tecnicas ft
  join public.valores_parametros vp on vp.ficha_tecnica_id = ft.id and vp.parametro_id = 188
  where ft.vigente = true;
$$;

grant execute on function public.limites_temperatura_vazamento_produtos() to authenticated;
