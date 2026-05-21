const admin = require("firebase-admin");

const SESSION_COLLECTION = "noteSessions";
const USER_SESSION_COLLECTION = "noteSessions";

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
    } catch (_) {
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

function randomAccessCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

exports.handler = async (event) => {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204 };
    }

    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const adminSdk = getAdmin();
        const db = adminSdk.database();

        if (event.httpMethod === "POST") {
            const token = getBearerToken(event.headers);
            if (!token) {
                return { statusCode: 401, body: JSON.stringify({ error: "Missing auth token." }) };
            }

            const decoded = await adminSdk.auth().verifyIdToken(token);
            const uid = decoded?.uid;
            const email = decoded?.email || "";
            if (!uid) {
                return { statusCode: 401, body: JSON.stringify({ error: "Invalid auth token." }) };
            }

            const body = event.body ? JSON.parse(event.body) : {};
            const html = String(body?.html || "");
            const meta = body?.meta && typeof body.meta === "object" ? body.meta : {};

            if (!html.trim()) {
                return { statusCode: 400, body: JSON.stringify({ error: "Missing notes HTML." }) };
            }

            if (html.length > 250000) {
                return { statusCode: 413, body: JSON.stringify({ error: "Notes are too large to host." }) };
            }

            const accessCode = randomAccessCode();
            const sessionRef = db.ref(SESSION_COLLECTION).push();
            const notesId = sessionRef.key;

            await sessionRef.set({
                uid,
                email,
                html,
                meta: meta || {},
                accessCode,
                createdAt: adminSdk.database.ServerValue.TIMESTAMP,
            });

            await db.ref(`users/${uid}/${USER_SESSION_COLLECTION}/${notesId}`).set({
                notesId,
                createdAt: adminSdk.database.ServerValue.TIMESTAMP,
                topic: String(meta?.topic || ""),
            });

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ notesId, accessCode }),
            };
        }

        const notesId = String(event.queryStringParameters?.notesId || "").trim();
        const code = String(event.queryStringParameters?.code || "").trim();
        if (!notesId || !code) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing notesId or code." }) };
        }

        const snap = await db.ref(`${SESSION_COLLECTION}/${notesId}`).get();
        if (!snap.exists()) {
            return { statusCode: 404, body: JSON.stringify({ error: "Notes not found." }) };
        }

        const session = snap.val();
        if (!session || session.accessCode !== code) {
            return { statusCode: 403, body: JSON.stringify({ error: "Invalid access code." }) };
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                notesId,
                meta: session.meta || {},
                html: String(session.html || ""),
            }),
        };
    } catch (error) {
        const requestId =
            event.headers?.["x-nf-request-id"] ||
            event.headers?.["x-request-id"] ||
            event.headers?.["x-amzn-trace-id"] ||
            "";

        console.error("notes-host error", { requestId, message: error?.message, stack: error?.stack });

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

