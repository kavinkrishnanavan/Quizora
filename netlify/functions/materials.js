const Groq = require("groq-sdk");
const JSZip = require("jszip");
const mammoth = require("mammoth");
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

function decodeXmlEntities(input) {
  const text = String(input || "");
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code)) return "";
      try {
        return String.fromCodePoint(code);
      } catch (_) {
        return "";
      }
    })
    .replace(/&#([0-9]+);/g, (_, num) => {
      const code = Number.parseInt(num, 10);
      if (!Number.isFinite(code)) return "";
      try {
        return String.fromCodePoint(code);
      } catch (_) {
        return "";
      }
    });
}

async function extractTextFromPdfBuffer(buffer) {
  const parsed = await pdfParse(buffer);
  return normalizeWhitespace(parsed?.text || "");
}

async function extractTextFromDocxBuffer(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeWhitespace(result?.value || "");
}

async function extractTextFromPptxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const an = Number(String(a).match(/slide(\d+)\.xml/i)?.[1] || 0);
      const bn = Number(String(b).match(/slide(\d+)\.xml/i)?.[1] || 0);
      return an - bn;
    });

  const allText = [];
  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const matches = String(xml).matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi);
    for (const m of matches) {
      const t = decodeXmlEntities(m?.[1] || "");
      if (t) allText.push(t);
    }
  }

  return normalizeWhitespace(allText.join("\n"));
}

function detectFileKind({ name, mime }) {
  const n = String(name || "").toLowerCase();
  const m = String(mime || "").toLowerCase();

  if (n.endsWith(".pdf") || m === "application/pdf") return "pdf";
  if (n.endsWith(".docx") || m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (n.endsWith(".pptx") || m === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (n.endsWith(".ppt") || m === "application/vnd.ms-powerpoint") return "ppt";

  return "";
}

function bufferFromBase64(base64) {
  return Buffer.from(String(base64 || ""), "base64");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const payload = JSON.parse(event.body || "{}");
    const files = Array.isArray(payload.files) ? payload.files : Array.isArray(payload.pdfs) ? payload.pdfs : [];
    const pastedText = typeof payload.pastedText === "string" ? payload.pastedText.trim() : "";

    const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
    const topic = typeof payload.topic === "string" ? payload.topic.trim() : "";
    const grade = typeof payload.grade === "string" ? payload.grade.trim() : "";
    const curriculum = typeof payload.curriculum === "string" ? payload.curriculum.trim() : "";

    const warnings = [];
    const parts = [];

    const maxBytesPerFile = 4 * 1024 * 1024;

    for (const f of files.slice(0, 5)) {
      const name = typeof f?.name === "string" ? f.name.trim() : "File";
      const data = typeof f?.data === "string" ? f.data.trim() : "";
      const mime = typeof f?.mime === "string" ? f.mime.trim() : "";
      if (!data) continue;

      const kind = detectFileKind({ name, mime });
      if (!kind) {
        warnings.push(`Unsupported file type: ${name}. Use PDF, DOCX, or PPTX.`);
        continue;
      }

      if (kind === "ppt") {
        warnings.push(`PowerPoint .ppt is not supported for text extraction: ${name}. Please save as .pptx or export to PDF.`);
        continue;
      }

      let buffer = null;
      try {
        buffer = bufferFromBase64(data);
      } catch (_) {
        warnings.push(`Could not read file: ${name}.`);
        continue;
      }

      if (buffer.length > maxBytesPerFile) {
        warnings.push(`File too large: ${name} (max 4MB).`);
        continue;
      }

      let text = "";
      try {
        if (kind === "pdf") text = await extractTextFromPdfBuffer(buffer);
        if (kind === "docx") text = await extractTextFromDocxBuffer(buffer);
        if (kind === "pptx") text = await extractTextFromPptxBuffer(buffer);
      } catch (err) {
        warnings.push(`Could not extract text from ${name}.`);
        continue;
      }

      if (text.length < 50) warnings.push(`Low text extracted from ${name} (may be scanned / image-based).`);
      const label = kind.toUpperCase();
      parts.push(`SOURCE: ${label} (${name})\n${text}`);
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
