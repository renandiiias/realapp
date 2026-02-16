# Real Mobile V1 (Front-First)

App mobile (Expo) onde o cliente configura tudo como software e, ao final, **envia para a Real**.
O envio cria um **Pedido** numa fila. O app acompanha **status + timeline + entregas**.

## O que está implementado (V1)

- Navegação com `expo-router` + Tabs:
  - Home
  - Criar
  - Pedidos
  - Aprovações
  - Conta
- Wizards (mock):
  - Tráfego (Meta Ads)
  - Site
  - Conteúdo (em breve)
- Onboarding em 2 camadas:
  - Cadastro inicial (mínimo) para liberar entrada no app
  - Cadastro de produção para liberar envio de pedidos
- Tour guiado curto após onboarding inicial.
- Regra única de envio:
  - rascunho pode ser criado sem travas
  - `Enviar para Real` exige cadastro de produção completo (todos os serviços)
- Fila local (mock) com persistência via `AsyncStorage`:
  - `draft` -> `queued`/`waiting_payment` -> `in_progress` -> `needs_approval`/`needs_info` -> `done`
- Aprovação de `copy`/`criativo` com `approved` ou `changes_requested`.
- Backend real de autenticação (`auth-api`) e fila (`queue-api`) com Postgres.
- Worker de automação (`codex-worker`) para fluxo `claim -> execute -> update`.
- Identidade visual da Real:
  - Verde `#35E214`, roxo `#8E00A6`, cinza `#EDEDEE`, preto `#1A1A1A`
  - Body: Montserrat
  - Título: display serif (fallback do Neue Metana)

## Rodar localmente

```bash
npm install
npm start
```

> Use o Expo Go no celular ou simulador iOS/Android.

### Node (importante)

Expo no momento funciona bem com Node LTS (ex.: `22.x`). Se voce estiver em Node muito novo (ex.: `25.x`) pode quebrar o CLI.

Comando garantido (Node 22 via Homebrew):

```bash
/opt/homebrew/opt/node@22/bin/npm start -- -c
```

## Testes (mínimo)

```bash
npm test
```

Roteiro de teste de jornada cliente:

- `scripts/client_journey_test.md`

## Plugar a API depois

Quando existir backend:

- defina `EXPO_PUBLIC_QUEUE_API_BASE_URL` (ex.: `https://api.seudominio.com`)
- o app passa a usar `HttpQueueClient` automaticamente.
- em staging/prod, use `EXPO_PUBLIC_REQUIRE_QUEUE_API=true`.

## Backend real (fila + worker)

1) Auth API:

```bash
cd auth-api
cp .env.example .env
npm install
npm run db:migrate
npm start
```

2) Queue API:

```bash
cd queue-api
cp .env.example .env
npm install
npm run db:migrate
npm start
```

3) Codex Worker:

```bash
cd codex-worker
cp .env.example .env
npm install
npm start
```

4) App:

```bash
cp .env.example .env
# ajuste EXPO_PUBLIC_AUTH_API_BASE_URL e EXPO_PUBLIC_QUEUE_API_BASE_URL
npm start -- -c -p 8088 --lan
```

## Deploy com Docker Compose

Arquivo: `docker-compose.backend.yml`

- `postgres`
- `auth-api`
- `queue-api`
- `codex-worker`

## Próximo passo técnico recomendado

1. Extrair `Agente Sênior` para um serviço backend (Node/Python) com fila de jobs.
2. Persistir `Raio-X` e plano em banco (Supabase/Postgres).
3. Conectar provedores reais (Meta Ads, WhatsApp, CRM).
4. Trocar simulação por execução real com logs e aprovações no app.
