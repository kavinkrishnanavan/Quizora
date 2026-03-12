import Groq from "groq-sdk";

export async function handler(event){

try{

const {text} = JSON.parse(event.body);

const groq = new Groq({
apiKey: process.env.GROQ_API_KEY
});

const prompt = `
You are an exam marker.

Grade the student's worksheet answers.

Student Answers:
${text}

Rules:
- Give marks out of 5 per question
- Give short feedback
- Show total score

Format clearly.
`;

const response = await groq.chat.completions.create({
model:"llama3-70b-8192",
messages:[
{
role:"user",
content:prompt
}
]
});

const result = response.choices[0].message.content;

return{
statusCode:200,
body:JSON.stringify({
result
})
};

}catch(error){

return{
statusCode:500,
body:JSON.stringify({
error:error.message
})
};

}

}