const express = require('express');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); 
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});


app.get('/api/properties', async (req, res) => {
  try {
    const xmlUrl = 'https://spain.metainmo.com/storage/feeds/kyero/13cadf90-267a-4ef6-9bc3-548164c3db4f.xml';

    const response = await axios.get(xmlUrl, {
      responseType: 'text', // <-- très important ici
    });

    const xmlData = response.data;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    const jsonData = parser.parse(xmlData);

    // console.log(jsonData); // ← active-le pour test si nécessaire

    const properties = jsonData.root?.property || [];

    res.json({ total: properties.length, properties });
  } catch (error) {
    console.error('❌ Erreur XML:', error.message);
    res.status(500).json({ error: 'Impossible de récupérer les propriétés.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur Express lancé sur http://localhost:${PORT}`);
});
