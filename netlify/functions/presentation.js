const Groq = require("groq-sdk");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    if (!process.env.GROQ_API_KEY) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Missing GROQ_API_KEY. Set it in your Netlify site environment variables.",
        }),
      };
    }

    const data = JSON.parse(event.body || "{}");
    const topic = typeof data?.topic === "string" ? data.topic.trim() : "";
    const audience = typeof data?.audience === "string" ? data.audience.trim() : "";
    const tone = typeof data?.tone === "string" ? data.tone.trim() : "Clear, student-friendly";
    const extra = typeof data?.extra === "string" ? data.extra.trim() : "";
    const slideCountRaw = Number.parseInt(data?.slideCount ?? 8, 10);
    const slideCount = Math.max(3, Math.min(20, Number.isFinite(slideCountRaw) ? slideCountRaw : 8));

    if (!topic) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing topic." }),
      };
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const schema = `{
  "title": "string",
  "subtitle": "string",
  "slides": [
    {
      "heading": "string",
      "bullets": ["string"],
      "speakerNotes": "string",
      "visualHint": "string"
    }
  ]
}`;

    const prompt = `Create a slide deck outline for the topic below.

Topic: ${topic}
Audience: ${audience || "(not provided)"}
Tone: ${tone}
Slides: exactly ${slideCount} slides
Extra instructions: ${extra || "(none)"}

Strict requirements:
1) Output ONLY valid JSON (no markdown fences, no extra text).
2) The JSON must match this schema exactly:
${schema}
3) "slides" must have exactly ${slideCount} items.
4) Each slide must have 3-6 bullets max, unless it's a title/closing slide (then bullets can be []).
5) Keep bullets short (<= 12 words each) and concrete.
6) Avoid repeating the same bullet across slides.
7) Use safe plain text only (no links, no code blocks).`;

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120B",
      messages: [
        {
          role: "system",
          content:
            "You are an expert teacher and presentation designer. Follow the schema precisely and return strictly valid JSON.",
        },
        { role: "user", content: prompt },
      ],
    });

    const text = String(completion?.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("Groq returned no content.");

    const parseJsonLoose = (raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) {
          const sliced = raw.slice(start, end + 1);
          return JSON.parse(sliced);
        }
        throw new Error("Invalid JSON returned by Groq.");
      }
    };

    const deck = parseJsonLoose(text);

    if (!deck || typeof deck !== "object") throw new Error("Invalid deck JSON.");
    if (!deck.title || typeof deck.title !== "string") throw new Error("Missing title.");
    if (!Array.isArray(deck.slides) || deck.slides.length !== slideCount) {
      throw new Error(`Expected exactly ${slideCount} slides.`);
    }

    for (const slide of deck.slides) {
      if (!slide || typeof slide !== "object") throw new Error("Invalid slide format.");
      if (!slide.heading || typeof slide.heading !== "string") throw new Error("Slide missing heading.");
      if (!Array.isArray(slide.bullets)) throw new Error("Slide missing bullets array.");
      if (typeof slide.speakerNotes !== "string") slide.speakerNotes = "";
      if (typeof slide.visualHint !== "string") slide.visualHint = "";
      slide.bullets = slide.bullets
        .filter((b) => typeof b === "string" && b.trim())
        .map((b) => b.trim())
        .slice(0, 8);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck }),
    };
  } catch (error) {
    const requestId =
      event.headers?.["x-nf-request-id"] ||
      event.headers?.["x-request-id"] ||
      event.headers?.["x-amzn-trace-id"] ||
      "";

    console.error("presentation error", { requestId, message: error?.message, stack: error?.stack });

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: error?.message || "Unknown error",
        requestId,
      }),
    };
  }
};

