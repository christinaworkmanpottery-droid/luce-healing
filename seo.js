// Shared defaults keep new published articles search-ready without changing the editor.
const ORIGIN = 'https://lucehealing.com';
const PUBLIC_PATHS = ['/', '/blog', '/reading', '/forecast', '/pricing.html', '/gift', '/subscribe'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain = value => String(value ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|quot|apos|lt|gt);/g,c=>({'&nbsp;':' ','&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[c])).replace(/\s+/g,' ').trim();
const json = value => JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
const postPath = slug => '/blog/' + encodeURIComponent(slug);
const isoDate = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : undefined;
function description(post) {
  const text = plain(post.excerpt) || plain(post.content) || plain(post.title);
  if (text.length <= 165) return text;
  return text.slice(0,162).replace(/\s+\S*$/,'') + '…';
}
// Descriptive search titles for existing posts whose visible titles are more poetic.
const titles = {
 'this-week-astrology-september-14-20-2026':'Weekly Astrology Forecast: September 14–20, 2026',
 'weekend-forecast-threshold-consequences':'Weekend Astrology Forecast: The Threshold Before Consequences',
 'a-collective-turning-point':'Astrology and a Collective Turning Point',
 'the-great-alignment-collective-turning-point':'The Great Astrological Alignment: A Collective Turning Point',
 'full-moon-leo-aquarius-july-2026':'Aquarius Full Moon, July 2026: Shine Without Losing Yourself',
 'weekly-energy-listening-to-your-own-weather-may-25':'Weekly Astrology: Listening to Your Own Weather',
 'weekend-energies-soft-hearts-tender-truths-recenter':'Weekend Astrology: Soft Hearts, Tender Truths and Recentering',
 'you-are-your-own-healer':'You Are Your Own Healer: Self-Healing and Inner Wisdom',
 'feel-scattered-how-to-ground-yourself':'Feel Scattered? Five Grounding Practices to Reconnect',
 'stop-waiting-become-who-you-are':'Personal Growth: Stop Waiting to Become Who You Are'
};
function metadata(post) {
 const headline=plain(post.title), desc=description(post), url=ORIGIN+postPath(post.slug);
 return {title: titles[post.slug] || headline, description:desc, url,
  schema:{'@context':'https://schema.org','@type':'BlogPosting','@id':url+'#article',headline,description:desc,url,
   mainEntityOfPage:{'@type':'WebPage','@id':url},image:ORIGIN+'/images/og-image.jpg',inLanguage:'en-US',
   datePublished:isoDate(post.created_at),dateModified:isoDate(post.updated_at || post.created_at),
   author:{'@type':'Person',name:'Christina Workman',url:ORIGIN+'/#about'},
   publisher:{'@type':'Organization','@id':ORIGIN+'/#organization',name:'Luce Healing',url:ORIGIN+'/',logo:{'@type':'ImageObject',url:ORIGIN+'/images/logo.jpg'}},
   isPartOf:{'@type':'Blog','@id':ORIGIN+'/blog',name:'From the Light: Astrology & Healing Insights'}}};
}
const themes = [ /astrolog|zodiac|birth.chart|natal|planet|moon|mercury|saturn|jupiter|virgo|aries|taurus|gemini|cancer|leo|libra|scorpio|sagittarius|capricorn|aquarius|pisces/i, /energy.healing|reiki|self.heal|own.healer/i, /ground|fear|anxiety|emotion|nervous|peace/i, /manifest|growth|become|intention/i, /crystal|ritual|bath|space.*clear/i ];
function related(post, posts) {
 const subject=plain(post.title+' '+post.excerpt), matches=themes.map(t=>t.test(subject));
 return posts.filter(p=>p.slug!==post.slug).map(p=>({p,score:themes.reduce((n,t,i)=>n+(matches[i]&&t.test(plain(p.title+' '+p.excerpt))?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3).map(({p})=>p);
}
function sitemap(posts) {
 const entries=PUBLIC_PATHS.map(p=>`  <url><loc>${ORIGIN}${p}</loc></url>`);
 for (const p of posts) {
  const date=isoDate(p.updated_at || p.created_at);
  entries.push(`  <url><loc>${escape(ORIGIN+postPath(p.slug))}</loc>${date?`<lastmod>${date}</lastmod>`:''}</url>`);
 }
 return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+entries.join('\n')+'\n</urlset>';
}
function headings(content) {
 let previous = 1;
 return String(content || '').replace(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi, (all, original, attrs, body) => {
  const level = Math.min(Math.max(2, Number(original)), previous + 1);
  previous = level;
  if (level === Number(original)) return all;
  const cls = 'seo-heading-h' + original;
  if (/\bclass=["']/.test(attrs)) attrs = attrs.replace(/\bclass=(["'])/, (_, q) => 'class=' + q + cls + ' ');
  else attrs += ' class="' + cls + '"';
  return '<h' + level + attrs + '>' + body + '</h' + level + '>';
 });
}
module.exports={headings,ORIGIN,PUBLIC_PATHS,escape,plain,json,postPath,isoDate,metadata,related,sitemap};
