# real-auth-api

API de autenticação própria (email + senha) para o app Real, usando Postgres.

## 1) Subir Postgres

```bash
docker compose up -d
```

## 2) Configurar env

```bash
cp .env.example .env
```

Troque pelo menos o `JWT_SECRET`.

## 3) Instalar e migrar

```bash
npm install
npm run db:migrate
```

## 4) Rodar API

```bash
npm start
```

Health check:

```bash
curl http://localhost:3333/health
```

## Endpoints

- `POST /v1/auth/register` `{ email, password }`
- `POST /v1/auth/login` `{ email, password }`
- `GET /v1/auth/me` com `Authorization: Bearer <token>`
