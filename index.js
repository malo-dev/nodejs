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
// 🔹 CACHE — Tesoro MLS (XML → JSON normalisé)
// ─────────────────────────────────────────────
let cachedTesoroProperties = [];
let tesoroLastUpdated = null;
let isFetchingTesoro = false;

const TESORO_URL = 'https://api.tesoro.estate/mls/mls/export/68d3b7ba15f66b3f94019ec2';

/**
 * Normalise une propriété XML Kyero en objet JSON uniforme,
 * identique à ce que renverrait une API JSON native.
 */
function normalizeTesoroProperty(p) {
  // Images : fast-xml-parser renvoie un objet ou un tableau selon le nombre d'images
  const rawImages = p.images?.image || [];
  const imagesArray = Array.isArray(rawImages) ? rawImages : [rawImages];
  const images = imagesArray.map(img => ({
    id: img['@_id'] || null,
    url: img.url || null,
  }));

  // Features : idem
  const rawFeatures = p.features?.feature || [];
  const features = Array.isArray(rawFeatures) ? rawFeatures : [rawFeatures];

  // URLs multilingues
  const urls = p.url || {};

  // Description multilingue
  const desc = p.desc || {};

  return {
    id: String(p.id ?? ''),
    ref: p.ref || null,
    date: p.date || null,

    // Prix
    price: parseFloat(p.price) || 0,
    currency: p.currency || 'EUR',
    price_freq: p.price_freq || 'sale',

    // Localisation
    country: p.country || null,
    province: p.province || null,
    town: p.town || null,
    location_detail: p.location_detail || null,

    // Type & caractéristiques
    type: p.type || null,
    new_build: p.new_build === 1 || p.new_build === '1' || p.new_build === true || false,
    part_ownership: p.part_ownership === 1 || p.part_ownership === '1' || false,
    leasehold: p.leasehold === 1 || p.leasehold === '1' || false,

    // Pièces
    beds: parseInt(p.beds ?? p.bedrooms ?? 0),
    baths: parseInt(p.baths ?? p.bathrooms ?? 0),
    pool: p.pool === 1 || p.pool === '1' || p.pool === 'yes' || false,

    // Surface
    surface_area: {
      built: parseFloat(p.surface_area?.built) || null,
      plot: parseFloat(p.surface_area?.plot) || null,
    },

    // Énergie
    energy_rating: {
      consumption: p.energy_rating?.consumption || null,
      emissions: p.energy_rating?.emissions || null,
    },

    // Contenu
    description: desc,
    features,
    images,
    urls,

    // Divers
    email: p.email || null,
    prime: p.prime === 1 || p.prime === '1' || false,
  };
}

async function fetchAndCacheTesoroProperties() {
  if (isFetchingTesoro) return;
  isFetchingTesoro = true;
  try {
    console.log('🔄 [Tesoro] Récupération des données XML en cours...');
    const response = await axios.get(TESORO_URL, {
      responseType: 'text',
      timeout: 15000,
    });

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const jsonData = parser.parse(response.data);

    // Support tableau ou objet unique
    const raw = jsonData.root?.property || [];
    const rawArray = Array.isArray(raw) ? raw : [raw];

    cachedTesoroProperties = rawArray.map(normalizeTesoroProperty);
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
 * Filtre Tesoro - utilise les champs normalises par normalizeTesoroProperty().
 */
function filterTesoroProperties(properties, query) {
  let results = [...properties];
  const { country, province, town, pool, bedrooms, priceMin, priceMax, type, search } = query;

  const s = (val) => (val ?? '').toString().toLowerCase().trim();

  if (country)  results = results.filter(p => s(p.country) === country.toLowerCase());
  if (province) results = results.filter(p => s(p.province) === province.toLowerCase());
  if (town)     results = results.filter(p => s(p.town) === town.toLowerCase());
  if (type)     results = results.filter(p => s(p.type) === type.toLowerCase());

  if (pool !== undefined && pool !== '') {
    const hasPool = pool.toLowerCase() === 'true';
    results = results.filter(p => hasPool ? p.pool === true : p.pool === false);
  }

  if (bedrooms) {
    const min = parseInt(bedrooms.toString().trim());
    results = results.filter(p => p.beds >= min);
  }

  if (priceMin) {
    const min = parseFloat(priceMin.toString().trim());
    results = results.filter(p => p.price >= min);
  }

  if (priceMax) {
    const max = parseFloat(priceMax.toString().trim());
    results = results.filter(p => p.price <= max);
  }

  if (search) {
    const q = search.toLowerCase();
    results = results.filter(p =>
      s(p.town).includes(q) ||
      s(p.country).includes(q) ||
      s(p.province).includes(q) ||
      s(p.type).includes(q)
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

  cachedTesoroProperties.forEach(p => {
    if (p.country)  countries.add(p.country);
    if (p.province) provinces.add(p.province);
    if (p.town)     towns.add(p.town);
    if (p.beds)     bedrooms.add(String(p.beds));
    if (p.type)     types.add(p.type);
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
