import Groq from "groq-sdk";

export async function handler(event) {
  try {
    // Parse JSON body
    const { image } = JSON.parse(event.body);

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });

    // Ask AI to return JSON for each question
    const prompt = `
You are an exam marker AI.

Grade this worksheet image and return JSON in this format:
{
  "questions": [
    {
      "student_answer": "...",
      "correct_answer": "...",
      "correct": true/false,
      "score": 0-5
    },
    ...
  ]
}

Do NOT return any extra text. Only JSON.
`;

    const response = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image } }
          ]
        }
      ]
    });

    // Get AI response
    const aiText = response.choices[0].message.content;

    // Try parsing AI JSON safely
    let questions = [];
    try {
      questions = JSON.parse(aiText).questions || [];
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "AI did not return valid JSON" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ questions })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}