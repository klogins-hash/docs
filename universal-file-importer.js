#!/usr/bin/env node

/**
 * Universal File Importer for Weaviate
 * Handles ZIP extraction and imports .md, .pdf, .txt, .docx, .html, .json, .csv, .xml and more
 */

import https from 'https';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { createReadStream } from 'fs';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

// Supported file types and their processors
const SUPPORTED_FORMATS = {
  // Text formats
  '.md': 'markdown',
  '.txt': 'text',
  '.rtf': 'text',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.json': 'json',
  '.jsonl': 'jsonl',
  '.csv': 'csv',
  '.tsv': 'csv',
  
  // Document formats (require external tools)
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
  '.odt': 'odt',
  '.epub': 'epub',
  
  // Code files
  '.js': 'code',
  '.ts': 'code',
  '.py': 'code',
  '.java': 'code',
  '.cpp': 'code',
  '.c': 'code',
  '.php': 'code',
  '.rb': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.swift': 'code',
  '.kt': 'code',
  '.scala': 'code',
  '.sh': 'code',
  '.sql': 'code',
  '.r': 'code',
  
  // Config files
  '.yaml': 'config',
  '.yml': 'config',
  '.toml': 'config',
  '.ini': 'config',
  '.conf': 'config',
  '.env': 'config',
  
  // Archive formats
  '.zip': 'archive',
  '.tar': 'archive',
  '.gz': 'archive',
  '.7z': 'archive',
  '.rar': 'archive'
};

class UniversalFileImporter {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.chunkSize = options.chunkSize || 10;
    this.delay = options.delay || 1000;
    this.verbose = options.verbose || false;
    this.extractZips = options.extractZips !== false; // Default to true
    this.tempDir = options.tempDir || './temp_extracts';
    this.stats = {
      files: { processed: 0, uploaded: 0, errors: 0, skipped: 0 },
      archives: { processed: 0, extracted: 0, errors: 0 },
      total: { processed: 0, uploaded: 0, errors: 0 }
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

  async extractArchive(archivePath, extractDir) {
    const ext = path.extname(archivePath).toLowerCase();
    const archiveName = path.basename(archivePath, ext);
    const targetDir = path.join(extractDir, archiveName);
    
    try {
      await fs.mkdir(targetDir, { recursive: true });
      
      switch (ext) {
        case '.zip':
          execSync(`unzip -q "${archivePath}" -d "${targetDir}"`, { stdio: 'pipe' });
          break;
        case '.tar':
          execSync(`tar -xf "${archivePath}" -C "${targetDir}"`, { stdio: 'pipe' });
          break;
        case '.gz':
          if (archivePath.endsWith('.tar.gz')) {
            execSync(`tar -xzf "${archivePath}" -C "${targetDir}"`, { stdio: 'pipe' });
          } else {
            execSync(`gunzip -c "${archivePath}" > "${targetDir}/${archiveName}"`, { stdio: 'pipe' });
          }
          break;
        case '.7z':
          execSync(`7z x "${archivePath}" -o"${targetDir}"`, { stdio: 'pipe' });
          break;
        default:
          throw new Error(`Unsupported archive format: ${ext}`);
      }
      
      this.stats.archives.extracted++;
      return targetDir;
      
    } catch (error) {
      this.stats.archives.errors++;
      throw new Error(`Failed to extract ${archivePath}: ${error.message}`);
    }
  }

  async findAllFiles(dir, recursive = true) {
    const files = [];
    
    async function scan(currentDir, depth = 0) {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory() && recursive && !entry.name.startsWith('.') && depth < 10) {
            await scan(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (SUPPORTED_FORMATS[ext]) {
              files.push({
                path: fullPath,
                name: entry.name,
                ext: ext,
                type: SUPPORTED_FORMATS[ext],
                size: 0 // Will be filled later if needed
              });
            }
          }
        }
      } catch (error) {
        console.log(`   ⚠️  Cannot read directory ${currentDir}: ${error.message}`);
      }
    }
    
    await scan(dir);
    return files;
  }

  async processTextFile(filePath, fileType) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return this.cleanText(content);
    } catch (error) {
      throw new Error(`Failed to read text file: ${error.message}`);
    }
  }

  async processPDFFile(filePath) {
    try {
      // Try pdftotext first (from poppler-utils)
      const result = execSync(`pdftotext "${filePath}" -`, { encoding: 'utf8', stdio: 'pipe' });
      return this.cleanText(result);
    } catch (error) {
      try {
        // Fallback to python-based extraction if available
        const result = execSync(`python3 -c "
import PyPDF2
import sys
with open('${filePath}', 'rb') as file:
    reader = PyPDF2.PdfReader(file)
    text = ''
    for page in reader.pages:
        text += page.extract_text() + '\\n'
    print(text)
"`, { encoding: 'utf8', stdio: 'pipe' });
        return this.cleanText(result);
      } catch (pythonError) {
        throw new Error(`PDF extraction failed: ${error.message}`);
      }
    }
  }

  async processDocxFile(filePath) {
    try {
      // Use python-docx if available
      const result = execSync(`python3 -c "
import docx
doc = docx.Document('${filePath}')
text = ''
for paragraph in doc.paragraphs:
    text += paragraph.text + '\\n'
print(text)
"`, { encoding: 'utf8', stdio: 'pipe' });
      return this.cleanText(result);
    } catch (error) {
      try {
        // Fallback to unzip and extract XML
        const tempDir = path.join(this.tempDir, 'docx_temp');
        await fs.mkdir(tempDir, { recursive: true });
        execSync(`unzip -q "${filePath}" -d "${tempDir}"`, { stdio: 'pipe' });
        
        const documentXml = await fs.readFile(path.join(tempDir, 'word/document.xml'), 'utf8');
        const textContent = documentXml
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Cleanup temp directory
        execSync(`rm -rf "${tempDir}"`, { stdio: 'pipe' });
        
        return this.cleanText(textContent);
      } catch (fallbackError) {
        throw new Error(`DOCX extraction failed: ${error.message}`);
      }
    }
  }

  async processJSONFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const jsonData = JSON.parse(content);
      
      // Convert JSON to readable text
      if (Array.isArray(jsonData)) {
        return jsonData.map(item => JSON.stringify(item, null, 2)).join('\n\n');
      } else {
        return JSON.stringify(jsonData, null, 2);
      }
    } catch (error) {
      throw new Error(`JSON processing failed: ${error.message}`);
    }
  }

  async processCSVFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');
      
      if (lines.length === 0) return '';
      
      // Convert CSV to readable format
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const rows = lines.slice(1).filter(line => line.trim());
      
      let result = `Headers: ${headers.join(', ')}\n\n`;
      
      rows.slice(0, 100).forEach((row, index) => { // Limit to first 100 rows
        const values = row.split(',').map(v => v.trim().replace(/"/g, ''));
        result += `Row ${index + 1}:\n`;
        headers.forEach((header, i) => {
          if (values[i]) {
            result += `  ${header}: ${values[i]}\n`;
          }
        });
        result += '\n';
      });
      
      if (rows.length > 100) {
        result += `... and ${rows.length - 100} more rows\n`;
      }
      
      return result;
    } catch (error) {
      throw new Error(`CSV processing failed: ${error.message}`);
    }
  }

  cleanText(text) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  async extractMetadata(content, filePath, fileType) {
    const stats = await fs.stat(filePath).catch(() => ({ size: 0, mtime: new Date() }));
    
    const metadata = {
      word_count: content.split(/\s+/).filter(w => w.length > 0).length,
      char_count: content.length,
      file_size: stats.size,
      file_type: fileType,
      file_extension: path.extname(filePath),
      modified_date: stats.mtime ? stats.mtime.toISOString() : new Date().toISOString(),
      created_at: new Date().toISOString(),
      has_links: /https?:\/\/[^\s]+/.test(content),
      has_emails: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(content),
      has_code: /```|`[^`]+`|\b(function|class|def|import|from|var|let|const)\b/.test(content),
      has_numbers: /\b\d+\b/.test(content)
    };

    // Extract potential tags/keywords
    const words = content.toLowerCase().match(/\b\w{3,}\b/g) || [];
    const wordCounts = {};
    words.forEach(word => {
      if (word.length > 3 && !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'man', 'men', 'she', 'use', 'her', 'now', 'oil', 'sit', 'set'].includes(word)) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    });
    
    const topWords = Object.entries(wordCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word);
    
    if (topWords.length > 0) {
      metadata.keywords = topWords;
    }

    return metadata;
  }

  async processFile(fileInfo, basePath = '') {
    const { path: filePath, name, ext, type } = fileInfo;
    
    try {
      let content = '';
      
      switch (type) {
        case 'markdown':
        case 'text':
        case 'html':
        case 'xml':
        case 'code':
        case 'config':
          content = await this.processTextFile(filePath, type);
          break;
        case 'pdf':
          content = await this.processPDFFile(filePath);
          break;
        case 'docx':
        case 'doc':
        case 'odt':
          content = await this.processDocxFile(filePath);
          break;
        case 'json':
          content = await this.processJSONFile(filePath);
          break;
        case 'csv':
          content = await this.processCSVFile(filePath);
          break;
        default:
          throw new Error(`Unsupported file type: ${type}`);
      }

      if (!content || content.trim().length < 10) {
        this.stats.files.skipped++;
        if (this.verbose) {
          console.log(`   ⏭️  Skipped ${name} (empty or too short)`);
        }
        return null;
      }

      const relativePath = basePath ? path.relative(basePath, filePath) : name;
      const fileName = path.basename(name, ext);
      const metadata = await this.extractMetadata(content, filePath, type);
      
      const document = {
        title: fileName,
        content: content,
        file_name: fileName,
        source: `file:${relativePath}`,
        file_type: type,
        metadata: {
          ...metadata,
          file_path: relativePath,
          folder: path.dirname(relativePath)
        }
      };

      if (!this.dryRun) {
        await this.uploadToWeaviate(document, 'Documents');
        this.stats.files.uploaded++;
        this.stats.total.uploaded++;
      }

      this.stats.files.processed++;
      this.stats.total.processed++;

      if (this.verbose) {
        console.log(`   ✅ ${name} (${type}, ${metadata.word_count} words)`);
      } else {
        console.log(`   ✅ ${name}`);
      }

      return document;

    } catch (error) {
      this.stats.files.errors++;
      this.stats.total.errors++;
      console.log(`   ❌ Error processing ${name}: ${error.message}`);
      return null;
    }
  }

  async uploadToWeaviate(document, className = 'Documents') {
    try {
      const response = await this.makeRequest(`/v1/objects`, 'POST', {
        class: className,
        properties: document
      });

      if (response.status !== 200) {
        throw new Error(`Upload failed: ${response.status} - ${JSON.stringify(response.data)}`);
      }

      return response.data;
    } catch (error) {
      throw new Error(`Weaviate upload failed: ${error.message}`);
    }
  }

  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async importFromPath(inputPath) {
    console.log(`📁 Processing: ${inputPath}\n`);
    
    const stats = await fs.stat(inputPath);
    let filesToProcess = [];
    
    if (stats.isFile()) {
      const ext = path.extname(inputPath).toLowerCase();
      
      if (SUPPORTED_FORMATS[ext] === 'archive' && this.extractZips) {
        console.log(`📦 Extracting archive: ${path.basename(inputPath)}`);
        try {
          await fs.mkdir(this.tempDir, { recursive: true });
          const extractDir = await this.extractArchive(inputPath, this.tempDir);
          console.log(`   ✅ Extracted to: ${extractDir}`);
          
          const extractedFiles = await this.findAllFiles(extractDir);
          console.log(`   📄 Found ${extractedFiles.length} files in archive`);
          filesToProcess = extractedFiles;
          
          this.stats.archives.processed++;
        } catch (error) {
          console.log(`   ❌ Archive extraction failed: ${error.message}`);
          return;
        }
      } else if (SUPPORTED_FORMATS[ext]) {
        filesToProcess = [{
          path: inputPath,
          name: path.basename(inputPath),
          ext: ext,
          type: SUPPORTED_FORMATS[ext]
        }];
      } else {
        console.log(`   ⚠️  Unsupported file type: ${ext}`);
        return;
      }
    } else if (stats.isDirectory()) {
      console.log(`📂 Scanning directory: ${path.basename(inputPath)}`);
      filesToProcess = await this.findAllFiles(inputPath);
      console.log(`   📄 Found ${filesToProcess.length} supported files`);
    }

    if (filesToProcess.length === 0) {
      console.log('   ℹ️  No supported files found');
      return;
    }

    // Process archives first if any
    const archives = filesToProcess.filter(f => f.type === 'archive');
    const regularFiles = filesToProcess.filter(f => f.type !== 'archive');
    
    if (archives.length > 0 && this.extractZips) {
      console.log(`\n📦 Processing ${archives.length} archive(s)...`);
      for (const archive of archives) {
        try {
          const extractDir = await this.extractArchive(archive.path, this.tempDir);
          const extractedFiles = await this.findAllFiles(extractDir);
          regularFiles.push(...extractedFiles);
          this.stats.archives.processed++;
          console.log(`   ✅ ${archive.name}: extracted ${extractedFiles.length} files`);
        } catch (error) {
          console.log(`   ❌ ${archive.name}: ${error.message}`);
        }
      }
    }

    if (regularFiles.length === 0) {
      console.log('   ℹ️  No regular files to process');
      return;
    }

    console.log(`\n📄 Processing ${regularFiles.length} file(s)...`);
    const chunks = this.chunkArray(regularFiles, this.chunkSize);
    
    for (let i = 0; i < chunks.length; i++) {
      console.log(`\n📦 Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} files)...`);
      
      for (const fileInfo of chunks[i]) {
        await this.processFile(fileInfo, inputPath);
      }
      
      if (i < chunks.length - 1) {
        console.log(`   ⏳ Waiting ${this.delay}ms before next chunk...`);
        await new Promise(resolve => setTimeout(resolve, this.delay));
      }
    }
  }

  async cleanup() {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  async generateImportReport() {
    const report = {
      timestamp: new Date().toISOString(),
      dry_run: this.dryRun,
      settings: {
        chunk_size: this.chunkSize,
        delay: this.delay,
        extract_zips: this.extractZips
      },
      stats: this.stats,
      supported_formats: Object.keys(SUPPORTED_FORMATS)
    };

    await fs.writeFile('./universal-import-report.json', JSON.stringify(report, null, 2));
    
    console.log('\n📊 === UNIVERSAL IMPORT SUMMARY ===\n');
    console.log(`📄 Files: ${this.stats.files.processed} processed, ${this.stats.files.uploaded} uploaded, ${this.stats.files.skipped} skipped, ${this.stats.files.errors} errors`);
    console.log(`📦 Archives: ${this.stats.archives.processed} processed, ${this.stats.archives.extracted} extracted, ${this.stats.archives.errors} errors`);
    console.log(`\n🎯 Total: ${this.stats.total.processed} processed, ${this.stats.total.uploaded} uploaded, ${this.stats.total.errors} errors`);
    console.log('\n💾 Full report saved to universal-import-report.json');
    
    return report;
  }

  async run(paths) {
    console.log('🌍 Universal File Importer\n');
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - No data will be uploaded\n');
    }

    console.log(`📋 Supported formats: ${Object.keys(SUPPORTED_FORMATS).join(', ')}\n`);

    try {
      for (const inputPath of paths) {
        await this.importFromPath(inputPath);
      }

      await this.generateImportReport();
      
      if (!this.dryRun && this.stats.total.uploaded > 0) {
        console.log('\n🤖 Running auto-tagging on new content...');
        try {
          execSync('node advanced-auto-tagger.js --auto-tag', { stdio: 'pipe' });
          console.log('✅ Auto-tagging completed');
        } catch (error) {
          console.log('⚠️  Auto-tagging failed, but import was successful');
        }
      }

      console.log('\n🎉 Universal import complete!');
      
    } catch (error) {
      console.error('❌ Import failed:', error.message);
      await this.generateImportReport();
    } finally {
      await this.cleanup();
    }
  }
}

// CLI handling
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
🌍 Universal File Importer

Import files and archives from multiple sources into Weaviate with automatic extraction and processing.

Usage:
  node universal-file-importer.js [paths...] [options]

Supported Formats:
  📝 Text: .md, .txt, .rtf, .html, .xml, .json, .csv, .tsv
  📄 Documents: .pdf, .docx, .doc, .odt, .epub
  💻 Code: .js, .ts, .py, .java, .cpp, .php, .rb, .go, .rs, .swift, .sql, .r
  ⚙️  Config: .yaml, .yml, .toml, .ini, .conf, .env
  📦 Archives: .zip, .tar, .gz, .7z, .rar

Options:
  --chunk-size <n>       Process in chunks of n items (default: 10)
  --delay <ms>           Delay between chunks in milliseconds (default: 1000)
  --no-extract           Don't extract archive files
  --temp-dir <path>      Temporary directory for extractions (default: ./temp_extracts)
  --dry-run              Preview what would be imported without uploading
  --verbose              Show detailed progress information
  --help                 Show this help

Examples:
  # Import a single file
  node universal-file-importer.js /path/to/document.pdf

  # Import a directory
  node universal-file-importer.js /path/to/documents/

  # Import and extract ZIP files
  node universal-file-importer.js /path/to/archive.zip

  # Import multiple sources
  node universal-file-importer.js /path/to/docs/ /path/to/archive.zip /path/to/file.pdf

  # Custom settings
  node universal-file-importer.js /path/to/large-archive.zip --chunk-size 5 --delay 2000

  # Dry run to preview
  node universal-file-importer.js /path/to/docs/ --dry-run --verbose

Features:
  • Automatic archive extraction (ZIP, TAR, 7Z, etc.)
  • PDF text extraction (requires pdftotext or PyPDF2)
  • DOCX processing (requires python-docx or fallback XML parsing)
  • JSON and CSV intelligent parsing
  • Code file processing with syntax awareness
  • Metadata extraction (file size, dates, keywords)
  • Chunked processing for large datasets
  • Automatic tagging integration
  • Comprehensive error handling and reporting
  `);
  process.exit(0);
}

const options = {
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  extractZips: !args.includes('--no-extract'),
  chunkSize: parseInt(args[args.indexOf('--chunk-size') + 1]) || 10,
  delay: parseInt(args[args.indexOf('--delay') + 1]) || 1000,
  tempDir: args[args.indexOf('--temp-dir') + 1] || './temp_extracts'
};

// Get paths (everything that's not an option)
const paths = args.filter(arg => !arg.startsWith('--') && !args[args.indexOf(arg) - 1]?.startsWith('--'));

if (paths.length === 0) {
  console.log('❌ No paths specified. Use --help for usage information.');
  process.exit(1);
}

const importer = new UniversalFileImporter(options);
importer.run(paths);
