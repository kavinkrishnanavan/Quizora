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
      "paragraphs": ["string"],
      "bullets": ["string"],
      "imageUrls": ["string"],
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
4) Each slide must have 1-3 "paragraphs" (40-90 words each), unless it's a title slide (then paragraphs can be []).
5) Each slide can have 0-6 bullets; keep bullets short (<= 12 words each) and concrete.
6) Title slide (slide 1) can have 0 images. Every other slide must have exactly 1 image URL in "imageUrls".
7) The image URL MUST be in this exact format (so it always works in a browser):
   https://source.unsplash.com/1600x900/?<comma-separated-keywords>
   Example: https://source.unsplash.com/1600x900/?linear,equations,math,classroom
8) Do not use any other image host. No data: URLs.
9) Avoid repeating the same bullet or paragraph idea across slides.
10) Use safe plain text only. Do not include links inside paragraphs/bullets. Put images only in "imageUrls".`;

    const extractJsonCandidate = (raw) => {
      let s = String(raw || "").trim();
      s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start >= 0 && end > start) s = s.slice(start, end + 1);
      return s.trim();
    };

    const normalizeJsonText = (raw) => {
      let s = extractJsonCandidate(raw);
      s = s
        .replaceAll("\u201c", '"')
        .replaceAll("\u201d", '"')
        .replaceAll("\u2018", "'")
        .replaceAll("\u2019", "'")
        .replaceAll("\u00a0", " ");
      // Remove trailing commas before ] or }
      s = s.replace(/,\s*([}\]])/g, "$1");
      return s;
    };

    const parseJsonLoose = (raw) => {
      const s1 = extractJsonCandidate(raw);
      try {
        return JSON.parse(s1);
      } catch (_) {
        const s2 = normalizeJsonText(raw);
        return JSON.parse(s2);
      }
    };

    const getCompletionText = async (messages) => {
      const completion = await groq.chat.completions.create({
        model: "openai/gpt-oss-120B",
        messages,
      });
      return String(completion?.choices?.[0]?.message?.content || "").trim();
    };

    let text = "";
    let deck = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      text = await getCompletionText([
        {
          role: "system",
          content:
            "You are an expert teacher and presentation designer. Follow the schema precisely and return strictly valid JSON.",
        },
        { role: "user", content: prompt },
      ]);
      if (!text) continue;
      try {
        deck = parseJsonLoose(text);
        break;
      } catch (err) {
        // Ask Groq to repair its own output into strict JSON.
        const repairPrompt = `Your previous output was NOT valid JSON.
Fix it and output ONLY valid JSON that matches this schema exactly:
${schema}

Rules:
- Do not add any extra keys.
- Ensure all arrays/strings are valid JSON (double quotes, escaped characters).
- Keep exactly ${slideCount} slides.

INVALID_OUTPUT:
${text}`;

        const repaired = await getCompletionText([
          {
            role: "system",
            content:
              "You repair invalid JSON into valid JSON. Output strictly valid JSON only.",
          },
          { role: "user", content: repairPrompt },
        ]);
        if (!repaired) continue;
        try {
          deck = parseJsonLoose(repaired);
          text = repaired;
          break;
        } catch (_) {
          // loop and try again
        }
      }
    }

    if (!deck) {
      throw new Error(
        "Groq returned invalid JSON for the deck. Please click Generate again."
      );
    }

    if (!deck || typeof deck !== "object") throw new Error("Invalid deck JSON.");
    if (!deck.title || typeof deck.title !== "string") throw new Error("Missing title.");
    if (!Array.isArray(deck.slides) || deck.slides.length !== slideCount) {
      throw new Error(`Expected exactly ${slideCount} slides.`);
    }

    const buildUnsplashUrl = (keywords) => {
      const cleaned = String(keywords || "")
        .replace(/[^a-zA-Z0-9\s,-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const parts = cleaned
        ? cleaned
            .split(/[,]/g)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const joined = (parts.length ? parts : [topic]).join(",");
      return `https://source.unsplash.com/1600x900/?${encodeURIComponent(joined).replace(/%2C/g, ",")}`;
    };

    deck.slides = deck.slides.map((s, i) => {
      const slide = s && typeof s === "object" ? s : {};

      if (!Array.isArray(slide.paragraphs)) slide.paragraphs = [];
      if (!Array.isArray(slide.bullets)) slide.bullets = [];
      if (!Array.isArray(slide.imageUrls)) slide.imageUrls = [];
      if (typeof slide.speakerNotes !== "string") slide.speakerNotes = "";
      if (typeof slide.visualHint !== "string") slide.visualHint = "";

      slide.paragraphs = slide.paragraphs
        .filter((p) => typeof p === "string" && p.trim())
        .map((p) => p.trim())
        .slice(0, 4);

      slide.bullets = slide.bullets
        .filter((b) => typeof b === "string" && b.trim())
        .map((b) => b.trim())
        .slice(0, 8);

      slide.imageUrls = slide.imageUrls
        .filter((u) => typeof u === "string" && u.trim())
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u))
        .filter((u) => !/^data:/i.test(u))
        .slice(0, 2);

      const isTitle = i === 0;
      const hasUnsplashUrl = slide.imageUrls.some((u) => /^https:\/\/source\.unsplash\.com\/1600x900\/\?/i.test(u));

      if (isTitle) {
        // Allow 0 images for title.
        slide.imageUrls = hasUnsplashUrl ? [slide.imageUrls.find((u) => /^https:\/\/source\.unsplash\.com\/1600x900\/\?/i.test(u))] : [];
      } else {
        // Force exactly 1 reliable image URL.
        if (!hasUnsplashUrl) {
          const keywords = [topic, slide.heading, slide.visualHint].filter(Boolean).join(", ");
          slide.imageUrls = [buildUnsplashUrl(keywords)];
        } else {
          slide.imageUrls = [slide.imageUrls.find((u) => /^https:\/\/source\.unsplash\.com\/1600x900\/\?/i.test(u))];
        }
      }

      return slide;
    });

    for (const slide of deck.slides) {
      if (!slide || typeof slide !== "object") throw new Error("Invalid slide format.");
      if (!slide.heading || typeof slide.heading !== "string") throw new Error("Slide missing heading.");
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
