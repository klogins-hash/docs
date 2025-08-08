#!/usr/bin/env node

/**
 * Script to migrate content files to Weaviate and clean up GitHub repo
 */

import fs from 'fs';
import path from 'path';

// Files and directories that should be in Weaviate, not GitHub
const WEAVIATE_FILES = [
  'imported/',
  'google-drive-sync-state.json',
  'google-drive-sync-report.json',
  'import-report.json',
  'maintenance-report.json',
  'semantic-archiving-report.json',
  'universal-import-report.json',
  'google-drive-sync.log',
  'auto-tag.log',
  'optimization.log'
];

// Files that should stay in GitHub
const KEEP_IN_GITHUB = [
  'package.json',
  'docs.json',
  'api-reference/openapi.json'
];

async function main() {
  console.log('🔍 Analyzing files for Weaviate migration...');
  
  // Check which files exist
  const existingFiles = [];
  for (const file of WEAVIATE_FILES) {
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      existingFiles.push({
        path: file,
        size: stats.size,
        isDirectory: stats.isDirectory()
      });
    }
  }
  
  console.log('\n📋 Files that should be moved to Weaviate:');
  existingFiles.forEach(file => {
    const sizeStr = file.isDirectory ? '(directory)' : `(${(file.size / 1024).toFixed(1)}KB)`;
    console.log(`  ✓ ${file.path} ${sizeStr}`);
  });
  
  console.log('\n🎯 Next steps:');
  console.log('1. Run your existing Weaviate sync scripts to import content');
  console.log('2. Add these files to .gitignore');
  console.log('3. Remove them from git history');
  console.log('4. Push clean repo to GitHub');
  
  // Generate .gitignore entries
  console.log('\n📝 Add these lines to .gitignore:');
  WEAVIATE_FILES.forEach(file => {
    console.log(`${file}`);
  });
}

main().catch(console.error);
