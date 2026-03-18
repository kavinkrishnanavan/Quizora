const admin = require("firebase-admin");

const HISTORY_COLLECTION = "history";

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

    if (event.httpMethod !== "GET" && event.httpMethod !== "POST" && event.httpMethod !== "DELETE") {
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
        const email = decoded?.email || "";
        if (!uid) {
            return { statusCode: 401, body: JSON.stringify({ error: "Invalid auth token." }) };
        }

        const db = adminSdk.database();
        const historyRef = db.ref(`users/${uid}/${HISTORY_COLLECTION}`);

        if (event.httpMethod === "POST") {
            const body = event.body ? JSON.parse(event.body) : {};
            const payload = body?.payload && typeof body.payload === "object" ? body.payload : null;
            if (!payload) {
                return { statusCode: 400, body: JSON.stringify({ error: "Missing payload." }) };
            }

            const payloadJson = JSON.stringify(payload);
            
            const newRef = historyRef.push();
            await newRef.set({
                uid,
                email,
                payload,
                payloadJson,
                createdAt: adminSdk.database.ServerValue.TIMESTAMP,
            });

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: newRef.key }),
            };
        }

        if (event.httpMethod === "DELETE") {
            const body = event.body ? JSON.parse(event.body) : {};
            const id = String(event.queryStringParameters?.id || body?.id || "").trim();
            if (!id) {
                return { statusCode: 400, body: JSON.stringify({ error: "Missing history id." }) };
            }

            await historyRef.child(id).remove();

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            };
        }

        const limitRaw = event.queryStringParameters?.limit;
        const limit = Math.max(1, Math.min(50, Number.parseInt(limitRaw ?? "20", 10) || 20));

        const snap = await historyRef.orderByChild("createdAt").limitToLast(limit).get();
        const raw = snap.exists() ? snap.val() : {};
        const items = Object.entries(raw || {}).map(([key, data]) => {
            const createdAtMs = Number(data?.createdAt);
            const createdAt = Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : null;
            return {
                id: key,
                createdAt,
                payloadJson: data?.payloadJson || "",
            };
        });
        items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items }),
        };
    } catch (error) {
        const requestId =
            event.headers?.["x-nf-request-id"] ||
            event.headers?.["x-request-id"] ||
            event.headers?.["x-amzn-trace-id"] ||
            "";

        console.error("history error", { requestId, message: error?.message, stack: error?.stack });

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
