const Groq = require("groq-sdk");
const pdfParse = require("pdf-parse");

function clampString(text, maxLen) {
  const normalized = String(text || "");
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen);
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function extractTextFromPdfBuffer(buffer) {
  const parsed = await pdfParse(buffer);
  return normalizeWhitespace(parsed?.text || "");
}

async function extractTextFromPdfBase64(base64) {
  const buffer = Buffer.from(String(base64 || ""), "base64");
  return extractTextFromPdfBuffer(buffer);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const payload = JSON.parse(event.body || "{}");
    const pdfs = Array.isArray(payload.pdfs) ? payload.pdfs : [];
    const pastedText = typeof payload.pastedText === "string" ? payload.pastedText.trim() : "";

    const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
    const topic = typeof payload.topic === "string" ? payload.topic.trim() : "";
    const grade = typeof payload.grade === "string" ? payload.grade.trim() : "";
    const curriculum = typeof payload.curriculum === "string" ? payload.curriculum.trim() : "";

    const warnings = [];
    const parts = [];

    for (const p of pdfs.slice(0, 5)) {
      const name = typeof p?.name === "string" ? p.name.trim() : "PDF";
      const data = typeof p?.data === "string" ? p.data.trim() : "";
      if (!data) continue;
      const text = await extractTextFromPdfBase64(data);
      if (text.length < 50) warnings.push(`Low text extracted from ${name} (may be scanned).`);
      parts.push(`SOURCE: PDF (${name})\n${text}`);
    }

    if (pastedText) {
      const normalized = normalizeWhitespace(pastedText);
      if (normalized.length < 50) warnings.push("Pasted text looks very short.");
      parts.push(`SOURCE: PASTED TEXT\n${normalized}`);
    }

    const combinedRaw = normalizeWhitespace(parts.join("\n\n"));
    if (!combinedRaw) {
      throw new Error("No text could be extracted from the provided PDF(s) or pasted text.");
    }

    const rawForModel = clampString(combinedRaw, 35_000);

    if (!process.env.GROQ_API_KEY) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learnedContext: clampString(rawForModel, 2500),
          warnings: warnings.concat(["Missing GROQ_API_KEY, returning raw extracted text instead of a summary."]),
        }),
      };
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const systemPrompt = `You are an expert teacher. Summarize the provided course materials into a short "what students have learned" profile that will be used to generate personalized quizzes.

Constraints:
1. Output plain text only (no JSON, no markdown).
2. Keep it concise (max ~1200 characters).
3. Use short lines. Avoid bullet symbols like "-" or "*".
4. Focus on: key learning objectives, key terms, core procedures, and typical mistakes.
5. If the content is broad, prioritize what best matches the Topic.

Class context:
- Subject: ${subject || "(unknown)"}
- Topic: ${topic || "(unknown)"}
- Grade: ${grade || "(unknown)"}
- Curriculum: ${curriculum || "(unknown)"}`;

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120B",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: rawForModel },
      ],
    });

    const learnedContext = normalizeWhitespace(completion?.choices?.[0]?.message?.content || "");
    if (!learnedContext) throw new Error("AI returned no summary.");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learnedContext: clampString(learnedContext, 2500),
        warnings,
      }),
    };
  } catch (error) {
    const requestId =
      event.headers?.["x-nf-request-id"] ||
      event.headers?.["x-request-id"] ||
      event.headers?.["x-amzn-trace-id"] ||
      "";

    console.error("materials error", { requestId, message: error?.message, stack: error?.stack });

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

