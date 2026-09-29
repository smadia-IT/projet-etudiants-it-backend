// ============================================
// ROUTES API POUR LES MOTS (PostgreSQL)
// ============================================

const express = require("express");
const router = express.Router();
const { pool } = require("../db/database");

// GET /api/mots
router.get("/", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM mots ORDER BY mot ASC");
        res.json({ 
            success: true, 
            count: result.rowCount, 
            data: result.rows 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// GET /api/mots/:id
router.get("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await pool.query("SELECT * FROM mots WHERE id = $1", [id]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: "Mot introuvable" 
            });
        }
        
        res.json({ success: true, data: result.rows[0] });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// GET /api/mots/domaine/:domaine
router.get("/domaine/:domaine", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM mots WHERE domaine = $1 ORDER BY mot ASC",
            [req.params.domaine]
        );
        res.json({ 
            success: true, 
            count: result.rowCount, 
            data: result.rows 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// GET /api/mots/recherche/:texte
router.get("/recherche/:texte", async (req, res) => {
    try {
        const texte = `%${req.params.texte}%`;
        const result = await pool.query(`
            SELECT * FROM mots 
            WHERE mot ILIKE $1 OR definition ILIKE $1
            ORDER BY mot ASC
        `, [texte]);
        res.json({ 
            success: true, 
            count: result.rowCount, 
            data: result.rows 
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// POST /api/mots
router.post("/", async (req, res) => {
    try {
        const { mot, definition, domaine, niveau } = req.body;
        
        if (!mot || !definition || !domaine) {
            return res.status(400).json({ 
                success: false, 
                error: "Champs obligatoires : mot, definition, domaine" 
            });
        }
        
        const result = await pool.query(`
            INSERT INTO mots (mot, definition, domaine, niveau)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [mot, definition, domaine, niveau || "Débutant"]);
        
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (erreur) {
        if (erreur.code === "23505") {
            return res.status(409).json({ 
                success: false, 
                error: "Ce mot existe déjà" 
            });
        }
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// DELETE /api/mots/:id
router.delete("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await pool.query("DELETE FROM mots WHERE id = $1", [id]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: "Mot introuvable" 
            });
        }
        
        res.json({ success: true, message: "Mot supprimé" });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

module.exports = router;