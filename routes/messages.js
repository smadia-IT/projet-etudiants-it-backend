// ============================================
// ROUTES MESSAGES (PostgreSQL)
// ============================================

const express = require("express");
const router = express.Router();
const { pool } = require("../db/database");
const { authMiddleware } = require("./auth");
// ============================================
// DELETE /api/messages/conversations/:userId — Masquer une conversation
// ============================================
router.delete("/conversations/:userId", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const autreId = parseInt(req.params.userId);

        if (monId === autreId) {
            return res.status(400).json({ 
                success: false, 
                error: "Impossible de masquer cette conversation" 
            });
        }

        // Insérer ou mettre à jour le masquage
        await pool.query(`
            INSERT INTO conversations_cachees (user_id, autre_user_id, date_masquage)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id, autre_user_id)
            DO UPDATE SET date_masquage = CURRENT_TIMESTAMP
        `, [monId, autreId]);

        res.json({ 
            success: true, 
            message: "Conversation masquée" 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

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
              AND NOT EXISTS (
                  SELECT 1 FROM conversations_cachees cc
                  WHERE cc.user_id = $1
                    AND cc.autre_user_id = u.id
                    AND cc.date_masquage > m.date
              )
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
// GET /api/messages/:userId/nouveaux — Messages après un certain ID
// ⚠️ DOIT ÊTRE PLACÉE AVANT /:userId
// ============================================
router.get("/:userId/nouveaux", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const autreId = parseInt(req.params.userId);
        const after = parseInt(req.query.after) || 0;

        const result = await pool.query(`
            SELECT 
                m.*,
                u.username as expediteur_username
            FROM messages m
            JOIN utilisateurs u ON u.id = m.expediteur_id
            WHERE ((m.expediteur_id = $1 AND m.destinataire_id = $2)
                OR (m.expediteur_id = $2 AND m.destinataire_id = $1))
              AND m.id > $3
            ORDER BY m.date ASC
        `, [monId, autreId, after]);

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
// GET /api/messages/:userId — Messages avec un utilisateur (paginé)
// ============================================
router.get("/:userId", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const autreId = parseInt(req.params.userId);

        // Paramètres de pagination
        const limit = Math.min(parseInt(req.query.limit) || 30, 100); // max 100
        const before = req.query.before ? parseInt(req.query.before) : null;

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

        // Construire la requête avec ou sans pagination
        let query;
        let params;

        if (before) {
            // Charger les messages AVANT un certain ID (pour le scroll infini)
            query = `
                SELECT 
                    m.*,
                    u.username as expediteur_username
                FROM messages m
                JOIN utilisateurs u ON u.id = m.expediteur_id
                WHERE ((m.expediteur_id = $1 AND m.destinataire_id = $2)
                    OR (m.expediteur_id = $2 AND m.destinataire_id = $1))
                  AND m.id < $3
                ORDER BY m.date DESC
                LIMIT $4
            `;
            params = [monId, autreId, before, limit];
        } else {
            // Charger les derniers messages
            query = `
                SELECT 
                    m.*,
                    u.username as expediteur_username
                FROM messages m
                JOIN utilisateurs u ON u.id = m.expediteur_id
                WHERE ((m.expediteur_id = $1 AND m.destinataire_id = $2)
                    OR (m.expediteur_id = $2 AND m.destinataire_id = $1))
                ORDER BY m.date DESC
                LIMIT $3
            `;
            params = [monId, autreId, limit];
        }

        const messagesResult = await pool.query(query, params);

        // On a récupéré du plus récent au plus ancien → on inverse pour l'affichage
        const messages = messagesResult.rows.reverse();

        // Savoir s'il y a plus de messages à charger
        const hasMore = messagesResult.rowCount === limit;

        res.json({ 
            success: true, 
            count: messages.length,
            data: messages,
            has_more: hasMore,
            plus_ancien_id: messages.length > 0 ? messages[0].id : null,
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

        // ✅ CRÉER UNE NOTIFICATION POUR LE DESTINATAIRE
        try {
            const { creerNotification } = require("./notifications");
            const apercu = contenu.trim().length > 50 
                ? contenu.trim().substring(0, 50) + "..." 
                : contenu.trim();
            
            await creerNotification(
                autreId,                          // destinataire
                "message",                        // type
                `💬 Nouveau message de ${req.user.username}`,  // titre
                apercu,                           // message
                `messages.html?user=${monId}&username=${encodeURIComponent(req.user.username)}` // lien
            );
        } catch (notifErreur) {
            console.error("Erreur création notif message:", notifErreur.message);
            // On ne bloque pas l'envoi du message si la notif plante
        }

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