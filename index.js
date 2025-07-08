const express = require('express');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());

let cachedProperties = [];
let lastUpdated = null;

// Fonction pour charger les données XML et les parser
async function fetchAndCacheProperties() {
  try {
    console.log('🔄 Récupération des données XML en cours...');
    const xmlUrl = 'https://spain.metainmo.com/storage/feeds/kyero/13cadf90-267a-4ef6-9bc3-548164c3db4f.xml';
    const response = await axios.get(xmlUrl, { responseType: 'text' });

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const jsonData = parser.parse(response.data);
    cachedProperties = jsonData.root?.property || [];
    lastUpdated = new Date();

    console.log(`✅ Données mises en cache (${cachedProperties.length} propriétés) à ${lastUpdated.toLocaleString()}`);
  } catch (error) {
    console.error('❌ Erreur de chargement du XML :', error.message);
  }
}

// Requête API avec pagination
app.get('/api/properties', async (req, res) => {
  try {
    if (cachedProperties.length === 0) {
      await fetchAndCacheProperties();
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 6;
    const startIndex = (page - 1) * limit;
    const paginated = cachedProperties.slice(startIndex, startIndex + limit);

    res.json({
      total: cachedProperties.length,
      page,
      limit,
      properties: paginated,
      lastUpdated,
    });
  } catch (error) {
    console.error('❌ Erreur API:', error.message);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// Mise à jour automatique toutes les 6 heures
setInterval(fetchAndCacheProperties, 48 * 60 * 60 * 1000);

// Charger les données une première fois au démarrage
fetchAndCacheProperties();

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});
