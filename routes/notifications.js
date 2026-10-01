// ============================================
// ROUTES NOTIFICATIONS (PostgreSQL)
// ============================================

const express = require("express");
const router = express.Router();
const { pool } = require("../db/database");
const { authMiddleware } = require("./auth");

// ============================================
// GET /api/notifications — Liste des notifications
// ============================================
router.get("/", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const limit = Math.min(parseInt(req.query.limit) || 30, 100);
        const before = req.query.before ? parseInt(req.query.before) : null;

        let query;
        let params;

        if (before) {
            query = `
                SELECT * FROM notifications 
                WHERE user_id = $1 AND id < $2
                ORDER BY date DESC 
                LIMIT $3
            `;
            params = [monId, before, limit];
        } else {
            query = `
                SELECT * FROM notifications 
                WHERE user_id = $1
                ORDER BY date DESC 
                LIMIT $2
            `;
            params = [monId, limit];
        }

        const result = await pool.query(query, params);

        res.json({
            success: true,
            count: result.rowCount,
            data: result.rows,
            has_more: result.rowCount === limit,
            plus_ancien_id: result.rowCount > 0 ? result.rows[result.rowCount - 1].id : null
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/notifications/non-lus/count — Nombre de non-lues
// ============================================
router.get("/non-lus/count", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        const result = await pool.query(`
            SELECT COUNT(*) as nb 
            FROM notifications 
            WHERE user_id = $1 AND lu = 0
        `, [monId]);

        res.json({
            success: true,
            count: parseInt(result.rows[0].nb)
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/notifications/:id/lu — Marquer comme lue
// ============================================
router.post("/:id/lu", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const notifId = parseInt(req.params.id);

        const result = await pool.query(`
            UPDATE notifications 
            SET lu = 1 
            WHERE id = $1 AND user_id = $2
        `, [notifId, monId]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: "Notification introuvable"
            });
        }

        res.json({ success: true, message: "Notification marquée comme lue" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/notifications/tout-lu — Tout marquer comme lu
// ============================================
router.post("/tout-lu", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        const result = await pool.query(`
            UPDATE notifications 
            SET lu = 1 
            WHERE user_id = $1 AND lu = 0
        `, [monId]);

        res.json({
            success: true,
            message: `${result.rowCount} notification(s) marquée(s) comme lue(s)`
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// DELETE /api/notifications/:id — Supprimer une notif
// ============================================
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const notifId = parseInt(req.params.id);

        const result = await pool.query(`
            DELETE FROM notifications 
            WHERE id = $1 AND user_id = $2
        `, [notifId, monId]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: "Notification introuvable"
            });
        }

        res.json({ success: true, message: "Notification supprimée" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// FONCTION UTILITAIRE : créer une notification
// (appelée depuis d'autres routes backend)
// ============================================
async function creerNotification(userId, type, titre, message, lien) {
    try {
        await pool.query(`
            INSERT INTO notifications (user_id, type, titre, message, lien)
            VALUES ($1, $2, $3, $4, $5)
        `, [userId, type, titre, message, lien]);
    } catch (erreur) {
        console.error("Erreur création notification:", erreur.message);
    }
}

// ============================================
// CRON : Rappel d'inactivité 24h
// ============================================
async function envoyerRappelsInactivite() {
    try {
        // Trouver les utilisateurs inactifs depuis plus de 24h
        // - Pas de rappel envoyé dans les dernières 24h
        // - Au moins 1 ami OU 1 notif non lue (pour ne pas spammer les comptes vides)
        const result = await pool.query(`
            SELECT u.id, u.username
            FROM utilisateurs u
            WHERE u.derniere_activite < NOW() - INTERVAL '24 hours'
              AND (u.dernier_rappel_envoye IS NULL 
                   OR u.dernier_rappel_envoye < NOW() - INTERVAL '24 hours')
              AND (
                  EXISTS (
                      SELECT 1 FROM amities a
                      WHERE (a.user_id_1 = u.id OR a.user_id_2 = u.id)
                        AND a.statut = 'acceptee'
                  )
                  OR EXISTS (
                      SELECT 1 FROM notifications n
                      WHERE n.user_id = u.id AND n.lu = 0
                  )
              )
        `);
        
        console.log(`🔔 Rappels inactivité : ${result.rowCount} utilisateur(s) trouvé(s)`);
        
        for (const user of result.rows) {
            await creerNotification(
                user.id,
                "rappel",
                "👋 Tu nous manques !",
                `Ça fait un moment qu'on ne t'a pas vu sur Étudiants IT. Reviens vite !`,
                "index.html"
            );
            
            // Marquer qu'on a envoyé un rappel
            await pool.query(`
                UPDATE utilisateurs 
                SET dernier_rappel_envoye = CURRENT_TIMESTAMP 
                WHERE id = $1
            `, [user.id]);
        }
        
        console.log(`✅ Rappels inactivité envoyés : ${result.rowCount}`);
    } catch (erreur) {
        console.error("❌ Erreur cron rappels inactivité:", erreur.message);
    }
}

// ============================================
// DÉMARRER LE CRON (toutes les heures)
// ============================================
function demarrerCronRappels() {
    console.log("⏰ Cron rappels inactivité démarré (toutes les heures)");
    
    // Lancer une fois au démarrage (après 30 secondes pour laisser le serveur se stabiliser)
    setTimeout(() => {
        envoyerRappelsInactivite();
    }, 30000);
    
    // Puis toutes les heures (3600000 ms)
    setInterval(envoyerRappelsInactivite, 60 * 60 * 1000);
}

module.exports = router;
module.exports.creerNotification = creerNotification;

module.exports = router;
module.exports.creerNotification = creerNotification;
module.exports.demarrerCronRappels = demarrerCronRappels;