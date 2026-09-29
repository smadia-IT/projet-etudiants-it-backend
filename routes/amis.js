// ============================================
// ROUTES AMIS (PostgreSQL)
// ============================================

const express = require("express");
const router = express.Router();
const { pool } = require("../db/database");
const { authMiddleware } = require("./auth");

// ============================================
// POST /api/amis/demande/:userId — Envoyer une demande d'ami
// ============================================
router.post("/demande/:userId", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const autreId = parseInt(req.params.userId);

        if (monId === autreId) {
            return res.status(400).json({ 
                success: false, 
                error: "Tu ne peux pas t'ajouter toi-même" 
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

        // Vérifier s'il y a déjà une relation
        const existanteResult = await pool.query(`
            SELECT * FROM amities 
            WHERE (user_id_1 = $1 AND user_id_2 = $2) 
               OR (user_id_1 = $2 AND user_id_2 = $1)
        `, [monId, autreId]);

        const existante = existanteResult.rows[0];

        if (existante) {
            if (existante.statut === "acceptee") {
                return res.status(409).json({ 
                    success: false, 
                    error: "Vous êtes déjà amis" 
                });
            }
            if (existante.statut === "en_attente") {
                return res.status(409).json({ 
                    success: false, 
                    error: "Une demande est déjà en attente" 
                });
            }
            // Si refusee, on peut en renvoyer une
            await pool.query("DELETE FROM amities WHERE id = $1", [existante.id]);
        }

        // Créer la demande
        const insertResult = await pool.query(`
            INSERT INTO amities (user_id_1, user_id_2, statut)
            VALUES ($1, $2, 'en_attente')
            RETURNING id
        `, [monId, autreId]);

        res.status(201).json({ 
            success: true, 
            message: "Demande envoyée", 
            amitieId: insertResult.rows[0].id 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/amis/accepter/:amitieId — Accepter une demande
// ============================================
router.post("/accepter/:amitieId", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const amitieId = parseInt(req.params.amitieId);

        // Vérifier que la demande m'est destinée
        const amitieResult = await pool.query(`
            SELECT * FROM amities 
            WHERE id = $1 AND user_id_2 = $2 AND statut = 'en_attente'
        `, [amitieId, monId]);

        if (amitieResult.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: "Demande introuvable ou déjà traitée" 
            });
        }

        await pool.query(`
            UPDATE amities 
            SET statut = 'acceptee', date_reponse = CURRENT_TIMESTAMP 
            WHERE id = $1
        `, [amitieId]);

        res.json({ success: true, message: "Demande acceptée" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/amis/refuser/:amitieId — Refuser une demande
// ============================================
router.post("/refuser/:amitieId", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const amitieId = parseInt(req.params.amitieId);

        const amitieResult = await pool.query(`
            SELECT * FROM amities 
            WHERE id = $1 AND user_id_2 = $2 AND statut = 'en_attente'
        `, [amitieId, monId]);

        if (amitieResult.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: "Demande introuvable" 
            });
        }

        await pool.query(`
            UPDATE amities 
            SET statut = 'refusee', date_reponse = CURRENT_TIMESTAMP 
            WHERE id = $1
        `, [amitieId]);

        res.json({ success: true, message: "Demande refusée" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/amis — Liste de mes amis
// ============================================
router.get("/", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        const amisResult = await pool.query(`
            SELECT 
                a.id as amitie_id,
                u.id,
                u.username,
                u.email,
                a.date_reponse
            FROM amities a
            JOIN utilisateurs u ON (
                (a.user_id_1 = $1 AND u.id = a.user_id_2) OR 
                (a.user_id_2 = $1 AND u.id = a.user_id_1)
            )
            WHERE a.statut = 'acceptee'
            ORDER BY u.username ASC
        `, [monId, monId]);

        res.json({ 
            success: true, 
            count: amisResult.rowCount, 
            data: amisResult.rows 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/amis/demandes — Demandes en attente (reçues)
// ============================================
router.get("/demandes", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        const demandesResult = await pool.query(`
            SELECT 
                a.id as amitie_id,
                a.date_demande,
                u.id as user_id,
                u.username,
                u.email
            FROM amities a
            JOIN utilisateurs u ON u.id = a.user_id_1
            WHERE a.user_id_2 = $1 AND a.statut = 'en_attente'
            ORDER BY a.date_demande DESC
        `, [monId]);

        res.json({ 
            success: true, 
            count: demandesResult.rowCount, 
            data: demandesResult.rows 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/amis/envoyees — Demandes envoyées (en attente)
// ============================================
router.get("/envoyees", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;

        const demandesResult = await pool.query(`
            SELECT 
                a.id as amitie_id,
                a.date_demande,
                u.id as user_id,
                u.username
            FROM amities a
            JOIN utilisateurs u ON u.id = a.user_id_2
            WHERE a.user_id_1 = $1 AND a.statut = 'en_attente'
            ORDER BY a.date_demande DESC
        `, [monId]);

        res.json({ 
            success: true, 
            count: demandesResult.rowCount, 
            data: demandesResult.rows 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// DELETE /api/amis/:amitieId — Retirer un ami
// ============================================
router.delete("/:amitieId", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const amitieId = parseInt(req.params.amitieId);

        const amitieResult = await pool.query(`
            SELECT * FROM amities 
            WHERE id = $1 AND (user_id_1 = $2 OR user_id_2 = $2)
        `, [amitieId, monId]);

        if (amitieResult.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: "Amitié introuvable" 
            });
        }

        await pool.query("DELETE FROM amities WHERE id = $1", [amitieId]);

        res.json({ success: true, message: "Ami retiré" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

module.exports = router;