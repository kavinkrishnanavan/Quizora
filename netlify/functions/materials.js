const Groq = require("groq-sdk");
const cheerio = require("cheerio");
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

async function readResponseBodyWithLimit(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("Response too large.");
    return buf;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) throw new Error("Response too large.");
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

async function extractTextFromPdfBuffer(buffer) {
  const parsed = await pdfParse(buffer);
  const text = normalizeWhitespace(parsed?.text || "");
  return text;
}

async function extractTextFromPdfBase64(base64) {
  const buffer = Buffer.from(String(base64 || ""), "base64");
  return extractTextFromPdfBuffer(buffer);
}

async function extractTextFromHtml(html) {
  const $ = cheerio.load(String(html || ""));
  $("script,style,noscript,svg,canvas,iframe,form,nav,header,footer").remove();
  const text = normalizeWhitespace($("body").text());
  return text;
}

async function fetchUrlContent(url, { timeoutMs = 12000, maxBytes = 1_500_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const u = new URL(url);
    const host = String(u.hostname || "").toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) {
      throw new Error("Blocked host.");
    }
    if (host === "169.254.169.254") {
      throw new Error("Blocked host.");
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      const [a, b] = host.split(".").map((n) => Number.parseInt(n, 10));
      if (a === 10) throw new Error("Blocked host.");
      if (a === 127) throw new Error("Blocked host.");
      if (a === 0) throw new Error("Blocked host.");
      if (a === 192 && b === 168) throw new Error("Blocked host.");
      if (a === 172 && b >= 16 && b <= 31) throw new Error("Blocked host.");
    }

    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": "Quiz-Wiz/1.0 (+https://example.invalid)",
        accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      throw new Error(`Fetch failed (${res.status})`);
    }

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    const buf = await readResponseBodyWithLimit(res, maxBytes);
    return { contentType, buffer: buf };
  } finally {
    clearTimeout(timer);
  }
}

async function extractTextFromUrl(url) {
  const { contentType, buffer } = await fetchUrlContent(url);

  if (contentType.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
    const text = await extractTextFromPdfBuffer(buffer);
    return { kind: "pdf", text };
  }

  const html = buffer.toString("utf8");
  const text = await extractTextFromHtml(html);
  return { kind: "html", text };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const payload = JSON.parse(event.body || "{}");
    const pdfs = Array.isArray(payload.pdfs) ? payload.pdfs : [];
    const urls = Array.isArray(payload.urls) ? payload.urls : [];

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

    for (const url of urls.slice(0, 10)) {
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
      try {
        const { kind, text } = await extractTextFromUrl(url);
        if (text.length < 50) warnings.push(`Low text extracted from link (${kind}).`);
        parts.push(`SOURCE: URL (${kind}) ${url}\n${text}`);
      } catch (e) {
        warnings.push(`Failed to fetch ${url}: ${e?.message || "unknown error"}`);
      }
    }

    const combinedRaw = normalizeWhitespace(parts.join("\n\n"));
    if (!combinedRaw) {
      throw new Error("No text could be extracted from the provided PDFs/links.");
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
