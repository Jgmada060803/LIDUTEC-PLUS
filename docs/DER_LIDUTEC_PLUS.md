
# DER — LIDUTEC+

```mermaid
erDiagram
    AUTH_USERS ||--|| USUARIOS : possui
    USUARIOS ||--o{ PRODUTOS : cria
    USUARIOS ||--o{ FICHAS_TECNICAS : elabora
    USUARIOS ||--o{ APROVACOES_FICHA : participa
    USUARIOS ||--o{ AUDITORIA : gera
    USUARIOS ||--o{ NOTIFICACOES : recebe

    CLIENTES ||--o{ PRODUTOS : possui
    FAMILIAS_PRODUTO ||--o{ PRODUTOS : classifica

    PRODUTOS ||--o{ FICHAS_TECNICAS : possui
    PRODUTOS ||--o{ DOCUMENTOS_PRODUTO : possui
    PRODUTOS ||--o{ REGISTROS_CE : recebe

    FICHAS_TECNICAS ||--o{ VALORES_PARAMETROS : contém
    FICHAS_TECNICAS ||--o{ APROVACOES_FICHA : passa_por
    FICHAS_TECNICAS ||--o{ ALTERACOES_REVISAO : registra
    FICHAS_TECNICAS ||--o| ESPECIFICACOES_EMBALAGEM : detalha
    FICHAS_TECNICAS ||--o{ DOCUMENTOS_PRODUTO : anexa
    FICHAS_TECNICAS ||--o| FICHAS_TECNICAS : sucede

    GRUPOS_PARAMETROS ||--o{ PARAMETROS : agrupa
    PARAMETROS ||--o{ VALORES_PARAMETROS : recebe
    PARAMETROS ||--o{ ALTERACOES_REVISAO : identifica

    MAQUINAS ||--o{ REGISTROS_CE : origina
    PANELAS ||--o{ REGISTROS_CE : utiliza
```

## Fluxo principal

```text
Cliente
  └── Produto
       ├── Ficha de Moldagem
       ├── Ficha de Fusão/Vazamento
       ├── Ficha de Metalurgia
       ├── Ficha de Embalagem
       ├── Ficha de Qualidade
       ├── Documentos
       └── Registros de CE
```

## Revisões

Cada revisão é uma nova linha em `fichas_tecnicas`.

Exemplo:

```text
MS0013
└── Fusão/Vazamento
    ├── Revisão 54 — OBSOLETA
    ├── Revisão 55 — OBSOLETA
    └── Revisão 56 — APROVADA e VIGENTE
```

A tela principal consulta apenas `vigente = true`.
A tela separada de revisões consulta todas as revisões do produto e do tipo de ficha.
