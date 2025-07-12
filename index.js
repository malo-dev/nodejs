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

// Requête API avec pagination et filtres
app.get('/api/properties', async (req, res) => {
  try {
    if (cachedProperties.length === 0) {
      await fetchAndCacheProperties();
    }

    let results = [...cachedProperties];

    // Filtres
    const {
      country,
      province,
      town,
      pool,
      bedrooms,
      priceMin,
      priceMax,
      page = 1,
      limit = 6
    } = req.query;

    if (country) {
      results = results.filter(p => p.country?.toLowerCase() === country.toLowerCase());
    }

    if (province) {
      results = results.filter(p => p.province?.toLowerCase() === province.toLowerCase());
    }

    if (town) {
      results = results.filter(p => p.town?.toLowerCase() === town.toLowerCase());
    }

    if (pool) {
      const hasPool = pool.toLowerCase() === 'true';
      results = results.filter(p => {
        const poolVal = p.features?.includes('pool') || p.pool === 'yes';
        return hasPool ? poolVal : !poolVal;
      });
    }

    if (bedrooms) {
      const minBedrooms = parseInt(bedrooms, 10);
      results = results.filter(p => parseInt(p.bedrooms, 10) >= minBedrooms);
    }

    if (priceMin) {
      const min = parseFloat(priceMin);
      results = results.filter(p => parseFloat(p.price?.value || 0) >= min);
    }

    if (priceMax) {
      const max = parseFloat(priceMax);
      results = results.filter(p => parseFloat(p.price?.value || 0) <= max);
    }


    if (req.query.search) {
  const searchLower = req.query.search.toLowerCase();
  results = results.filter(p =>
    p.town?.toLowerCase().includes(searchLower) ||
    p.country?.toLowerCase().includes(searchLower)
  );
}

    const total = results.length;
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const paginated = results.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      properties: paginated,
      lastUpdated,
    });

  } catch (error) {
    console.error('❌ Erreur API:', error.message);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// Mise à jour automatique toutes les 48 heures
setInterval(fetchAndCacheProperties, 48 * 60 * 60 * 1000);

// Charger les données une première fois au démarrage
fetchAndCacheProperties();

// Route pour les valeurs de filtres disponibles
app.get('/api/properties/filters', (req, res) => {
  if (!cachedProperties.length) {
    return res.status(503).json({ error: 'Données non encore chargées.' });
  }

  const countries = new Set();
  const provinces = new Set();
  const towns = new Set();
  const bedrooms = new Set();
  const types = new Set();

  cachedProperties.forEach(prop => {
    if (prop.country) countries.add(prop.country.trim());
    if (prop.province) provinces.add(prop.province.trim());
    if (prop.town) towns.add(prop.town.trim());
    if (prop.bedrooms) bedrooms.add(String(prop.bedrooms).trim());
    if (prop.type) types.add(prop.type.trim());
  });

  res.json({
    countries: Array.from(countries).sort(),
    provinces: Array.from(provinces).sort(),
    towns: Array.from(towns).sort(),
    bedrooms: Array.from(bedrooms).sort((a, b) => parseInt(a) - parseInt(b)),
    types: Array.from(types).sort()
  });
});


// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});
