import Groq from "groq-sdk";

export const config = {
  api: {
    bodyParser: false
  }
};

export async function handler(event){

try{

const buffer = Buffer.from(event.body, "base64");

const imageBase64 = buffer.toString("base64");

const groq = new Groq({
apiKey: process.env.GROQ_API_KEY
});

const response = await groq.chat.completions.create({
model: "meta-llama/llama-4-scout-17b-16e-instruct",
messages: [
{
role: "user",
content: [
{
type: "text",
text: "Grade this worksheet. Identify questions and give marks out of 5."
},
{
type: "image_url",
image_url: {
url: `data:image/png;base64,${imageBase64}`
}
}
]
}
]
});

const result = response.choices[0].message.content;

return {
statusCode:200,
body:JSON.stringify({
result
})
};

}catch(err){

return{
statusCode:500,
body:JSON.stringify({
error:err.message
})
};

}

}