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

        const data = JSON.parse(event.body);
        const { row, topic, grade, subject, curriculum, maxMarks, requests, questionCount } = data;
        const qCount = Math.max(1, Math.min(50, Number.parseInt(questionCount ?? 3, 10) || 3));
        
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

        const systemPrompt = `You are an expert educator specializing in the ${curriculum} curriculum.
        Your task is to extract a student's name from raw CSV data and generate a personalized ${qCount}-question quiz with answers.
        
        Context:
        - Subject: ${subject}
        - Topic: ${topic}
        - Grade Level: ${grade}
        - Curriculum: ${curriculum}
        - Student's Previous Score: (Found in data) out of ${maxMarks}
        
        Strict Requirements:
        1. Output ONLY valid JSON (no markdown fences, no extra commentary).
        2. The JSON schema must be:
           {
             "studentName": "string",
             "questions": [
               { "number": 1, "question": "string", "answer": "string" }
             ]
           }
        3. Generate exactly ${qCount} items in "questions" with sequential "number" values from 1..${qCount}.
        4. Adjust difficulty based on previous score (lower score = more scaffolding; higher score = higher-order thinking).
        5. Ensure questions align with ${curriculum} standards.
        6. Special Requirements : ${requests}`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `DATA ROW: ${row}\nSPECIAL REQUESTS: ${requests}` }
            ],
            model: "llama-3.3-70b-versatile",
        });

        const text = completion?.choices?.[0]?.message?.content;
        if (!text) {
            throw new Error("Groq returned no content.");
        }

        let quiz = null;
        try {
            quiz = JSON.parse(text);
        } catch (_) {
            // Some models occasionally wrap JSON; strip common wrappers and retry.
            const cleaned = String(text)
                .trim()
                .replace(/^```json\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/```$/i, "")
                .trim();

            try {
                quiz = JSON.parse(cleaned);
            } catch (e2) {
                // Last resort: extract the largest JSON object substring.
                const first = cleaned.indexOf("{");
                const last = cleaned.lastIndexOf("}");
                if (first >= 0 && last > first) {
                    quiz = JSON.parse(cleaned.slice(first, last + 1));
                } else {
                    throw e2;
                }
            }
        }

        if (!quiz || typeof quiz !== "object") throw new Error("Invalid quiz JSON.");
        if (!quiz.studentName || typeof quiz.studentName !== "string") throw new Error("Missing studentName.");
        if (!Array.isArray(quiz.questions) || quiz.questions.length !== qCount) {
            throw new Error(`Expected exactly ${qCount} questions.`);
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quiz }),
        };
    } catch (error) {
        const requestId =
            event.headers?.["x-nf-request-id"] ||
            event.headers?.["x-request-id"] ||
            event.headers?.["x-amzn-trace-id"] ||
            "";

        console.error("generate error", { requestId, message: error?.message, stack: error?.stack });

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
