import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEYS = getGeminiApiKeys();
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.OPENAI_MODEL || "models/gemini-flash-latest";
let nextGeminiKeyIndex = 0;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: GEMINI_API_KEYS.length > 0,
        model: GEMINI_MODEL,
        keys: GEMINI_API_KEYS.length,
        message: GEMINI_API_KEYS.length ? `Ready with ${GEMINI_API_KEYS.length} key(s)` : "Missing GEMINI_API_KEY"
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(req, res);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong on the server." });
  }
});

server.listen(PORT, () => {
  console.log(`AI chatbot running at http://localhost:${PORT}`);
});

async function handleChat(req, res) {
  if (!GEMINI_API_KEYS.length) {
    return sendJson(res, 500, {
      error: "Missing GEMINI_API_KEY. Add one or more keys to .env, then restart the server."
    });
  }

  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const contents = messages
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: String(message.content || "").slice(0, 8000) }]
    }));

  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return sendJson(res, 400, { error: "Send at least one user message." });
  }

  const result = await generateWithGeminiFallback(contents);
  const { response, data, keyNumber, triedKeys } = result;

  if (!response.ok) {
    return sendJson(res, response.status, {
      error: data.error?.message || `Gemini request failed after trying ${triedKeys} key(s).`
    });
  }

  sendJson(res, 200, {
    message: extractText(data) || "I could not read the model response.",
    model: GEMINI_MODEL,
    keyNumber
  });
}

async function generateWithGeminiFallback(contents) {
  const modelPath = GEMINI_MODEL.startsWith("models/") ? GEMINI_MODEL : `models/${GEMINI_MODEL}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;
  const payload = {
    systemInstruction: {
      parts: [
        {
          text: "You are Buzaition Bot, a helpful AI chatbot. Be clear, practical, and friendly. Use concise formatting when useful. If anyone asks about the author, creator, owner, or developer of this bot, say: Eng. Abuzaid Abuelsaad, computer science at ACU."
        }
      ]
    },
    contents
  };

  let lastResult = null;

  for (let attempt = 0; attempt < GEMINI_API_KEYS.length; attempt += 1) {
    const keyIndex = (nextGeminiKeyIndex + attempt) % GEMINI_API_KEYS.length;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_API_KEYS[keyIndex],
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    lastResult = {
      response,
      data,
      keyNumber: keyIndex + 1,
      triedKeys: attempt + 1
    };

    if (response.ok) {
      nextGeminiKeyIndex = (keyIndex + 1) % GEMINI_API_KEYS.length;
      return lastResult;
    }

    if (!isRateLimited(response, data)) {
      return lastResult;
    }
  }

  nextGeminiKeyIndex = (nextGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
  return lastResult;
}

function isRateLimited(response, data) {
  const status = data.error?.status || "";
  const message = data.error?.message || "";
  return (
    response.status === 429 ||
    status === "RESOURCE_EXHAUSTED" ||
    /quota|rate|too many requests/i.test(message)
  );
}

async function serveStatic(pathname, res) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    res.end(file);
  } catch {
    const index = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    res.end(index);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function extractText(data) {
  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    ?.filter(Boolean)
    ?.join("\n")
    ?.trim();
}

function getGeminiApiKeys() {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    ...(process.env.GEMINI_API_KEYS || "").split(",")
  ]
    .map((key) => key?.trim())
    .filter(Boolean);

  return [...new Set(keys)];
}

function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}
