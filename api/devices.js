const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const app = express();
const port = process.env.PORT || 3001;
const rootDir = path.join(__dirname, '..');
const localDevicesPath = path.join(rootDir, 'devices.json');
const mddUrl = 'https://mdis.mdd.gov.hk/aps/GetMdList.php';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.static(rootDir));

function fetchMddDeviceData() {
  return new Promise((resolve, reject) => {
    const request = https.get(mddUrl, { rejectUnauthorized: false, headers: { Accept: 'application/json' } }, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk) => {
        data += chunk;
      });
      apiRes.on('end', () => {
        try {
          const payload = JSON.parse(data);
          if (payload && Array.isArray(payload.records)) {
            resolve(payload);
            return;
          }
          reject(new Error('The MDD response did not contain a valid records array.'));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(15000, () => {
      request.destroy(new Error('Timed out while fetching the MDD device data.'));
    });

    request.on('error', (error) => {
      reject(error);
    });
  });
}

function readLocalDeviceData() {
  if (!fs.existsSync(localDevicesPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(localDevicesPath, 'utf8'));
  } catch (error) {
    console.error('Failed to read local device data:', error.message);
    return null;
  }
}

function fetchBinaryUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 3) {
      reject(new Error('Too many redirects while fetching PDF.'));
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      reject(new Error('Invalid URL.'));
      return;
    }

    const transport = parsedUrl.protocol === 'http:' ? require('http') : require('https');
    const request = transport.get(parsedUrl, { rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' } }, (apiRes) => {
      const { statusCode, headers } = apiRes;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        const nextUrl = new URL(headers.location, parsedUrl).toString();
        resolve(fetchBinaryUrl(nextUrl, redirectCount + 1));
        return;
      }

      if (statusCode !== 200) {
        reject(new Error(`Unexpected status code ${statusCode} when fetching PDF.`));
        return;
      }

      const chunks = [];
      apiRes.on('data', (chunk) => chunks.push(chunk));
      apiRes.on('end', () => resolve(Buffer.concat(chunks)));
    });

    request.on('error', reject);
    request.setTimeout(20000, () => request.destroy(new Error('Timed out while fetching PDF.')));
  });
}

async function extractTextFromPdfUrl(url) {
  const buffer = await fetchBinaryUrl(url);
  const data = await pdfParse(buffer);
  return String(data.text || '').trim();
}

app.get('/api/extract-pdf', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) {
    return res.status(400).json({ error: 'Missing url query parameter.' });
  }

  try {
    const text = await extractTextFromPdfUrl(url);
    return res.json({ text });
  } catch (error) {
    console.error('PDF extraction error:', error.message || error);
    return res.status(500).json({ error: 'Unable to extract text from the PDF.' });
  }
});

app.get('/api/devices', async (req, res) => {
  try {
    const payload = await fetchMddDeviceData();
    fs.writeFileSync(localDevicesPath, JSON.stringify(payload, null, 2));
    res.setHeader('Content-Type', 'application/json');
    return res.json(payload);
  } catch (error) {
    console.warn('Falling back to local device snapshot:', error.message);
    const fallbackPayload = readLocalDeviceData();
    if (fallbackPayload) {
      res.setHeader('Content-Type', 'application/json');
      return res.json(fallbackPayload);
    }

    res.status(500).json({ error: 'Unable to load the current MDD device data.' });
  }
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.sendStatus(404);
  }
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Device portal listening on http://localhost:${port}`);
  console.log(`Device API available at http://localhost:${port}/api/devices`);
});
