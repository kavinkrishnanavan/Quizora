// Simple image proxy to avoid CORS/hotlink issues in html2canvas/html2pdf.
// Usage: /.netlify/functions/imgproxy?url=https%3A%2F%2Fexample.com%2Fimage.jpg

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const rawUrl = event.queryStringParameters?.url;
    if (!rawUrl) return { statusCode: 400, body: "Missing url" };

    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      return { statusCode: 400, body: "Invalid url" };
    }

    if (!/^https?:$/.test(target.protocol)) return { statusCode: 400, body: "Invalid protocol" };

    const res = await fetch(target.toString(), {
      redirect: "follow",
      headers: {
        // Many CDNs require a UA; keep it simple.
        "User-Agent": "Quiz-Wiz-ImgProxy/1.0",
        Accept: "image/*,*/*;q=0.8",
        // Some hosts block requests with no referer; sending the same origin is usually acceptable.
        Referer: "https://quiz-wiz.local/",
      },
    });

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: `Upstream error: ${res.status}`,
      };
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    if (!/^image\//i.test(contentType)) {
      return {
        statusCode: 415,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Upstream is not an image",
      };
    }

    const arrayBuffer = await res.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    // Basic size guard (8 MB)
    if (bytes.length > 8 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Image too large",
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
      body: bytes.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: err?.message || "Unknown error",
    };
  }
};
