#!/usr/bin/env node
'use strict';
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) { console.error('chronostudy needs Node 18+ (pkg install nodejs)'); process.exit(1); }
require('../lib/cli').main(process.argv.slice(2)).catch((e) => { console.error('Error: ' + e.message); process.exit(1); });
