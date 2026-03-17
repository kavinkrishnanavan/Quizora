const admin = require("firebase-admin");

const SESSION_COLLECTION = "quizSessions";
const USER_SESSION_COLLECTION = "quizSessions";

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

function randomAccessCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function sanitizeQuestion(q) {
    if (!q || typeof q !== "object") return null;
    const number = Number.isFinite(q.number) ? q.number : null;
    const question = String(q.question || "").trim();
    if (!number || !question) return null;
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o)) : [];
    return { number, question, options };
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
            const quiz = body?.quiz && typeof body.quiz === "object" ? body.quiz : null;
            const meta = body?.meta && typeof body.meta === "object" ? body.meta : null;
            const mode = String(body?.mode || "personalized");
            if (!quiz || !Array.isArray(quiz.questions)) {
                return { statusCode: 400, body: JSON.stringify({ error: "Missing quiz data." }) };
            }

            const studentName = String(quiz.studentName || "Student").trim();
            const questions = quiz.questions.map((q) => ({ ...q })).filter(Boolean);
            if (!questions.length) {
                return { statusCode: 400, body: JSON.stringify({ error: "Quiz has no questions." }) };
            }

            const accessCode = randomAccessCode();
            const sessionRef = db.ref(SESSION_COLLECTION).push();
            const quizId = sessionRef.key;
            const parsedMaxResponses = Number(meta?.studentCount ?? meta?.maxResponses);
            const maxResponses = Number.isFinite(parsedMaxResponses) && parsedMaxResponses > 0
                ? Math.floor(parsedMaxResponses)
                : null;

            await sessionRef.set({
                uid,
                email,
                studentName,
                questions,
                meta: meta || {},
                answerFormat: String(meta?.answerFormat || ""),
                mode,
                accessCode,
                maxResponses,
                createdAt: adminSdk.database.ServerValue.TIMESTAMP,
            });

            await db.ref(`users/${uid}/${USER_SESSION_COLLECTION}/${quizId}`).set({
                quizId,
                studentName,
                createdAt: adminSdk.database.ServerValue.TIMESTAMP,
            });

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quizId, accessCode }),
            };
        }

        const quizId = String(event.queryStringParameters?.quizId || "").trim();
        const code = String(event.queryStringParameters?.code || "").trim();
        if (!quizId || !code) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing quizId or code." }) };
        }

        const snap = await db.ref(`${SESSION_COLLECTION}/${quizId}`).get();
        if (!snap.exists()) {
            return { statusCode: 404, body: JSON.stringify({ error: "Quiz not found." }) };
        }

        const session = snap.val();
        if (!session || session.accessCode !== code) {
            return { statusCode: 403, body: JSON.stringify({ error: "Invalid access code." }) };
        }

        const maxResponses = Number(session?.maxResponses);
        if (Number.isFinite(maxResponses) && maxResponses > 0 && session?.uid) {
            const respSnap = await db.ref(`users/${session.uid}/quizResponses/${quizId}`).get();
            const respData = respSnap.exists() ? respSnap.val() : {};
            const count = Object.keys(respData || {}).length;
            if (count >= maxResponses) {
                return { statusCode: 409, body: JSON.stringify({ error: "Quiz is closed." }) };
            }
        }

        const questions = Array.isArray(session.questions) ? session.questions : [];
        const publicQuestions = questions.map(sanitizeQuestion).filter(Boolean);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                quizId,
                studentName: session.studentName || "Student",
                meta: session.meta || {},
                answerFormat: String(session.answerFormat || ""),
                questions: publicQuestions,
            }),
        };
    } catch (error) {
        const requestId =
            event.headers?.["x-nf-request-id"] ||
            event.headers?.["x-request-id"] ||
            event.headers?.["x-amzn-trace-id"] ||
            "";

        console.error("quiz-host error", { requestId, message: error?.message, stack: error?.stack });

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
