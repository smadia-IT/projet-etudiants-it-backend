// ============================================
// SERVEUR EXPRESS - ÉTUDIANTS IT
// ============================================

const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const PORT = process.env.PORT || 3000;

// Imports
const { initialiserTables, migrerDonnees } = require("./db/database");
const routesMots = require("./routes/mots");
const { router: routesAuth } = require("./routes/auth");
const routesUtilisateurs = require("./routes/utilisateurs");
const routesAmis = require("./routes/amis");
const routesMessages = require("./routes/messages");
const routesForum = require("./routes/forum");
const routesChat = require("./routes/chat");
const routesNotifications = require("./routes/notifications");

// ============================================
// MIDDLEWARE
// ============================================

// ⚠️ LA CONFIG CORS DOIT ÊTRE ICI
const corsOptions = {
    origin: process.env.NODE_ENV === "production"
        ? [
            "https://projet-etudiants-it.vercel.app",
            "https://projet-etudiants-it-git-main-smadia.vercel.app"
          ]
        : [
            "http://localhost:3000",
            "http://localhost:5500",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5500"
          ],
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// ...


// ============================================
// ROUTES
// ============================================

// Accueil
app.get("/", (req, res) => {
    res.json({
        message: "🎉 Bienvenue sur l'API Étudiants IT",
        version: "1.0.0",
        endpoints: {
            mots: "/api/mots",
            test: "/api/test"
        }
    });
});

// Test
app.get("/api/test", (req, res) => {
    res.json({
        message: "L'API fonctionne !",
        date: new Date().toISOString()
    });
});

// Routes pour les mots
app.use("/api/mots", routesMots);

// Routes pour l'authentification
app.use("/api/auth", routesAuth);

// Routes pour les utilisateurs
app.use("/api/utilisateurs", routesUtilisateurs);

// Routes pour les amis
app.use("/api/amis", routesAmis);

// Routes pour les messages
app.use("/api/messages", routesMessages);

// Routes pour le forum
app.use("/api/forum", routesForum);
app.use("/api/chat", routesChat);
app.use("/api/notifications", routesNotifications);

// ⚠️ ROUTE TEMPORAIRE DE DEBUG - À SUPPRIMER APRÈS
app.get("/api/debug", (req, res) => {
    res.json({
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        hasJwtSecret: !!process.env.JWT_SECRET,
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT
    });
});

// ============================================
// DÉMARRAGE
// ============================================
async function demarrer() {
    try {
        console.log("🔧 Initialisation des tables...");
        await initialiserTables();
        
        console.log("📚 Migration des données...");
        await migrerDonnees();
        
        app.listen(PORT, () => {
            console.log(`🚀 Serveur sur le port ${PORT}`);
            console.log(`📚 API Mots : http://localhost:${PORT}/api/mots`);
        });
    } catch (erreur) {
        console.error("❌ Erreur au démarrage:", erreur.message);
        process.exit(1); // Arrêter le serveur si l'init échoue
    }
}

demarrer();