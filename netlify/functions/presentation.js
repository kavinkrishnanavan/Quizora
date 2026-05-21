const Groq = require("groq-sdk");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    if (!process.env.GROQ_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing GROQ_API_KEY" }),
      };
    }

    const body = JSON.parse(event.body || "{}");

    const topic = body.topic?.trim();
    if (!topic) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing topic" }),
      };
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const prompt = `
You are an expert presentation designer.

Generate a COMPLETE HTML DOCUMENT for a presentation.

STRICT RULES:
- Output ONLY raw HTML (no markdown, no explanation)
- Must include <html>, <head>, <style>, <body>
- Must include next/previous navigation buttons
- Must be about: ${topic}
- Must fit full screen
- Must NOT include JSON
- Must NOT include backticks
- Must NOT include any text outside HTML
- !important! Every slide must be creative and colorful !important!
- !important! Every slide must be in a different format and must be visually attractive instead of a boring same format !important!
- !important! Information must be clearly visible !important!

FEATURES REQUIRED:
- Fullscreen slides
- One slide visible at a time
- Navigation buttons (Next / Prev)
- Smooth design
`;


    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content:
            "You generate only complete HTML documents. No extra text allowed.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    const html = completion?.choices?.[0]?.message?.content || "";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ html }),
    };
  } catch (err) {
    console.error(err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Server error",
      }),
    };
  }
};