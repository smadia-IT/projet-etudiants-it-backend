// ============================================
// BASE DE DONNÉES POSTGRESQL
// ============================================

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// Configuration de la connexion
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,                              // Limite de connexions
    idleTimeoutMillis: 30000,             // Fermer les connexions inactives après 30s
    connectionTimeoutMillis: 10000        // Timeout de connexion : 10s
});

// ============================================
// INITIALISATION DES TABLES
// ============================================

async function initialiserTables() {
    try {
        // Table des mots
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mots (
                id SERIAL PRIMARY KEY,
                mot TEXT NOT NULL UNIQUE,
                definition TEXT NOT NULL,
                domaine TEXT NOT NULL,
                niveau TEXT DEFAULT 'Débutant',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Table des utilisateurs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS utilisateurs (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Table des amitiés
        await pool.query(`
            CREATE TABLE IF NOT EXISTS amities (
                id SERIAL PRIMARY KEY,
                user_id_1 INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
                user_id_2 INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
                statut TEXT NOT NULL DEFAULT 'en_attente',
                date_demande TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                date_reponse TIMESTAMP,
                UNIQUE(user_id_1, user_id_2)
            )
        `);

        // Table des messages
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                expediteur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
                destinataire_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
                contenu TEXT NOT NULL,
                lu INTEGER DEFAULT 0,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Table des posts (forum)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
                titre TEXT NOT NULL,
                contenu TEXT NOT NULL,
                domaine TEXT NOT NULL,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Table des commentaires
        await pool.query(`
            CREATE TABLE IF NOT EXISTS commentaires (
                id SERIAL PRIMARY KEY,
                post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
                contenu TEXT NOT NULL,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("✅ Tables initialisées (PostgreSQL)");
    } catch (erreur) {
        console.error("❌ Erreur initialisation tables:", erreur.message);
    }
}

// ============================================
// MIGRATION DES DONNÉES JSON → POSTGRESQL
// ============================================

async function migrerDonnees() {
    try {
        const jsonPath = path.join(__dirname, "..", "data", "dictionnaire.json");
        if (!fs.existsSync(jsonPath)) {
            console.log("⚠️ Fichier dictionnaire.json introuvable");
            return;
        }

        const mots = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        let nbAjoutes = 0;
        let nbIgnores = 0;

        for (const m of mots) {
            try {
                const result = await pool.query(`
                    INSERT INTO mots (mot, definition, domaine, niveau)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (mot) DO NOTHING
                    RETURNING id
                `, [m.mot, m.definition, m.domaine, m.niveau || "Débutant"]);
                
                if (result.rowCount > 0) {
                    nbAjoutes++;
                } else {
                    nbIgnores++;
                }
            } catch (erreur) {
                console.error(`Erreur mot "${m.mot}":`, erreur.message);
                nbIgnores++;
            }
        }

        console.log(`✅ Migration : ${nbAjoutes} mots ajoutés, ${nbIgnores} ignorés`);

        const total = await pool.query("SELECT COUNT(*) as nb FROM mots");
        console.log(`📚 Total en base : ${total.rows[0].nb} mots`);
    } catch (erreur) {
        console.error("❌ Erreur migration:", erreur.message);
    }
}

module.exports = {
    pool,
    initialiserTables,
    migrerDonnees
};