-- A importação histórica da Fusão (04/09/2026) fez corridas_fusao_carga_itens
-- e panelas_holding crescerem de algumas centenas pra ~13 mil e ~20 mil
-- linhas. Sem índice nas colunas mais buscadas, toda consulta virou Seq
-- Scan na tabela inteira (confirmado via EXPLAIN ANALYZE) -- causa da
-- lentidão geral relatada pelo usuário em qualquer tela após login.
-- Só adiciona índices: não muda nenhum dado nem comportamento.

create index if not exists corridas_fusao_carga_itens_corrida_idx
  on public.corridas_fusao_carga_itens(corrida_id);

-- Suporta o "order by inicio desc" usado por volume_atual_forno_fusao
-- (o índice existente corridas_fusao_forno_idx é por criado_em, não inicio).
create index if not exists corridas_fusao_forno_inicio_idx
  on public.corridas_fusao(forno_id, inicio desc);

create index if not exists panelas_holding_status_idx
  on public.panelas_holding(status);

create index if not exists panelas_holding_hora_inicio_vazamento_idx
  on public.panelas_holding(hora_inicio_vazamento);

create index if not exists panelas_holding_hora_retirada_idx
  on public.panelas_holding(hora_retirada);
