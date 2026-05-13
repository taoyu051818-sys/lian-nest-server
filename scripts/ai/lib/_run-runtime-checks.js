#!/usr/bin/env node
'use strict';
const checks = require('./constitution-checks');
const result = checks.runRuntimeHealthChecks();
process.stdout.write(JSON.stringify(result));
