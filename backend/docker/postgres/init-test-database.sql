SELECT 'CREATE DATABASE ai_codeguard_integration_test'
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'ai_codeguard_integration_test'
)\gexec
