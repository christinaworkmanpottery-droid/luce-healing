const aliases = {
  instagram: ['Instagram', 'Social media'], ig: ['Instagram', 'Social media'],
  facebook: ['Facebook', 'Social media'], fb: ['Facebook', 'Social media'],
  tiktok: ['TikTok', 'Social media'], threads: ['Threads', 'Social media'],
  pinterest: ['Pinterest', 'Social media'], linkedin: ['LinkedIn', 'Social media'],
  youtube: ['YouTube', 'Social media'], twitter: ['X / Twitter', 'Social media'], x: ['X / Twitter', 'Social media'],
  google: ['Google', 'Search'], bing: ['Bing', 'Search'], yahoo: ['Yahoo', 'Search'], duckduckgo: ['DuckDuckGo', 'Search'],
  newsletter: ['Newsletter', 'Email'], email: ['Email', 'Email']
};
function classifySource(pagePath, referrer, ownHost = 'lucehealing.com') {
  let url;
  try { url = new URL(pagePath, 'https://' + ownHost); } catch { url = new URL('https://lucehealing.com'); }
  const tag = (url.searchParams.get('utm_source') || '').trim().toLowerCase().replace(/[^a-z0-9_. -]/g, '').slice(0,80);
  const medium = (url.searchParams.get('utm_medium') || '').trim().toLowerCase();
  if (tag) {
    const [source, channel] = aliases[tag] || [tag, 'Tagged link'];
    return { source, medium: /^(cpc|ppc|paidsearch|paid_search)$/.test(medium) ? 'Paid advertising' : /^(paid_social|paidsocial)$/.test(medium) ? 'Paid social' : medium === 'email' ? 'Email' : channel, explicit: true };
  }
  if (url.searchParams.has('gclid')) return {source:'Google',medium:'Paid advertising',explicit:true};
  let host = '';
  try { const ref = new URL(referrer); if (/^https?:$/.test(ref.protocol)) host = ref.hostname.toLowerCase(); } catch {}
  const own = ownHost.split(':')[0].toLowerCase().replace(/^www\./,'');
  if (!host || host.replace(/^www\./,'') === own) return {source:'Direct / unknown',medium:'Direct / unknown',explicit:false};
  const domain = name => host === name || host.endsWith('.' + name);
  for (const [name, key] of [['instagram.com','instagram'],['facebook.com','facebook'],['fb.com','facebook'],['tiktok.com','tiktok'],['threads.net','threads'],['threads.com','threads'],['pinterest.com','pinterest'],['pin.it','pinterest'],['linkedin.com','linkedin'],['lnkd.in','linkedin'],['youtube.com','youtube'],['youtu.be','youtube'],['twitter.com','twitter'],['x.com','twitter'],['t.co','twitter'],['bing.com','bing'],['yahoo.com','yahoo'],['duckduckgo.com','duckduckgo']]) {
    if(domain(name)) { const [source, medium] = aliases[key]; return {source,medium,explicit:true}; }
  }
  if (/(^|\.)google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host)) return {source:'Google',medium:'Search',explicit:true};
  return {source:host.replace(/^www\./,''),medium:'Other websites',explicit:true};
}
function groupSources(rows) {
  const grouped = new Map();
  for(const row of rows) {
    const legacy = classifySource('/', row.referrer);
    const source = row.traffic_source || legacy.source;
    const medium = row.traffic_medium || legacy.medium;
    const key = JSON.stringify([source,medium]);
    const item = grouped.get(key) || {source,medium,views:0};
    item.views += Number(row.views);
    grouped.set(key,item);
  }
  return [...grouped.values()].sort((a,b)=>b.views-a.views || a.source.localeCompare(b.source));
}
module.exports = {classifySource,groupSources};
