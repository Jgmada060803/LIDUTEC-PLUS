# Preparação para migração ao SQL corporativo

## Princípio

O navegador não deve acessar diretamente o banco corporativo. Na migração, uma API
corporativa substituirá o adaptador Supabase e manterá os mesmos contratos de dados.
Autenticação (`auth.uid()`), RLS, policies e funções `security definer` pertencem à
infraestrutura atual e devem ser reimplementadas na camada de identidade/API.

O módulo de produção já concentra suas operações em
`assets/js/producao-data.js`. Na migração, esse arquivo deve ser substituído por um
adaptador HTTP com os mesmos métodos (`support`, `records`, `stops`, `shift`,
`closeShift`, `editShift` e `deleteShift`), sem alterar as telas.

## Entidades de negócio

- `turnos_producao_moldes`: cabeçalho e estado do turno.
- `registros_producao_moldes`: intervalos e quantidades produzidas.
- `paradas_producao_moldes`: intervalos de parada.
- `setores_responsaveis_parada`: cadastro mestre de setores.
- `categorias_parada_producao`: cadastro mestre de motivos.
- `historico_edicoes_turno_producao`: auditoria anterior/posterior.
- `produtos`: origem de `cavidades_molde` e `peso_peca_kg`.

Chaves primárias e estrangeiras devem ser preservadas. Datas/hora devem ser
armazenadas com fuso ou normalizadas em UTC, usando `America/Sao_Paulo` na exibição.
Valores de peso usam quilogramas; toneladas são quilogramas divididos por 1.000.

## Contratos operacionais

1. Fechar turno recebe cabeçalho, produções e paradas em uma única transação.
2. Editar turno fechado substitui os detalhes em uma transação e grava snapshots.
3. Excluir turno é permitido somente a Administrador e Gerente de Produção.
4. Nenhuma linha pode ficar fora do intervalo do turno.
5. A quantidade gravada deve ser igual à quantidade recebida; não há sucesso parcial.

## Exportação

As views `export_*` da migração `202608050006` fornecem conjuntos sem dependência da
interface e adequados a CSV/ETL:

- `export_turnos_producao`
- `export_apontamentos_producao`
- `export_paradas_producao`
- `export_historico_edicoes_producao`
- `export_catalogo_colunas` (inventário de todo o schema público)
- `export_relacionamentos` (chaves estrangeiras de todo o schema público)

Os módulos legados ainda usam o cliente Supabase diretamente. A migração completa
deve criar adaptadores equivalentes por módulo antes da troca do backend. O módulo
de produção serve como implementação de referência; esta separação evita conectar
o navegador diretamente ao SQL da empresa.

## Adaptação por banco

- PostgreSQL corporativo: portar tabelas e funções; substituir `auth.uid()`.
- SQL Server: identities viram `IDENTITY`; JSONB vira `nvarchar(max)` ou tabelas de
  auditoria normalizadas; funções transacionais viram procedures.
- Oracle: identities/sequences conforme versão; JSON em `CLOB`/tipo JSON; procedures
  no package da aplicação.

Antes da virada, executar exportação, contagens por tabela, totais de moldes/peças/
toneladas e comparação de chaves entre origem e destino.
