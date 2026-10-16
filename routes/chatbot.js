// ============================================
// ROUTES CHATBOT D'AIDE
// ============================================
// Répond aux questions sur le fonctionnement d'Étudiants IT,
// en tenant compte de l'état de l'utilisateur.
// ============================================

const express = require("express");
const router = express.Router();
const https = require("https");
const { authMiddleware } = require("./auth");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.5-flash-lite";

const TAILLE_MAX_QUESTION = 1000;

// ============================================
// PROMPT SYSTÈME (guide du site)
// ============================================
const SYSTEM_PROMPT = `Tu es l'assistant d'aide d'Étudiants IT, une plateforme pour étudiants en informatique.
Tu réponds uniquement sur le fonctionnement du site. Si la question sort de ce cadre, tu le dis poliment et tu proposes l'Assistant IA (page chat.html) pour les questions techniques.

GUIDE DU SITE (ne jamais inventer une fonctionnalité absente de ce guide) :

ACCUEIL (index.html)
- Mot du jour : bouton « Réviser ce mot » pour l'ajouter à ta liste de révision.
- Coffre quotidien : ouvre-le une fois par jour pour gagner des points. Série de 7 jours = bonus.
- Ma progression : parties, meilleur score, badges, favoris.

DICTIONNAIRE (dictionnaire.html)
- Recherche par mot ou définition, filtre par domaine (menu déroulant) et par niveau.
- ☆ ajoute un mot aux favoris. « Réviser ce mot » l'ajoute à ta liste de révision.
- « Voir plus de mots » affiche la suite de la liste.

QUIZ (quiz.html)
- Choisis la difficulté (facile : 30 s ; difficile : 20 s, points x2) et le domaine, puis Commencer.
- Types de questions : définition, quel mot, vrai ou faux, complète la définition, domaine, écris le mot.
- Bonne réponse rapide = plus de points. 3 bonnes réponses d'affilée = une vie gagnée.
- ⏸ Pause met la partie en pause. Passer sur un autre onglet met aussi en pause.
- Plus de vies : tu peux acheter une vie avec tes points. Le prix augmente à chaque achat dans la même partie (10, 20, 30…).

RÉVISION (revision.html)
- Mode Apprentissage : parcourt les mots de ta liste.
- Mode Quiz : teste-toi sur ta liste. Un mot est maîtrisé après 3 bonnes réponses.
- Vider la liste : bouton en bas de la page.

MESSAGERIE (messages.html)
- Choisis une conversation dans la liste, ou ➕ pour en commencer une avec un ami.
- 🎤 envoie un message vocal (60 secondes maximum).
- Réactions : touche 👍 ❤️ 😂 sous un message. Retouche la même pour la retirer.
- 🗑️ à côté de ton message le supprime (seulement pour toi, pour l'autre personne il disparaît aussi).
- Une notification sonne pour chaque nouveau message reçu.

AMIS (amis.html)
- Onglet Mes amis : message ou retirer un ami.
- Onglet Demandes : accepter ou refuser.
- Onglet Découvrir : chercher par nom et envoyer une demande.

FORUM (forum.html)
- Lire les sujets, filtrer par domaine, chercher.
- Créer un sujet : bouton ➕ (il faut être connecté).
- Répondre dans un sujet (il faut être connecté).

DOCUMENTS (documents.html)
- Fiches et résumés à télécharger. Filtre par type et par domaine.

ASSISTANT IA (chat.html)
- Pour les questions techniques poussées (concepts, code, exercices).

PROFIL (profil.html)
- Tes statistiques, ta photo (📷), tes badges.

PARAMÈTRES (parametres.html)
- Thème clair ou sombre.
- Notifications : activer, ou comprendre pourquoi elles sont bloquées.
- Installer l'application sur ton écran d'accueil.
- Mentions légales.
- Déconnexion et suppression du compte.

MENU « PLUS » (barre du bas)
- Accès au profil, paramètres, badges, révision, amis, forum, assistant IA, documents.

COMPTE
- Inscription : prénom, nom, nom d'utilisateur, e-mail, pays puis numéro (l'indicatif est automatique), mot de passe (8 caractères, une majuscule, un chiffre).
- Connexion : par nom d'utilisateur, e-mail ou téléphone.

RÈGLES DE RÉPONSE :
- Réponds en 3 à 6 lignes maximum. Pour une procédure, donne les étapes numérotées (4 étapes maximum).
- Indique toujours où trouver la fonctionnalité (page et bouton).
- Si l'utilisateur n'est pas connecté et demande une action qui en a besoin, dis-le et propose de te connecter.
- Ne donne jamais d'informations sur les autres utilisateurs.
- Réponds toujours en français, avec quelques emojis.`;

// ============================================
// ÉTAT DE L'UTILISATEUR (informations non sensibles)
// ============================================
function construireContexte(ctx) {
    const c = ctx || {};
    return `ÉTAT ACTUEL DE L'UTILISATEUR :
- Connecté : ${c.connecte ? "oui" : "non"}
- Page actuelle : ${String(c.pageActuelle || "inconnue").slice(0, 60)}
- Notifications activées : ${c.notificationsActivees ? "oui" : "non"}

`;
}

// ============================================
// APPEL GEMINI (en-tête pour la clé, pas dans l'URL)
// ============================================
async function appelerGemini(prompt) {
    const tentatives = 3;
    for (let i = 1; i <= tentatives; i++) {
        try {
            return await appelerGeminiUnefois(prompt);
        } catch (erreur) {
            const surcharge = /high demand|overloaded|503|429/i.test(erreur.message);
            if (!surcharge || i === tentatives) throw erreur;
            await new Promise(r => setTimeout(r, 1000 * i));
        }
    }
}

function appelerGeminiUnefois(prompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 400
            }
        });

        const options = {
            hostname: "generativelanguage.googleapis.com",
            path: `/v1beta/models/${MODEL}:generateContent`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
                "x-goog-api-key": GEMINI_API_KEY
            }
        };

        const req = https.request(options, (res) => {
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
// POST /api/chatbot/ask — Poser une question
// ============================================
router.post("/ask", authMiddleware, async (req, res) => {
    try {
        const { question, historique, contexte } = req.body;

        if (!question || question.trim() === "") {
            return res.status(400).json({ success: false, error: "Question vide" });
        }

        if (question.length > TAILLE_MAX_QUESTION) {
            return res.status(400).json({
                success: false,
                error: "Question trop longue (1000 caractères maximum)"
            });
        }

        // Prompt = guide + état de l'utilisateur + 4 derniers échanges + question
        let prompt = SYSTEM_PROMPT + "\n\n" + construireContexte(contexte);

        if (Array.isArray(historique)) {
            historique.slice(-4).forEach(msg => {
                prompt += `${msg.role === "user" ? "Utilisateur" : "Toi"}: ${String(msg.contenu || "").slice(0, 500)}\n`;
            });
            prompt += "\n";
        }

        prompt += `Utilisateur: ${question}\nToi:`;

        const reponse = await appelerGemini(prompt);

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

    const aujourdhui = new Date();
    const debutAnnee = new Date(aujourdhui.getFullYear(), 0, 0);
    const numeroJour = Math.floor((aujourdhui - debutAnnee) / (1000 * 60 * 60 * 24));
    const astuce = astuces[numeroJour % astuces.length];

    res.json({ success: true, astuce });
});

module.exports = router;