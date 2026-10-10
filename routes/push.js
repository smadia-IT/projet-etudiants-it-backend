// ============================================
// ROUTES PUSH — Notifications Web Push
// ============================================

const express = require("express");
const router = express.Router();
const webpush = require("web-push");
const { pool } = require("../db/database");
const { authMiddleware } = require("./auth");

// ============================================
// CONFIG WEB-PUSH
// ============================================
webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:contact@etudiants-it.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// ============================================
// GET /api/push/public-key — Récupérer la clé publique
// ============================================
router.get("/public-key", (req, res) => {
    res.json({
        success: true,
        publicKey: process.env.VAPID_PUBLIC_KEY
    });
});

// ============================================
// POST /api/push/subscribe — Enregistrer un abonnement
// ============================================
router.post("/subscribe", authMiddleware, async (req, res) => {
    try {
        const { endpoint, keys } = req.body;
        const userId = req.user.id;

        if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
            return res.status(400).json({
                success: false,
                error: "Données d'abonnement incomplètes"
            });
        }

        // Insérer ou mettre à jour l'abonnement
        await pool.query(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (endpoint) 
            DO UPDATE SET user_id = $1, p256dh = $3, auth = $4
        `, [userId, endpoint, keys.p256dh, keys.auth]);

        res.json({
            success: true,
            message: "Abonnement enregistré"
        });
    } catch (erreur) {
        console.error("Erreur subscribe:", erreur);
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/push/unsubscribe — Supprimer un abonnement
// ============================================
router.post("/unsubscribe", authMiddleware, async (req, res) => {
    try {
        const { endpoint } = req.body;

        if (!endpoint) {
            return res.status(400).json({
                success: false,
                error: "Endpoint manquant"
            });
        }

        await pool.query(
            "DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2",
            [endpoint, req.user.id]
        );

        res.json({ success: true, message: "Abonnement supprimé" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// FONCTION UTILITAIRE : envoyer un push à un user
// ============================================
async function envoyerPush(userId, titre, message, url = "/") {
    try {
        // Récupérer tous les abonnements de ce user
        const result = await pool.query(
            "SELECT * FROM push_subscriptions WHERE user_id = $1",
            [userId]
        );

        if (result.rowCount === 0) return;

        const payload = JSON.stringify({
            title: titre,
            body: message,
            url: url,
            icon: "/icon-192.png",
            badge: "/icon-192.png"
        });

        // Envoyer à chaque abonnement
        for (const sub of result.rows) {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                }
            };

            try {
                await webpush.sendNotification(pushSubscription, payload);
            } catch (erreur) {
                // Si l'abonnement est expiré (410 Gone), on le supprime
                if (erreur.statusCode === 410 || erreur.statusCode === 404) {
                    console.log(`Abonnement expiré supprimé pour user ${userId}`);
                    await pool.query(
                        "DELETE FROM push_subscriptions WHERE endpoint = $1",
                        [sub.endpoint]
                    );
                } else {
                    console.error("Erreur envoi push:", erreur.message);
                }
            }
        }
    } catch (erreur) {
        console.error("Erreur envoyerPush:", erreur.message);
    }
}

module.exports = router;
module.exports.envoyerPush = envoyerPush;