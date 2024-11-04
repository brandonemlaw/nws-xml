import { app, BrowserWindow } from 'electron';
import path, { dirname } from 'path';
import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import xml2js from 'xml2js';
import { google } from 'googleapis';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import Store from 'electron-store';  // Import electron-store

(async () => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const userDocumentsPath = app.getPath('documents');

    const server = express();
    const PORT = 3005;

    const store = new Store();  // Create a new store instance

    // Load persisted data or initialize default values
    let urlConfig = store.get('urlConfig', []);
    console.log("loaded ")
    console.log(urlConfig)
    let pollInterval = store.get('pollInterval', 60000);

    server.use(bodyParser.json());
    server.use(express.static(path.join(__dirname, 'react-ui', 'build')));

    server.get('/api/config', (req, res) => {
      res.json({ urlConfig, pollInterval });
    });

    server.post('/api/setRefresh', async (req, res) => {
      const { pollInterval: newPollInterval } = req.body;
      pollInterval = newPollInterval;

      try {
        store.set('pollInterval', pollInterval);

        res.json({ message: 'Polling interval updated', urlConfig });
        startPolling();
      } catch (error) {
        console.error('Error updating poll interval:', error);
        res.status(500).json({ message: 'Failed to update poll interval' });
      }
    });

    server.post('/api/refresh', (req, res) => {
      poll();
      res.status(200);
    });

    server.post('/api/setRefresh', async (req, res) => {
      const { pollInterval: newPollInterval } = req.body;
      pollInterval = newPollInterval;

      try {
        store.set('pollInterval', pollInterval);
        startPolling();
        res.status(200);
      } catch (error) {
        console.error('Error updating poll interval:', error);
        res.status(500).json({ message: 'Failed to update poll interval' });
      }
    });

    server.post('/api/config', async (req, res) => {
      const { url, name, key } = req.body;

      try {
        urlConfig = [...urlConfig, { url, name, key}];

        // Persist updated configuration
        store.set('urlConfig', urlConfig);

        res.json({ message: 'Configuration updated', urlConfig });
        startPolling();
      } catch (error) {
        console.error('Error updating config:', error);
        res.status(500).json({ message: 'Failed to update configuration' });
      }
    });

    server.delete('/api/config', (req, res) => {
      const { url } = req.body;
      urlConfig = urlConfig.filter(entry => entry.url !== url);

      // Persist updated configuration
      store.set('urlConfig', urlConfig);

      res.json({ message: 'URL deleted', urlConfig });
    });

    function extractSpreadsheetId(url) {
      const regex = /\/d\/([a-zA-Z0-9-_]+)/;
      const match = url.match(regex);
      if (match && match[1]) {
        return match[1];
      } else {
        throw new Error('Invalid Google Sheets URL');
      }
    }    

    async function fetchAndParseData(spreadsheetLink, key) {
      try {
        const sheets = google.sheets({ version: 'v4', auth: key});
        const range = 'Display!A2:Z';  // Adjust range as needed
        const spreadsheetId = extractSpreadsheetId(spreadsheetLink);
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        });
    
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
          throw new Error('No data found in the sheet.');
        }
    
        return rows.map(row => {
          const fileName = row[0];
          const data = {};
    
          for (let i = 1; i < row.length; i += 2) {
            const tag = row[i];
            const adjustedTag = tag.replace(/[^\w]/gi, '')
            const value = row[i + 1];
            data[adjustedTag] = value;
          }
    
          return {
            FileName: fileName,
            Data: data,
          };
        });
      } catch (error) {
        console.error('Error fetching or parsing data:', error);
        return null;
      }
    }

    async function poll() {
      if (urlConfig.length === 0) return;

      function removeSpecialChars(value) {
        return value.replaceAll("/", "-").replaceAll("\\", "-").replaceAll(",", "-").replaceAll(".", "")
      }
      
      for (const entry of urlConfig) {
        const { url, key } = entry;
        try {
          console.log(`Polling data from ${url}`);
          const contests = await fetchAndParseData(url, key);
          console.log(`Parsed data`);

          if (contests) {
            await fs.mkdir(path.join(userDocumentsPath, 'GSheetsElectionXMLFiles'), { recursive: true });

            for (const contest of contests) {
              const builder = new xml2js.Builder({ headless: true });
              const simplifiedXmlContent = builder.buildObject({ Contest: contest });

              const contestFileName = `${removeSpecialChars(entry.name)}-${removeSpecialChars(contest.FileName)}.xml`;
              const contestFilePath = path.join(userDocumentsPath, 'GSheetsElectionXMLFiles', contestFileName);

              await fs.writeFile(contestFilePath, simplifiedXmlContent);

              console.log(`Contest ${contest.FileName} written to ${contestFilePath}`);
            }
          }
        } catch (error) {
          console.error(`Error polling data from ${url}:`, error);
        }
      }
      setTimeout(poll, pollInterval);
    }

    async function startPolling() {
      if (urlConfig.length === 0) return;

      setTimeout(poll, pollInterval);

      poll().catch(error => {
        console.error('Polling error:', error);
      });
    }

    app.on('ready', () => {
      console.log('Electron app is ready.');

      server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
      });

      const win = new BrowserWindow({
        width: 600,
        height: 700,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
        },
      });

      win.loadURL(`http://localhost:${PORT}`);

      // Start polling immediately after app is ready and server is started
      startPolling();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

  } catch (error) {
    console.error('Error during initialization:', error);
  }
})();