begin;

-- Incidente 2026-08-27: 4 conexões do PostgREST (papel authenticator)
-- ficaram presas em "idle in transaction (aborted)" e foram reaproveitadas
-- pelo pool a cada fração de segundo, gerando ~700 rollbacks/s continuamente
-- (465 milhões de rollbacks acumulados) sem nunca ficar "idle" tempo
-- suficiente pra disparar o idle_in_transaction_session_timeout já
-- configurado no papel authenticator (mesma família do incidente de
-- 39h corrigido em 2026-08-17, mas esse estado específico escapa do
-- timeout por ser reativado antes de completar 60s parado).
-- Esse watchdog mata qualquer conexão nesse estado a cada minuto, não
-- dependendo de ela ficar parada — uma transação abortada não tem uso
-- legítimo possível, então é seguro encerrar na hora.
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'watchdog_conexoes_abortadas',
  '* * * * *',
  $$select pg_terminate_backend(pid) from pg_stat_activity
      where state = 'idle in transaction (aborted)' and pid <> pg_backend_pid();$$
);

commit;
