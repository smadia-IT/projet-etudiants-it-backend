// ============================================
// ROUTES D'AUTHENTIFICATION (PostgreSQL)
// ============================================

const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/database");

// Configuration JWT
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRATION = "7d";

// ============================================
// POST /api/auth/register — Inscription
// ============================================
router.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Validation
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                error: "Champs obligatoires : username, email, password"
            });
        }

        if (username.length < 3) {
            return res.status(400).json({
                success: false,
                error: "Le nom d'utilisateur doit faire au moins 3 caractères"
            });
        }

        if (password.length < 8) {
    return res.status(400).json({
        success: false,
        error: "Le mot de passe doit faire au moins 8 caractères"
    });
}

// Vérifier qu'il y a au moins une majuscule et un chiffre
if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({
        success: false,
        error: "Le mot de passe doit contenir au moins une majuscule et un chiffre"
    });
}

        // Vérifier si l'utilisateur existe déjà
        const existantResult = await pool.query(
            "SELECT * FROM utilisateurs WHERE username = $1 OR email = $2",
            [username, email]
        );

        if (existantResult.rowCount > 0) {
            return res.status(409).json({
                success: false,
                error: "Ce nom d'utilisateur ou cet email est déjà utilisé"
            });
        }

        // Hacher le mot de passe
        const hash = await bcrypt.hash(password, 10);

        // Insérer dans la base
        const insertResult = await pool.query(`
            INSERT INTO utilisateurs (username, email, password)
            VALUES ($1, $2, $3)
            RETURNING id
        `, [username, email, hash]);

        const userId = insertResult.rows[0].id;

        // Créer le JWT
        const token = jwt.sign(
            { id: userId, username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRATION }
        );

        res.status(201).json({
            success: true,
            message: "Inscription réussie",
            token,
            user: {
                id: userId,
                username,
                email
            }
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/auth/login — Connexion
// ============================================
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: "Champs obligatoires : username, password"
            });
        }

        // Chercher l'utilisateur (par username OU email)
        const userResult = await pool.query(`
            SELECT * FROM utilisateurs 
            WHERE username = $1 OR email = $1
        `, [username]);

        const user = userResult.rows[0];

        if (!user) {
            return res.status(401).json({
                success: false,
                error: "Nom d'utilisateur ou mot de passe incorrect"
            });
        }

        // Vérifier le mot de passe
        const valide = await bcrypt.compare(password, user.password);
        if (!valide) {
            return res.status(401).json({
                success: false,
                error: "Nom d'utilisateur ou mot de passe incorrect"
            });
        }

        // Créer le JWT
        const token = jwt.sign(
            { id: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRATION }
        );

        res.json({
            success: true,
            message: "Connexion réussie",
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// GET /api/auth/me — Informations de l'utilisateur connecté
// ============================================
router.get("/me", authMiddleware, async (req, res) => {
    try {
        const userResult = await pool.query(
            "SELECT id, username, email, created_at FROM utilisateurs WHERE id = $1",
            [req.user.id]
        );

        const user = userResult.rows[0];

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: "Utilisateur introuvable" 
            });
        }

        res.json({ success: true, data: user });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            error: "Token manquant ou invalide"
        });
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (erreur) {
        return res.status(401).json({
            success: false,
            error: "Token invalide ou expiré"
        });
    }
}

module.exports = {
    router,
    authMiddleware
};