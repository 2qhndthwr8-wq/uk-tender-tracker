const axios = require('axios');
const fs = require('fs').promises;

const URL = 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?order=desc';
const OUT = 'tenders-data.json';

async function fetchTenders() {
  try {
    const { data } = await axios.get(URL, { responseType: 'json', timeout: 30000 });
    const payload = {
      fetchedAt: new Date().toISOString(),
      source: URL,
      data
    };
    await fs.writeFile(OUT, JSON.stringify(payload, null, 2), 'utf8');
    console.log('Successfully fetched and saved tender data');
  } catch (err) {
    console.error('Error fetching tenders:', err.message || err);
    process.exit(1);
  }
}

fetchTenders();