#!/usr/bin/env node

/**
 * Google Drive Auto-Sync System for Weaviate
 * Monitors specific Google Drive folders and automatically imports new/modified files
 */

import https from 'https';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

// Configuration for Google Drive folders to monitor
const GOOGLE_DRIVE_CONFIG = {
  basePath: '/Users/franksimpson/Library/CloudStorage/GoogleDrive-dp@thekollektiv.xyz/My Drive',
  watchFolders: [
    '1A Downloads',
    'Creating Reusable Prompts for AI Processes', 
    'declaration',
    '.' // Root level files
  ],
  excludePatterns: [
    '.DS_Store',
    'Thumbs.db',
    '~$*',
    '*.tmp',
    '*.temp',
    '.git',
    'node_modules'
  ],
  supportedExtensions: [
    '.md', '.txt', '.rtf', '.html', '.htm', '.xml', '.json', '.jsonl', '.csv', '.tsv',
    '.pdf', '.docx', '.doc', '.odt', '.epub',
    '.js', '.ts', '.py', '.java', '.cpp', '.c', '.php', '.rb', '.go', '.rs', '.swift',
    '.yaml', '.yml', '.toml', '.ini', '.conf', '.env',
    '.zip', '.tar', '.gz', '.7z', '.rar'
  ]
};

class GoogleDriveAutoSync {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
    this.chunkSize = options.chunkSize || 5;
    this.delay = options.delay || 2000;
    this.stateFile = './google-drive-sync-state.json';
    this.logFile = './google-drive-sync.log';
    this.stats = {
      scanned: 0,
      new: 0,
      modified: 0,
      uploaded: 0,
      errors: 0,
      skipped: 0
    };
  }

  async makeRequest(path, method = 'GET', data = null) {
    const url = `${WEAVIATE_CONFIG.scheme}://${WEAVIATE_CONFIG.host}${path}`;
    
    return new Promise((resolve, reject) => {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WEAVIATE_CONFIG.apiKey}`
        }
      };

      const req = https.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ status: res.statusCode, data: parsed });
          } catch (error) {
            resolve({ status: res.statusCode, data: body });
          }
        });
      });

      req.on('error', reject);
      
      if (data) {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  async loadSyncState() {
    try {
      const stateData = await fs.readFile(this.stateFile, 'utf8');
      return JSON.parse(stateData);
    } catch (error) {
      return {
        lastSync: null,
        fileHashes: {},
        processedFiles: new Set()
      };
    }
  }

  async saveSyncState(state) {
    await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
  }

  async log(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    
    if (this.verbose) {
      console.log(message);
    }
    
    try {
      await fs.appendFile(this.logFile, logEntry);
    } catch (error) {
      // Ignore log file errors
    }
  }

  async getFileHash(filePath) {
    try {
      const content = await fs.readFile(filePath);
      return createHash('md5').update(content).digest('hex');
    } catch (error) {
      return null;
    }
  }

  async getFileMetadata(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtime.toISOString(),
        ctime: stats.ctime.toISOString()
      };
    } catch (error) {
      return null;
    }
  }

  shouldProcessFile(filePath, fileName) {
    // Check exclude patterns
    for (const pattern of GOOGLE_DRIVE_CONFIG.excludePatterns) {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        if (regex.test(fileName)) {
          return false;
        }
      } else if (fileName === pattern) {
        return false;
      }
    }

    // Check supported extensions
    const ext = path.extname(fileName).toLowerCase();
    return GOOGLE_DRIVE_CONFIG.supportedExtensions.includes(ext);
  }

  async scanGoogleDriveFolders() {
    const allFiles = [];
    
    for (const folder of GOOGLE_DRIVE_CONFIG.watchFolders) {
      const folderPath = path.join(GOOGLE_DRIVE_CONFIG.basePath, folder);
      
      try {
        await fs.access(folderPath);
        await this.log(`📂 Scanning folder: ${folder}`);
        
        const files = await this.scanDirectory(folderPath, folder);
        allFiles.push(...files);
        
        await this.log(`   Found ${files.length} files in ${folder}`);
      } catch (error) {
        await this.log(`   ⚠️  Cannot access folder ${folder}: ${error.message}`);
      }
    }
    
    this.stats.scanned = allFiles.length;
    return allFiles;
  }

  async scanDirectory(dirPath, relativePath = '') {
    const files = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativeFilePath = path.join(relativePath, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          // Recursively scan subdirectories
          const subFiles = await this.scanDirectory(fullPath, relativeFilePath);
          files.push(...subFiles);
        } else if (entry.isFile() && this.shouldProcessFile(fullPath, entry.name)) {
          const metadata = await this.getFileMetadata(fullPath);
          if (metadata) {
            files.push({
              fullPath,
              relativePath: relativeFilePath,
              name: entry.name,
              ext: path.extname(entry.name).toLowerCase(),
              ...metadata
            });
          }
        }
      }
    } catch (error) {
      await this.log(`   ❌ Error scanning directory ${dirPath}: ${error.message}`);
    }
    
    return files;
  }

  async identifyChangedFiles(files, syncState) {
    const changedFiles = [];
    
    for (const file of files) {
      const fileId = file.relativePath;
      const currentHash = await this.getFileHash(file.fullPath);
      
      if (!currentHash) {
        this.stats.errors++;
        continue;
      }
      
      const previousHash = syncState.fileHashes[fileId];
      const isNew = !previousHash;
      const isModified = previousHash && previousHash !== currentHash;
      
      if (isNew || isModified) {
        changedFiles.push({
          ...file,
          hash: currentHash,
          isNew,
          isModified
        });
        
        if (isNew) this.stats.new++;
        if (isModified) this.stats.modified++;
      }
    }
    
    return changedFiles;
  }

  async processFile(file) {
    try {
      await this.log(`   Processing: ${file.name} (${file.isNew ? 'NEW' : 'MODIFIED'})`);
      
      if (file.ext === '.zip' || file.ext === '.tar' || file.ext === '.gz' || file.ext === '.7z') {
        // Handle archive files
        return await this.processArchiveFile(file);
      } else {
        // Handle regular files
        return await this.processRegularFile(file);
      }
    } catch (error) {
      await this.log(`   ❌ Error processing ${file.name}: ${error.message}`);
      this.stats.errors++;
      return null;
    }
  }

  async processRegularFile(file) {
    // Use the universal file importer logic
    const tempDir = './temp_google_drive';
    await fs.mkdir(tempDir, { recursive: true });
    
    try {
      // Copy file to temp directory for processing
      const tempFilePath = path.join(tempDir, file.name);
      await fs.copyFile(file.fullPath, tempFilePath);
      
      // Process with universal importer
      const result = execSync(`node universal-file-importer.js "${tempFilePath}" --chunk-size 1`, 
        { encoding: 'utf8', stdio: 'pipe' });
      
      if (result.includes('uploaded')) {
        this.stats.uploaded++;
        await this.log(`   ✅ Uploaded: ${file.name}`);
        return true;
      } else {
        this.stats.skipped++;
        await this.log(`   ⏭️  Skipped: ${file.name}`);
        return false;
      }
    } finally {
      // Cleanup temp file
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }

  async processArchiveFile(file) {
    await this.log(`   📦 Processing archive: ${file.name}`);
    
    try {
      // Process archive with universal importer
      const result = execSync(`node universal-file-importer.js "${file.fullPath}" --chunk-size 3`, 
        { encoding: 'utf8', stdio: 'pipe' });
      
      const uploadedMatch = result.match(/(\d+) uploaded/);
      const uploadedCount = uploadedMatch ? parseInt(uploadedMatch[1]) : 0;
      
      this.stats.uploaded += uploadedCount;
      await this.log(`   ✅ Archive processed: ${file.name} (${uploadedCount} files uploaded)`);
      return uploadedCount > 0;
    } catch (error) {
      await this.log(`   ❌ Archive processing failed: ${file.name} - ${error.message}`);
      this.stats.errors++;
      return false;
    }
  }

  async runSync() {
    await this.log('🔄 Starting Google Drive Auto-Sync');
    
    if (this.dryRun) {
      await this.log('🔍 DRY RUN MODE - No files will be uploaded');
    }
    
    try {
      // Load previous sync state
      const syncState = await this.loadSyncState();
      
      // Scan Google Drive folders
      await this.log('📂 Scanning Google Drive folders...');
      const allFiles = await this.scanGoogleDriveFolders();
      
      if (allFiles.length === 0) {
        await this.log('ℹ️  No files found to process');
        return;
      }
      
      // Identify changed files
      await this.log('🔍 Identifying changed files...');
      const changedFiles = await this.identifyChangedFiles(allFiles, syncState);
      
      if (changedFiles.length === 0) {
        await this.log('✅ No changes detected - all files up to date');
        return;
      }
      
      await this.log(`📊 Found ${changedFiles.length} changed files (${this.stats.new} new, ${this.stats.modified} modified)`);
      
      if (!this.dryRun) {
        // Process changed files in chunks
        const chunks = this.chunkArray(changedFiles, this.chunkSize);
        
        for (let i = 0; i < chunks.length; i++) {
          await this.log(`📦 Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} files)...`);
          
          for (const file of chunks[i]) {
            await this.processFile(file);
            
            // Update sync state
            syncState.fileHashes[file.relativePath] = file.hash;
          }
          
          if (i < chunks.length - 1) {
            await this.log(`   ⏳ Waiting ${this.delay}ms before next chunk...`);
            await new Promise(resolve => setTimeout(resolve, this.delay));
          }
        }
        
        // Update sync state
        syncState.lastSync = new Date().toISOString();
        await this.saveSyncState(syncState);
        
        // Run auto-tagging on new content
        if (this.stats.uploaded > 0) {
          await this.log('🤖 Running auto-tagging on new content...');
          try {
            execSync('node advanced-auto-tagger.js --auto-tag', { stdio: 'pipe' });
            await this.log('✅ Auto-tagging completed');
          } catch (error) {
            await this.log('⚠️  Auto-tagging failed, but sync was successful');
          }
        }
      }
      
      await this.generateSyncReport();
      
    } catch (error) {
      await this.log(`❌ Sync failed: ${error.message}`);
      throw error;
    }
  }

  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async generateSyncReport() {
    const report = {
      timestamp: new Date().toISOString(),
      dry_run: this.dryRun,
      stats: this.stats,
      watched_folders: GOOGLE_DRIVE_CONFIG.watchFolders,
      supported_extensions: GOOGLE_DRIVE_CONFIG.supportedExtensions
    };
    
    await fs.writeFile('./google-drive-sync-report.json', JSON.stringify(report, null, 2));
    
    await this.log('\n📊 === GOOGLE DRIVE SYNC SUMMARY ===');
    await this.log(`📂 Folders scanned: ${GOOGLE_DRIVE_CONFIG.watchFolders.length}`);
    await this.log(`📄 Files scanned: ${this.stats.scanned}`);
    await this.log(`🆕 New files: ${this.stats.new}`);
    await this.log(`📝 Modified files: ${this.stats.modified}`);
    await this.log(`⬆️  Files uploaded: ${this.stats.uploaded}`);
    await this.log(`⏭️  Files skipped: ${this.stats.skipped}`);
    await this.log(`❌ Errors: ${this.stats.errors}`);
    await this.log('\n💾 Report saved to google-drive-sync-report.json');
    await this.log('📋 Logs saved to google-drive-sync.log');
  }

  async setupCronJob() {
    const cronScript = `#!/bin/bash
cd "${process.cwd()}"
node google-drive-auto-sync.js >> google-drive-sync.log 2>&1
`;
    
    await fs.writeFile('./google-drive-sync-cron.sh', cronScript);
    await fs.chmod('./google-drive-sync-cron.sh', 0o755);
    
    console.log('\n🕒 To set up automatic syncing, add this to your crontab:');
    console.log('crontab -e');
    console.log('Add line: */30 * * * * /path/to/your/project/google-drive-sync-cron.sh');
    console.log('\nThis will sync every 30 minutes. Adjust the schedule as needed.');
  }
}

// CLI handling
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
🔄 Google Drive Auto-Sync System

Automatically monitor Google Drive folders and import new/modified files to Weaviate.

Usage:
  node google-drive-auto-sync.js [options]

Options:
  --chunk-size <n>       Process in chunks of n items (default: 5)
  --delay <ms>           Delay between chunks in milliseconds (default: 2000)
  --dry-run              Preview what would be synced without uploading
  --verbose              Show detailed progress information
  --setup-cron           Generate cron job script for automatic syncing
  --help                 Show this help

Examples:
  # Run sync once
  node google-drive-auto-sync.js

  # Dry run to see what would be synced
  node google-drive-auto-sync.js --dry-run --verbose

  # Setup automatic syncing
  node google-drive-auto-sync.js --setup-cron

Monitored Folders:
  • 1A Downloads
  • Business Documents
  • Projects
  • Research
  • AI Tools
  • Collective
  • Marketing
  • Strategy

Features:
  • Automatic change detection (MD5 hashing)
  • State persistence between runs
  • Archive extraction and processing
  • Chunked processing for large datasets
  • Auto-tagging integration
  • Comprehensive logging and reporting
  • Cron job setup for automation
  `);
  process.exit(0);
}

const options = {
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  chunkSize: parseInt(args[args.indexOf('--chunk-size') + 1]) || 5,
  delay: parseInt(args[args.indexOf('--delay') + 1]) || 2000
};

const autoSync = new GoogleDriveAutoSync(options);

if (args.includes('--setup-cron')) {
  autoSync.setupCronJob();
} else {
  autoSync.runSync().catch(error => {
    console.error('❌ Auto-sync failed:', error.message);
    process.exit(1);
  });
}
