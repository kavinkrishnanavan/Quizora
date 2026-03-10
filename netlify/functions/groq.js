const Groq = require("groq-sdk");

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { row, topic, grade, subject, requests } = JSON.parse(event.body);
        const groq = new Groq({ apiKey: process.env.GROQ_API });

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "You are an expert teacher. Your task is to extract the student's name from the raw data provided and generate a personalized 3-question quiz."
                },
                {
                    role: "user",
                    content: `
                        RAW DATA: ${row}
                        TOPIC: ${topic}
                        SUBJECT: ${subject}
                        GRADE: ${grade}
                        SPECIAL REQUESTS: ${requests}

                        INSTRUCTIONS:
                        1. Identify the student name from the RAW DATA.
                        2. Create a 3-question quiz tailored to the student.
                        3. Start your response EXACTLY with "Student Name: [Extracted Name]".
                    `
                }
            ],
            model: "llama-3.3-70b-versatile", // High speed, high intelligence
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ text: completion.choices[0].message.content }),
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};