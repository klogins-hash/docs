#!/usr/bin/env node

/**
 * Chunked Weaviate to Mintlify Sync
 * Processes large datasets in manageable chunks with progress tracking
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

class ChunkedWeaviateSync {
  constructor(options = {}) {
    this.docsPath = process.cwd();
    this.chunkSize = options.chunkSize || 5; // Process 5 items at a time
    this.delayBetweenChunks = options.delay || 1000; // 1 second delay between chunks
    this.progressFile = path.join(this.docsPath, '.sync-progress.json');
    this.maxRetries = 3;
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

  async getProgress() {
    try {
      const progressData = await fs.readFile(this.progressFile, 'utf8');
      return JSON.parse(progressData);
    } catch {
      return {
        documentsProcessed: 0,
        weaviateUploadsProcessed: 0,
        totalProcessed: 0,
        lastProcessedId: null,
        startTime: new Date().toISOString(),
        errors: []
      };
    }
  }

  async saveProgress(progress) {
    await fs.writeFile(this.progressFile, JSON.stringify(progress, null, 2));
  }

  async queryDocumentsChunk(offset = 0, limit = 5) {
    console.log(`📊 Querying Documents chunk (offset: ${offset}, limit: ${limit})...`);
    
    const query = {
      query: `{
        Get {
          Documents(limit: ${limit}, offset: ${offset}) {
            content
            file_name
            file_type
            zip_file_name
            upload_date
            file_path
            _additional {
              id
              lastUpdateTimeUnix
            }
          }
        }
      }`
    };

    const response = await this.makeRequest('/v1/graphql', 'POST', query);
    
    if (response.status === 200 && response.data.data) {
      return response.data.data.Get.Documents || [];
    }
    
    throw new Error(`Query failed: ${JSON.stringify(response.data)}`);
  }

  async queryWeaviateUploadChunk(offset = 0, limit = 5) {
    console.log(`📊 Querying WeaviateUpload chunk (offset: ${offset}, limit: ${limit})...`);
    
    const query = {
      query: `{
        Get {
          WeaviateUpload(limit: ${limit}, offset: ${offset}) {
            title
            text
            description
            docAuthor
            docSource
            published
            url
            chunkSource
            wordCount
            token_count_estimate
            _additional {
              id
              lastUpdateTimeUnix
            }
          }
        }
      }`
    };

    const response = await this.makeRequest('/v1/graphql', 'POST', query);
    
    if (response.status === 200 && response.data.data) {
      return response.data.data.Get.WeaviateUpload || [];
    }
    
    throw new Error(`Query failed: ${JSON.stringify(response.data)}`);
  }

  async getTotalCounts() {
    console.log('📊 Getting total document counts...');
    
    const documentsQuery = {
      query: `{
        Aggregate {
          Documents {
            meta {
              count
            }
          }
        }
      }`
    };

    const uploadsQuery = {
      query: `{
        Aggregate {
          WeaviateUpload {
            meta {
              count
            }
          }
        }
      }`
    };

    try {
      const [docsResponse, uploadsResponse] = await Promise.all([
        this.makeRequest('/v1/graphql', 'POST', documentsQuery),
        this.makeRequest('/v1/graphql', 'POST', uploadsQuery)
      ]);

      const docsCount = docsResponse.data?.data?.Aggregate?.Documents?.[0]?.meta?.count || 0;
      const uploadsCount = uploadsResponse.data?.data?.Aggregate?.WeaviateUpload?.[0]?.meta?.count || 0;

      console.log(`📈 Total counts: ${docsCount} Documents, ${uploadsCount} WeaviateUploads`);
      return { documents: docsCount, uploads: uploadsCount };
    } catch (error) {
      console.log('⚠️  Could not get exact counts, will process until no more data');
      return { documents: -1, uploads: -1 }; // Unknown count
    }
  }

  generateMDXFromDocument(item) {
    const category = this.extractCategory(item.file_name, item.zip_file_name);
    const title = this.extractTitle(item.file_name, item.content);
    
    const frontmatter = {
      title: title,
      description: `Document from ${item.zip_file_name || 'Weaviate'}`,
      file_name: item.file_name || '',
      file_type: item.file_type || '',
      upload_date: item.upload_date || '',
      category: category,
      weaviate_id: item._additional?.id || ''
    };

    const yamlFrontmatter = Object.entries(frontmatter)
      .filter(([key, value]) => value)
      .map(([key, value]) => `${key}: "${value}"`)
      .join('\n');

    return `---
${yamlFrontmatter}
---

${item.content || 'No content available.'}

<Note>
**Source**: ${item.zip_file_name || 'Unknown'}  
**File**: ${item.file_name || 'Unknown'}  
**Type**: ${item.file_type || 'Unknown'}  
**Uploaded**: ${item.upload_date || 'Unknown'}  
**Synced**: ${new Date().toISOString()}
</Note>
`;
  }

  generateMDXFromWeaviateUpload(item) {
    const category = this.extractCategoryFromSource(item.docSource, item.chunkSource);
    const title = item.title || 'Untitled Document';
    
    const frontmatter = {
      title: title,
      description: item.description || `Document from ${item.docSource}`,
      doc_author: item.docAuthor || '',
      doc_source: item.docSource || '',
      published: item.published || '',
      word_count: item.wordCount || 0,
      category: category,
      weaviate_id: item._additional?.id || ''
    };

    const yamlFrontmatter = Object.entries(frontmatter)
      .filter(([key, value]) => value !== '' && value !== 0)
      .map(([key, value]) => `${key}: "${value}"`)
      .join('\n');

    let cleanContent = item.text || 'No content available.';
    cleanContent = cleanContent.replace(/<document_metadata>[\s\S]*?<\/document_metadata>/g, '');
    cleanContent = cleanContent.trim();

    return `---
${yamlFrontmatter}
---

# ${title}

${cleanContent}

<Note>
**Author**: ${item.docAuthor || 'Unknown'}  
**Source**: ${item.docSource || 'Unknown'}  
**Published**: ${item.published || 'Unknown'}  
**Word Count**: ${item.wordCount || 0}  
**Synced**: ${new Date().toISOString()}
</Note>

${item.url ? `<Info>\n**Original Location**: [View Document](${item.url})\n</Info>` : ''}
`;
  }

  extractTitle(fileName, content) {
    if (fileName && fileName !== 'undefined') {
      return fileName.replace(/\.(md|txt|pdf)$/i, '').replace(/[_-]/g, ' ');
    }
    
    const lines = (content || '').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        return trimmed.substring(2).trim();
      }
    }
    
    return 'Untitled Document';
  }

  extractCategory(fileName, zipFileName) {
    if (zipFileName && zipFileName.includes('conversation_archive')) return 'conversations';
    if (fileName) {
      if (fileName.includes('ghl') || fileName.includes('gohighlevel')) return 'gohighlevel';
      if (fileName.includes('hormozi') || fileName.includes('acquisition')) return 'business';
      if (fileName.includes('sandbox') || fileName.includes('test')) return 'testing';
    }
    return 'general';
  }

  extractCategoryFromSource(docSource, chunkSource) {
    if (docSource && docSource.includes('Obsidian')) return 'obsidian';
    if (chunkSource && chunkSource.includes('Nexus AI')) return 'ai-chat';
    return 'documents';
  }

  sanitizeFilename(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }

  async writeContentFile(item, content, category) {
    const title = item.title || this.extractTitle(item.file_name, item.content);
    const filename = this.sanitizeFilename(title) + '.mdx';
    const dirPath = path.join(this.docsPath, 'internal-docs', category);
    
    await fs.mkdir(dirPath, { recursive: true });
    
    const filePath = path.join(dirPath, filename);
    await fs.writeFile(filePath, content);
    
    return { filePath, category, filename: filename.replace('.mdx', ''), title };
  }

  async processChunk(items, type, progress) {
    const processedFiles = [];
    
    for (const item of items) {
      try {
        let content, category;
        
        if (type === 'documents') {
          category = this.extractCategory(item.file_name, item.zip_file_name);
          content = this.generateMDXFromDocument(item);
        } else {
          category = this.extractCategoryFromSource(item.docSource, item.chunkSource);
          content = this.generateMDXFromWeaviateUpload(item);
        }
        
        const fileInfo = await this.writeContentFile(item, content, category);
        processedFiles.push(fileInfo);
        
        console.log(`📝 ✅ ${fileInfo.title}`);
        
        // Update progress
        progress.totalProcessed++;
        progress.lastProcessedId = item._additional?.id;
        
        if (type === 'documents') {
          progress.documentsProcessed++;
        } else {
          progress.weaviateUploadsProcessed++;
        }
        
      } catch (error) {
        console.log(`❌ Failed to process item: ${error.message}`);
        progress.errors.push({
          id: item._additional?.id,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    return processedFiles;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async syncWithChunks() {
    console.log('🔄 Starting chunked sync of your Weaviate data...\n');
    console.log(`⚙️  Chunk size: ${this.chunkSize} items`);
    console.log(`⏱️  Delay between chunks: ${this.delayBetweenChunks}ms\n`);
    
    const progress = await this.getProgress();
    const totals = await this.getTotalCounts();
    const allProcessedFiles = [];
    
    try {
      // Process Documents in chunks
      console.log('\n📄 Processing Documents class...');
      let documentsOffset = progress.documentsProcessed;
      let hasMoreDocuments = true;
      
      while (hasMoreDocuments) {
        const chunk = await this.queryDocumentsChunk(documentsOffset, this.chunkSize);
        
        if (chunk.length === 0) {
          hasMoreDocuments = false;
          console.log('✅ No more documents to process');
          break;
        }
        
        console.log(`\n📦 Processing Documents chunk ${Math.floor(documentsOffset / this.chunkSize) + 1} (${chunk.length} items):`);
        const processedFiles = await this.processChunk(chunk, 'documents', progress);
        allProcessedFiles.push(...processedFiles);
        
        documentsOffset += this.chunkSize;
        await this.saveProgress(progress);
        
        if (chunk.length < this.chunkSize) {
          hasMoreDocuments = false;
          console.log('✅ Reached end of Documents');
        } else {
          console.log(`⏳ Waiting ${this.delayBetweenChunks}ms before next chunk...`);
          await this.delay(this.delayBetweenChunks);
        }
      }
      
      // Process WeaviateUpload in chunks
      console.log('\n📄 Processing WeaviateUpload class...');
      let uploadsOffset = progress.weaviateUploadsProcessed;
      let hasMoreUploads = true;
      
      while (hasMoreUploads) {
        const chunk = await this.queryWeaviateUploadChunk(uploadsOffset, this.chunkSize);
        
        if (chunk.length === 0) {
          hasMoreUploads = false;
          console.log('✅ No more uploads to process');
          break;
        }
        
        console.log(`\n📦 Processing WeaviateUpload chunk ${Math.floor(uploadsOffset / this.chunkSize) + 1} (${chunk.length} items):`);
        const processedFiles = await this.processChunk(chunk, 'uploads', progress);
        allProcessedFiles.push(...processedFiles);
        
        uploadsOffset += this.chunkSize;
        await this.saveProgress(progress);
        
        if (chunk.length < this.chunkSize) {
          hasMoreUploads = false;
          console.log('✅ Reached end of WeaviateUpload');
        } else {
          console.log(`⏳ Waiting ${this.delayBetweenChunks}ms before next chunk...`);
          await this.delay(this.delayBetweenChunks);
        }
      }
      
      // Update navigation and commit
      if (allProcessedFiles.length > 0) {
        console.log('\n🔧 Updating navigation...');
        await this.updateDocsConfig(allProcessedFiles);
        
        console.log('📤 Committing changes...');
        await this.commitAndPush(`Chunked sync: ${allProcessedFiles.length} documents from Weaviate`);
      }
      
      // Final summary
      console.log('\n🎉 Chunked sync completed successfully!');
      console.log(`✅ Total processed: ${progress.totalProcessed} documents`);
      console.log(`📊 Documents: ${progress.documentsProcessed}, Uploads: ${progress.weaviateUploadsProcessed}`);
      console.log(`📁 Categories: ${[...new Set(allProcessedFiles.map(f => f.category))].join(', ')}`);
      
      if (progress.errors.length > 0) {
        console.log(`⚠️  Errors encountered: ${progress.errors.length}`);
      }
      
      // Clean up progress file on successful completion
      await fs.unlink(this.progressFile).catch(() => {});
      
    } catch (error) {
      console.error('❌ Chunked sync failed:', error.message);
      await this.saveProgress(progress);
      console.log(`💾 Progress saved. Resume with: node sync-chunked-weaviate.js --resume`);
    }
  }

  async updateDocsConfig(newFiles) {
    const configPath = path.join(this.docsPath, 'docs.json');
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    // Remove existing Internal Docs tab
    config.navigation.tabs = config.navigation.tabs.filter(tab => tab.tab !== 'Internal Docs');
    
    // Group files by category
    const groups = {};
    newFiles.forEach(file => {
      if (!groups[file.category]) {
        groups[file.category] = [];
      }
      groups[file.category].push(`internal-docs/${file.category}/${file.filename}`);
    });

    // Add Internal Docs tab
    config.navigation.tabs.push({
      tab: 'Internal Docs',
      groups: Object.entries(groups).map(([category, pages]) => ({
        group: category.charAt(0).toUpperCase() + category.slice(1).replace('-', ' '),
        pages
      }))
    });

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  async commitAndPush(message) {
    try {
      execSync('git add .', { cwd: this.docsPath });
      execSync(`git commit -m "${message}"`, { cwd: this.docsPath });
      execSync('git push', { cwd: this.docsPath });
      console.log('✅ Changes pushed to repository');
    } catch (error) {
      console.log('⚠️  Git operation skipped');
    }
  }
}

// CLI usage
const args = process.argv.slice(2);
const chunkSize = parseInt(args.find(arg => arg.startsWith('--chunk-size='))?.split('=')[1]) || 5;
const delay = parseInt(args.find(arg => arg.startsWith('--delay='))?.split('=')[1]) || 1000;

const syncer = new ChunkedWeaviateSync({ chunkSize, delay });

if (args.includes('--help')) {
  console.log(`
Chunked Weaviate Sync Usage:
  node sync-chunked-weaviate.js                    # Default: 5 items per chunk, 1s delay
  node sync-chunked-weaviate.js --chunk-size=10    # Custom chunk size
  node sync-chunked-weaviate.js --delay=2000       # Custom delay (ms)
  node sync-chunked-weaviate.js --help             # Show this help
  `);
} else {
  syncer.syncWithChunks();
}
