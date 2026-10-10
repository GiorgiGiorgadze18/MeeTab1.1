'use strict';
// Static syntax validation for all inline scripts; does not replace browser tests.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('website/index.html','utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(x=>!/\bsrc\s*=/.test(x[1]));
assert(scripts.length,'No inline script found');
for(const [i,m] of scripts.entries())new vm.Script(m[2],{filename:'website/index.html:inline-'+i});
assert(html.includes('openITHelp'), 'Missing IT Help overlay implementation');
assert(html.includes('id="itRecipient"')&&html.includes('id="itSave"'),'Missing IT configuration form');
assert(!html.includes('IT_ADMIN_TOKEN='),'No private admin token may appear in public HTML');
console.log('PASS inline JavaScript parsing',scripts.length,'script(s)');
