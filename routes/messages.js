// ============================================
// ROUTES MESSAGES (PostgreSQL)
// ============================================

const express = require("express");
const router = express.Router();
const { pool } = require("../db/database");
const { authMiddleware } = require("./auth");

// ============================================
// GET /api/messages/conversations — Liste des conversations
// ============================================
router.get("/conversations", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        const conversationsResult = await pool.query(`
            SELECT 
                u.id as user_id,
                u.username,
                m.contenu as dernier_message,
                m.date as date_dernier,
                m.expediteur_id as dernier_expediteur,
                m.lu,
                (
                    SELECT COUNT(*) 
                    FROM messages 
                    WHERE expediteur_id = u.id 
                      AND destinataire_id = $1 
                      AND lu = 0
                ) as nb_non_lus
            FROM utilisateurs u
            JOIN messages m ON m.id = (
                SELECT id FROM messages 
                WHERE (expediteur_id = $1 AND destinataire_id = u.id)
                   OR (expediteur_id = u.id AND destinataire_id = $1)
                ORDER BY date DESC 
                LIMIT 1
            )
            WHERE u.id != $1
            ORDER BY m.date DESC
        `, [monId]);

        res.json({ 
            success: true, 
            count: conversationsResult.rowCount, 
            data: conversationsResult.rows 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/messages/non-lus/count — Nombre de messages non lus
// ============================================
router.get("/non-lus/count", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        const result = await pool.query(`
            SELECT COUNT(*) as nb 
            FROM messages 
            WHERE destinataire_id = $1 AND lu = 0
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
// GET /api/messages/:userId — Messages avec un utilisateur
// ============================================
router.get("/:userId", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const autreId = parseInt(req.params.userId);

        // Vérifier que l'autre utilisateur existe
        const autreUserResult = await pool.query(
            "SELECT id, username FROM utilisateurs WHERE id = $1",
            [autreId]
        );

        const autreUser = autreUserResult.rows[0];

        if (!autreUser) {
            return res.status(404).json({ 
                success: false, 
                error: "Utilisateur introuvable" 
            });
        }

        // Récupérer tous les messages échangés
        const messagesResult = await pool.query(`
            SELECT 
                m.*,
                u.username as expediteur_username
            FROM messages m
            JOIN utilisateurs u ON u.id = m.expediteur_id
            WHERE (m.expediteur_id = $1 AND m.destinataire_id = $2)
               OR (m.expediteur_id = $2 AND m.destinataire_id = $1)
            ORDER BY m.date ASC
        `, [monId, autreId, autreId, monId]);

        res.json({ 
            success: true, 
            count: messagesResult.rowCount, 
            data: messagesResult.rows,
            autre_utilisateur: autreUser
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/messages/:userId — Envoyer un message
// ============================================
router.post("/:userId", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const autreId = parseInt(req.params.userId);
        const { contenu } = req.body;

        if (!contenu || contenu.trim() === "") {
            return res.status(400).json({ 
                success: false, 
                error: "Le message ne peut pas être vide" 
            });
        }

        if (contenu.length > 2000) {
            return res.status(400).json({ 
                success: false, 
                error: "Message trop long (max 2000 caractères)" 
            });
        }

        if (monId === autreId) {
            return res.status(400).json({ 
                success: false, 
                error: "Tu ne peux pas t'envoyer un message" 
            });
        }

        // Vérifier que l'autre utilisateur existe
        const autreUserResult = await pool.query(
            "SELECT id FROM utilisateurs WHERE id = $1",
            [autreId]
        );

        if (autreUserResult.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: "Utilisateur introuvable" 
            });
        }

        // Insérer le message
        const insertResult = await pool.query(`
            INSERT INTO messages (expediteur_id, destinataire_id, contenu)
            VALUES ($1, $2, $3)
            RETURNING id
        `, [monId, autreId, contenu.trim()]);

        const messageId = insertResult.rows[0].id;

        const messageResult = await pool.query(`
            SELECT m.*, u.username as expediteur_username
            FROM messages m
            JOIN utilisateurs u ON u.id = m.expediteur_id
            WHERE m.id = $1
        `, [messageId]);

        res.status(201).json({ 
            success: true, 
            data: messageResult.rows[0] 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/messages/:userId/lu — Marquer les messages comme lus
// ============================================
router.post("/:userId/lu", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const autreId = parseInt(req.params.userId);

        const result = await pool.query(`
            UPDATE messages 
            SET lu = 1 
            WHERE expediteur_id = $1 AND destinataire_id = $2 AND lu = 0
        `, [autreId, monId]);

        res.json({ 
            success: true, 
            message: `${result.rowCount} message(s) marqué(s) comme lu(s)` 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// DELETE /api/messages/:messageId — Supprimer un message
// ============================================
router.delete("/:messageId", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const messageId = parseInt(req.params.messageId);

        const messageResult = await pool.query(`
            SELECT * FROM messages 
            WHERE id = $1 AND (expediteur_id = $2 OR destinataire_id = $2)
        `, [messageId, monId]);

        if (messageResult.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: "Message introuvable" 
            });
        }

        await pool.query("DELETE FROM messages WHERE id = $1", [messageId]);

        res.json({ success: true, message: "Message supprimé" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

module.exports = router;