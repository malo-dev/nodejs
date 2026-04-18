const express = require('express');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());

// ─────────────────────────────────────────────
// 🔹 CACHE — MetaInmo (XML / Kyero)
// ─────────────────────────────────────────────
let cachedProperties = [];
let lastUpdated = null;
let isFetching = false;

async function fetchAndCacheProperties() {
  if (isFetching) return;
  isFetching = true;
  try {
    console.log('🔄 [MetaInmo] Récupération des données XML en cours...');
    const xmlUrl = 'https://spain.metainmo.com/storage/feeds/kyero/13cadf90-267a-4ef6-9bc3-548164c3db4f.xml';
    const response = await axios.get(xmlUrl, { responseType: 'text' });

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const jsonData = parser.parse(response.data);
    cachedProperties = jsonData.root?.property || [];
    lastUpdated = new Date();

    console.log(`✅ [MetaInmo] ${cachedProperties.length} propriétés en cache à ${lastUpdated.toLocaleString()}`);
  } catch (error) {
    console.error('❌ [MetaInmo] Erreur de chargement du XML :', error.message);
  } finally {
    isFetching = false;
  }
}

fetchAndCacheProperties();
setInterval(fetchAndCacheProperties, 48 * 60 * 60 * 1000);

// ─────────────────────────────────────────────
// 🔹 CACHE — Tesoro MLS (JSON)
// ─────────────────────────────────────────────
let cachedTesoroProperties = [];
let tesoroLastUpdated = null;
let isFetchingTesoro = false;

const TESORO_URL = 'https://api.tesoro.estate/mls/mls/export/68d3b7ba15f66b3f94019ec2';

async function fetchAndCacheTesoroProperties() {
  if (isFetchingTesoro) return;
  isFetchingTesoro = true;
  try {
    console.log('🔄 [Tesoro] Récupération des données MLS en cours...');
    const response = await axios.get(TESORO_URL, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    // L'API peut renvoyer un tableau directement ou un objet avec une clé
    const raw = response.data;
    if (Array.isArray(raw)) {
      cachedTesoroProperties = raw;
    } else if (raw.properties && Array.isArray(raw.properties)) {
      cachedTesoroProperties = raw.properties;
    } else if (raw.data && Array.isArray(raw.data)) {
      cachedTesoroProperties = raw.data;
    } else if (raw.items && Array.isArray(raw.items)) {
      cachedTesoroProperties = raw.items;
    } else {
      // Fallback : on prend la première valeur tableau trouvée
      const firstArray = Object.values(raw).find(v => Array.isArray(v));
      cachedTesoroProperties = firstArray || [];
    }

    tesoroLastUpdated = new Date();
    console.log(`✅ [Tesoro] ${cachedTesoroProperties.length} propriétés en cache à ${tesoroLastUpdated.toLocaleString()}`);
  } catch (error) {
    console.error('❌ [Tesoro] Erreur de chargement :', error.message);
  } finally {
    isFetchingTesoro = false;
  }
}

fetchAndCacheTesoroProperties();
setInterval(fetchAndCacheTesoroProperties, 48 * 60 * 60 * 1000);

// ─────────────────────────────────────────────
// 🔧 HELPERS
// ─────────────────────────────────────────────

/** Filtre générique pour MetaInmo */
function filterProperties(properties, query) {
  let results = [...properties];
  const { country, province, town, pool, bedrooms, priceMin, priceMax, search } = query;

  if (country) results = results.filter(p => p.country?.toLowerCase() === country.toLowerCase());
  if (province) results = results.filter(p => p.province?.toLowerCase() === province.toLowerCase());
  if (town) results = results.filter(p => p.town?.toLowerCase() === town.toLowerCase());

  if (pool) {
    const hasPool = pool.toLowerCase() === 'true';
    results = results.filter(p => {
      const poolVal = p.features?.includes('pool') || p.pool === 'yes';
      return hasPool ? poolVal : !poolVal;
    });
  }

  if (bedrooms) {
    const minBedrooms = parseInt(bedrooms.toString().trim());
    results = results.filter(p => parseInt(p.bedrooms || p.beds || 0) >= minBedrooms);
  }

  if (priceMin) {
    const min = parseFloat(priceMin.toString().trim());
    results = results.filter(p => parseFloat(p.price?.value || p.price || 0) >= min);
  }

  if (priceMax) {
    const max = parseFloat(priceMax.toString().trim());
    results = results.filter(p => parseFloat(p.price?.value || p.price || 0) <= max);
  }

  if (search) {
    const searchLower = search.toLowerCase();
    results = results.filter(p =>
      p.town?.toLowerCase().includes(searchLower) ||
      p.country?.toLowerCase().includes(searchLower)
    );
  }

  return results;
}

/**
 * Filtre générique pour Tesoro MLS.
 * Les noms de champs peuvent varier selon la réponse réelle de l'API ;
 * on couvre les cas courants avec des fallbacks.
 */
function filterTesoroProperties(properties, query) {
  let results = [...properties];
  const { country, province, town, pool, bedrooms, priceMin, priceMax, type, search } = query;

  const str = (val) => (val ?? '').toString().toLowerCase().trim();

  if (country) results = results.filter(p =>
    str(p.country) === country.toLowerCase() ||
    str(p.location?.country) === country.toLowerCase()
  );

  if (province) results = results.filter(p =>
    str(p.province) === province.toLowerCase() ||
    str(p.region) === province.toLowerCase() ||
    str(p.location?.province) === province.toLowerCase()
  );

  if (town) results = results.filter(p =>
    str(p.town) === town.toLowerCase() ||
    str(p.city) === town.toLowerCase() ||
    str(p.location?.city) === town.toLowerCase()
  );

  if (type) results = results.filter(p =>
    str(p.type) === type.toLowerCase() ||
    str(p.property_type) === type.toLowerCase()
  );

  if (pool !== undefined && pool !== '') {
    const hasPool = pool.toLowerCase() === 'true';
    results = results.filter(p => {
      const v = p.pool ?? p.features?.pool ?? p.amenities?.pool;
      const poolVal = v === true || v === 1 || str(v) === 'yes' || str(v) === 'true';
      return hasPool ? poolVal : !poolVal;
    });
  }

  if (bedrooms) {
    const min = parseInt(bedrooms.toString().trim());
    results = results.filter(p =>
      parseInt(p.bedrooms ?? p.beds ?? p.rooms?.bedrooms ?? 0) >= min
    );
  }

  if (priceMin) {
    const min = parseFloat(priceMin.toString().trim());
    results = results.filter(p =>
      parseFloat(p.price ?? p.price_value ?? p.pricing?.price ?? 0) >= min
    );
  }

  if (priceMax) {
    const max = parseFloat(priceMax.toString().trim());
    results = results.filter(p =>
      parseFloat(p.price ?? p.price_value ?? p.pricing?.price ?? 0) <= max
    );
  }

  if (search) {
    const s = search.toLowerCase();
    results = results.filter(p =>
      str(p.town).includes(s) ||
      str(p.city).includes(s) ||
      str(p.country).includes(s) ||
      str(p.title).includes(s) ||
      str(p.description).includes(s) ||
      str(p.location?.city).includes(s)
    );
  }

  return results;
}

// ─────────────────────────────────────────────
// 🔹 ROUTES — MetaInmo
// ─────────────────────────────────────────────

app.get('/api/properties', async (req, res) => {
  try {
    if (cachedProperties.length === 0) {
      fetchAndCacheProperties();
      return res.status(503).json({ error: 'Données en cours de chargement, réessayez dans quelques secondes.' });
    }

    let results = filterProperties(cachedProperties, req.query);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const total = results.length;
    const startIndex = (page - 1) * limit;
    const paginated = results.slice(startIndex, startIndex + limit);

    paginated.sort(() => Math.random() - 0.5);

    res.json({ total, page, limit, properties: paginated, lastUpdated });
  } catch (error) {
    console.error('❌ [MetaInmo] Erreur API:', error.message);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

app.get('/api/properties/filters', (req, res) => {
  if (cachedProperties.length === 0) {
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
    types: Array.from(types).sort(),
  });
});

app.get('/api/properties/:id', (req, res) => {
  const { id } = req.params;

  if (cachedProperties.length === 0) {
    fetchAndCacheProperties();
    return res.status(503).json({ error: 'Données en cours de chargement, réessayez dans quelques secondes.' });
  }

  const property = cachedProperties.find(p => p.id === id || String(p.id) === id);

  if (!property) {
    return res.status(404).json({ error: 'Propriété non trouvée.' });
  }

  res.json({ property });
});

// ─────────────────────────────────────────────
// 🔹 ROUTES — Tesoro MLS
// ─────────────────────────────────────────────

/**
 * GET /api/tesoro/properties
 * Query params (tous optionnels) :
 *   country, province, town, type, pool, bedrooms, priceMin, priceMax, search
 *   page (défaut 1), limit (défaut 20)
 */
app.get('/api/tesoro/properties', (req, res) => {
  try {
    if (cachedTesoroProperties.length === 0) {
      fetchAndCacheTesoroProperties();
      return res.status(503).json({ error: 'Données Tesoro en cours de chargement, réessayez dans quelques secondes.' });
    }

    let results = filterTesoroProperties(cachedTesoroProperties, req.query);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const total = results.length;
    const startIndex = (page - 1) * limit;
    const paginated = results.slice(startIndex, startIndex + limit);

    res.json({
      source: 'tesoro',
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      properties: paginated,
      lastUpdated: tesoroLastUpdated,
    });
  } catch (error) {
    console.error('❌ [Tesoro] Erreur API:', error.message);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

/**
 * GET /api/tesoro/properties/filters
 * Retourne les valeurs uniques disponibles pour les filtres
 */
app.get('/api/tesoro/properties/filters', (req, res) => {
  if (cachedTesoroProperties.length === 0) {
    return res.status(503).json({ error: 'Données Tesoro non encore chargées.' });
  }

  const countries = new Set();
  const provinces = new Set();
  const towns = new Set();
  const bedrooms = new Set();
  const types = new Set();

  cachedTesoroProperties.forEach(prop => {
    const c = prop.country || prop.location?.country;
    const prov = prop.province || prop.region || prop.location?.province;
    const t = prop.town || prop.city || prop.location?.city;
    const b = prop.bedrooms ?? prop.beds ?? prop.rooms?.bedrooms;
    const ty = prop.type || prop.property_type;

    if (c) countries.add(String(c).trim());
    if (prov) provinces.add(String(prov).trim());
    if (t) towns.add(String(t).trim());
    if (b !== undefined && b !== null) bedrooms.add(String(b).trim());
    if (ty) types.add(String(ty).trim());
  });

  res.json({
    source: 'tesoro',
    countries: Array.from(countries).sort(),
    provinces: Array.from(provinces).sort(),
    towns: Array.from(towns).sort(),
    bedrooms: Array.from(bedrooms).sort((a, b) => parseInt(a) - parseInt(b)),
    types: Array.from(types).sort(),
  });
});

/**
 * GET /api/tesoro/properties/:id
 * Récupère une propriété Tesoro par son ID
 */
app.get('/api/tesoro/properties/:id', (req, res) => {
  const { id } = req.params;

  if (cachedTesoroProperties.length === 0) {
    fetchAndCacheTesoroProperties();
    return res.status(503).json({ error: 'Données Tesoro en cours de chargement, réessayez dans quelques secondes.' });
  }

  const property = cachedTesoroProperties.find(p =>
    p.id === id || String(p.id) === id ||
    p._id === id || String(p._id) === id ||
    p.ref === id || p.reference === id
  );

  if (!property) {
    return res.status(404).json({ error: 'Propriété Tesoro non trouvée.' });
  }

  res.json({ source: 'tesoro', property });
});

/**
 * GET /api/tesoro/raw
 * Retourne la réponse brute de l'API Tesoro (utile pour debug / inspecter la structure)
 */
app.get('/api/tesoro/raw', async (req, res) => {
  try {
    const response = await axios.get(TESORO_URL, {
      headers: { 'Accept': 'application/json' },
      timeout: 15000,
    });
    res.json(response.data);
  } catch (error) {
    console.error('❌ [Tesoro] Erreur raw fetch:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// 🚀 Lancement
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
  console.log(`   MetaInmo  → GET /api/properties`);
  console.log(`   Tesoro    → GET /api/tesoro/properties`);
  console.log(`   Debug raw → GET /api/tesoro/raw`);
});
