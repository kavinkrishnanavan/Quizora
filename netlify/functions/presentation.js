const Groq = require("groq-sdk");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    if (!process.env.GROQ_API_KEY) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Missing GROQ_API_KEY in environment variables",
        }),
      };
    }

    const body = JSON.parse(event.body || "{}");

    const topic = body.topic?.trim();
    const audience = body.audience?.trim() || "General audience";
    const tone = body.tone?.trim() || "Clear and student-friendly";
    const extra = body.extra?.trim() || "";
    const slideCount = Math.max(
      3,
      Math.min(20, parseInt(body.slideCount || 8, 10))
    );

    if (!topic) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing topic" }),
      };
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const schema = {
      title: "string",
      subtitle: "string",
      slides: [
        {
          heading: "string",
          paragraphs: ["string"],
          bullets: ["string"],
          speakerNotes: "string",
          visualHint: "string",
        },
      ],
    };

    const prompt = `
Create a presentation JSON ONLY.

Topic: ${topic}
Audience: ${audience}
Tone: ${tone}
Slides: ${slideCount}
Extra: ${extra}

RULES:
- Output ONLY valid JSON
- Must match this structure:
${JSON.stringify(schema, null, 2)}
- Exactly ${slideCount} slides
- No markdown, no explanation, no extra text
- No trailing commas
`;

    const getResponse = async () => {
      const res = await groq.chat.completions.create({
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content:
              "You are a strict JSON generator. Output ONLY valid JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      });

      return res?.choices?.[0]?.message?.content?.trim();
    };

    const cleanJSON = (text) => {
      if (!text) return null;

      // remove markdown fences if any
      let cleaned = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      // extract JSON block
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start === -1 || end === -1) return null;

      cleaned = cleaned.slice(start, end + 1);

      return JSON.parse(cleaned);
    };

    let deck = null;
    let raw = "";

    for (let i = 0; i < 3; i++) {
      raw = await getResponse();

      try {
        deck = cleanJSON(raw);
        if (deck) break;
      } catch (e) {
        deck = null;
      }
    }

    if (!deck) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Failed to generate valid presentation JSON",
        }),
      };
    }

    // Validation + cleanup
    if (!Array.isArray(deck.slides)) {
      throw new Error("Invalid slides format");
    }

    deck.slides = deck.slides.slice(0, slideCount).map((s) => ({
      heading: s.heading || "Untitled",
      paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs : [],
      bullets: Array.isArray(s.bullets) ? s.bullets : [],
      speakerNotes: s.speakerNotes || "",
      visualHint: s.visualHint || "",
    }));

    deck.slides = deck.slides.map((s) => ({
      ...s,
      paragraphs: s.paragraphs.slice(0, 3),
      bullets: s.bullets.slice(0, 6),
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({ deck }),
    };
  } catch (err) {
    console.error("Generate error:", err);

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: err.message || "Unknown error",
      }),
    };
  }
};