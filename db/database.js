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
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
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

        // Index pour accélérer les recherches de messages entre 2 utilisateurs
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_conversation 
            ON messages (expediteur_id, destinataire_id, date DESC)
        `);

        // Index pour accélérer le comptage des messages non lus
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_non_lus 
            ON messages (destinataire_id, lu)
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
        // Table des conversations cachées (suppression côté utilisateur)
await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations_cachees (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
        autre_user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
        date_masquage TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, autre_user_id)
    )
`);
await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_conversations_cachees 
    ON conversations_cachees (user_id, autre_user_id)
`);

        // Table des notifications
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                titre TEXT NOT NULL,
                message TEXT,
                lien TEXT,
                lu INTEGER DEFAULT 0,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Index pour accélérer la récupération des notifs d'un user
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_notifications_user 
            ON notifications (user_id, date DESC)
        `);

        // Index pour compter rapidement les non-lues
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_notifications_non_lues 
            ON notifications (user_id, lu)
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