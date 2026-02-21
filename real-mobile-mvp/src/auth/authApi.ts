import AsyncStorage from "@react-native-async-storage/async-storage";

export type AuthUser = {
  id: string;
  email: string;
};

type AuthSuccess = {
  token: string;
  user: AuthUser;
};

const AUTH_API_BASE_URL = process.env.EXPO_PUBLIC_AUTH_API_BASE_URL?.replace(/\/+$/, "");
const LOCAL_USERS_KEY = "real:auth:local_users";

type LocalUserRecord = {
  email: string;
  password: string;
  userId: string;
};

function fallbackSession(email: string): AuthSuccess {
  const cleanEmail = email.trim().toLowerCase();
  return {
    token: `local-dev-${Date.now()}`,
    user: {
      id: `local-${cleanEmail}`,
      email: cleanEmail,
    },
  };
}

async function readLocalUsers(): Promise<Record<string, LocalUserRecord>> {
  const raw = await AsyncStorage.getItem(LOCAL_USERS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, LocalUserRecord>;
  } catch {
    return {};
  }
}

async function writeLocalUsers(users: Record<string, LocalUserRecord>): Promise<void> {
  await AsyncStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

async function upsertLocalUser(email: string, password: string): Promise<AuthSuccess> {
  const cleanEmail = email.trim().toLowerCase();
  const users = await readLocalUsers();
  const existing = users[cleanEmail];
  const next: LocalUserRecord = existing ?? {
    email: cleanEmail,
    password,
    userId: `local-${cleanEmail}`,
  };
  next.password = password;
  users[cleanEmail] = next;
  await writeLocalUsers(users);
  return {
    token: `local-dev-${Date.now()}`,
    user: { id: next.userId, email: cleanEmail },
  };
}

async function loginLocalUser(email: string, password: string): Promise<AuthSuccess> {
  const cleanEmail = email.trim().toLowerCase();
  const users = await readLocalUsers();
  const existing = users[cleanEmail];
  if (!existing) {
    return upsertLocalUser(cleanEmail, password);
  }
  if (existing.password !== password) {
    throw new Error("Senha inválida para este e-mail.");
  }
  return {
    token: `local-dev-${Date.now()}`,
    user: { id: existing.userId, email: cleanEmail },
  };
}

function ensureApiBaseUrl(): string {
  if (!AUTH_API_BASE_URL) {
    throw new Error("AUTH_API_NOT_CONFIGURED");
  }
  return AUTH_API_BASE_URL;
}

async function authRequest(path: string, init: RequestInit): Promise<AuthSuccess> {
  const rawBody = typeof init.body === "string" ? init.body : "{}";
  const parsedBody = JSON.parse(rawBody) as { email?: string; password?: string };
  const fallbackEmail = parsedBody.email ?? "cliente@real.local";
  const fallbackPassword = parsedBody.password ?? "";

  let baseUrl: string;
  try {
    baseUrl = ensureApiBaseUrl();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_API_NOT_CONFIGURED") {
      if (path.includes("/register")) return upsertLocalUser(fallbackEmail, fallbackPassword);
      return loginLocalUser(fallbackEmail, fallbackPassword);
    }
    throw error;
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new Error("Falha de conexão com o servidor de autenticação.");
  }

  const raw = await res.text();
  let data: { error?: string; token?: string; user?: AuthUser } = {};
  try {
    data = raw ? (JSON.parse(raw) as { error?: string; token?: string; user?: AuthUser }) : {};
  } catch {
    throw new Error("Resposta inválida do servidor de autenticação.");
  }

  if (!res.ok || !data.token || !data.user) {
    if (typeof data.error === "string" && data.error.trim()) {
      throw new Error(data.error.trim());
    }
    throw new Error("Não foi possível autenticar. Tente novamente.");
  }

  return { token: data.token, user: data.user };
}

export async function loginWithPassword(email: string, password: string): Promise<AuthSuccess> {
  return authRequest("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function registerWithPassword(email: string, password: string): Promise<AuthSuccess> {
  return authRequest("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
