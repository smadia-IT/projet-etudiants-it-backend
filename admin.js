// ============================================
// SCRIPT ADMIN - Gérer les utilisateurs
// ============================================

require("dotenv").config();
const { Pool } = require("pg");
const readline = require("readline");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ============================================
// AFFICHER TOUS LES UTILISATEURS
// ============================================
async function listerUtilisateurs() {
    const result = await pool.query(`
        SELECT id, username, email, created_at 
        FROM utilisateurs 
        ORDER BY id
    `);
    
    console.log("\n📋 LISTE DES UTILISATEURS\n");
    console.log("ID | Username | Email | Créé le");
    console.log("---|----------|-------|--------");
    result.rows.forEach(u => {
        console.log(`${u.id} | ${u.username} | ${u.email} | ${u.created_at.toISOString().split('T')[0]}`);
    });
    console.log(`\nTotal : ${result.rowCount} utilisateur(s)\n`);
}

// ============================================
// SUPPRIMER UN UTILISATEUR
// ============================================
async function supprimerUtilisateur(username) {
    const result = await pool.query(
        "DELETE FROM utilisateurs WHERE username = $1 RETURNING id, username",
        [username]
    );
    
    if (result.rowCount === 0) {
        console.log(`❌ Utilisateur "${username}" introuvable`);
    } else {
        console.log(`✅ Utilisateur "${username}" supprimé`);
    }
}

// ============================================
// MENU
// ============================================
async function main() {
    console.log("\n🎓 ADMIN - Gestion des utilisateurs\n");
    console.log("1. Lister tous les utilisateurs");
    console.log("2. Supprimer un utilisateur");
    console.log("3. Quitter\n");
    
    rl.question("Ton choix : ", async (choix) => {
        if (choix === "1") {
            await listerUtilisateurs();
            main();
        } else if (choix === "2") {
            rl.question("Username à supprimer : ", async (username) => {
                await supprimerUtilisateur(username);
                main();
            });
        } else if (choix === "3") {
            console.log("👋 Bye");
            rl.close();
            await pool.end();
        } else {
            console.log("❌ Choix invalide");
            main();
        }
    });
}

main().catch(console.error);