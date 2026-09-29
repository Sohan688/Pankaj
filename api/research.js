const {
  analyzeWithOpenAI,
  collectFromPlatforms,
  summarizeWithOpenAI,
} = require("../server");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const { query = "find old photo", startDate, endDate } = request.body || {};
  if (!startDate || !endDate || startDate > endDate) {
    return response.status(400).json({ error: "Provide a valid start and end date." });
  }

  try {
    const collection = await collectFromPlatforms(query, startDate, endDate);
    if (!collection.items.length) {
      return response.status(200).json({ ...collection, analysis: [], summary: null });
    }
    if (!process.env.OPENAI_API_KEY) {
      return response.status(200).json({
        ...collection,
        analysis: [],
        summary: null,
        aiError: "OPENAI_API_KEY is not configured; collection completed without AI synthesis.",
      });
    }

    const analysis = await analyzeWithOpenAI(collection.items);
    const summary = await summarizeWithOpenAI(
      collection.items,
      analysis,
      { startDate, endDate },
    );
    return response.status(200).json({ ...collection, analysis, summary });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
};
