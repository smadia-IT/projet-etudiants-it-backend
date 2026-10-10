// ============================================
// ROUTES D'AUTHENTIFICATION (PostgreSQL)
// ============================================

const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/database");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRATION = "7d";

// ============================================
// VALIDATION DU NUMÉRO DE TÉLÉPHONE
// ============================================
function validerTelephone(tel) {
    // Format accepté : +XXX-XXXXXXXXX (indicatif - numéro)
    // Exemple : +243-823456789
    const regex = /^\+\d{1,4}-\d{6,15}$/;
    return regex.test(tel);
}

// ============================================
// POST /api/auth/register — Inscription
// ============================================
router.post("/register", async (req, res) => {
    try {
        const { username, email, password, prenom, nom, telephone } = req.body;

        // Validation des champs obligatoires
        if (!username || !email || !password || !prenom || !nom || !telephone) {
            return res.status(400).json({
                success: false,
                error: "Tous les champs sont obligatoires : username, email, password, prenom, nom, telephone"
            });
        }

        if (username.length < 3) {
            return res.status(400).json({
                success: false,
                error: "Le nom d'utilisateur doit faire au moins 3 caractères"
            });
        }

        if (prenom.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: "Le prénom doit faire au moins 2 caractères"
            });
        }

        if (nom.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: "Le nom doit faire au moins 2 caractères"
            });
        }

        if (!validerTelephone(telephone)) {
            return res.status(400).json({
                success: false,
                error: "Numéro de téléphone invalide. Format attendu : +243-823456789"
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                error: "Le mot de passe doit faire au moins 8 caractères"
            });
        }

        if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(400).json({
                success: false,
                error: "Le mot de passe doit contenir au moins une majuscule et un chiffre"
            });
        }

        // Vérifier si l'utilisateur existe déjà
        const existantResult = await pool.query(
            "SELECT * FROM utilisateurs WHERE username = $1 OR email = $2 OR telephone = $3",
            [username, email, telephone]
        );

        if (existantResult.rowCount > 0) {
            const existant = existantResult.rows[0];
            let message = "Ce compte existe déjà";
            if (existant.username === username) message = "Ce nom d'utilisateur est déjà utilisé";
            else if (existant.email === email) message = "Cet email est déjà utilisé";
            else if (existant.telephone === telephone) message = "Ce numéro de téléphone est déjà utilisé";
            
            return res.status(409).json({
                success: false,
                error: message
            });
        }

        // Hacher le mot de passe
        const hash = await bcrypt.hash(password, 10);

        // Insérer dans la base
        const insertResult = await pool.query(`
            INSERT INTO utilisateurs (username, email, password, prenom, nom, telephone)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `, [username, email, hash, prenom.trim(), nom.trim(), telephone]);

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
                email,
                prenom: prenom.trim(),
                nom: nom.trim(),
                telephone
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

        // Chercher l'utilisateur (par username, email OU téléphone)
        const userResult = await pool.query(`
            SELECT * FROM utilisateurs 
            WHERE username = $1 OR email = $1 OR telephone = $1
        `, [username]);

        const user = userResult.rows[0];

        if (!user) {
            return res.status(401).json({
                success: false,
                error: "Identifiant ou mot de passe incorrect"
            });
        }

        const valide = await bcrypt.compare(password, user.password);
        if (!valide) {
            return res.status(401).json({
                success: false,
                error: "Identifiant ou mot de passe incorrect"
            });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRATION }
        );

        // ✅ Vérifier si le profil est complet
        const profilComplet = user.prenom && user.nom && user.telephone;

        res.json({
            success: true,
            message: "Connexion réussie",
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                prenom: user.prenom,
                nom: user.nom,
                telephone: user.telephone
            },
            profil_complet: !!profilComplet
        });
    } catch (erreur) {
        res.status(500).json({ success: false, error: erreur.message });
    }
});

// ============================================
// POST /api/auth/completer-profil — Compléter un profil incomplet
// ============================================
router.post("/completer-profil", authMiddleware, async (req, res) => {
    try {
        const { prenom, nom, telephone } = req.body;

        if (!prenom || !nom || !telephone) {
            return res.status(400).json({
                success: false,
                error: "Champs obligatoires : prenom, nom, telephone"
            });
        }

        if (prenom.trim().length < 2 || nom.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: "Prénom et nom doivent faire au moins 2 caractères"
            });
        }

        if (!validerTelephone(telephone)) {
            return res.status(400).json({
                success: false,
                error: "Numéro de téléphone invalide. Format attendu : +243-823456789"
            });
        }

        // Vérifier que le téléphone n'est pas déjà utilisé par un autre
        const existantResult = await pool.query(
            "SELECT id FROM utilisateurs WHERE telephone = $1 AND id != $2",
            [telephone, req.user.id]
        );

        if (existantResult.rowCount > 0) {
            return res.status(409).json({
                success: false,
                error: "Ce numéro de téléphone est déjà utilisé"
            });
        }

        // Mettre à jour
        const updateResult = await pool.query(`
            UPDATE utilisateurs 
            SET prenom = $1, nom = $2, telephone = $3
            WHERE id = $4
            RETURNING id, username, email, prenom, nom, telephone
        `, [prenom.trim(), nom.trim(), telephone, req.user.id]);

        res.json({
            success: true,
            message: "Profil complété",
            user: updateResult.rows[0]
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
            "SELECT id, username, email, prenom, nom, telephone, created_at FROM utilisateurs WHERE id = $1",
            [req.user.id]
        );

        const user = userResult.rows[0];

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: "Utilisateur introuvable" 
            });
        }

        const profilComplet = user.prenom && user.nom && user.telephone;

        res.json({ 
            success: true, 
            data: user,
            profil_complet: !!profilComplet
        });
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

        const { pool } = require("../db/database");
        pool.query(
            "UPDATE utilisateurs SET derniere_activite = CURRENT_TIMESTAMP WHERE id = $1",
            [decoded.id]
        ).catch(err => console.error("Erreur update activité:", err.message));
        
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