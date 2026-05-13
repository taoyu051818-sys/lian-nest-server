#!/usr/bin/env node
'use strict';
const checks = require('./constitution-checks');
const result = checks.runConstitutionChecks();
process.stdout.write(JSON.stringify(result));
