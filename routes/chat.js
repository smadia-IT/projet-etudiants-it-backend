// ============================================
// ROUTES CHAT IA (Proxy Gemini)
// ============================================

const express = require("express");
const router = express.Router();
const { authMiddleware } = require("./auth");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse";

// ============================================
// POST /api/chat — Proxy vers Gemini
// ============================================
router.post("/", authMiddleware, async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || message.trim() === "") {
            return res.status(400).json({
                success: false,
                error: "Le message ne peut pas être vide"
            });
        }

        if (!GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: "Clé API Gemini manquante"
            });
        }

        // Appeler Gemini
        const reponse = await fetch(`${GEMINI_URL}&key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: message }]
                }]
            })
        });

        if (!reponse.ok) {
            throw new Error(`Erreur Gemini : ${reponse.status}`);
        }

        // Lire le flux en streaming
        const reader = reponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let texteComplet = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lignes = buffer.split(/\r?\n\r?\n/);
            buffer = lignes.pop() || "";

            for (const ligne of lignes) {
                if (!ligne.startsWith("data: ")) continue;

                const jsonStr = ligne.substring(6);
                if (jsonStr.trim() === "[DONE]") continue;

                try {
                    const data = JSON.parse(jsonStr);

                    if (data.candidates && data.candidates[0] &&
                        data.candidates[0].content &&
                        data.candidates[0].content.parts &&
                        data.candidates[0].content.parts[0]) {

                        const morceau = data.candidates[0].content.parts[0].text;
                        if (morceau) {
                            texteComplet += morceau;
                        }
                    }
                } catch (e) {
                    // Ignorer les erreurs de parsing
                }
            }
        }

        res.json({
            success: true,
            data: {
                reponse: texteComplet
            }
        });

    } catch (erreur) {
        console.error("Erreur chat :", erreur.message);
        res.status(500).json({
            success: false,
            error: erreur.message
        });
    }
});

module.exports = router;