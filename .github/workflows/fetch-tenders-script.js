const fs = require('fs');
const https = require('https');

const KEYWORDS = [
  'battery', 'batteries', 'energy storage', 'bess', 'powerwall',
  'battery energy storage', 'solar battery', 'home battery',
  'residential energy storage', 'lithium', 'inverter',
  'solar pv', 'photovoltaic', 'renewable energy', 
  'ev charging', 'electric vehicle charging', 'microgrid'
];

function matches(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw));
}

function getMonthYear(ago) {
  const d = new Date();
  d.setMonth(d.getMonth() - ago);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function fetchSell2Wales() {
  console.log('Fetching Sell2Wales...');
  const all = [];
  
  for (let m = 0; m < 6; m++) {
    for (const t of [1, 2, 3, 7]) {
      try {
        const data = await httpsGet(`https://api.sell2wales.gov.wales/v1/Notices?dateFrom=${getMonthYear(m)}&noticeType=${t}&outputType=0&locale=2057`);
        if (data.releases) all.push(...data.releases);
      } catch (e) {
        console.log(`Sell2Wales error: ${e.message}`);
      }
    }
  }

  const unique = Array.from(new Map(all.map(r => [r.id, r])).values());
  const filtered = unique.filter(r => matches((r.tender?.title || '') + ' ' + (r.tender?.description || '')));
  
  return {
    success: true,
    raw: unique.length,
    filtered: filtered.length,
    data: filtered.map(r => ({
      id: r.id,
      title: r.tender?.title || 'No title',
      description: (r.tender?.description || '').substring(0, 300),
      buyer: r.buyer?.name || 'Unknown',
      value: r.tender?.value?.amount ? `£${r.tender.value.amount.toLocaleString()}` : 'Not specified',
      deadline: r.tender?.tenderPeriod?.endDate || 'Not specified',
      source: 'Sell2Wales',
      url: `https://www.sell2wales.gov.wales/search/show/search_view.aspx?ID=${r.id}`,
      publishDate: r.date || 'Not specified'
    }))
  };
}

async function fetchFindATender() {
  console.log('Fetching Find a Tender...');
  const all = [];
  let url = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';

  while (url && all.length < 2000) {
    try {
      const data = await httpsGet(url);
      if (data.releases) all.push(...data.releases);
      url = data.links?.next || null;
      console.log(`  Fetched ${all.length} so far...`);
    } catch (e) {
      console.log(`Find a Tender error: ${e.message}`);
      break;
    }
  }

  const filtered = all.filter(r => matches((r.tender?.title || '') + ' ' + (r.tender?.description || r.description || '')));

  return {
    success: true,
    raw: all.length,
    filtered: filtered.length,
    data: filtered.map(r => ({
      id: r.id,
      title: r.tender?.title || 'No title',
      description: (r.tender?.description || r.description || '').substring(0, 300),
      buyer: (r.buyer?.name || r.parties?.find(p => p.roles?.includes('buyer'))?.name || 'Unknown'),
      value: r.tender?.value?.amount ? `£${r.tender.value.amount.toLocaleString()}` : 'Not specified',
      deadline: r.tender?.tenderPeriod?.endDate || 'Not specified',
      source: 'Find a Tender',
      url: `https://www.find-tender.service.gov.uk/Notice/${r.id}`,
      publishDate: r.date || 'Not specified'
    }))
  };
}

async function fetchContractsFinder() {
  console.log('Fetching Contracts Finder...');
  const all = [];
  let url = 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?order=publishedDate&stage=active';

  while (url && all.length < 2000) {
    try {
      const data = await httpsGet(url);
      if (data.releases) all.push(...data.releases);
      url = data.links?.next || null;
      console.log(`  Fetched ${all.length} so far...`);
    } catch (e) {
      console.log(`Contracts Finder error: ${e.message}`);
      break;
    }
  }

  const filtered = all.filter(r => matches((r.tender?.title || '') + ' ' + (r.tender?.description || r.description || '')));
  const unique = Array.from(new Map(filtered.map(r => [r.id, r])).values());

  return {
    success: true,
    raw: all.length,
    filtered: unique.length,
    data: unique.map(r => ({
      id: r.id,
      title: r.tender?.title || 'No title',
      description: (r.tender?.description || r.description || '').substring(0, 300),
      buyer: r.buyer?.name || 'Unknown',
      value: r.tender?.value?.amount ? `£${r.tender.value.amount.toLocaleString()}` : 'Not specified',
      deadline: r.tender?.tenderPeriod?.endDate || 'Not specified',
      source: 'Contracts Finder',
      url: `https://www.contractsfinder.service.gov.uk/Notice/${r.id}`,
      publishDate: r.date || 'Not specified'
    }))
  };
}

async function main() {
  console.log('Starting tender fetch...');
  
  const results = {
    lastUpdated: new Date().toISOString(),
    stats: {},
    tenders: []
  };

  try {
    const s2w = await fetchSell2Wales();
    results.stats.sell2Wales = { success: true, totalFetched: s2w.raw, energyRelated: s2w.filtered };
    results.tenders.push(...s2w.data);
    console.log(`Sell2Wales: ${s2w.filtered} energy tenders from ${s2w.raw} total`);
  } catch (e) {
    results.stats.sell2Wales = { success: false, error: e.message };
  }

  try {
    const fat = await fetchFindATender();
    results.stats.findATender = { success: true, totalFetched: fat.raw, energyRelated: fat.filtered };
    results.tenders.push(...fat.data);
    console.log(`Find a Tender: ${fat.filtered} energy tenders from ${fat.raw} total`);
  } catch (e) {
    results.stats.findATender = { success: false, error: e.message };
  }

  try {
    const cf = await fetchContractsFinder();
    results.stats.contractsFinder = { success: true, totalFetched: cf.raw, energyRelated: cf.filtered };
    results.tenders.push(...cf.data);
    console.log(`Contracts Finder: ${cf.filtered} energy tenders from ${cf.raw} total`);
  } catch (e) {
    results.stats.contractsFinder = { success: false, error: e.message };
  }

  // Sort by deadline
  results.tenders.sort((a, b) => {
    if (a.deadline === 'Not specified') return 1;
    if (b.deadline === 'Not specified') return -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });

  results.totalEnergyTenders = results.tenders.length;

  fs.writeFileSync('tenders-data.json', JSON.stringify(results, null, 2));
  console.log(`\n✅ DONE! Found ${results.totalEnergyTenders} battery/energy storage tenders.`);
  console.log('Results saved to tenders-data.json');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
