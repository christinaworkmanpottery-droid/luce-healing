const test=require('node:test'),assert=require('node:assert/strict'),c=require('../private-membership/chart');
test('historical timezone offsets, DST gaps and repeated times are handled without guessing',()=>{
 assert.deepEqual(c.localCandidates('1965-07-01','12:00','America/Los_Angeles').map(x=>new Date(x).toISOString()),['1965-07-01T19:00:00.000Z']);
 assert.deepEqual(c.localCandidates('1943-01-01','12:00','America/New_York').map(x=>new Date(x).toISOString()),['1943-01-01T16:00:00.000Z']);
 assert.equal(c.localCandidates('2021-03-14','02:30','America/New_York').length,0);
 assert.deepEqual(c.localCandidates('2021-11-07','01:30','America/New_York').map(x=>new Date(x).toISOString()),['2021-11-07T05:30:00.000Z','2021-11-07T06:30:00.000Z']);
 assert.throws(()=>c.calculate({date:'2021-03-14',time:'02:30',placeId:'5128581'}),/did not occur/);
 const ambiguous=c.calculate({date:'2021-11-07',time:'01:30',placeId:'5128581'});assert(ambiguous.ambiguous);assert(ambiguous.notes.some(x=>x.includes('both occurrences')));
});
test('birthday-only and unknown-location charts omit Rising and mark changing signs uncertain',()=>{
 const x=c.calculate({date:'1990-01-01',unknownTime:true,unknownLocation:true});assert.equal(x.placements.find(p=>p.placement==='Sun').sign,'Capricorn');assert.equal(x.placements.find(p=>p.placement==='Moon').reliable,false);assert.equal(x.placements.find(p=>p.placement==='Rising').sign,null);
 const y=c.calculate({date:'2000-03-20',time:'12:00',unknownLocation:true});assert.equal(y.placements.find(p=>p.placement==='Sun').reliable,false);assert.equal(y.placements.find(p=>p.placement==='Rising').reliable,false);
 const z=c.calculate({date:'1990-01-01',unknownTime:true,placeId:'5368361'});assert.equal(z.profile.place.zone,'America/Los_Angeles');assert.equal(z.placements.find(p=>p.placement==='Rising').reliable,false);
 assert.throws(()=>c.calculate({date:'2001-02-29',unknownTime:true,unknownLocation:true}),/valid birth date/);
 assert.throws(()=>c.calculate({date:'1990-01-01',time:'25:00',unknownLocation:true}),/birth time/);
});
test('personal reading groups shared signs once, includes only reliable placements and supplied published text',()=>{
 const x=c.calculate({date:'1990-01-01',unknownTime:true,unknownLocation:true});const groups=c.matchingReading(x,{content:{Capricorn:'Christina published Capricorn',Aquarius:'Christina published Aquarius'}});assert.equal(groups.filter(x=>x.sign==='Capricorn').length,1);assert.equal(groups.find(x=>x.sign==='Capricorn').placements.length,2);assert(!groups.some(x=>x.placements.some(p=>p.placement==='Moon'||p.placement==='Rising')));assert.equal(groups[0].content,'Christina published Capricorn');assert.deepEqual(c.matchingReading(x,{content:{}}),[]);
});
test('planet longitudes and eastern-horizon Rising agree with independent ephemeris fixtures',()=>{
 for(const row of require('./chart-reference.json'))for(const [body,expected] of Object.entries(row.longitude)){const actual=body==='Rising'?c.rising(new Date(row.utc),row.lat,row.lon):c.longitude(body,new Date(row.utc));const delta=Math.abs(((actual-expected+540)%360)-180);assert(delta<0.04,body+' '+row.utc+' delta '+delta);}
});
