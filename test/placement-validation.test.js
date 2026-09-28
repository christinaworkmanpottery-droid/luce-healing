const test=require('node:test'),assert=require('node:assert/strict');
const {validatePlacements}=require('../private-membership/placement-validation');
const context={placements:[{placement:'Sun',sign:'Virgo'},{placement:'Moon',sign:'Taurus'},{placement:'Mercury',sign:'Virgo'},{placement:'Mars',sign:'Cancer'},{placement:'Jupiter',sign:'Cancer'},{placement:'Venus',sign:'Leo'}],omitted:['Rising']};
test('exact natal facts and clearly distinct current events pass',()=>{
 assert.equal(validatePlacements('With your natal Mars in Cancer and your natal Jupiter in Cancer, reflect on these themes. The current transit of Mars in Leo and the current transit of Jupiter through Leo are monthly influences. The current Venus retrograde asks for reflection.',context),true);
});
test('all seven bodies are locked, including unknown Rising',()=>{
 for(const body of ['Sun','Moon','Rising','Mercury','Venus','Mars','Jupiter'])assert.throws(()=>validatePlacements(`With your natal ${body} in Aquarius, reflect.`,context));
});
test('grouped, reversed, ambiguous and contradicted references cannot bypass new validation',()=>{
 for(const text of ['Mars and Jupiter in Leo bring confidence.','Your Mars and Jupiter in Leo.','Your Leo Mars.','Your Mars is in Leo.','Your Cancer Sun.','Your natal Mars in Cancer. Later your natal Mars in Leo.','Your Leo confidence.','Your Ascendant in Libra.','Your Mars, Jupiter and Venus in Leo.'])assert.throws(()=>validatePlacements(text,context),text);
});
test('legacy contradictions are invalidated without an AI call',()=>{
 for(const text of ['Mars and Jupiter in Leo bring confidence. Later your Mars and Jupiter in Cancer support home.','Your Leo Mars and Jupiter.','Your Mars, Jupiter and Venus in Leo.','Your Rising in Libra.','Your Virgo Sun and Mercury. Your Mars lies in Leo.'])assert.throws(()=>validatePlacements(text,context,{strict:false}),text);
 assert.equal(validatePlacements('Your Virgo Sun and Mercury help you reflect. Your Mars and Jupiter in Cancer emphasize home. Your Taurus Moon grounds you.',context,{strict:false}),true);
});
