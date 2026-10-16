// ============================================
// ROUTES COFFRES QUOTIDIENS
// ============================================

const express = require("express");
const router = express.Router();
const { pool } = require("../db/database");
const { authMiddleware } = require("./auth");
const { creerNotification } = require("./notifications");

// Configuration des 7 niveaux
const NIVEAUX = [
    { jour: 1, points: 10,  type: "message" },
    { jour: 2, points: 20,  type: "badge", badge: "coffre-regulier" },
    { jour: 3, points: 30,  type: "mot" },
    { jour: 4, points: 40,  type: "message" },
    { jour: 5, points: 50,  type: "badge", badge: "coffre-assidu" },
    { jour: 6, points: 60,  type: "mot" },
    { jour: 7, points: 100, type: "badge", badge: "coffre-legende" }
];

// Messages d'encouragement
const MESSAGES = [
    "Continue comme ça ! 🎯",
    "Tu es sur la bonne voie ! ⭐",
    "Bravo pour ta régularité ! 💪",
    "Tu progresses vite ! 🚀",
    "Reviens demain pour un nouveau coffre ! 🎁"
];

// ============================================
// GET /api/coffres/statut — État du coffre
// ============================================
router.get("/statut", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        const result = await pool.query(
            "SELECT points, streak_coffres, dernier_coffre FROM utilisateurs WHERE id = $1",
            [monId]
        );

        const user = result.rows[0];
        const maintenant = new Date();
        const dernierCoffre = user.dernier_coffre ? new Date(user.dernier_coffre) : null;

        // Peut ouvrir si :
        // - Jamais ouvert (dernierCoffre = null)
        // - OU il y a plus de 20h depuis le dernier (pour éviter abus)
        let peutOuvrir = true;
        if (dernierCoffre) {
            const heures = (maintenant - dernierCoffre) / (1000 * 60 * 60);
            peutOuvrir = heures >= 20;
        }

        // Calculer le prochain jour de streak
        let prochainJour = 1;
        if (user.streak_coffres > 0 && dernierCoffre) {
            const heures = (maintenant - dernierCoffre) / (1000 * 60 * 60);
            if (heures < 48) {
                // Si moins de 48h, on continue le streak
                prochainJour = Math.min(user.streak_coffres + 1, 7);
            }
            // Sinon, reset à 1 (l'utilisateur a raté un jour)
        }

        res.json({
            success: true,
            points: user.points || 0,
            streak: user.streak_coffres || 0,
            peut_ouvrir: peutOuvrir,
            prochain_jour: prochainJour,
            dernier_coffre: user.dernier_coffre
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/coffres/ouvrir — Ouvrir le coffre
// ============================================
router.post("/ouvrir", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        // 1. Récupérer l'état actuel
        const userResult = await pool.query(
            "SELECT points, streak_coffres, dernier_coffre FROM utilisateurs WHERE id = $1",
            [monId]
        );

        const user = userResult.rows[0];
        const maintenant = new Date();
        const dernierCoffre = user.dernier_coffre ? new Date(user.dernier_coffre) : null;

        // 2. Vérifier qu'il peut ouvrir
        if (dernierCoffre) {
            const heures = (maintenant - dernierCoffre) / (1000 * 60 * 60);
            if (heures < 20) {
                const heuresRestantes = Math.ceil(20 - heures);
                return res.status(400).json({
                    success: false,
                    error: `Tu dois attendre ${heuresRestantes}h avant d'ouvrir ton prochain coffre !`
                });
            }
        }

        // 3. Calculer le nouveau streak
        let nouveauStreak = 1;
        if (user.streak_coffres > 0 && dernierCoffre) {
            const heures = (maintenant - dernierCoffre) / (1000 * 60 * 60);
            if (heures < 48) {
                nouveauStreak = user.streak_coffres + 1;
            }
            // Sinon, reset à 1
        }

        // 4. Si streak > 7, reset à 1
        if (nouveauStreak > 7) {
            nouveauStreak = 1;
        }

        // 5. Récupérer la config du niveau
        const niveau = NIVEAUX[nouveauStreak - 1];
        const pointsGagnes = niveau.points;

        // 6. Déterminer la récompense spéciale
        let recompenseType = niveau.type;
        let recompenseValeur = null;

        if (niveau.type === "message") {
            recompenseValeur = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
        } else if (niveau.type === "badge") {
            recompenseValeur = niveau.badge;
        } else if (niveau.type === "mot") {
            // Récupérer un mot aléatoire du dictionnaire
            const motResult = await pool.query(
                "SELECT mot, definition FROM mots ORDER BY RANDOM() LIMIT 1"
            );
            if (motResult.rowCount > 0) {
                recompenseValeur = JSON.stringify({
                    mot: motResult.rows[0].mot,
                    definition: motResult.rows[0].definition
                });
            }
        }

        // 7. Mettre à jour l'utilisateur
        await pool.query(`
            UPDATE utilisateurs 
            SET points = COALESCE(points, 0) + $1,
                streak_coffres = $2,
                dernier_coffre = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [pointsGagnes, nouveauStreak, monId]);

        // 8. Enregistrer dans l'historique
        await pool.query(`
            INSERT INTO coffres_quotidiens (user_id, jour_streak, points_gagnes, recompense_type, recompense_valeur)
            VALUES ($1, $2, $3, $4, $5)
        `, [monId, nouveauStreak, pointsGagnes, recompenseType, recompenseValeur]);

        // 9. Envoyer une notif si badge débloqué
        if (recompenseType === "badge") {
            try {
                await creerNotification(
                    monId,
                    "badge",
                    "🏆 Nouveau badge débloqué !",
                    `Tu as débloqué le badge "${niveau.badge}" grâce à tes ${nouveauStreak} jours d'affilée !`,
                    "badges.html"
                );
            } catch (e) {
                console.error("Erreur notif badge:", e.message);
            }
        }

        // 10. Réponse
        res.json({
            success: true,
            jour: nouveauStreak,
            points_gagnes: pointsGagnes,
            total_points: (user.points || 0) + pointsGagnes,
            recompense_type: recompenseType,
            recompense_valeur: recompenseValeur
        });

    } catch (erreur) {
        console.error("Erreur ouverture coffre:", erreur);
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/coffres/historique — Historique des coffres
// ============================================
router.get("/historique", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        const result = await pool.query(`
            SELECT jour_streak, points_gagnes, recompense_type, date_ouverture
            FROM coffres_quotidiens
            WHERE user_id = $1
            ORDER BY date_ouverture DESC
            LIMIT 30
        `, [monId]);

        res.json({
            success: true,
            count: result.rowCount,
            data: result.rows
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});
// ============================================
// POST /api/coffres/acheter-vie — Acheter une vie (débit côté serveur)
// ============================================
router.post("/acheter-vie", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const achats = parseInt(req.body.achats, 10);

        if (!Number.isInteger(achats) || achats < 0 || achats > 50) {
            return res.status(400).json({ success: false, error: "Requête invalide" });
        }

        const cout = 10 * (achats + 1);

        // Débit seulement si le solde est suffisant (vérification et débit en une seule requête)
        const result = await pool.query(`
            UPDATE utilisateurs
            SET points = COALESCE(points, 0) - $1
            WHERE id = $2 AND COALESCE(points, 0) >= $1
            RETURNING points
        `, [cout, monId]);

        if (result.rowCount === 0) {
            return res.status(400).json({
                success: false,
                error: `Il te faut ${cout} points pour acheter une vie.`
            });
        }

        res.json({
            success: true,
            cout,
            points: result.rows[0].points
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

module.exports = router;