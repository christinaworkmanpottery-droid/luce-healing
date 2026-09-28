const chart = require('./chart');
const bodies = Object.keys(chart.meanings);
const bodyPattern = '(?:' + bodies.join('|') + '|Ascendant)';
const signPattern = '(?:' + chart.signs.join('|') + ')';
const canonicalBody = name => /^ascendant$/i.test(name) ? 'Rising' : bodies.find(b => b.toLowerCase() === name.toLowerCase());
const failure = () => Object.assign(Error('Your reading needs another attempt to keep natal placements and current monthly astrology accurate.'), {status:502});
const signature = placements => JSON.stringify(placements.map(p => [p.placement,p.sign]).sort());

// New prose uses explicit, mechanically checkable placement phrases. The model
// never supplies the authoritative mapping. Ambiguous sky/natal wording fails closed.
function validatePlacements(text, context, {strict = true} = {}) {
  const locked = new Map(context.placements.map(p => [p.placement,p.sign.toLowerCase()]));
  const normalized = text.normalize('NFKC').replace(/[’‘]/g,"'");
  let remaining = normalized;
  const natal = new RegExp('\\byour natal (' + bodyPattern + ') in (' + signPattern + ')\\b','gi');
  remaining = remaining.replace(natal, (phrase,body,sign) => {
    if (locked.get(canonicalBody(body)) !== sign.toLowerCase()) throw failure();
    return ' '.repeat(phrase.length);
  });
  // These labels cannot be mistaken for a member's natal chart. Their factual
  // support (including dates/aspects) is independently checked against cited sources.
  const monthly = new RegExp('\\bthe current (?:transit of (' + bodyPattern + ') (?:in|through) (' + signPattern + ')|(' + bodyPattern + ') retrograde|(?:Full|New) Moon in (' + signPattern + '))\\b','gi');
  remaining = remaining.replace(monthly, phrase => ' '.repeat(phrase.length));
  if (strict) {
    // No alternative spelling/order, grouped placement, or bare sign can bypass
    // the exact check. The generator retries with the required phrasing.
    if (new RegExp('\\b(?:' + bodyPattern + '|' + signPattern + ')\\b','i').test(remaining)) throw failure();
    return true;
  }
  // Legacy cache: check common natural-language placement forms without another
  // AI call. Retain valid readings; reject contradictions and unlabelled sky claims.
  const group = bodyPattern + '(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+(?:and|&)\\s+)' + bodyPattern + ')*';
  const check = (phrase, names, sign) => {
    for (const body of names.match(new RegExp(bodyPattern,'gi')) || []) {
      if (locked.get(canonicalBody(body)) !== sign.toLowerCase()) throw failure();
    }
    return ' '.repeat(phrase.length);
  };
  remaining = remaining.replace(new RegExp('\\b(' + group + ')\\s+(?:(?:is|are|lies?|sits?|falls?)\\s+)?(?:in|in the sign of)\\s+(' + signPattern + ')\\b','gi'),check);
  remaining = remaining.replace(new RegExp('\\b(' + signPattern + ')\\s+(' + group + ')\\b','gi'),(phrase,sign,names)=>check(phrase,names,sign));
  // Any remaining unparsed planet/sign pairing is ambiguous, so it must be
  // regenerated using the explicit grammar, rather than guessed at display time.
  for (const sentence of remaining.split(/[.!?;\n]/)) {
    if (new RegExp('\\b' + bodyPattern + '\\b','i').test(sentence) && new RegExp('\\b' + signPattern + '\\b','i').test(sentence)) throw failure();
    for (const body of context.omitted || []) {
      const names=body==='Rising'?'(?:Rising|Ascendant)':body;
      if (new RegExp('\\b'+names+'\\b','i').test(sentence)) throw failure();
    }
  }
  return true;
}
module.exports = {validatePlacements,signature};
