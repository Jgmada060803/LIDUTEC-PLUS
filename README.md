# LIDUTEC+

Sistema web industrial em HTML, CSS e JavaScript, integrado ao Supabase.

## Execução local

Na raiz do projeto:

```powershell
node dev-server.cjs
```

Acesse `http://127.0.0.1:8080/`.

## Banco de dados

Mudanças de banco são mantidas em `supabase/migrations`. As migrations devem
ser revisadas e aplicadas ao projeto Supabase antes de testar módulos que
dependam de tabelas ou RPCs novas. A chave `service_role` é exclusiva de Edge
Functions e nunca deve ser incluída no front-end.

## Testes puros

```powershell
node tests/turnos.test.cjs
```

## Módulos

- Produtos e fichas técnicas;
- histórico e aprovação de revisões;
- controle de processo;
- reclamações de clientes;
- produção de moldes e paradas;
- administração de usuários.

As páginas protegidas exigem sessão, usuário ativo e permissões concedidas no
Supabase.
