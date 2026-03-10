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
        Your task is to extract a student's name from raw CSV data and generate a personalized ${qCount}-question quiz.
        
        Context:
        - Subject: ${subject}
        - Topic: ${topic}
        - Grade Level: ${grade}
        - Curriculum: ${curriculum}
        - Student's Previous Score: (Found in data) out of ${maxMarks}
        
        Strict Requirements:
        1. Start response with "Student Name: [Extracted Name]"
        2. Adjust question difficulty based on their previous score (Lower score = more scaffolding/easier; Higher score = higher-order thinking).
        3. Generate exactly ${qCount} questions.
        4. Ensure questions align with ${curriculum} standards.`;

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

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
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
