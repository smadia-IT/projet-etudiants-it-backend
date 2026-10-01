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

module.exports = router;
module.exports.creerNotification = creerNotification;