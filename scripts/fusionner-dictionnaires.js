// ============================================
// SCRIPT : Fusionner les dictionnaires
// ============================================
// Usage :
// 1. Place ce fichier dans projet_1-backend/scripts/
// 2. Place tes 2 fichiers dans projet_1/data/ :
//    - dictionnaire.json (les 424 mots)
//    - dictionnaire-nouveaux.json (les 208 nouveaux)
// 3. Lance : node scripts/fusionner-dictionnaires.js
// ============================================

const fs = require("fs");
const path = require("path");

const CHEMIN_ANCIEN = path.join(__dirname, "..", "..", "projet_1", "data", "dictionnaire.json");
const CHEMIN_NOUVEAU = path.join(__dirname, "..", "..", "projet_1", "data", "dictionnaire-nouveaux.json");
const CHEMIN_SORTIE = path.join(__dirname, "..", "..", "projet_1", "data", "dictionnaire-fusionne.json");

// Corrections de typos (à appliquer partout)
const CORRECTIONS_TYPOS = {
    "Système d me d'exploitation": "Système d'exploitation",
    "Comutation": "Commutation",
    "Eagering": "Élévation",
    "Protege ": "Protège ",
    "Recouvant": "Recouvrant"
};

function corrigerTypos(obj) {
    const json = JSON.stringify(obj);
    let corrige = json;
    
    for (const [avant, apres] of Object.entries(CORRECTIONS_TYPOS)) {
        corrige = corrige.split(avant).join(apres);
    }
    
    return JSON.parse(corrige);
}

function normaliserMot(mot) {
    return mot.toLowerCase().trim().replace(/\s+/g, " ");
}

function fusionner() {
    console.log("🔄 Chargement des fichiers...\n");
    
    const ancien = JSON.parse(fs.readFileSync(CHEMIN_ANCIEN, "utf-8"));
    const nouveau = JSON.parse(fs.readFileSync(CHEMIN_NOUVEAU, "utf-8"));
    
    console.log(`   📚 Ancien : ${ancien.length} mots`);
    console.log(`   📚 Nouveau : ${nouveau.length} mots\n`);
    
    // Dictionnaire par mot normalisé
    const parMot = new Map();
    const doublons = [];
    
    // 1. Ajouter les anciens
    ancien.forEach(m => {
        const cle = normaliserMot(m.mot);
        parMot.set(cle, { ...m, _source: "ancien" });
    });
    
    // 2. Ajouter les nouveaux (en écrasant si déjà présent → on garde le nouveau qui est plus récent)
    nouveau.forEach(m => {
        const cle = normaliserMot(m.mot);
        if (parMot.has(cle)) {
            doublons.push(m.mot);
            // On écrase avec la version la plus complète
            const existant = parMot.get(cle);
            const versionGagnante = (m.explication && m.exemple) ? m : existant;
            parMot.set(cle, { ...versionGagnante, _source: "nouveau" });
        } else {
            parMot.set(cle, { ...m, _source: "nouveau" });
        }
    });
    
    // 3. Convertir en tableau + corriger typos + enlever champ _source
    let fusionnes = Array.from(parMot.values()).map(m => {
        const { _source, ...propre } = m;
        return propre;
    });
    
    // 4. Corriger les typos globalement
    fusionnes = corrigerTypos(fusionnes);
    
    // 5. Trier par domaine puis par mot
    fusionnes.sort((a, b) => {
        if (a.domaine !== b.domaine) return a.domaine.localeCompare(b.domaine);
        return a.mot.localeCompare(b.mot);
    });
    
    // 6. Sauvegarder
    fs.writeFileSync(CHEMIN_SORTIE, JSON.stringify(fusionnes, null, 2), "utf-8");
    
    // 7. Bilan
    console.log("═══════════════════════════════════════");
    console.log(`✅ Fusion terminée`);
    console.log(`   ${fusionnes.length} mots uniques`);
    console.log(`   ${doublons.length} doublons supprimés :`);
    doublons.forEach(d => console.log(`      - ${d}`));
    console.log(`   Fichier : ${CHEMIN_SORTIE}`);
    console.log("═══════════════════════════════════════\n");
    
    // 8. Répartition par domaine
    const domaines = {};
    fusionnes.forEach(m => {
        domaines[m.domaine] = (domaines[m.domaine] || 0) + 1;
    });
    
    console.log("📊 Répartition par domaine :");
    Object.entries(domaines)
        .sort((a, b) => b[1] - a[1])
        .forEach(([domaine, nb]) => {
            console.log(`   ${domaine.padEnd(30)} : ${nb}`);
        });
}

fusionner();