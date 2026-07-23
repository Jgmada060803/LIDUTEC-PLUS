# Módulo de fichas técnicas

## Arquitetura

O módulo usa um núcleo compartilhado:

`produtos → fichas_tecnicas → valores_parametros → parametros → grupos_parametros`

Cada revisão é uma linha independente em `fichas_tecnicas`. Moldagem e
Fusão/Vazamento podem, portanto, ter números de revisão diferentes para o
mesmo produto.

Documentos históricos externos usam `IMPORTADA`. Esse status é somente
leitura e não representa aprovação eletrônica pelo LIDUTEC+. Nomes impressos
no documento são metadados textuais, sem vínculo obrigatório com usuários.

O catálogo `tipos_ficha` associa cada processo a um `layout_id`. O banco
armazena dados e metadados simples; HTML não é armazenado.

## Seleção da ficha

A interface prioriza:

1. `RASCUNHO`;
2. `EM_APROVACAO`;
3. ficha vigente;
4. demais fichas para resumo histórico.

Dentro de cada prioridade são usados, nesta ordem, `numero_revisao`,
`criado_em` e `id`, todos decrescentes.

## Persistência

`salvar_rascunho_ficha_tecnica_v2` reutiliza a RPC transacional existente e
acrescenta início, fim e o marcador de não aplicável na mesma transação.
Criação exige `ficha.criar`; alteração exige `ficha.editar_rascunho`.

## Segurança

RLS permanece habilitado. As RPCs validam `auth.uid()`, usuário ativo,
permissões individuais/perfil, produto, tipo, status e parâmetros. Nenhuma
chave `service_role` é usada no navegador.
