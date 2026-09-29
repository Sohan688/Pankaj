const { analyzeWithOpenAI } = require("../server");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const { items } = request.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return response.status(400).json({ error: "Provide at least one feedback item." });
  }
  if (!process.env.OPENAI_API_KEY) {
    return response.status(503).json({
      error: "AI analysis is not configured. Set OPENAI_API_KEY or use the included demo analysis.",
    });
  }

  try {
    const results = await analyzeWithOpenAI(items.slice(0, 50));
    return response.status(200).json({ results });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
};
