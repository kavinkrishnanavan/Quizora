const admin = require("firebase-admin");

const SESSION_COLLECTION = "quizSessions";
const RESPONSE_COLLECTION = "quizResponses";

function getDatabaseUrl() {
    const url = process.env.FIREBASE_DATABASE_URL;
    if (!url) {
        throw new Error("Missing FIREBASE_DATABASE_URL in Netlify environment variables.");
    }
    return url;
}

function getServiceAccount() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
        throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON in Netlify environment variables.");
    }
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
}

function getAdmin() {
    if (!admin.apps.length) {
        const serviceAccount = getServiceAccount();
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: getDatabaseUrl(),
        });
    }
    return admin;
}

function getBearerToken(headers) {
    const authHeader = headers?.authorization || headers?.Authorization || "";
    const parts = String(authHeader).split(" ");
    if (parts.length === 2 && parts[0] === "Bearer" && parts[1]) return parts[1];
    return "";
}

exports.handler = async (event) => {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204 };
    }

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const token = getBearerToken(event.headers);
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ error: "Missing auth token." }) };
        }

        const adminSdk = getAdmin();
        const decoded = await adminSdk.auth().verifyIdToken(token);
        const uid = decoded?.uid;
        if (!uid) {
            return { statusCode: 401, body: JSON.stringify({ error: "Invalid auth token." }) };
        }

        const body = event.body ? JSON.parse(event.body) : {};
        const quizId = String(body?.quizId || "").trim();
        if (!quizId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing quizId." }) };
        }

        const db = adminSdk.database();
        const sessionSnap = await db.ref(`${SESSION_COLLECTION}/${quizId}`).get();
        if (!sessionSnap.exists()) {
            return { statusCode: 404, body: JSON.stringify({ error: "Quiz not found." }) };
        }
        const session = sessionSnap.val();
        if (session?.uid !== uid) {
            return { statusCode: 403, body: JSON.stringify({ error: "Not authorized for this quiz." }) };
        }

        await db.ref(`${SESSION_COLLECTION}/${quizId}`).remove();
        await db.ref(`users/${uid}/quizSessions/${quizId}`).remove();
        await db.ref(`users/${uid}/${RESPONSE_COLLECTION}/${quizId}`).remove();

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ok: true }),
        };
    } catch (error) {
        const requestId =
            event.headers?.["x-nf-request-id"] ||
            event.headers?.["x-request-id"] ||
            event.headers?.["x-amzn-trace-id"] ||
            "";

        console.error("quiz-delete error", { requestId, message: error?.message, stack: error?.stack });

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
