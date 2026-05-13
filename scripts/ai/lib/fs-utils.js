'use strict';

const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readNdjson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines silently — non-destructive
    }
  }
  return entries;
}

function appendNdjson(outPath, record) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(outPath, line, 'utf8');
}

module.exports = { readJson, readNdjson, appendNdjson };
