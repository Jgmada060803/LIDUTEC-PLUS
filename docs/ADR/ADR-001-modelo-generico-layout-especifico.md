# ADR-001 — Modelo de dados compartilhado com layouts específicos

## Contexto

As fichas de Moldagem, Macharia, Fusão/Vazamento e Acabamento possuem
formatos visuais diferentes, mas compartilham produto, revisão, permissões,
aprovação, histórico, parâmetros e valores.

## Decisão

Usar um núcleo de dados compartilhado e renderizadores específicos por tipo
de processo. O catálogo de tipos define um identificador de layout estável.
Configurações visuais simples podem ser armazenadas como JSON, mas HTML
permanece no front-end.

## Consequências positivas

- flexibilidade para novos processos;
- reutilização das regras de versão, permissão e persistência;
- integração dos dados;
- menor duplicidade.

## Riscos

- maior complexidade na renderização;
- necessidade de validar formatos diferentes;
- manutenção de contratos comuns entre os layouts.
