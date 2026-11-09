'use strict';
// Tiny arg parser: --k v, --k=v, -k v, boolean flags listed in `bools`.
function parse(argv, bools = []) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      let k = a.replace(/^-+/, ''), v;
      if (k.includes('=')) { [k, v] = [k.split('=')[0], k.slice(k.indexOf('=') + 1)]; }
      else if (!bools.includes(k)) v = argv[++i];
      else v = true;
      flags[k] = v === undefined ? true : v;
    } else pos.push(a);
  }
  return { pos, flags };
}
module.exports = { parse };
