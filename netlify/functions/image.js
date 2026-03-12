exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  return {
    statusCode: 501,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      error:
        "Image marking is not implemented yet. Create a Netlify Function at netlify/functions/image.js that calls a vision-capable model/API and returns { result }.",
    }),
  };
};

