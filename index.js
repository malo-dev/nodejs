const express = require('express');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors()); // plus simple que headers manuels

app.get('/api/properties', async (req, res) => {
  try {
    const xmlUrl = 'https://spain.metainmo.com/storage/feeds/kyero/13cadf90-267a-4ef6-9bc3-548164c3db4f.xml';

    const response = await axios.get(xmlUrl, { responseType: 'text' });

    const xmlData = response.data;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    const jsonData = parser.parse(xmlData);

    const allProperties = jsonData.root?.property || [];

    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 6;

    const startIndex = (page - 1) * limit;
    const paginatedProperties = allProperties.slice(startIndex, startIndex + limit);

    res.json({
      total: allProperties.length,
      page,
      limit,
      properties: paginatedProperties,
    });
  } catch (error) {
    console.error('❌ Erreur XML:', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les propriétés.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur Express lancé sur http://localhost:${PORT}`);
});
