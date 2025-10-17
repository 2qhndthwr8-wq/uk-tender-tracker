const fs = require('fs');

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

async function fetchSell2Wales() {
  console.log('Fetching Sell2Wales...');
  const all = [];
  
  for (let m = 0; m < 6; m++) {
    for (const t of [1, 2, 3, 7]) {
      try {
        const r = await fetch(`https://api.sell2wales.gov.wales/v1/Notices?dateFrom=${getMonthYear(m)}&noticeType=${t}&outputType=0&locale=2057`);
        if (r.ok) {
          const d = await r.json();
          if (d.releases) all.push(...d.releases);
        }
      } catch (e) {}
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
  let next = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';

  while (next && all.length < 2000) {
    try {
      const r = await fetch(next);
      if (!r.ok) break;
      const d = await r.json();
      if (d.releases) all.push(...d.releases);
      next = d.links?.next || null;
    } catch (e) { break; }
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
  let next = 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?order=publishedDate&stage=active';

  while (next && all.length < 2000) {
    try {
      const r = await fetch(next);
      if (!r.ok) break;
      const d = await r.json();
      if (d.releases) all.push(...d.releases);
      next = d.links?.next || null;
    } catch (e) { break; }
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
  const results = {
    lastUpdated: new Date().toISOString(),
    stats: {},
    tenders: []
  };

  try {
    const s2w = await fetchSell2Wales();
    results.stats.sell2Wales = { success: true, totalFetched: s2w.raw, energyRelated: s2w.filtered };
    results.tenders.push(...s2w.data);
  } catch (e) {
    results.stats.sell2Wales = { success: false, error: e.message };
  }

  try {
    const fat = await fetchFindATender();
    results.stats.findATender = { success: true, totalFetched: fat.raw, energyRelated: fat.filtered };
    results.tenders.push(...fat.data);
  } catch (e) {
    results.stats.findATender = { success: false, error: e.message };
  }

  try {
    const cf = await fetchContractsFinder();
    results.stats.contractsFinder = { success: true, totalFetched: cf.raw, energyRelated: cf.filtered };
    results.tenders.push(...cf.data);
  } catch (e) {
    results.stats.contractsFinder = { success: false, error: e.message };
  }

  results.tenders.sort((a, b) => {
    if (a.deadline === 'Not specified') return 1;
    if (b.deadline === 'Not specified') return -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });

  results.totalEnergyTenders = results.tenders.length;

  fs.writeFileSync('tenders-data.json', JSON.stringify(results, null, 2));
  console.log(`Done! ${results.totalEnergyTenders} battery/energy tenders found.`);
}

main().catch(console.error);
