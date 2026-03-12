import Groq from "groq-sdk";

export async function handler(event){

try{

const { image } = JSON.parse(event.body);

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
text: "Read this worksheet image and grade the answers. Give marks out of 5."
},
{
type: "image_url",
image_url: {
url: image
}
}
]
}
]
});

return {
statusCode:200,
body:JSON.stringify({
result: response.choices[0].message.content
})
};

}catch(err){

return{
statusCode:500,
body:JSON.stringify({
error: err.message
})
};

}

}