// ============================================
// ROUTES FORUM (PostgreSQL)
// ============================================

const express = require("express");
const router = express.Router();
const { pool } = require("../db/database");
const { authMiddleware } = require("./auth");
const { creerNotification } = require("./notifications");

// ============================================
// GET /api/forum/posts — Liste des sujets
// ============================================
router.get("/posts", async (req, res) => {
    try {
        const { domaine, recherche } = req.query;
        
        let query = `
            SELECT 
                p.id,
                p.titre,
                p.contenu,
                p.domaine,
                p.date,
                u.id as user_id,
                u.username,
                (SELECT COUNT(*) FROM commentaires c WHERE c.post_id = p.id) as nb_commentaires
            FROM posts p
            JOIN utilisateurs u ON u.id = p.user_id
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (domaine && domaine !== "tous") {
            query += ` AND p.domaine = $${paramIndex}`;
            params.push(domaine);
            paramIndex++;
        }
        
        if (recherche) {
            query += ` AND (p.titre ILIKE $${paramIndex} OR p.contenu ILIKE $${paramIndex})`;
            params.push(`%${recherche}%`);
            paramIndex++;
        }
        
        query += " ORDER BY p.date DESC";
        
        const result = await pool.query(query, params);
        
        const postsAvecApercu = result.rows.map(p => ({
            ...p,
            nb_commentaires: parseInt(p.nb_commentaires),
            apercu: p.contenu.length > 150 
                ? p.contenu.substring(0, 150) + "..." 
                : p.contenu
        }));
        
        res.json({ 
            success: true, 
            count: postsAvecApercu.length, 
            data: postsAvecApercu 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/forum/posts/:id — Détail d'un sujet
// ============================================
router.get("/posts/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        const postResult = await pool.query(`
            SELECT 
                p.*,
                u.id as user_id,
                u.username
            FROM posts p
            JOIN utilisateurs u ON u.id = p.user_id
            WHERE p.id = $1
        `, [id]);
        
        const post = postResult.rows[0];
        
        if (!post) {
            return res.status(404).json({ 
                success: false, 
                error: "Sujet introuvable" 
            });
        }
        
        const commentairesResult = await pool.query(`
            SELECT 
                c.*,
                u.id as user_id,
                u.username
            FROM commentaires c
            JOIN utilisateurs u ON u.id = c.user_id
            WHERE c.post_id = $1
            ORDER BY c.date ASC
        `, [id]);
        
        res.json({ 
            success: true, 
            data: { 
                post: post, 
                commentaires: commentairesResult.rows 
            } 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/forum/posts — Créer un sujet
// ============================================
router.post("/posts", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const { titre, contenu, domaine } = req.body;
        
        if (!titre || !contenu || !domaine) {
            return res.status(400).json({ 
                success: false, 
                error: "Champs obligatoires : titre, contenu, domaine" 
            });
        }
        
        if (titre.length < 5 || titre.length > 200) {
            return res.status(400).json({ 
                success: false, 
                error: "Le titre doit faire entre 5 et 200 caractères" 
            });
        }
        
        if (contenu.length < 10 || contenu.length > 5000) {
            return res.status(400).json({ 
                success: false, 
                error: "Le contenu doit faire entre 10 et 5000 caractères" 
            });
        }
        
        const insertResult = await pool.query(`
            INSERT INTO posts (user_id, titre, contenu, domaine)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `, [monId, titre.trim(), contenu.trim(), domaine]);
        
        const postId = insertResult.rows[0].id;
        
        const postResult = await pool.query(`
            SELECT p.*, u.username
            FROM posts p
            JOIN utilisateurs u ON u.id = p.user_id
            WHERE p.id = $1
        `, [postId]);
        
        res.status(201).json({ 
            success: true, 
            data: postResult.rows[0] 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/forum/posts/:id/commentaires — Ajouter un commentaire
// ============================================
router.post("/posts/:id/commentaires", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const postId = parseInt(req.params.id);
        const { contenu } = req.body;
        
        if (!contenu || contenu.trim().length < 2) {
            return res.status(400).json({ 
                success: false, 
                error: "Le commentaire doit faire au moins 2 caractères" 
            });
        }
        
        if (contenu.length > 2000) {
            return res.status(400).json({ 
                success: false, 
                error: "Le commentaire ne peut pas dépasser 2000 caractères" 
            });
        }
        
        // Vérifier que le post existe ET récupérer son auteur + titre
        const postResult = await pool.query(
            "SELECT id, user_id, titre FROM posts WHERE id = $1",
            [postId]
        );
        
        if (postResult.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: "Sujet introuvable" 
            });
        }
        
        const post = postResult.rows[0];
        
        const insertResult = await pool.query(`
            INSERT INTO commentaires (post_id, user_id, contenu)
            VALUES ($1, $2, $3)
            RETURNING id
        `, [postId, monId, contenu.trim()]);
        
        const commentaireId = insertResult.rows[0].id;
        
        const commentaireResult = await pool.query(`
            SELECT c.*, u.username
            FROM commentaires c
            JOIN utilisateurs u ON u.id = c.user_id
            WHERE c.id = $1
        `, [commentaireId]);
        
        // ✅ Notifier l'auteur du sujet (SAUF si c'est lui-même qui commente)
        try {
            if (post.user_id !== monId) {
                const apercu = contenu.trim().length > 60 
                    ? contenu.trim().substring(0, 60) + "..." 
                    : contenu.trim();
                
                const titreTronque = post.titre.length > 40 
                    ? post.titre.substring(0, 40) + "..." 
                    : post.titre;
                
                await creerNotification(
                    post.user_id,
                    "forum",
                    `📝 Nouveau commentaire sur ton sujet`,
                    `${req.user.username} a répondu à "${titreTronque}" : ${apercu}`,
                    `sujet.html?id=${postId}`
                );
            }
        } catch (notifErreur) {
            console.error("Erreur notif commentaire forum:", notifErreur.message);
        }
        
        res.status(201).json({ 
            success: true, 
            data: commentaireResult.rows[0] 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// DELETE /api/forum/posts/:id — Supprimer un sujet
// ============================================
router.delete("/posts/:id", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const id = parseInt(req.params.id);
        
        const postResult = await pool.query(
            "SELECT * FROM posts WHERE id = $1",
            [id]
        );
        
        const post = postResult.rows[0];
        
        if (!post) {
            return res.status(404).json({ 
                success: false, 
                error: "Sujet introuvable" 
            });
        }
        
        if (post.user_id !== monId) {
            return res.status(403).json({ 
                success: false, 
                error: "Tu ne peux supprimer que tes propres sujets" 
            });
        }
        
        await pool.query("DELETE FROM posts WHERE id = $1", [id]);
        
        res.json({ success: true, message: "Sujet supprimé" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// DELETE /api/forum/commentaires/:id — Supprimer un commentaire
// ============================================
router.delete("/commentaires/:id", authMiddleware, async (req, res) => {
    try {
        const monId = req.user.id;
        const id = parseInt(req.params.id);
        
        const commentaireResult = await pool.query(
            "SELECT * FROM commentaires WHERE id = $1",
            [id]
        );
        
        const commentaire = commentaireResult.rows[0];
        
        if (!commentaire) {
            return res.status(404).json({ 
                success: false, 
                error: "Commentaire introuvable" 
            });
        }
        
        if (commentaire.user_id !== monId) {
            return res.status(403).json({ 
                success: false, 
                error: "Tu ne peux supprimer que tes propres commentaires" 
            });
        }
        
        await pool.query("DELETE FROM commentaires WHERE id = $1", [id]);
        
        res.json({ success: true, message: "Commentaire supprimé" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/forum/stats — Statistiques du forum
// ============================================
router.get("/stats", async (req, res) => {
    try {
        const nbPostsResult = await pool.query("SELECT COUNT(*) as nb FROM posts");
        const nbCommentairesResult = await pool.query("SELECT COUNT(*) as nb FROM commentaires");
        const nbUtilisateursResult = await pool.query("SELECT COUNT(*) as nb FROM utilisateurs");
        
        res.json({ 
            success: true, 
            data: {
                nb_posts: parseInt(nbPostsResult.rows[0].nb),
                nb_commentaires: parseInt(nbCommentairesResult.rows[0].nb),
                nb_utilisateurs: parseInt(nbUtilisateursResult.rows[0].nb)
            }
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

module.exports = router;