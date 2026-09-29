// ============================================
// ROUTES UTILISATEURS (PostgreSQL)
// ============================================

const express = require("express");
const router = express.Router();
const { pool } = require("../db/database");
const { authMiddleware } = require("./auth");

// ============================================
// GET /api/utilisateurs — Liste tous les utilisateurs (sauf moi)
// ============================================
router.get("/", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const utilisateursResult = await pool.query(`
            SELECT id, username, email, created_at 
            FROM utilisateurs 
            WHERE id != $1 
            ORDER BY username ASC
        `, [userId]);

        const utilisateurs = utilisateursResult.rows;

        // Pour chaque utilisateur, vérifier le statut de l'amitié
        const utilisateursAvecStatut = await Promise.all(
            utilisateurs.map(async (u) => {
                const amitieResult = await pool.query(`
                    SELECT id, statut, user_id_1 
                    FROM amities 
                    WHERE (user_id_1 = $1 AND user_id_2 = $2) 
                       OR (user_id_1 = $2 AND user_id_2 = $1)
                `, [userId, u.id]);

                const amitie = amitieResult.rows[0];

                let statutAmitie = "aucune";
                let amitieId = null;
                let envoyeParMoi = false;

                if (amitie) {
                    statutAmitie = amitie.statut;
                    amitieId = amitie.id;
                    envoyeParMoi = amitie.user_id_1 === userId;
                }

                return {
                    ...u,
                    statutAmitie,
                    amitieId,
                    envoyeParMoi
                };
            })
        );

        res.json({ 
            success: true, 
            count: utilisateursAvecStatut.length, 
            data: utilisateursAvecStatut 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/utilisateurs/recherche/:texte — Rechercher un utilisateur
// ============================================
router.get("/recherche/:texte", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const texte = `%${req.params.texte}%`;

        const result = await pool.query(`
            SELECT id, username, email 
            FROM utilisateurs 
            WHERE (username ILIKE $1 OR email ILIKE $1) AND id != $2
            ORDER BY username ASC
        `, [texte, userId]);

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
// GET /api/utilisateurs/:id — Profil public d'un utilisateur
// ============================================
router.get("/:id", authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const monId = req.user.id;
        
        const utilisateurResult = await pool.query(
            "SELECT id, username, email, created_at FROM utilisateurs WHERE id = $1",
            [id]
        );

        const utilisateur = utilisateurResult.rows[0];

        if (!utilisateur) {
            return res.status(404).json({ 
                success: false, 
                error: "Utilisateur introuvable" 
            });
        }

        // Stats
        const nbAmisResult = await pool.query(`
            SELECT COUNT(*) as nb FROM amities
            WHERE statut = 'acceptee' 
              AND (user_id_1 = $1 OR user_id_2 = $1)
        `, [id]);
        const nbAmis = parseInt(nbAmisResult.rows[0].nb);

        const nbMessagesResult = await pool.query(`
            SELECT COUNT(*) as nb FROM messages
            WHERE expediteur_id = $1
        `, [id]);
        const nbMessages = parseInt(nbMessagesResult.rows[0].nb);

        let nbPosts = 0;
        try {
            const nbPostsResult = await pool.query(
                "SELECT COUNT(*) as nb FROM posts WHERE user_id = $1",
                [id]
            );
            nbPosts = parseInt(nbPostsResult.rows[0].nb);
        } catch (e) {
            // Table posts peut ne pas exister
        }

        // Statut d'amitié
               const amitieResult = await pool.query(`
            SELECT id, statut, user_id_1 
            FROM amities 
            WHERE (user_id_1 = $1 AND user_id_2 = $2) 
               OR (user_id_1 = $2 AND user_id_2 = $1)
        `, [monId, id]);

        const amitie = amitieResult.rows[0];

        let statutAmitie = "aucune";
        let amitieId = null;
        let envoyeParMoi = false;

        if (amitie) {
            statutAmitie = amitie.statut;
            amitieId = amitie.id;
            envoyeParMoi = amitie.user_id_1 === monId;
        }

        // Liste d'amis
        const amisResult = await pool.query(`
            SELECT u.id, u.username
            FROM amities a
            JOIN utilisateurs u ON (
                (a.user_id_1 = $1 AND u.id = a.user_id_2) OR 
                (a.user_id_2 = $1 AND u.id = a.user_id_1)
            )
            WHERE a.statut = 'acceptee'
            ORDER BY u.username ASC
            LIMIT 20
        `, [id]);

        res.json({
            success: true,
            data: {
                utilisateur: utilisateur,
                stats: {
                    nb_amis: nbAmis,
                    nb_messages: nbMessages,
                    nb_posts: nbPosts
                },
                statut_amitie: {
                    statut: statutAmitie,
                    amitie_id: amitieId,
                    envoye_par_moi: envoyeParMoi
                },
                amis: amisResult.rows
            }
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

module.exports = router;