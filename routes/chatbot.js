// ============================================
// ROUTES CHATBOT D'AIDE
// ============================================
// Utilise Gemini avec un prompt spécialisé pour aider
// l'utilisateur à utiliser le site.
// ============================================

const express = require("express");
const router = express.Router();
const https = require("https");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.6-flash";

// ============================================
// PROMPT SYSTÈME
// ============================================
const SYSTEM_PROMPT = `Tu es l'assistant d'Étudiants IT, une plateforme pour étudiants en informatique.

FONCTIONNALITÉS DU SITE :
1. 📖 Dictionnaire : 758 mots techniques avec définitions, explications et exemples
2. 🎮 Quiz : teste tes connaissances sur différents domaines
3. 💬 Assistant IA : pour les questions techniques poussées
4. 📝 Forum : pose des questions aux autres étudiants
5. 👥 Amis : ajoute d'autres étudiants
6. 💬 Messages : discute avec tes amis
7. 📚 Révision : révise les mots du dictionnaire (2 modes : Apprentissage + Quiz)
8. 🏆 Badges : débloque des badges en progressant
9. 🎁 Coffres quotidiens : ouvre un coffre par jour pour gagner 10, 20... jusqu'à 100 points
10. ⭐ Points : gagnés via coffres (streak de 7 jours = gros bonus)
11. 📄 Documents : télécharge des fiches

INSTRUCTIONS STRICTES :
- Réponds COURTEMENT (2-3 phrases max, 40 mots max)
- Sois BIENVEILLANT et ENCOURAGEANT
- Utilise des emojis pour rendre vivant
- Si la question est TECHNIQUE (sur un mot, un langage...) → redirige vers la page "Assistant IA"
- Si la question ne concerne pas le site → réponds poliment que tu ne peux aider que sur Étudiants IT
- Ne JAMAIS inventer de fonctionnalités qui n'existent pas

Réponds toujours en français.`;

// ============================================
// FONCTION : APPEL GEMINI
// ============================================
function appelerGemini(prompt) {
    return new Promise((resolve, reject) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        
        const body = JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 200
            }
        });
        
        const options = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            }
        };
        
        const req = https.request(url, options, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) return reject(new Error(json.error.message));
                    
                    const texte = json.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (!texte) return reject(new Error("Réponse vide"));
                    
                    resolve(texte);
                } catch (e) {
                    reject(new Error(`Parse error: ${data.slice(0, 200)}`));
                }
            });
        });
        
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

// ============================================
// POST /api/chatbot/ask — Poser une question au chatbot
// ============================================
router.post("/ask", async (req, res) => {
    try {
        const { question, historique } = req.body;
        
        if (!question || question.trim() === "") {
            return res.status(400).json({
                success: false,
                error: "Question vide"
            });
        }
        
        // Construire le contexte (question + historique récent)
        let contexte = SYSTEM_PROMPT + "\n\n";
        
        if (historique && Array.isArray(historique)) {
            // Garder les 4 derniers échanges max
            const recents = historique.slice(-4);
            recents.forEach(msg => {
                contexte += `${msg.role === "user" ? "Utilisateur" : "Toi"}: ${msg.contenu}\n`;
            });
            contexte += "\n";
        }
        
        contexte += `Utilisateur: ${question}\nToi:`;
        
        // Appeler Gemini
        const reponse = await appelerGemini(contexte);
        
        res.json({
            success: true,
            reponse: reponse.trim()
        });
        
    } catch (erreur) {
        console.error("Erreur chatbot:", erreur.message);
        res.status(500).json({
            success: false,
            error: "Erreur du chatbot. Réessaie dans un instant."
        });
    }
});

// ============================================
// GET /api/chatbot/astuce — Astuce du jour
// ============================================
router.get("/astuce", (req, res) => {
    const astuces = [
        "💡 Tu peux filtrer le dictionnaire par domaine !",
        "💡 Ouvre ton coffre quotidien pour gagner des points ⭐",
        "💡 Le mode Apprentissage t'aide à mémoriser les mots 🧠",
        "💡 Réponds aux sujets du forum pour aider les autres 📝",
        "💡 Ajoute des mots en révision depuis le dictionnaire 📚",
        "💡 Débloque des badges en progressant 🏆",
        "💡 Connecte-toi 7 jours d'affilée pour un coffre légendaire 🏆",
        "💡 Utilise l'Assistant IA pour tes questions techniques 🤖",
        "💡 Ajoute tes amis pour discuter en privé 💬",
        "💡 Filtre par niveau (Débutant/Intermédiaire/Avancé) pour t'entraîner 🎯"
    ];
    
    // Astuce du jour (change chaque jour)
    const aujourdhui = new Date();
    const debutAnnee = new Date(aujourdhui.getFullYear(), 0, 0);
    const numeroJour = Math.floor((aujourdhui - debutAnnee) / (1000 * 60 * 60 * 24));
    const astuce = astuces[numeroJour % astuces.length];
    
    res.json({
        success: true,
        astuce: astuce
    });
});

module.exports = router;