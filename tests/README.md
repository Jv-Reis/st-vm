# Testes

Cobertura de RLS/autorização — a parte mais crítica do projeto, já que o IDOR
original só foi achado por um pentest externo, não por revisão interna. Cada
teste roda dentro de uma transação sempre desfeita (`ROLLBACK`, garantido
mesmo se o teste falhar no meio) contra o **Supabase de produção mesmo** —
nenhum teste comita dado de verdade, então não precisa de um projeto Supabase
separado só pra teste.

## Como rodar

1. Pegue a connection string do Postgres (diferente da `SUPABASE_URL` do
   `.env`, que é a URL da API REST): no [Supabase Dashboard](https://supabase.com/dashboard),
   Project Settings → Database → **Connection string**.
   - Use a aba **Session pooler** (porta 5432), não "Direct connection" — a
     conexão direta (`db.<ref>.supabase.co`) só tem endereço IPv6, e boa
     parte das redes (principalmente no Brasil) não roteia IPv6, o que dá
     `ENOTFOUND` na hora de conectar. O pooler (`aws-0-<região>.pooler.supabase.com`)
     resolve em IPv4 normalmente.
   - Repara que o usuário muda pra `postgres.<ref-do-projeto>` (não só
     `postgres`) nesse formato — é assim que o pooler roteia pra base certa.
   - Formato final: `postgresql://postgres.xxxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`.
   - Se não souber a senha do banco, reseta em Project Settings → Database →
     "Reset database password" (não afeta as chaves anon/service-role usadas
     em produção, só a senha de conexão direta por Postgres).
2. Defina como variável de ambiente antes de rodar (não vai pro `.env`
   principal de propósito, pra não ficar carregada sem querer em produção):
   ```bash
   export DATABASE_URL="postgresql://..."
   ```
   No PowerShell:
   ```powershell
   $env:DATABASE_URL = "postgresql://..."
   ```
3. Rode:
   ```bash
   npm test
   ```

## Como funciona

`db-helper.js` simula cada ator (`anon`, um usuário específico, ou o dono da
conexão) exatamente do jeito que o PostgREST faz pra aplicar as policies de
RLS — `SET LOCAL role` + `set_config('request.jwt.claims', ...)`. Não dá pra
testar RLS de verdade com mocks; precisa bater no Postgres real e deixar as
policies rodarem.

Os testes usam **duas contas reais** de `auth.users` (as duas mais antigas do
projeto) como "dono" e "membro" — não dá pra criar um `auth.users` sintético
fácil, é uma tabela gerenciada pelo Supabase Auth, não uma tabela comum dessas
que a gente cria com `create table`. Nenhum dado dessas contas é alterado:
os testes só criam eventos de teste (`test-rls-*`) dentro da transação que é
desfeita no final.
