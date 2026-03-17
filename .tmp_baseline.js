

function isMobile() {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}
    if (isMobile()) {
    const banner = document.getElementById("bottom-bar");
    banner.remove();
    const logo = document.getElementById("title");
    logo.remove();
  console.log("User is on mobile");

} else {
  console.log("User is on desktop");
  const mobile1 = document.getElementById("mobile1");
    const mobile2 = document.getElementById("mobile2");
    mobile1.remove();
    mobile2.remove();
}

    let FIREBASE_CONFIG = null;
    let firebaseReady = false;
    let currentUser = null;
    let historyItems = [];
    let historyPdfUrls = [];
    let historyAutoLoaded = false;
    let authChecked = false;
    const HISTORY_TYPE = "baseline";

    function setAuthStatus(text) {
        const status = document.getElementById("authStatus");
        if (status) status.innerText = text || "";
    }

    function setHistoryStatus(text) {
        const status = document.getElementById("historyStatus");
        if (status) status.innerText = text || "";
    }

    function updateAuthUi(user) {
        const historySidebar = document.getElementById("historySidebar");
        const signOutBtn = document.getElementById("signOutBtn");
        const signedOut = document.getElementById("accountSignedOut");
        const signedIn = document.getElementById("accountSignedIn");
        const emailDisplay = document.getElementById("accountEmailDisplay");
        if (user) {
            setAuthStatus(``);
            if (historySidebar) historySidebar.style.display = "block";
            if (signOutBtn) signOutBtn.disabled = false;
            if (signedOut) signedOut.style.display = "none";
            if (signedIn) signedIn.style.display = "block";
            if (emailDisplay) emailDisplay.innerText = user.email || "teacher";
        } else {
            setAuthStatus("Enter email and password to sign in.");
            if (historySidebar) historySidebar.style.display = "block";
            if (signOutBtn) signOutBtn.disabled = true;
            const list = document.getElementById("historyList");
            if (list) {
                list.innerHTML = authChecked
                    ? "<div class=\"portal-meta\">Please sign in to see history.</div>"
                    : "<div class=\"portal-meta\"></div>";
            }
            if (signedOut) signedOut.style.display = "block";
            if (signedIn) signedIn.style.display = "none";
            if (emailDisplay) emailDisplay.innerText = "";
        }
    }

    function openAccountModal() {
        const modal = document.getElementById("accountModal");
        if (!modal) return;
        modal.style.display = "block";
        document.body.style.overflow = "hidden";
    }

    function closeAccountModal() {
        const modal = document.getElementById("accountModal");
        if (!modal) return;
        modal.style.display = "none";
        document.body.style.overflow = "";
        if (currentUser) autoLoadHistory({ force: true });
    }

    async function initFirebase() {
        if (!window.firebase || !firebase?.initializeApp) {
            setAuthStatus("Firebase SDK not loaded.");
            return;
        }

        try {
            const res = await fetch("/.netlify/functions/firebase-config");
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.config) {
                throw new Error(data?.error || "Missing Firebase config.");
            }
            FIREBASE_CONFIG = data.config;
        } catch (err) {
            setAuthStatus("Firebase config missing. Set FIREBASE_WEB_CONFIG_JSON.");
            return;
        }

        firebase.initializeApp(FIREBASE_CONFIG);
        firebaseReady = true;

        firebase.auth().onAuthStateChanged((user) => {
            currentUser = user || null;
            historyAutoLoaded = false;
            authChecked = true;
            updateAuthUi(currentUser);
            if (currentUser) autoLoadHistory({ force: true });
        });
    }

    async function signUp() {
        if (!firebaseReady) return alert("Firebase is not configured yet.");
        const email = String(document.getElementById("authEmail")?.value || "").trim();
        const password = String(document.getElementById("authPassword")?.value || "");
        if (!email || !password) return alert("Enter an email and password.");
        try {
            await firebase.auth().createUserWithEmailAndPassword(email, password);
            closeAccountModal();
        } catch (err) {
            alert(err?.message || "Sign-up failed.");
        }
    }

    async function signIn() {
        if (!firebaseReady) return alert("Firebase is not configured yet.");
        const email = String(document.getElementById("authEmail")?.value || "").trim();
        const password = String(document.getElementById("authPassword")?.value || "");
        if (!email || !password) return alert("Enter an email and password.");
        try {
            await firebase.auth().signInWithEmailAndPassword(email, password);
            closeAccountModal();
        } catch (err) {
            alert(err?.message || "Sign-in failed.");
        }
    }

    async function signOut() {
        if (!firebaseReady) return;
        await firebase.auth().signOut();
        closeAccountModal();
    }

    async function getAuthToken() {
        if (!firebaseReady || !firebase.auth().currentUser) return "";
        return firebase.auth().currentUser.getIdToken();
    }

    function buildHostedQuizLink(session) {
        const quizId = session?.quizId || "";
        const code = session?.accessCode || "";
        if (!quizId || !code) return "";
        try {
            const url = new URL("quiz.html", window.location.href);
            url.searchParams.set("quizId", quizId);
            url.searchParams.set("code", code);
            url.searchParams.set("mode", "baseline");
            return url.toString();
        } catch (_) {
            return `quiz.html-quizId=${encodeURIComponent(quizId)}&code=${encodeURIComponent(code)}&mode=baseline`;
        }
    }

    async function copyText(text) {
        if (!text) return false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}

        try {
            const area = document.createElement("textarea");
            area.value = text;
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.focus();
            area.select();
            const ok = document.execCommand("copy");
            area.remove();
            return ok;
        } catch (_) {
            return false;
        }
    }

    async function createHostedQuizSession(quiz, meta) {
        if (!currentUser) return null;
        const token = await getAuthToken();
        if (!token) return null;
        const res = await fetch("/.netlify/functions/quiz-host", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ quiz, meta, mode: "baseline" })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Failed to host quiz.");
        if (!data?.quizId || !data?.accessCode) return null;
        return { quizId: data.quizId, accessCode: data.accessCode };
    }

    async function fetchQuizResponses(quizId) {
        const token = await getAuthToken();
        if (!token) throw new Error("Please sign in to view responses.");
        const res = await fetch(`/.netlify/functions/quiz-responses-quizId=${encodeURIComponent(quizId)}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Failed to load responses.");
        return data;
    }

    function openResponsesModal({ title, subtitle, responses }) {
        const modal = document.getElementById("responsesModal");
        const titleEl = document.getElementById("responsesTitle");
        const subtitleEl = document.getElementById("responsesSubtitle");
        const body = document.getElementById("responsesBody");
        const deleteBtn = document.getElementById("responsesDelete");
        if (!modal || !body) return;

        if (titleEl) titleEl.innerText = title || "Quiz Responses";
        if (subtitleEl) subtitleEl.innerText = subtitle || "";
        if (deleteBtn) deleteBtn.style.display = "none";

        body.innerHTML = "";
        const list = Array.isArray(responses) ? responses : [];
        if (!list.length) {
            const empty = document.createElement("div");
            empty.className = "portal-meta";
            empty.innerText = "No responses yet.";
            body.appendChild(empty);
        } else {
            list.forEach((item) => {
                const card = document.createElement("div");
                card.className = "response-card";

                const name = document.createElement("div");
                name.style.fontWeight = "700";
                name.innerText = item.studentName || "Student";
                card.appendChild(name);

                if (item.submittedAt) {
                    const time = document.createElement("div");
                    time.className = "portal-meta";
                    time.innerText = new Date(item.submittedAt).toLocaleString();
                    card.appendChild(time);
                }

                if (Number.isFinite(item.autoScore)) {
                    const score = document.createElement("div");
                    score.className = "portal-meta";
                    score.innerText = `Score: ${item.autoScore}/${item.maxScore || 0}`;
                    card.appendChild(score);
                }

                if (Array.isArray(item.answers) && item.answers.length) {
                    const pre = document.createElement("pre");
                    pre.innerText = item.answers
                        .map((a) => `${a.number}. ${a.answer || a.selectedOption || ""}`.trim())
                        .join("\n\n");
                    card.appendChild(pre);
                }

                body.appendChild(card);
            });
        }

        modal.style.display = "block";
        document.body.style.overflow = "hidden";
    }

    function closeResponsesModal() {
        const modal = document.getElementById("responsesModal");
        if (modal) modal.style.display = "none";
        document.body.style.overflow = "";
    }

    async function deleteHostedQuiz(quizId) {
        const token = await getAuthToken();
        if (!token) throw new Error("Please sign in to delete quizzes.");
        const res = await fetch("/.netlify/functions/quiz-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ quizId })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Failed to delete quiz.");
        return data;
    }

    async function autoLoadHistory({ force = false } = {}) {
        if (!currentUser) return;
        if (!force && historyAutoLoaded) return;
        historyAutoLoaded = true;
        await loadHistory();
    }

    function revokeHistoryPdfUrls() {
        for (const url of historyPdfUrls) URL.revokeObjectURL(url);
        historyPdfUrls = [];
    }

    function clearOutputArea() {
        revokeHistoryPdfUrls();
        const output = document.getElementById("output");
        if (output) output.innerHTML = "";
    }

    function setFormValue(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value ?? "";
    }

    function detectAnswerFormat(payload) {
        if (payload?.answerFormat) return payload.answerFormat;
        const students = Array.isArray(payload?.students) ? payload.students : [];
        const first = students[0];
        const questions = Array.isArray(first?.questions) ? first.questions : (Array.isArray(payload?.questions) ? payload.questions : []);
        const hasOptions = questions.some((q) => Array.isArray(q?.options) && q.options.length);
        return hasOptions ? "mcq" : "blank";
    }

    function normalizeQuestions(raw) {
        const list = Array.isArray(raw) ? raw : [];
        return list
            .map((q, idx) => {
                if (!q || typeof q !== "object") return null;
                const question = String(q.question || "").trim();
                if (!question) return null;
                const number = Number.isFinite(q.number) ? q.number : idx + 1;
                return { ...q, number, question };
            })
            .filter(Boolean);
    }

    function applyHistoryPayload(payload) {
        if (!payload || typeof payload !== "object") return;
        setFormValue("subject", payload.subject || "");
        setFormValue("topic", payload.topic || "");
        setFormValue("grade", payload.grade || "");
        setFormValue("curriculum", payload.curriculum || "");
        setFormValue("mMax", payload.maxMarks || "");
        setFormValue("qCount", payload.questionCount || "");
        setFormValue("answerFormat", detectAnswerFormat(payload));
        setFormValue("requests", payload.requests || "");

        if (typeof payload.learnedContext === "string") {
            learnedContext = payload.learnedContext.trim();
            if (learnedContext) {
                setMaterialsUi({
                    statusText: "Loaded learning materials summary from history.",
                    previewText: learnedContext
                });
                updateMaterialsBadge();
                saveMaterialsToStorage();
            } else {
                setMaterialsUi({ statusText: "", previewText: "" });
                updateMaterialsBadge();
            }
        }
    }

    async function buildPdfLinks(quiz, meta) {
        const qBytes = await buildWorksheetPdf({ quiz, meta, includeAnswers: false });
        const aBytes = await buildWorksheetPdf({ quiz, meta, includeAnswers: true });
        const qUrl = URL.createObjectURL(new Blob([qBytes], { type: "application/pdf" }));
        const aUrl = URL.createObjectURL(new Blob([aBytes], { type: "application/pdf" }));
        historyPdfUrls.push(qUrl, aUrl);
        return { qUrl, aUrl };
    }

    function matchesHistoryType(payload) {
        if (!payload || typeof payload !== "object") return false;
        if (payload.type) return payload.type === HISTORY_TYPE;
        const title = String(payload.title || "").toLowerCase();
        const students = Array.isArray(payload.students) ? payload.students : [];
        if (HISTORY_TYPE === "baseline") {
            return title.includes("baseline") || students[0]?.studentName === "Baseline Worksheet";
        }
        return !title.includes("baseline");
    }

    function renderHistory(items) {
        const list = document.getElementById("historyList");
        if (!list) return;
        list.innerHTML = "";
        historyItems = items.map((item) => {
            let payload = null;
            try {
                payload = item.payloadJson ? JSON.parse(item.payloadJson) : null;
            } catch (_) {
                payload = null;
            }
            return { ...item, payload };
        }).filter((item) => matchesHistoryType(item.payload));

        if (!historyItems.length) {
            list.innerHTML = "<div class=\"portal-meta\">No history found yet.</div>";
            return;
        }

        historyItems.forEach((item, index) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "history-entry";

            const title = document.createElement("div");
            title.className = "history-entry-title";
            title.innerText = item.payload?.title || "Baseline Worksheet";
            btn.appendChild(title);

            const createdAt = item.payload?.createdAt || item.createdAt || "";
            const meta = document.createElement("div");
            meta.className = "history-entry-meta";
            meta.innerText = createdAt ? new Date(createdAt).toLocaleString() : "Saved history";
            btn.appendChild(meta);

            if (item.payload?.summary) {
                const summary = document.createElement("div");
                summary.className = "history-entry-meta";
                summary.innerText = item.payload.summary;
                btn.appendChild(summary);
            }

            btn.addEventListener("click", () => loadHistoryEntry(index));
            list.appendChild(btn);
        });
    }

    function setActiveHistory(index) {
        const entries = document.querySelectorAll(".history-entry");
        entries.forEach((entry, i) => {
            if (i === index) entry.classList.add("active");
            else entry.classList.remove("active");
        });
    }

    async function loadHistoryEntry(index) {
        const item = historyItems[index];
        if (!item?.payload) return alert("History entry missing data.");
        setActiveHistory(index);
        applyHistoryPayload(item.payload);
        await generateFromHistory(item.payload);
    }

    async function generateFromHistory(payload) {
        const status = document.getElementById("status");
        const output = document.getElementById("output");
        if (!status || !output) return;

        const historyAnswerFormat = detectAnswerFormat(payload);
        setFormValue("answerFormat", historyAnswerFormat);

        const students = Array.isArray(payload?.students) ? payload.students : [];
        const saved = students[0] || {};
        const savedQuestions = normalizeQuestions(
            Array.isArray(saved.questions) ? saved.questions : (Array.isArray(payload?.questions) ? payload.questions : [])
        );
        if (!savedQuestions.length) {
            alert("No questions found in this history entry.");
            return;
        }

        clearOutputArea();
        status.style.display = "block";

        const meta = {
            subject: document.getElementById('subject').value,
            topic: document.getElementById('topic').value,
            grade: document.getElementById('grade').value,
            curriculum: document.getElementById('curriculum').value,
            maxMarks: document.getElementById('mMax').value,
            answerFormat: historyAnswerFormat
        };

        status.innerText = "Loading saved baseline worksheet...";
        const quiz = { studentName: saved.studentName || "Baseline Worksheet", questions: savedQuestions };

        const card = document.createElement('div');
        card.className = 'quiz-card';

        const title = document.createElement('div');
        title.style.fontWeight = "800";
        title.style.marginBottom = "10px";
        title.innerText = quiz.studentName;

        const btnRow = document.createElement('div');
        btnRow.style.display = "flex";
        btnRow.style.gap = "10px";
        btnRow.style.flexWrap = "wrap";
        btnRow.style.marginBottom = "12px";

        const links = await buildPdfLinks(quiz, meta);
        const qLink = document.createElement('a');
        qLink.href = links.qUrl;
        qLink.download = `${sanitizeFilename(quiz.studentName)} - Question Sheet.pdf`;
        qLink.className = "download-link";
        qLink.innerText = "Download Question PDF";

        const aLink = document.createElement('a');
        aLink.href = links.aUrl;
        aLink.download = `${sanitizeFilename(quiz.studentName)} - Answer Sheet.pdf`;
        aLink.className = "download-link";
        aLink.innerText = "Download Answer PDF";

        btnRow.appendChild(qLink);
        btnRow.appendChild(aLink);

        let quizSession = saved.quizSession || null;

        const hostWrap = document.createElement('div');
        hostWrap.style.display = "grid";
        hostWrap.style.gap = "8px";
        hostWrap.style.marginBottom = "10px";

        const renderHostPanel = (session) => {
            hostWrap.innerHTML = "";

            if (!session) {
                if (!currentUser) {
                    const note = document.createElement("div");
                    note.className = "portal-meta";
                    note.innerText = "Sign in to host quizzes and collect responses.";
                    hostWrap.appendChild(note);
                } else {
                    const hostBtn = document.createElement("button");
                    hostBtn.type = "button";
                    hostBtn.innerText = "Host Quiz";
                    hostBtn.style.padding = "10px 12px";
                    hostBtn.style.marginTop = "0";
                    hostBtn.onclick = async () => {
                        hostBtn.disabled = true;
                        hostBtn.innerText = "Hosting...";
                        try {
                            const hosted = await createHostedQuizSession(quiz, meta);
                            if (hosted) {
                                quizSession = hosted;
                                renderHostPanel(hosted);
                            }
                        } catch (err) {
                            alert(err?.message || "Failed to host quiz.");
                        } finally {
                            hostBtn.disabled = false;
                            hostBtn.innerText = "Host Quiz";
                        }
                    };
                    hostWrap.appendChild(hostBtn);
                }
                return;
            }

            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.gap = "10px";
            row.style.flexWrap = "wrap";

            const link = buildHostedQuizLink(session);
            const openBtn = document.createElement("a");
            openBtn.href = link;
            openBtn.target = "_blank";
            openBtn.rel = "noopener noreferrer";
            openBtn.className = "quiz-link";
            openBtn.innerText = "Open Hosted Quiz";

            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.innerText = "Copy Link";
            copyBtn.style.padding = "10px 12px";
            copyBtn.style.marginTop = "0";
            copyBtn.onclick = async () => {
                const ok = await copyText(link);
                copyBtn.innerText = ok ? "Copied!" : "Copy Link";
                setTimeout(() => { copyBtn.innerText = "Copy Link"; }, 1500);
            };

            const responsesBtn = document.createElement("button");
            responsesBtn.type = "button";
            responsesBtn.innerText = "View Responses";
            responsesBtn.style.padding = "10px 12px";
            responsesBtn.style.marginTop = "0";
            responsesBtn.onclick = async () => {
                responsesBtn.disabled = true;
                try {
                    const data = await fetchQuizResponses(session.quizId);
                    const subtitle = `${quiz.studentName} - ${data?.count || 0} responses`;
                    const deleteBtn = document.getElementById("responsesDelete");
                    if (deleteBtn) {
                        deleteBtn.style.display = "inline-flex";
                        deleteBtn.onclick = async () => {
                            if (!confirm("Delete this hosted quiz? New submissions will be blocked.")) return;
                            try {
                                await deleteHostedQuiz(session.quizId);
                                closeResponsesModal();
                                alert("Quiz deleted.");
                            } catch (err) {
                                alert(err?.message || "Failed to delete quiz.");
                            }
                        };
                    }
                    openResponsesModal({
                        title: "Quiz Responses",
                        subtitle,
                        responses: data?.items || []
                    });
                } catch (err) {
                    alert(err?.message || "Failed to load responses.");
                } finally {
                    responsesBtn.disabled = false;
                }
            };

            row.appendChild(openBtn);
            row.appendChild(copyBtn);
            row.appendChild(responsesBtn);
            hostWrap.appendChild(row);

            const hint = document.createElement("div");
            hint.className = "portal-meta";
            hint.innerText = "Share the hosted quiz link with your students.";
            hostWrap.appendChild(hint);
        };

        renderHostPanel(quizSession);

        const preview = document.createElement('pre');
        preview.innerText = quiz.questions.map(q => `${q.number}. ${q.question}`).join("\n\n");

        card.appendChild(title);
        card.appendChild(btnRow);
        card.appendChild(hostWrap);
        card.appendChild(preview);
        output.appendChild(card);

        status.innerText = "History loaded.";
    }

    async function loadHistory() {
        if (!firebaseReady || !currentUser) return;
        setHistoryStatus("Loading history...");
        try {
            const token = await getAuthToken();
            const res = await fetch("/.netlify/functions/history-limit=20", {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || "Failed to load history.");
            renderHistory(Array.isArray(data?.items) ? data.items : []);
            setHistoryStatus("");
        } catch (err) {
            setHistoryStatus("Could not load history.");
            alert(err?.message || "Failed to load history.");
        }
    }

    async function saveHistory(payload) {
        if (!firebaseReady || !currentUser) return;
        const token = await getAuthToken();
        const res = await fetch("/.netlify/functions/history", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ payload })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Failed to save history.");
        return data;
    }

    function sanitizeFilename(name) {
        return String(name || "Worksheet")
            .trim()
            .replace(/[<>:"/\|?* -]/g, "_")
            .replace(/\s+/g, " ")
            .slice(0, 80);
    }

    function wrapLines(text, font, size, maxWidth) {
        const inputLines = String(text || "").replace(/\r\n/g, "\n").split("\n");
        const out = [];

        for (const rawLine of inputLines) {
            const words = rawLine.split(/\s+/).filter(Boolean);
            if (words.length === 0) {
                out.push("");
                continue;
            }

            let line = words[0];
            for (let i = 1; i < words.length; i++) {
                const candidate = line + " " + words[i];
                const width = font.widthOfTextAtSize(candidate, size);
                if (width <= maxWidth) {
                    line = candidate;
                } else {
                    out.push(line);
                    line = words[i];
                }
            }
            out.push(line);
        }
        return out;
    }

    async function downloadPdf(bytes, filename) {
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    async function buildWorksheetPdf({ quiz, meta, includeAnswers }) {
        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        const margin = 48;
        const dateStr = new Date().toLocaleString();
        const headerText = "Quiz-Wiz Worksheet";

        const form = doc.getForm();
        const sheetTitle = includeAnswers ? "Teacher Answer Sheet" : "Student Question Sheet";

        const startPage = ({ withMarks }) => {
            const page = doc.addPage();
            const { width, height } = page.getSize();
            const maxWidth = width - margin * 2;
            let y = height - margin;

            page.drawText(headerText, { x: margin, y, size: 14, font: fontBold, color: rgb(0.12, 0.2, 0.35) });
            y -= 18;
            page.drawText(`Generated: ${dateStr}`, { x: margin, y, size: 10, font, color: rgb(0.35, 0.45, 0.55) });
            y -= 18;

            page.drawText(`Worksheet: ${quiz.studentName}`, { x: margin, y, size: 12, font: fontBold });
            y -= 18;

            if (!includeAnswers) {
                page.drawText("Name:", { x: margin, y, size: 11, font: fontBold });
                const nameField = form.createTextField(`name_${Math.random().toString(16).slice(2)}`);
                nameField.setText("");
                nameField.addToPage(page, { x: margin + 54, y: y ? 2, width: 260, height: 16 });
                y -= 24;
            }

            if (withMarks) {
                page.drawText("Marks:", { x: margin, y, size: 11, font: fontBold });
                const marksField = form.createTextField(`marks_${Math.random().toString(16).slice(2)}`);
                marksField.setText("");
                marksField.addToPage(page, { x: margin + 52, y: y ? 2, width: 120, height: 16 });
                page.drawText(`/ ${meta.maxMarks}`, { x: margin + 180, y, size: 11, font });
                y -= 24;
            } else {
                y -= 6;
            }

            page.drawText(`${meta.subject} | ${meta.topic} | ${meta.grade} | ${meta.curriculum}`, {
                x: margin,
                y,
                size: 10,
                font,
                color: rgb(0.35, 0.45, 0.55),
            });
            y -= 24;

            page.drawText(sheetTitle, { x: margin, y, size: 12, font: fontBold });
            y -= 18;

            return { page, y, maxWidth };
        };

        let { page, y, maxWidth } = startPage({ withMarks: !includeAnswers });

        const qFontSize = 11;
        const aFontSize = 10;
        const qLineGap = 14;
        const aLineGap = 12;
        const minY = margin + 54;

        const ensureSpace = (needed) => {
            if (y - needed < minY) {
                ({ page, y, maxWidth } = startPage({ withMarks: false }));
            }
        };

        for (const q of quiz.questions) {
            const qText = `${q.number}. ${q.question}`;
            const qLines = wrapLines(qText, font, qFontSize, maxWidth);

            ensureSpace(qLines.length * qLineGap + 18);
            for (const line of qLines) {
                page.drawText(line, { x: margin, y, size: qFontSize, font });
                y -= qLineGap;
            }

            if (includeAnswers) {
                const extra =
                    meta.answerFormat === "mcq" && typeof q.correctOption === "string"
                        ? `Correct option: ${q.correctOption}`
                        : "";
                const aText = extra ? `${extra}\nAnswer: ${q.answer}` : `Answer: ${q.answer}`;
                const aLines = wrapLines(aText, font, aFontSize, maxWidth - 18);
                ensureSpace(aLines.length * aLineGap + 12);
                for (const line of aLines) {
                    page.drawText(line, { x: margin + 18, y, size: aFontSize, font, color: rgb(0.15, 0.3, 0.2) });
                    y -= aLineGap;
                }
            } else {
                if (meta.answerFormat === "mcq" && Array.isArray(q.options) && q.options.length) {
                    const labels = ["A", "B", "C", "D", "E", "F"];
                    const optFontSize = 10;
                    const optLineGap = 12;

                    const optLines = [];
                    for (let idx = 0; idx < q.options.length; idx++) {
                        const label = labels[idx] || String(idx + 1);
                        const txt = `${label}) ${q.options[idx]}`;
                        optLines.push(...wrapLines(txt, font, optFontSize, maxWidth - 18));
                    }

                    ensureSpace(optLines.length * optLineGap + 10);
                    for (const line of optLines) {
                        page.drawText(line, { x: margin + 18, y, size: optFontSize, font, color: rgb(0.2, 0.25, 0.32) });
                        y -= optLineGap;
                    }
                } else {
                    ensureSpace(46);
                    for (let i = 0; i < 3; i++) {
                        page.drawLine({
                            start: { x: margin, y: y ? 2 },
                            end: { x: margin + maxWidth, y: y ? 2 },
                            thickness: 1,
                            color: rgb(0.86, 0.89, 0.92),
                        });
                        y -= 14;
                    }
                }
            }

            y -= 10;
        }

        return await doc.save();
    }

    async function requestQuiz(payload) {
        const response = await fetch('/.netlify/functions/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            data = null;
        }

        if (!response.ok) {
            const errMsg = data?.error ? String(data.error) : `Request failed (${response.status})`;
            const errRid = data?.requestId ? `\nRequest ID: ${data.requestId}` : "";
            throw new Error(errMsg + errRid);
        }

        const quiz = data?.quiz;
        if (!quiz || typeof quiz.studentName !== "string" || !Array.isArray(quiz.questions)) {
            throw new Error("Server returned an unexpected quiz format.");
        }
        return quiz;
    }

    const MATERIALS_STORAGE_KEY = "quizwiz_materials_v1";
    let learnedContext = "";

    function openMaterialsModal() {
        const modal = document.getElementById("materialsModal");
        if (!modal) return;
        modal.style.display = "block";
        document.body.style.overflow = "hidden";
    }

    function closeMaterialsModal() {
        const modal = document.getElementById("materialsModal");
        if (!modal) return;
        modal.style.display = "none";
        document.body.style.overflow = "";
    }

    function updateMaterialsBadge() {
        const badge = document.getElementById("materialsBadge");
        const btn = document.getElementById("materialsOpenBtn");
        if (!badge || !btn) return;

        if (learnedContext && learnedContext.trim()) {
            badge.innerText = "Ready";
            btn.innerText = "Edit learning materials";
        } else {
            badge.innerText = "";
            btn.innerText = "Add learning materials";
        }
    }

    function setMaterialsUi({ statusText = "", previewText = "" } = {}) {
        const statusEl = document.getElementById("materialsStatus");
        const previewEl = document.getElementById("materialsPreview");
        if (statusEl) statusEl.innerText = statusText || "";
        if (previewEl) previewEl.value = previewText || "";
    }

    function loadMaterialsFromStorage() {
        try {
            const raw = localStorage.getItem(MATERIALS_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.learnedContext === "string") {
                learnedContext = parsed.learnedContext.trim();
                if (learnedContext) {
                    setMaterialsUi({
                        statusText: "Using saved learning materials summary.",
                        previewText: learnedContext
                    });
                }
                updateMaterialsBadge();
            }
        } catch (_) {
            // ignore
        }
    }

    function saveMaterialsToStorage() {
        try {
            localStorage.setItem(MATERIALS_STORAGE_KEY, JSON.stringify({ learnedContext }));
        } catch (_) {
            // ignore
        }
    }

    function clearMaterials() {
        learnedContext = "";
        const filesEl = document.getElementById("materialsFiles");
        const textEl = document.getElementById("materialsText");
        if (filesEl) filesEl.value = "";
        if (textEl) textEl.value = "";
        setMaterialsUi({ statusText: "Cleared.", previewText: "" });
        updateMaterialsBadge();
        try {
            localStorage.removeItem(MATERIALS_STORAGE_KEY);
        } catch (_) {
            // ignore
        }
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Failed to read file."));
            reader.onload = () => {
                const result = String(reader.result || "");
                const comma = result.indexOf(",");
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            reader.readAsDataURL(file);
        });
    }

    async function analyzeMaterials() {
        const btn = document.getElementById("materialsAnalyzeBtn");
        const filesEl = document.getElementById("materialsFiles");
        const textEl = document.getElementById("materialsText");

        const files = filesEl?.files ? Array.from(filesEl.files) : [];
        const pastedText = String(textEl?.value || "").trim();

        if (!files.length && !pastedText) {
            alert("Add at least one file (PDF/DOCX/PPT/PPTX) or paste some text.");
            return;
        }

        btn.disabled = true;
        setMaterialsUi({ statusText: "Analyzing materials...", previewText: "" });

        try {
            const maxBytesPerFile = 4 * 1024 * 1024;
            const materialsFiles = [];

            for (const f of files.slice(0, 5)) {
                if (f.size > maxBytesPerFile) throw new Error(`File too large: ${f.name} (max 4MB).`);
                const data = await fileToBase64(f);
                materialsFiles.push({ name: f.name, data, mime: f.type || "" });
            }

            const payload = {
                files: materialsFiles,
                pastedText,
                subject: document.getElementById('subject').value,
                topic: document.getElementById('topic').value,
                grade: document.getElementById('grade').value,
                curriculum: document.getElementById('curriculum').value
            };

            const res = await fetch("/.netlify/functions/materials", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const errMsg = data?.error ? String(data.error) : `Request failed (${res.status})`;
                const errRid = data?.requestId ? `\nRequest ID: ${data.requestId}` : "";
                throw new Error(errMsg + errRid);
            }

            const summary = typeof data?.learnedContext === "string" ? data.learnedContext.trim() : "";
            if (!summary) throw new Error("No summary returned.");

            learnedContext = summary;
            saveMaterialsToStorage();

            const warnText = Array.isArray(data?.warnings) && data.warnings.length ? ` Warnings: ${data.warnings.join(" | ")}` : "";
            setMaterialsUi({ statusText: "Materials summary ready. It will be used for worksheet generation." + warnText, previewText: learnedContext });
            updateMaterialsBadge();
        } finally {
            btn.disabled = false;
        }
    }

    document.getElementById("materialsAnalyzeBtn")?.addEventListener("click", analyzeMaterials);
    document.getElementById("materialsClearBtn")?.addEventListener("click", clearMaterials);
    document.getElementById("materialsOpenBtn")?.addEventListener("click", openMaterialsModal);
    document.getElementById("materialsModalClose")?.addEventListener("click", closeMaterialsModal);
    document.getElementById("materialsModalBackdrop")?.addEventListener("click", closeMaterialsModal);
    loadMaterialsFromStorage();
    updateMaterialsBadge();

    document.getElementById("signUpBtn")?.addEventListener("click", signUp);
    document.getElementById("signInBtn")?.addEventListener("click", signIn);
    document.getElementById("signOutBtn")?.addEventListener("click", signOut);
    document.getElementById("accountBtn")?.addEventListener("click", openAccountModal);
    document.getElementById("accountBackdrop")?.addEventListener("click", closeAccountModal);
    document.getElementById("accountClose")?.addEventListener("click", closeAccountModal);
    document.getElementById("responsesClose")?.addEventListener("click", closeResponsesModal);
    document.getElementById("responsesBackdrop")?.addEventListener("click", closeResponsesModal);
    updateAuthUi(null);
    initFirebase();

    async function runBase() {
        const btn = document.getElementById('genBtn');
        const status = document.getElementById('status');
        const output = document.getElementById('output');

        btn.disabled = true;
        status.style.display = "block";
        output.innerHTML = "";

        try {
            status.innerText = "Generating Baseline Worksheet...";

            const meta = {
                subject: document.getElementById('subject').value,
                topic: document.getElementById('topic').value,
                grade: document.getElementById('grade').value,
                curriculum: document.getElementById('curriculum').value,
                maxMarks: document.getElementById('mMax').value,
                answerFormat: document.getElementById('answerFormat').value
            };

            const quiz = await requestQuiz({
                mode: "base",
                learnedContext,
                subject: meta.subject,
                topic: meta.topic,
                grade: meta.grade,
                curriculum: meta.curriculum,
                maxMarks: meta.maxMarks,
                questionCount: parseInt(document.getElementById('qCount').value, 10),
                answerFormat: meta.answerFormat,
                requests: document.getElementById('requests').value
            });

            const card = document.createElement('div');
            card.className = 'quiz-card';

            const title = document.createElement('div');
            title.style.fontWeight = "800";
            title.style.marginBottom = "10px";
            title.innerText = quiz.studentName;

            const btnRow = document.createElement('div');
            btnRow.style.display = "flex";
            btnRow.style.gap = "10px";
            btnRow.style.flexWrap = "wrap";
            btnRow.style.marginBottom = "12px";

            const qBtn = document.createElement('button');
            qBtn.type = "button";
            qBtn.innerText = "Download Question PDF";
            qBtn.style.padding = "10px 12px";
            qBtn.style.marginTop = "0";

            const aBtn = document.createElement('button');
            aBtn.type = "button";
            aBtn.innerText = "Download Answer PDF";
            aBtn.style.padding = "10px 12px";
            aBtn.style.marginTop = "0";

            qBtn.onclick = async () => {
                qBtn.disabled = true;
                try {
                    const bytes = await buildWorksheetPdf({ quiz, meta, includeAnswers: false });
                    await downloadPdf(bytes, `${sanitizeFilename(quiz.studentName)} - Question Sheet.pdf`);
                } finally {
                    qBtn.disabled = false;
                }
            };

            aBtn.onclick = async () => {
                aBtn.disabled = true;
                try {
                    const bytes = await buildWorksheetPdf({ quiz, meta, includeAnswers: true });
                    await downloadPdf(bytes, `${sanitizeFilename(quiz.studentName)} - Answer Sheet.pdf`);
                } finally {
                    aBtn.disabled = false;
                }
            };

            btnRow.appendChild(qBtn);
            btnRow.appendChild(aBtn);

            let quizSession = null;
            if (currentUser) {
                try {
                    quizSession = await createHostedQuizSession(quiz, meta);
                } catch (err) {
                    console.warn("Failed to host quiz", err);
                }
            }

            const hostWrap = document.createElement('div');
            hostWrap.style.display = "grid";
            hostWrap.style.gap = "8px";
            hostWrap.style.marginBottom = "10px";

            const renderHostPanel = (session) => {
                hostWrap.innerHTML = "";

                if (!session) {
                    if (!currentUser) {
                        const note = document.createElement("div");
                        note.className = "portal-meta";
                        note.innerText = "Sign in to host quizzes and collect responses.";
                        hostWrap.appendChild(note);
                    } else {
                        const hostBtn = document.createElement("button");
                        hostBtn.type = "button";
                        hostBtn.innerText = "Host Quiz";
                        hostBtn.style.padding = "10px 12px";
                        hostBtn.style.marginTop = "0";
                        hostBtn.onclick = async () => {
                            hostBtn.disabled = true;
                            hostBtn.innerText = "Hosting...";
                            try {
                                const hosted = await createHostedQuizSession(quiz, meta);
                                if (hosted) {
                                    quizSession = hosted;
                                    renderHostPanel(hosted);
                                }
                            } catch (err) {
                                alert(err?.message || "Failed to host quiz.");
                            } finally {
                                hostBtn.disabled = false;
                                hostBtn.innerText = "Host Quiz";
                            }
                        };
                        hostWrap.appendChild(hostBtn);
                    }
                    return;
                }

                const row = document.createElement("div");
                row.style.display = "flex";
                row.style.gap = "10px";
                row.style.flexWrap = "wrap";

                const link = buildHostedQuizLink(session);
                const openBtn = document.createElement("a");
                openBtn.href = link;
                openBtn.target = "_blank";
                openBtn.rel = "noopener noreferrer";
                openBtn.className = "quiz-link";
                openBtn.innerText = "Open Hosted Quiz";

                const copyBtn = document.createElement("button");
                copyBtn.type = "button";
                copyBtn.innerText = "Copy Link";
                copyBtn.style.padding = "10px 12px";
                copyBtn.style.marginTop = "0";
                copyBtn.onclick = async () => {
                    const ok = await copyText(link);
                    copyBtn.innerText = ok ? "Copied!" : "Copy Link";
                    setTimeout(() => { copyBtn.innerText = "Copy Link"; }, 1500);
                };

                const responsesBtn = document.createElement("button");
                responsesBtn.type = "button";
                responsesBtn.innerText = "View Responses";
                responsesBtn.style.padding = "10px 12px";
                responsesBtn.style.marginTop = "0";
                responsesBtn.onclick = async () => {
                    responsesBtn.disabled = true;
                    try {
                        const data = await fetchQuizResponses(session.quizId);
                        const subtitle = `${quiz.studentName} - ${data?.count || 0} responses`;
                    const deleteBtn = document.getElementById("responsesDelete");
                    if (deleteBtn) {
                        deleteBtn.style.display = "inline-flex";
                        deleteBtn.onclick = async () => {
                            if (!confirm("Delete this hosted quiz? New submissions will be blocked.")) return;
                            try {
                                await deleteHostedQuiz(session.quizId);
                                closeResponsesModal();
                                alert("Quiz deleted.");
                            } catch (err) {
                                alert(err?.message || "Failed to delete quiz.");
                            }
                        };
                    }
                        openResponsesModal({
                            title: "Quiz Responses",
                            subtitle,
                            responses: data?.items || []
                        });
                    } catch (err) {
                        alert(err?.message || "Failed to load responses.");
                    } finally {
                        responsesBtn.disabled = false;
                    }
                };

                row.appendChild(openBtn);
                row.appendChild(copyBtn);
                row.appendChild(responsesBtn);
                hostWrap.appendChild(row);

                const hint = document.createElement("div");
                hint.className = "portal-meta";
                hint.innerText = "Share the hosted quiz link with your students.";
                hostWrap.appendChild(hint);
            };

            renderHostPanel(quizSession);

            const preview = document.createElement('pre');
            preview.innerText = quiz.questions.map(q => `${q.number}. ${q.question}`).join("\n\n");

            card.appendChild(title);
            card.appendChild(btnRow);
            card.appendChild(hostWrap);
            card.appendChild(preview);
            output.appendChild(card);

            status.innerText = "Baseline Worksheet generated!";

            if (currentUser) {
                try {
                    const payload = {
                        title: `${meta.subject} ? ${meta.topic}`,
                        createdAt: new Date().toISOString(),
                        summary: `Baseline worksheet generated for ${meta.grade} (${meta.curriculum}).`,
                        type: HISTORY_TYPE,
                        subject: meta.subject,
                        topic: meta.topic,
                        grade: meta.grade,
                        curriculum: meta.curriculum,
                        maxMarks: meta.maxMarks,
                        questionCount: parseInt(document.getElementById('qCount').value, 10),
                        answerFormat: meta.answerFormat,
                        requests: document.getElementById('requests').value,
                        learnedContext,
                        studentCount: 1,
                        students: [
                            {
                                studentName: quiz.studentName,
                                questions: quiz.questions,
                                quizSession
                            }
                        ]
                    };
                    await saveHistory(payload);
                    await loadHistory();
                } catch (err) {
                    status.innerText += " History save failed.";
                }
            }
        } catch (err) {
            alert("Error: " + err.message);
        } finally {
            btn.disabled = false;
        }
    }
