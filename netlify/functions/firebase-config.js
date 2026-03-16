exports.handler = async () => {
    try {
        const raw = process.env.FIREBASE_WEB_CONFIG_JSON;
        if (!raw) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Missing FIREBASE_WEB_CONFIG_JSON." }),
            };
        }
        let config = null;
        try {
            config = JSON.parse(raw);
        } catch (err) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "FIREBASE_WEB_CONFIG_JSON is not valid JSON." }),
            };
        }
        return {
            
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config }),
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: error?.message || "Unknown error" }),
        };
    }
};
