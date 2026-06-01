import { generateChat } from "./_gemini.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const result = await generateChat(messages);

    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
}
