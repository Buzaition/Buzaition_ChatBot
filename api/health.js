import { getHealth } from "./_gemini.js";

export default function handler(req, res) {
  return res.status(200).json(getHealth());
}
