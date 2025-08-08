#!/usr/bin/env node

/**
 * Multi-Source Data Importer for Weaviate
 * Handles Obsidian vaults, Google Docs, ChatGPT conversations, and more
 */

import https from 'https';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class MultiSourceImporter {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.chunkSize = options.chunkSize || 10;
    this.delay = options.delay || 1000;
    this.verbose = options.verbose || false;
    this.stats = {
      obsidian: { processed: 0, uploaded: 0, errors: 0 },
      googleDocs: { processed: 0, uploaded: 0, errors: 0 },
      chatgpt: { processed: 0, uploaded: 0, errors: 0 },
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

  sanitizeFilename(filename) {
    return filename
      .replace(/[^a-zA-Z0-9\-_\.]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();
  }

  extractMetadata(content, source) {
    const metadata = {
      word_count: content.split(/\s+/).length,
      char_count: content.length,
      source_type: source,
      has_links: /\[.*?\]\(.*?\)/.test(content),
      has_code: /```/.test(content) || /`[^`]+`/.test(content),
      has_tables: /\|.*\|/.test(content),
      created_at: new Date().toISOString()
    };

    // Extract tags from content
    const tagMatches = content.match(/#[\w-]+/g);
    if (tagMatches) {
      metadata.tags = [...new Set(tagMatches.map(tag => tag.slice(1)))];
    }

    // Extract dates
    const dateMatches = content.match(/\d{4}-\d{2}-\d{2}/g);
    if (dateMatches) {
      metadata.dates_mentioned = [...new Set(dateMatches)];
    }

    return metadata;
  }

  async importObsidianVault(vaultPath) {
    console.log('📝 Importing Obsidian Vault...\n');
    
    try {
      const stats = await fs.stat(vaultPath);
      if (!stats.isDirectory()) {
        throw new Error('Obsidian vault path must be a directory');
      }

      const files = await this.findMarkdownFiles(vaultPath);
      console.log(`📁 Found ${files.length} markdown files in Obsidian vault`);

      const chunks = this.chunkArray(files, this.chunkSize);
      
      for (let i = 0; i < chunks.length; i++) {
        console.log(`\n📦 Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} files)...`);
        
        for (const filePath of chunks[i]) {
          try {
            await this.processObsidianFile(filePath, vaultPath);
            this.stats.obsidian.processed++;
            this.stats.total.processed++;
          } catch (error) {
            console.log(`   ❌ Error processing ${path.basename(filePath)}: ${error.message}`);
            this.stats.obsidian.errors++;
            this.stats.total.errors++;
          }
        }
        
        if (i < chunks.length - 1) {
          console.log(`   ⏳ Waiting ${this.delay}ms before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, this.delay));
        }
      }

      console.log(`\n✅ Obsidian import complete: ${this.stats.obsidian.processed} processed, ${this.stats.obsidian.uploaded} uploaded`);
      
    } catch (error) {
      console.log(`❌ Obsidian import failed: ${error.message}`);
      throw error;
    }
  }

  async findMarkdownFiles(dir) {
    const files = [];
    
    async function scan(currentDir) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await scan(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    }
    
    await scan(dir);
    return files;
  }

  async processObsidianFile(filePath, vaultPath) {
    const content = await fs.readFile(filePath, 'utf8');
    const relativePath = path.relative(vaultPath, filePath);
    const fileName = path.basename(filePath, '.md');
    
    // Extract frontmatter if present
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    let frontmatter = {};
    let mainContent = content;
    
    if (frontmatterMatch) {
      try {
        frontmatter = this.parseFrontmatter(frontmatterMatch[1]);
        mainContent = content.slice(frontmatterMatch[0].length);
      } catch (error) {
        // Ignore frontmatter parsing errors
      }
    }

    const metadata = this.extractMetadata(mainContent, 'obsidian');
    
    const document = {
      title: frontmatter.title || fileName,
      content: mainContent,
      file_name: fileName,
      source: `obsidian:${relativePath}`,
      file_type: 'markdown',
      metadata: {
        ...metadata,
        ...frontmatter,
        vault_path: relativePath,
        folder: path.dirname(relativePath)
      }
    };

    if (!this.dryRun) {
      await this.uploadToWeaviate(document, 'Documents');
      this.stats.obsidian.uploaded++;
      this.stats.total.uploaded++;
    }

    if (this.verbose) {
      console.log(`   ✅ ${fileName} (${metadata.word_count} words)`);
    } else {
      console.log(`   ✅ ${fileName}`);
    }
  }

  parseFrontmatter(frontmatterText) {
    const lines = frontmatterText.split('\n');
    const result = {};
    
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        // Try to parse as JSON, otherwise keep as string
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value.replace(/^["']|["']$/g, '');
        }
      }
    }
    
    return result;
  }

  async importChatGPTConversations(jsonFilePath) {
    console.log('💬 Importing ChatGPT Conversations...\n');
    
    try {
      const jsonContent = await fs.readFile(jsonFilePath, 'utf8');
      const conversations = JSON.parse(jsonContent);
      
      console.log(`📁 Found ${conversations.length} conversations in JSON file`);

      const chunks = this.chunkArray(conversations, this.chunkSize);
      
      for (let i = 0; i < chunks.length; i++) {
        console.log(`\n📦 Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} conversations)...`);
        
        for (const conversation of chunks[i]) {
          try {
            await this.processChatGPTConversation(conversation);
            this.stats.chatgpt.processed++;
            this.stats.total.processed++;
          } catch (error) {
            console.log(`   ❌ Error processing conversation: ${error.message}`);
            this.stats.chatgpt.errors++;
            this.stats.total.errors++;
          }
        }
        
        if (i < chunks.length - 1) {
          console.log(`   ⏳ Waiting ${this.delay}ms before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, this.delay));
        }
      }

      console.log(`\n✅ ChatGPT import complete: ${this.stats.chatgpt.processed} processed, ${this.stats.chatgpt.uploaded} uploaded`);
      
    } catch (error) {
      console.log(`❌ ChatGPT import failed: ${error.message}`);
      throw error;
    }
  }

  async processChatGPTConversation(conversation) {
    const conversationId = conversation.id || 'unknown';
    const title = conversation.title || `Conversation ${conversationId}`;
    const createTime = conversation.create_time ? new Date(conversation.create_time * 1000).toISOString() : new Date().toISOString();
    
    // Extract messages
    const messages = [];
    if (conversation.mapping) {
      for (const [messageId, messageData] of Object.entries(conversation.mapping)) {
        if (messageData.message && messageData.message.content) {
          const content = messageData.message.content;
          if (content.parts && content.parts.length > 0) {
            messages.push({
              id: messageId,
              role: content.author?.role || 'unknown',
              content: content.parts.join('\n'),
              create_time: messageData.message.create_time ? new Date(messageData.message.create_time * 1000).toISOString() : createTime
            });
          }
        }
      }
    }

    // Create conversation text
    const conversationText = messages.map(msg => 
      `**${msg.role.toUpperCase()}**: ${msg.content}`
    ).join('\n\n');

    const metadata = this.extractMetadata(conversationText, 'chatgpt');
    
    const document = {
      title: title,
      content: conversationText,
      file_name: `chatgpt_${conversationId}`,
      source: `chatgpt:${conversationId}`,
      file_type: 'conversation',
      metadata: {
        ...metadata,
        conversation_id: conversationId,
        message_count: messages.length,
        create_time: createTime,
        update_time: conversation.update_time ? new Date(conversation.update_time * 1000).toISOString() : createTime,
        participants: [...new Set(messages.map(m => m.role))]
      }
    };

    if (!this.dryRun) {
      await this.uploadToWeaviate(document, 'Documents');
      this.stats.chatgpt.uploaded++;
      this.stats.total.uploaded++;
    }

    if (this.verbose) {
      console.log(`   ✅ ${title} (${messages.length} messages, ${metadata.word_count} words)`);
    } else {
      console.log(`   ✅ ${title}`);
    }
  }

  async importGoogleDocsFolder(folderPath) {
    console.log('📄 Importing Google Docs...\n');
    
    try {
      const files = await this.findDocFiles(folderPath);
      console.log(`📁 Found ${files.length} document files`);

      const chunks = this.chunkArray(files, this.chunkSize);
      
      for (let i = 0; i < chunks.length; i++) {
        console.log(`\n📦 Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} files)...`);
        
        for (const filePath of chunks[i]) {
          try {
            await this.processGoogleDocFile(filePath, folderPath);
            this.stats.googleDocs.processed++;
            this.stats.total.processed++;
          } catch (error) {
            console.log(`   ❌ Error processing ${path.basename(filePath)}: ${error.message}`);
            this.stats.googleDocs.errors++;
            this.stats.total.errors++;
          }
        }
        
        if (i < chunks.length - 1) {
          console.log(`   ⏳ Waiting ${this.delay}ms before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, this.delay));
        }
      }

      console.log(`\n✅ Google Docs import complete: ${this.stats.googleDocs.processed} processed, ${this.stats.googleDocs.uploaded} uploaded`);
      
    } catch (error) {
      console.log(`❌ Google Docs import failed: ${error.message}`);
      throw error;
    }
  }

  async findDocFiles(dir) {
    const files = [];
    const docExtensions = ['.txt', '.md', '.docx', '.pdf', '.html', '.rtf'];
    
    async function scan(currentDir) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (docExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    }
    
    await scan(dir);
    return files;
  }

  async processGoogleDocFile(filePath, basePath) {
    const content = await fs.readFile(filePath, 'utf8');
    const relativePath = path.relative(basePath, filePath);
    const fileName = path.basename(filePath, path.extname(filePath));
    const fileType = path.extname(filePath).slice(1);
    
    const metadata = this.extractMetadata(content, 'google_docs');
    
    const document = {
      title: fileName,
      content: content,
      file_name: fileName,
      source: `google_docs:${relativePath}`,
      file_type: fileType,
      metadata: {
        ...metadata,
        file_path: relativePath,
        folder: path.dirname(relativePath)
      }
    };

    if (!this.dryRun) {
      await this.uploadToWeaviate(document, 'Documents');
      this.stats.googleDocs.uploaded++;
      this.stats.total.uploaded++;
    }

    if (this.verbose) {
      console.log(`   ✅ ${fileName} (${fileType}, ${metadata.word_count} words)`);
    } else {
      console.log(`   ✅ ${fileName}`);
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

  async generateImportReport() {
    const report = {
      timestamp: new Date().toISOString(),
      dry_run: this.dryRun,
      settings: {
        chunk_size: this.chunkSize,
        delay: this.delay
      },
      stats: this.stats
    };

    await fs.writeFile('./import-report.json', JSON.stringify(report, null, 2));
    
    console.log('\n📊 === IMPORT SUMMARY ===\n');
    console.log(`📝 Obsidian: ${this.stats.obsidian.processed} processed, ${this.stats.obsidian.uploaded} uploaded, ${this.stats.obsidian.errors} errors`);
    console.log(`💬 ChatGPT: ${this.stats.chatgpt.processed} processed, ${this.stats.chatgpt.uploaded} uploaded, ${this.stats.chatgpt.errors} errors`);
    console.log(`📄 Google Docs: ${this.stats.googleDocs.processed} processed, ${this.stats.googleDocs.uploaded} uploaded, ${this.stats.googleDocs.errors} errors`);
    console.log(`\n🎯 Total: ${this.stats.total.processed} processed, ${this.stats.total.uploaded} uploaded, ${this.stats.total.errors} errors`);
    console.log('\n💾 Full report saved to import-report.json');
    
    return report;
  }

  async run(sources) {
    console.log('📥 Multi-Source Data Importer\n');
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - No data will be uploaded\n');
    }

    try {
      for (const source of sources) {
        switch (source.type) {
          case 'obsidian':
            await this.importObsidianVault(source.path);
            break;
          case 'chatgpt':
            await this.importChatGPTConversations(source.path);
            break;
          case 'google-docs':
            await this.importGoogleDocsFolder(source.path);
            break;
          default:
            console.log(`⚠️  Unknown source type: ${source.type}`);
        }
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

      console.log('\n🎉 Multi-source import complete!');
      
    } catch (error) {
      console.error('❌ Import failed:', error.message);
      await this.generateImportReport();
    }
  }
}

// CLI handling
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
📥 Multi-Source Data Importer

Import data from multiple sources into Weaviate with automatic tagging and organization.

Usage:
  node multi-source-importer.js [options]

Options:
  --obsidian <path>      Import Obsidian vault from path
  --chatgpt <path>       Import ChatGPT conversations from JSON file
  --google-docs <path>   Import Google Docs from folder path
  --chunk-size <n>       Process in chunks of n items (default: 10)
  --delay <ms>           Delay between chunks in milliseconds (default: 1000)
  --dry-run              Preview what would be imported without uploading
  --verbose              Show detailed progress information
  --help                 Show this help

Examples:
  # Import Obsidian vault
  node multi-source-importer.js --obsidian /path/to/vault --dry-run

  # Import ChatGPT conversations
  node multi-source-importer.js --chatgpt /path/to/conversations.json

  # Import multiple sources
  node multi-source-importer.js --obsidian /path/to/vault --chatgpt /path/to/conversations.json --google-docs /path/to/docs

  # Custom settings
  node multi-source-importer.js --obsidian /path/to/vault --chunk-size 5 --delay 2000

Features:
  • Automatic metadata extraction
  • Frontmatter parsing for Obsidian
  • Conversation structure preservation for ChatGPT
  • Multiple document format support
  • Chunked processing for large datasets
  • Automatic tagging integration
  • Comprehensive error handling and reporting
  `);
  process.exit(0);
}

const options = {
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  chunkSize: parseInt(args[args.indexOf('--chunk-size') + 1]) || 10,
  delay: parseInt(args[args.indexOf('--delay') + 1]) || 1000
};

const sources = [];

// Parse source arguments
if (args.includes('--obsidian')) {
  const pathIndex = args.indexOf('--obsidian') + 1;
  if (pathIndex < args.length && !args[pathIndex].startsWith('--')) {
    sources.push({ type: 'obsidian', path: args[pathIndex] });
  }
}

if (args.includes('--chatgpt')) {
  const pathIndex = args.indexOf('--chatgpt') + 1;
  if (pathIndex < args.length && !args[pathIndex].startsWith('--')) {
    sources.push({ type: 'chatgpt', path: args[pathIndex] });
  }
}

if (args.includes('--google-docs')) {
  const pathIndex = args.indexOf('--google-docs') + 1;
  if (pathIndex < args.length && !args[pathIndex].startsWith('--')) {
    sources.push({ type: 'google-docs', path: args[pathIndex] });
  }
}

if (sources.length === 0) {
  console.log('❌ No sources specified. Use --help for usage information.');
  process.exit(1);
}

const importer = new MultiSourceImporter(options);
importer.run(sources);
