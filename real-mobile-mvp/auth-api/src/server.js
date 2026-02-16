const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { z } = require("zod");
require("dotenv").config();

const PORT = Number(process.env.PORT || 3333);
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || "7d";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL é obrigatória.");
}
if (!JWT_SECRET || JWT_SECRET.length < 24) {
  throw new Error("JWT_SECRET é obrigatória e precisa ter 24+ caracteres.");
}

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();

app.use(helmet());
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    methods: ["GET", "POST"],
  }),
);
app.use(express.json({ limit: "64kb" }));

const authSchema = z.object({
  email: z.string().email().min(5).max(180),
  password: z.string().min(8).max(72),
});

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRES_IN,
    issuer: "real-auth-api",
    audience: "real-mobile-app",
  });
}

function parseBearerToken(req) {
  const authHeader = req.header("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim();
}

function authMiddleware(req, res, next) {
  const token = parseBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Token ausente." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: "real-auth-api",
      audience: "real-mobile-app",
    });
    req.auth = { userId: payload.sub, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: "Token inválido." });
  }
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.post("/v1/auth/register", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos." });
  }

  const email = normalizeEmail(parsed.data.email);
  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);

  try {
    const result = await pool.query(
      `insert into auth_users (email, password_hash)
       values ($1, $2)
       returning id, email`,
      [email, passwordHash],
    );

    const user = result.rows[0];
    const token = signToken(user);
    return res.status(201).json({ token, user });
  } catch (error) {
    if (error && error.code === "23505") {
      return res.status(409).json({ error: "Este e-mail já está em uso." });
    }
    return res.status(500).json({ error: "Falha ao criar conta." });
  }
});

app.post("/v1/auth/login", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos." });
  }

  const email = normalizeEmail(parsed.data.email);

  try {
    const result = await pool.query(
      `select id, email, password_hash
       from auth_users
       where email = $1
       limit 1`,
      [email],
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    }

    await pool.query("update auth_users set last_login_at = now() where id = $1", [user.id]);

    const token = signToken({ id: user.id, email: user.email });
    return res.json({ token, user: { id: user.id, email: user.email } });
  } catch {
    return res.status(500).json({ error: "Falha ao logar." });
  }
});

app.get("/v1/auth/me", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `select id, email from auth_users where id = $1 limit 1`,
      [req.auth.userId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    return res.json({ user: result.rows[0] });
  } catch {
    return res.status(500).json({ error: "Falha ao buscar usuário." });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

app.listen(PORT, () => {
  console.log(`real-auth-api rodando em http://localhost:${PORT}`);
});
