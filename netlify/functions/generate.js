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
        const mode = String(data?.mode || "student").trim().toLowerCase() === "base" ? "base" : "student";
        const { row, rowObject, rowText, topic, grade, subject, curriculum, maxMarks, requests, questionCount, nameColumn, studentNameHint } = data;
        const answerFormat = String(data?.answerFormat || "blank") === "mcq" ? "mcq" : "blank";
        const learnedContext = typeof data?.learnedContext === "string" ? data.learnedContext.trim() : "";
        const marksColumn = typeof data?.marksColumn === "string" ? data.marksColumn.trim() : "";
        const normalizedNameColumn = typeof nameColumn === "string" ? nameColumn.trim() : "";
        const normalizedStudentNameHint = typeof studentNameHint === "string" ? studentNameHint.trim() : "";
        const score = String(data?.score ?? "").trim();
        const qCount = Math.max(1, Math.min(50, Number.parseInt(questionCount ?? 3, 10) || 3));

        const hasRowObject = rowObject && typeof rowObject === "object" && !Array.isArray(rowObject);
        const providedRowText = typeof rowText === "string" ? rowText.trim() : "";
        let normalizedRowText = providedRowText || (hasRowObject ? JSON.stringify(rowObject) : String(row ?? "").trim());
        if (mode === "student" && !normalizedRowText) throw new Error("Missing row data.");
        if (mode === "base" && !normalizedRowText) normalizedRowText = "(no student data)";
        
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

        const schemaText =
            answerFormat === "mcq"
                ? `{
             "studentName": "string",
             "questions": [
               {
                 "number": 1,
                 "question": "string",
                 "options": ["string", "string", "string", "string"],
                 "correctOption": "A",
                 "answer": "string"
               }
             ]
           }`
                : `{
             "studentName": "string",
             "questions": [
               { "number": 1, "question": "string", "answer": "string" }
             ]
           }`;

        const systemPrompt =
            mode === "base"
                ? `You are an expert educator specializing in the ${curriculum} curriculum.
        Your task is to generate a generic, non-personalized ${qCount}-question worksheet with answers.

        Context:
        - Subject: ${subject}
        - Topic: ${topic}
        - Grade Level: ${grade}
        - Curriculum: ${curriculum}
        - Max Marks: ${maxMarks}
        ${learnedContext ? `- Learning materials summary: ${learnedContext}` : ""}

        Strict Requirements:
        1. Output ONLY valid JSON (no markdown fences, no extra commentary).
        2. The JSON schema must be:
           ${schemaText}
        3. Set "studentName" to exactly: "Baseline Worksheet".
        4. Generate exactly ${qCount} items in "questions" with sequential "number" values from 1..${qCount}.
        ${answerFormat === "mcq" ? '4b. For each question, generate exactly 4 "options" and set "correctOption" to one of "A","B","C","D". The correct answer must match the selected option.' : ""}
        5. Do NOT tailor the worksheet to any student's marks or prior score.
        6. Ensure questions align with ${curriculum} standards.
        7. Special Requirements : ${requests}
        8. Reminder : Questions must only be about ${topic}
        ${learnedContext ? "9. Prefer questions that match the provided learning materials summary; avoid content outside what was taught." : ""}
        10.Warning : Don't use any special characters. Only the numbers and the alphabet.`
                : `You are an expert educator specializing in the ${curriculum} curriculum.
        Your task is to extract a student's name from the provided student row data and generate a personalized ${qCount}-question quiz with answers.
        
        Context:
        - Subject: ${subject}
        - Topic: ${topic}
        - Grade Level: ${grade}
        - Curriculum: ${curriculum}
        - Student's Previous Score: ${score ? score : "(Found in data)"} out of ${maxMarks}${marksColumn ? ` (Marks column: ${marksColumn})` : ""}
        ${normalizedNameColumn ? `- Student name column: ${normalizedNameColumn}` : ""}
        ${normalizedStudentNameHint ? `- Student name (from selected column): ${normalizedStudentNameHint}` : ""}
        ${learnedContext ? `- Learning materials summary: ${learnedContext}` : ""}
        
        Strict Requirements:
        1. Output ONLY valid JSON (no markdown fences, no extra commentary).
        2. The JSON schema must be:
           ${schemaText}
        3. Generate exactly ${qCount} items in "questions" with sequential "number" values from 1..${qCount}.
        ${answerFormat === "mcq" ? '3b. For each question, generate exactly 4 "options" and set "correctOption" to one of "A","B","C","D". The correct answer must match the selected option.' : ""}
        4. Adjust difficulty based on previous score (lower score = more scaffolding; higher score = higher-order thinking).
        5. Ensure questions align with ${curriculum} standards.
        6. Special Requirements : ${requests}
        7. Reminder : Questions must only be about ${topic}
        ${learnedContext ? "8. Prefer questions that match the provided learning materials summary; avoid content outside what was taught." : ""}
        9.Warning (Important): Use only the numbers and the alphabet and a few exceptions which are the symbols : . , ? + - / * () If necessary, please use this symbols intead of words.`;
        

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: hasRowObject
                        ? `MODE: ${mode}\nANSWER_FORMAT: ${answerFormat}\nMARKS_COLUMN: ${marksColumn}\nNAME_COLUMN: ${normalizedNameColumn}\nSTUDENT_NAME_HINT: ${normalizedStudentNameHint}\nSCORE: ${score}\nDATA ROW (${providedRowText ? "TEXT" : "JSON OBJECT"}): ${normalizedRowText}\nSPECIAL REQUESTS: ${requests}`
                        : `MODE: ${mode}\nANSWER_FORMAT: ${answerFormat}\nMARKS_COLUMN: ${marksColumn}\nNAME_COLUMN: ${normalizedNameColumn}\nSTUDENT_NAME_HINT: ${normalizedStudentNameHint}\nSCORE: ${score}\nDATA ROW (${providedRowText ? "TEXT" : "RAW CSV LINE"}): ${normalizedRowText}\nSPECIAL REQUESTS: ${requests}`,
                }
            ],
            model: "openai/gpt-oss-120B",
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

        if (answerFormat === "mcq") {
            for (const q of quiz.questions) {
                if (!q || typeof q !== "object") throw new Error("Invalid question format.");
                if (!Array.isArray(q.options) || q.options.length !== 4) throw new Error("MCQ requires exactly 4 options per question.");
                if (!q.correctOption || typeof q.correctOption !== "string") throw new Error("MCQ requires correctOption.");
                const letter = q.correctOption.trim().toUpperCase();
                if (!["A", "B", "C", "D"].includes(letter)) throw new Error('correctOption must be one of "A","B","C","D".');
                q.correctOption = letter;
            }
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
