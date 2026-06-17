const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
let nextGeminiKeyIndex = 0;

export function getHealth() {
  const keys = getGeminiApiKeys();

  return {
    ok: keys.length > 0,
    model: GEMINI_MODEL,
    keys: keys.length,
    message: keys.length
      ? `Ready with ${keys.length} key(s)`
      : "Missing GEMINI_API_KEY",
  };
}

export async function generateChat(messages) {
  const keys = getGeminiApiKeys();

  if (!keys.length) {
    return {
      status: 500,
      body: {
        error:
          "Missing GEMINI_API_KEY. Add one or more keys to Vercel environment variables.",
      },
    };
  }

  const contents = messages
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: String(message.content || "").slice(0, 8000) }],
    }));

  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return {
      status: 400,
      body: { error: "Send at least one user message." },
    };
  }

  const result = await generateWithGeminiFallback(contents, keys);
  const { response, data, keyNumber, triedKeys } = result;

  if (!response.ok) {
    return {
      status: response.status,
      body: {
        error:
          data.error?.message ||
          `Gemini request failed after trying ${triedKeys} key(s).`,
      },
    };
  }

  return {
    status: 200,
    body: {
      message: extractText(data) || "I could not read the model response.",
      model: GEMINI_MODEL,
      keyNumber,
    },
  };
}

async function generateWithGeminiFallback(contents, keys) {
  const modelPath = GEMINI_MODEL.startsWith("models/")
    ? GEMINI_MODEL
    : `models/${GEMINI_MODEL}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;

  const payload = {
    systemInstruction: {
      parts: [
        {
          text:
            "You are Buzaition Bot, a helpful AI chatbot. Be clear, practical, and friendly. If anyone asks about the author, creator, owner, or developer of this bot, say: Eng. Abuzaid Abuelsaad, computer science at ACU.",
        },
      ],
    },
    contents,
  };

  let lastResult = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyIndex = (nextGeminiKeyIndex + attempt) % keys.length;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": keys[keyIndex],
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    lastResult = {
      response,
      data,
      keyNumber: keyIndex + 1,
      triedKeys: attempt + 1,
    };

    if (response.ok) {
      nextGeminiKeyIndex = (keyIndex + 1) % keys.length;
      return lastResult;
    }

    if (!isRateLimited(response, data)) {
      return lastResult;
    }
  }

  nextGeminiKeyIndex = (nextGeminiKeyIndex + 1) % keys.length;
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
    ...(process.env.GEMINI_API_KEYS || "").split(","),
  ]
    .map((key) => key?.trim())
    .filter(Boolean);

  return [...new Set(keys)];
}
