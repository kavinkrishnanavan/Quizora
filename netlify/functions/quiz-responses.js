const admin = require("firebase-admin");
const Groq = require("groq-sdk");

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

function normalizeAnswer(value) {
    return String(value || "").trim();
}

function normalizeOption(value) {
    return String(value || "").trim().toUpperCase();
}

function computeAutoScore(sessionQuestions, answers) {
    if (!Array.isArray(sessionQuestions)) return null;
    if (!Array.isArray(answers)) return null;

    let score = 0;
    let total = 0;

    const questionMap = new Map();
    for (const q of sessionQuestions) {
        const num = Number(q?.number);
        if (!Number.isFinite(num)) continue;
        questionMap.set(num, q);
    }

    for (const a of answers) {
        const num = Number(a?.number);
        if (!Number.isFinite(num)) continue;
        const question = questionMap.get(num);
        if (!question) continue;
        total += 1;

        const correct = normalizeOption(question?.correctOption);
        const selected = normalizeOption(a?.selectedOption || a?.answer);
        if (correct && selected && correct === selected) {
            score += 1;
            continue;
        }

        if (question?.options && Array.isArray(question.options)) {
            const idx = ["A", "B", "C", "D", "E", "F"].indexOf(correct);
            if (idx >= 0) {
                const correctText = normalizeAnswer(question.options[idx]);
                const answerText = normalizeAnswer(a?.answer);
                if (correctText && answerText && correctText === answerText) {
                    score += 1;
                }
            }
        }
    }

    return { score, total };
}

function safeJsonParse(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (_) {
        const cleaned = String(text)
            .trim()
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```$/i, "")
            .trim();
        try {
            return JSON.parse(cleaned);
        } catch (_) {
            const first = cleaned.indexOf("{");
            const last = cleaned.lastIndexOf("}");
            if (first >= 0 && last > first) {
                try {
                    return JSON.parse(cleaned.slice(first, last + 1));
                } catch (_) {
                    return null;
                }
            }
            return null;
        }
    }
}

async function gradeWithGroq(sessionQuestions, answers) {
    if (!process.env.GROQ_API_KEY) return null;
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const questions = Array.isArray(sessionQuestions) ? sessionQuestions : [];
    const answerList = Array.isArray(answers) ? answers : [];

    const prompt = {
        instructions:
            "You are grading a student quiz. Use the answer key to award 1 point per correct question. " +
            "Respond with ONLY valid JSON. Do not include extra text.",
        schema: {
            score: "integer",
            maxScore: "integer",
            results: [
                {
                    number: 1,
                    correct: true
                }
            ]
        },
        questions: questions.map((q) => ({
            number: q.number,
            question: q.question,
            answer: q.answer || "",
            options: Array.isArray(q.options) ? q.options : [],
            correctOption: q.correctOption || ""
        })),
        studentAnswers: answerList.map((a) => ({
            number: a.number,
            answer: a.answer || a.selectedOption || ""
        }))
    };

    const completion = await groq.chat.completions.create({
        messages: [
            { role: "system", content: prompt.instructions },
            { role: "user", content: JSON.stringify(prompt) }
        ],
        model: "openai/gpt-oss-120B"
    });

    const text = completion?.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(text);
    if (!parsed || typeof parsed !== "object") return null;

    const maxScore = Number(parsed.maxScore);
    const score = Number(parsed.score);
    if (!Number.isFinite(score) || !Number.isFinite(maxScore)) return null;

    return { score, total: maxScore, results: Array.isArray(parsed.results) ? parsed.results : [] };
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

        const quizId = String(event.queryStringParameters?.quizId || "").trim() ||
            String(event?.body ? JSON.parse(event.body)?.quizId : "").trim();
        if (!quizId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing quizId." }) };
        }

        if (event.httpMethod === "GET") {
            const token = getBearerToken(event.headers);
            if (!token) {
                return { statusCode: 401, body: JSON.stringify({ error: "Missing auth token." }) };
            }

            const decoded = await adminSdk.auth().verifyIdToken(token);
            const uid = decoded?.uid;
            if (!uid) {
                return { statusCode: 403, body: JSON.stringify({ error: "Not authorized for this quiz." }) };
            }

            const sessionSnap = await db.ref(`${SESSION_COLLECTION}/${quizId}`).get();
            if (sessionSnap.exists()) {
                const session = sessionSnap.val();
                if (!session || session.uid !== uid) {
                    return { statusCode: 403, body: JSON.stringify({ error: "Not authorized for this quiz." }) };
                }
            }

            const snap = await db.ref(`users/${uid}/${RESPONSE_COLLECTION}/${quizId}`).get();
            const raw = snap.exists() ? snap.val() : {};
            const items = Object.entries(raw || {}).map(([key, data]) => {
                const submittedAtMs = Number(data?.submittedAt);
                const submittedAt = Number.isFinite(submittedAtMs) ? new Date(submittedAtMs).toISOString() : null;
                return {
                    id: key,
                    studentName: data?.studentName || "Student",
                    answers: Array.isArray(data?.answers) ? data.answers : [],
                    autoScore: Number.isFinite(data?.autoScore) ? data.autoScore : null,
                    maxScore: Number.isFinite(data?.maxScore) ? data.maxScore : null,
                    submittedAt,
                };
            });
            items.sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quizId, count: items.length, items }),
            };
        }

        const sessionSnap = await db.ref(`${SESSION_COLLECTION}/${quizId}`).get();
        if (!sessionSnap.exists()) {
            return { statusCode: 404, body: JSON.stringify({ error: "Quiz not found." }) };
        }
        const session = sessionSnap.val();

        const body = event.body ? JSON.parse(event.body) : {};
        const code = String(body?.code || "").trim();
        if (!code || code !== session.accessCode) {
            return { statusCode: 403, body: JSON.stringify({ error: "Invalid access code." }) };
        }

        const studentName = String(body?.studentName || session.studentName || "Student").trim().slice(0, 120);
        const answersRaw = Array.isArray(body?.answers) ? body.answers : [];
        const answers = answersRaw.map((a) => ({
            number: Number(a?.number) || null,
            answer: normalizeAnswer(a?.answer || a?.selectedOption || ""),
            selectedOption: normalizeOption(a?.selectedOption || a?.answer || ""),
        })).filter((a) => Number.isFinite(a.number));

        let autoScore = null;
        let maxScore = null;

        const groqScore = await gradeWithGroq(session.questions, answers);
        if (groqScore) {
            autoScore = groqScore.score;
            maxScore = groqScore.total;
        } else if (String(session.answerFormat || "") === "mcq") {
            const scoreInfo = computeAutoScore(session.questions, answers);
            if (scoreInfo) {
                autoScore = scoreInfo.score;
                maxScore = scoreInfo.total;
            }
        }

        const responseRef = db.ref(`users/${session.uid}/${RESPONSE_COLLECTION}/${quizId}`).push();
        await responseRef.set({
            studentName,
            answers,
            autoScore,
            maxScore,
            submittedAt: adminSdk.database.ServerValue.TIMESTAMP,
        });

        if (String(session?.mode || "personalized") !== "baseline") {
            try {
                await db.ref(`${SESSION_COLLECTION}/${quizId}`).remove();
                if (session?.uid) {
                    await db.ref(`users/${session.uid}/quizSessions/${quizId}`).remove();
                }
            } catch (_) {
                // ignore cleanup errors
            }
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: responseRef.key, autoScore, maxScore }),
        };
    } catch (error) {
        const requestId =
            event.headers?.["x-nf-request-id"] ||
            event.headers?.["x-request-id"] ||
            event.headers?.["x-amzn-trace-id"] ||
            "";

        console.error("quiz-responses error", { requestId, message: error?.message, stack: error?.stack });

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
