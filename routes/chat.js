// ============================================
// ROUTES CHAT IA (Proxy Gemini)
// ============================================

const express = require("express");
const router = express.Router();
const { authMiddleware } = require("./auth");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Modèle principal, puis modèle de secours si le principal est saturé
const MODELES = [
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite"
];

// ============================================
// APPEL UNIQUE À GEMINI POUR UN MODÈLE DONNÉ
// ============================================
async function appelerModele(modele, message) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modele}:streamGenerateContent?alt=sse`;

    const reponse = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: message }] }]
        })
    });

    if (!reponse.ok) {
        throw new Error(`Gemini ${modele} : ${reponse.status}`);
    }

    // Lire le flux en streaming et reconstruire le texte complet
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
                const morceau = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (morceau) texteComplet += morceau;
            } catch (e) {
                // Ignorer les morceaux incomplets
            }
        }
    }

    return texteComplet;
}

// ============================================
// ESSAIS AVEC REPLI SUR LE MODÈLE DE SECOURS
// ============================================
async function appelerGemini(message) {
    let dernierMessage = "";

    for (const modele of MODELES) {
        // Deux essais par modèle avant de passer au suivant
        for (let essai = 1; essai <= 2; essai++) {
            try {
                return await appelerModele(modele, message);
            } catch (erreur) {
                dernierMessage = erreur.message;
                const surcharge = /503|429|high demand|overloaded/i.test(erreur.message);
                if (!surcharge) throw erreur;
                await new Promise(r => setTimeout(r, 1000 * essai));
            }
        }
    }

    throw new Error(dernierMessage);
}

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

        if (message.length > 2000) {
            return res.status(400).json({
                success: false,
                error: "Message trop long (2000 caractères maximum)"
            });
        }

        const texte = await appelerGemini(message);

        res.json({
            success: true,
            data: { reponse: texte }
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