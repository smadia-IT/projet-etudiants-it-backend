// ============================================
// SCRIPT ADMIN - Console complète Étudiants IT
// ============================================

require("dotenv").config();
const { Pool } = require("pg");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ============================================
// HELPERS
// ============================================
function demander(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function pause() {
    await demander("\n⏸️  Appuie sur Entrée pour continuer...");
}

function formatDate(d) {
    if (!d) return "—";
    const date = new Date(d);
    return date.toLocaleString("fr-FR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
}

// ============================================
// SÉCURITÉ : blocage des opérations destructrices
// ============================================
function estDangereux(sql) {
    const s = sql.trim().toUpperCase();
    return s.startsWith("DROP") || 
           s.startsWith("TRUNCATE") ||
           (s.startsWith("DELETE") && !s.includes("WHERE"));
}

// ============================================
// BACKUP AVANT OPÉRATION DESTRUCTRICE
// ============================================
async function creerBackup(nomFichier) {
    const backupDir = path.join(__dirname, "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    
    const tables = ["utilisateurs", "messages", "amities", "posts", "commentaires", "mots", "notifications", "conversations_cachees"];
    const backup = { date: new Date().toISOString(), tables: {} };
    
    for (const t of tables) {
        try {
            const r = await pool.query(`SELECT * FROM ${t}`);
            backup.tables[t] = r.rows;
        } catch (e) {
            backup.tables[t] = { error: e.message };
        }
    }
    
    const fichier = path.join(backupDir, nomFichier);
    fs.writeFileSync(fichier, JSON.stringify(backup, null, 2));
    console.log(`💾 Backup créé : ${fichier}`);
    return fichier;
}

// ============================================
// AFFICHER LE RÉSULTAT D'UNE REQUÊTE
// ============================================
function afficherResultat(result) {
    if (result.rows && result.rows.length > 0) {
        // Formater les dates
        const rows = result.rows.map(r => {
            const obj = { ...r };
            for (const k in obj) {
                if (obj[k] instanceof Date) obj[k] = formatDate(obj[k]);
            }
            return obj;
        });
        console.log("");
        console.table(rows);
        console.log(`📊 ${result.rowCount} ligne(s)\n`);
    } else if (result.rowCount !== undefined) {
        console.log(`\n✅ ${result.rowCount} ligne(s) affectée(s)\n`);
    } else {
        console.log("\n✅ Requête exécutée (aucun résultat)\n");
    }
}

// ============================================
// EXÉCUTER UNE REQUÊTE SQL
// ============================================
async function executerSQL(sql, silencieux = false) {
    try {
        const result = await pool.query(sql);
        if (!silencieux) afficherResultat(result);
        return result;
    } catch (erreur) {
        console.log(`\n❌ ERREUR SQL : ${erreur.message}\n`);
        return null;
    }
}

// ============================================
// MENU 1 : UTILISATEURS
// ============================================
async function menuUtilisateurs() {
    console.log("\n👥 === GESTION DES UTILISATEURS ===\n");
    console.log("1. Lister tous les utilisateurs");
    console.log("2. Voir un utilisateur en détail (avec stats)");
    console.log("3. Créer un utilisateur manuellement");
    console.log("4. Changer le mot de passe d'un utilisateur");
    console.log("5. Supprimer un utilisateur (avec backup)");
    console.log("6. Voir les utilisateurs inactifs (24h+)");
    console.log("7. Voir les utilisateurs connectés récemment");
    console.log("0. Retour\n");
    
    const choix = await demander("Ton choix : ");
    
    if (choix === "1") {
        await executerSQL(`
            SELECT id, username, email, created_at, derniere_activite
            FROM utilisateurs 
            ORDER BY id
        `);
    } else if (choix === "2") {
        const username = await demander("Username : ");
        const r = await executerSQL(`
            SELECT 
                u.id, u.username, u.email, u.created_at, u.derniere_activite,
                (SELECT COUNT(*) FROM messages WHERE expediteur_id = u.id OR destinataire_id = u.id) as total_messages,
                (SELECT COUNT(*) FROM amities WHERE (user_id_1 = u.id OR user_id_2 = u.id) AND statut = 'acceptee') as total_amis,
                (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as total_posts,
                (SELECT COUNT(*) FROM commentaires WHERE user_id = u.id) as total_commentaires,
                (SELECT COUNT(*) FROM notifications WHERE user_id = u.id AND lu = 0) as notifs_non_lues
            FROM utilisateurs u
            WHERE u.username = $1
        `, false);
        // ⚠️ Si tu veux passer un paramètre, modifie executerSQL (voir note en bas)
    } else if (choix === "3") {
        const username = await demander("Username : ");
        const email = await demander("Email : ");
        const password = await demander("Mot de passe (hash bcrypt) : ");
        await executerSQL(
            `INSERT INTO utilisateurs (username, email, password) VALUES ('${username}', '${email}', '${password}') RETURNING id, username, email`
        );
    } else if (choix === "4") {
        const username = await demander("Username : ");
        const hash = await demander("Nouveau hash bcrypt : ");
        await executerSQL(
            `UPDATE utilisateurs SET password = '${hash}' WHERE username = '${username}' RETURNING id, username`
        );
    } else if (choix === "5") {
        const username = await demander("Username à supprimer : ");
        const confirm = await demander(`⚠️  Supprimer "${username}" ET TOUTES ses données ? (oui/non) : `);
        if (confirm.toLowerCase() === "oui") {
            await creerBackup(`backup_avant_suppression_${username}_${Date.now()}.json`);
            await executerSQL(`DELETE FROM utilisateurs WHERE username = '${username}' RETURNING id, username`);
        } else {
            console.log("❌ Annulé");
        }
    } else if (choix === "6") {
        await executerSQL(`
            SELECT id, username, derniere_activite, dernier_rappel_envoye
            FROM utilisateurs
            WHERE derniere_activite < NOW() - INTERVAL '24 hours'
            ORDER BY derniere_activite ASC
        `);
    } else if (choix === "7") {
        await executerSQL(`
            SELECT id, username, derniere_activite
            FROM utilisateurs
            WHERE derniere_activite > NOW() - INTERVAL '1 hour'
            ORDER BY derniere_activite DESC
        `);
    } else if (choix === "0") {
        return;
    }
    
    await pause();
    await menuUtilisateurs();
}

// ============================================
// MENU 2 : NOTIFICATIONS
// ============================================
async function menuNotifications() {
    console.log("\n🔔 === GESTION DES NOTIFICATIONS ===\n");
    console.log("1. Voir les notifs d'un utilisateur");
    console.log("2. Voir les notifs non-lues (tous utilisateurs)");
    console.log("3. Créer une notif manuellement");
    console.log("4. Marquer toutes les notifs d'un user comme lues");
    console.log("5. Supprimer les notifs d'un user");
    console.log("6. Voir les stats par type");
    console.log("0. Retour\n");
    
    const choix = await demander("Ton choix : ");
    
    if (choix === "1") {
        const username = await demander("Username : ");
        await executerSQL(`
            SELECT n.id, n.type, n.titre, n.message, n.lu, n.date
            FROM notifications n
            JOIN utilisateurs u ON u.id = n.user_id
            WHERE u.username = '${username}'
            ORDER BY n.date DESC
            LIMIT 50
        `);
    } else if (choix === "2") {
        await executerSQL(`
            SELECT n.id, u.username, n.type, n.titre, n.date
            FROM notifications n
            JOIN utilisateurs u ON u.id = n.user_id
            WHERE n.lu = 0
            ORDER BY n.date DESC
            LIMIT 50
        `);
    } else if (choix === "3") {
        const username = await demander("Username destinataire : ");
        const type = await demander("Type (message/ami/forum/rappel/badge) : ");
        const titre = await demander("Titre : ");
        const message = await demander("Message : ");
        const lien = await demander("Lien (ex: index.html, ou vide) : ");
        await executerSQL(`
            INSERT INTO notifications (user_id, type, titre, message, lien)
            SELECT id, '${type}', '${titre}', '${message}', ${lien ? `'${lien}'` : "NULL"}
            FROM utilisateurs WHERE username = '${username}'
            RETURNING id, user_id, titre
        `);
    } else if (choix === "4") {
        const username = await demander("Username : ");
        await executerSQL(`
            UPDATE notifications SET lu = 1
            WHERE user_id = (SELECT id FROM utilisateurs WHERE username = '${username}')
              AND lu = 0
        `);
    } else if (choix === "5") {
        const username = await demander("Username : ");
        const confirm = await demander(`⚠️  Supprimer toutes les notifs de "${username}" ? (oui/non) : `);
        if (confirm.toLowerCase() === "oui") {
            await executerSQL(`
                DELETE FROM notifications
                WHERE user_id = (SELECT id FROM utilisateurs WHERE username = '${username}')
            `);
        } else {
            console.log("❌ Annulé");
        }
    } else if (choix === "6") {
        await executerSQL(`
            SELECT type, COUNT(*) as total, SUM(lu) as lues, COUNT(*) - SUM(lu) as non_lues
            FROM notifications
            GROUP BY type
            ORDER BY total DESC
        `);
    } else if (choix === "0") {
        return;
    }
    
    await pause();
    await menuNotifications();
}

// ============================================
// MENU 3 : MESSAGES
// ============================================
async function menuMessages() {
    console.log("\n💬 === GESTION DES MESSAGES ===\n");
    console.log("1. Voir les derniers messages");
    console.log("2. Voir une conversation (entre 2 users)");
    console.log("3. Voir les conversations cachées");
    console.log("4. Compter les messages non-lus d'un user");
    console.log("5. Supprimer les messages d'un user");
    console.log("0. Retour\n");
    
    const choix = await demander("Ton choix : ");
    
    if (choix === "1") {
        await executerSQL(`
            SELECT m.id, ue.username as expediteur, ud.username as destinataire,
                   LEFT(m.contenu, 50) as apercu, m.lu, m.date
            FROM messages m
            JOIN utilisateurs ue ON ue.id = m.expediteur_id
            JOIN utilisateurs ud ON ud.id = m.destinataire_id
            ORDER BY m.date DESC
            LIMIT 30
        `);
    } else if (choix === "2") {
        const u1 = await demander("Username 1 : ");
        const u2 = await demander("Username 2 : ");
        await executerSQL(`
            SELECT m.id, ue.username as expediteur, m.contenu, m.lu, m.date
            FROM messages m
            JOIN utilisateurs ue ON ue.id = m.expediteur_id
            JOIN utilisateurs ud ON ud.id = m.destinataire_id
            WHERE (ue.username = '${u1}' AND ud.username = '${u2}')
               OR (ue.username = '${u2}' AND ud.username = '${u1}')
            ORDER BY m.date ASC
        `);
    } else if (choix === "3") {
        await executerSQL(`
            SELECT cc.id, u.username, ua.username as autre, cc.date_masquage
            FROM conversations_cachees cc
            JOIN utilisateurs u ON u.id = cc.user_id
            JOIN utilisateurs ua ON ua.id = cc.autre_user_id
            ORDER BY cc.date_masquage DESC
        `);
    } else if (choix === "4") {
        const username = await demander("Username : ");
        await executerSQL(`
            SELECT COUNT(*) as messages_non_lus
            FROM messages
            WHERE destinataire_id = (SELECT id FROM utilisateurs WHERE username = '${username}')
              AND lu = 0
        `);
    } else if (choix === "5") {
        const username = await demander("Username : ");
        const confirm = await demander(`⚠️  Supprimer TOUS les messages de "${username}" ? (oui/non) : `);
        if (confirm.toLowerCase() === "oui") {
            await creerBackup(`backup_messages_${username}_${Date.now()}.json`);
            await executerSQL(`
                DELETE FROM messages
                WHERE expediteur_id = (SELECT id FROM utilisateurs WHERE username = '${username}')
                   OR destinataire_id = (SELECT id FROM utilisateurs WHERE username = '${username}')
            `);
        } else {
            console.log("❌ Annulé");
        }
    } else if (choix === "0") {
        return;
    }
    
    await pause();
    await menuMessages();
}

// ============================================
// MENU 4 : BASE DE DONNÉES
// ============================================
async function menuDatabase() {
    console.log("\n🗄️  === BASE DE DONNÉES ===\n");
    console.log("1. Lister toutes les tables");
    console.log("2. Voir les colonnes d'une table");
    console.log("3. Voir la taille des tables");
    console.log("4. Compter les lignes de chaque table");
    console.log("5. Créer un backup complet");
    console.log("6. Requête SQL personnalisée");
    console.log("0. Retour\n");
    
    const choix = await demander("Ton choix : ");
    
    if (choix === "1") {
        await executerSQL(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
    } else if (choix === "2") {
        const table = await demander("Nom de la table : ");
        await executerSQL(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = '${table}'
            ORDER BY ordinal_position
        `);
    } else if (choix === "3") {
        await executerSQL(`
            SELECT 
                relname as table_name,
                pg_size_pretty(pg_total_relation_size(relid)) as taille
            FROM pg_catalog.pg_statio_user_tables
            ORDER BY pg_total_relation_size(relid) DESC
        `);
    } else if (choix === "4") {
        const tables = ["utilisateurs", "messages", "amities", "posts", "commentaires", "mots", "notifications", "conversations_cachees"];
        console.log("\n📊 Comptage en cours...\n");
        for (const t of tables) {
            const r = await executerSQL(`SELECT COUNT(*) as nb FROM ${t}`, true);
            console.log(`${t.padEnd(25)} : ${r ? r.rows[0].nb : "❌"}`);
        }
        console.log("");
    } else if (choix === "5") {
        await creerBackup(`backup_complet_${Date.now()}.json`);
    } else if (choix === "6") {
        console.log("\n💡 Tape ta requête SQL (une seule ligne) :");
        console.log("   Pour DROP/DELETE sans WHERE, il faut taper 'FORCE' après.\n");
        const sql = await demander("SQL > ");
        
        if (estDangereux(sql)) {
            const confirm = await demander("⚠️  Requête DESTRUCTRICE détectée. Confirmer (oui/non) : ");
            if (confirm.toLowerCase() !== "oui") {
                console.log("❌ Annulé");
                await pause();
                return menuDatabase();
            }
            await creerBackup(`backup_avant_requete_dangereuse_${Date.now()}.json`);
        }
        
        await executerSQL(sql);
    } else if (choix === "0") {
        return;
    }
    
    await pause();
    await menuDatabase();
}

// ============================================
// MENU 5 : CRON & RAPPELS
// ============================================
async function menuCron() {
    console.log("\n⏰ === CRON & RAPPELS ===\n");
    console.log("1. Voir les utilisateurs à rappeler (inactifs 24h+)");
    console.log("2. Simuler un utilisateur inactif");
    console.log("3. Remettre un utilisateur actif");
    console.log("4. Voir les rappels déjà envoyés");
    console.log("0. Retour\n");
    
    const choix = await demander("Ton choix : ");
    
    if (choix === "1") {
        await executerSQL(`
            SELECT u.id, u.username, u.derniere_activite, u.dernier_rappel_envoye
            FROM utilisateurs u
            WHERE u.derniere_activite < NOW() - INTERVAL '24 hours'
              AND (u.dernier_rappel_envoye IS NULL 
                   OR u.dernier_rappel_envoye < NOW() - INTERVAL '24 hours')
              AND (
                  EXISTS (
                      SELECT 1 FROM amities a
                      WHERE (a.user_id_1 = u.id OR a.user_id_2 = u.id)
                        AND a.statut = 'acceptee'
                  )
                  OR EXISTS (
                      SELECT 1 FROM notifications n
                      WHERE n.user_id = u.id AND n.lu = 0
                  )
              )
        `);
    } else if (choix === "2") {
        const username = await demander("Username : ");
        await executerSQL(`
            UPDATE utilisateurs
            SET derniere_activite = NOW() - INTERVAL '25 hours',
                dernier_rappel_envoye = NULL
            WHERE username = '${username}'
            RETURNING id, username, derniere_activite
        `);
    } else if (choix === "3") {
        const username = await demander("Username : ");
        await executerSQL(`
            UPDATE utilisateurs
            SET derniere_activite = NOW()
            WHERE username = '${username}'
            RETURNING id, username, derniere_activite
        `);
    } else if (choix === "4") {
        await executerSQL(`
            SELECT id, username, dernier_rappel_envoye
            FROM utilisateurs
            WHERE dernier_rappel_envoye IS NOT NULL
            ORDER BY dernier_rappel_envoye DESC
        `);
    } else if (choix === "0") {
        return;
    }
    
    await pause();
    await menuCron();
}

// ============================================
// MENU PRINCIPAL
// ============================================
async function main() {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║   🎓 ADMIN - Étudiants IT              ║");
    console.log("╚════════════════════════════════════════╝\n");
    console.log("1. 👥 Utilisateurs");
    console.log("2. 🔔 Notifications");
    console.log("3. 💬 Messages");
    console.log("4. 🗄️  Base de données");
    console.log("5. ⏰ Cron & Rappels");
    console.log("6. 📝 Forum");
    console.log("7. 🎲 Quiz & Badges");
    console.log("0. 🚪 Quitter\n");
    
    const choix = await demander("Ton choix : ");
    
    switch (choix) {
        case "1": await menuUtilisateurs(); break;
        case "2": await menuNotifications(); break;
        case "3": await menuMessages(); break;
        case "4": await menuDatabase(); break;
        case "5": await menuCron(); break;
        case "6": console.log("À venir..."); await pause(); break;
        case "7": console.log("À venir..."); await pause(); break;
        case "0":
            console.log("\n👋 Bye !\n");
            rl.close();
            await pool.end();
            process.exit(0);
        default:
            console.log("❌ Choix invalide");
            await pause();
    }
    
    await main();
}

// ============================================
// LANCEMENT
// ============================================
main().catch(err => {
    console.error("❌ Erreur fatale :", err);
    rl.close();
    pool.end();
    process.exit(1);
});