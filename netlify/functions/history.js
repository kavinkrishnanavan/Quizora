const admin = require("firebase-admin");

const HISTORY_COLLECTION = "history";

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

    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
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

        const db = adminSdk.firestore();
        const historyRef = db.collection("users").doc(uid).collection(HISTORY_COLLECTION);

        if (event.httpMethod === "POST") {
            const body = event.body ? JSON.parse(event.body) : {};
            const payload = body?.payload && typeof body.payload === "object" ? body.payload : null;
            if (!payload) {
                return { statusCode: 400, body: JSON.stringify({ error: "Missing payload." }) };
            }

            const payloadJson = JSON.stringify(payload);
            const doc = await historyRef.add({
                uid,
                email,
                payload,
                payloadJson,
                createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
            });

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: doc.id }),
            };
        }

        const limitRaw = event.queryStringParameters?.limit;
        const limit = Math.max(1, Math.min(50, Number.parseInt(limitRaw ?? "20", 10) || 20));

        const snap = await historyRef.orderBy("createdAt", "desc").limit(limit).get();
        const items = snap.docs.map((doc) => {
            const data = doc.data() || {};
            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null;
            return {
                id: doc.id,
                createdAt,
                payloadJson: data.payloadJson || "",
            };
        });

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
