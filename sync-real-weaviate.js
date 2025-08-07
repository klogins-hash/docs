#!/usr/bin/env node

/**
 * Real Weaviate to Mintlify Sync
 * Syncs your actual Weaviate data using the correct schema
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

class RealWeaviateSync {
  constructor() {
    this.docsPath = process.cwd();
    this.lastSyncFile = path.join(this.docsPath, '.last-sync');
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

  async queryDocuments() {
    console.log('📊 Querying Documents class...');
    
    const query = {
      query: `{
        Get {
          Documents(limit: 10) {
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

  async queryWeaviateUpload() {
    console.log('📊 Querying WeaviateUpload class...');
    
    const query = {
      query: `{
        Get {
          WeaviateUpload(limit: 10) {
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

  generateMDXFromDocument(item) {
    const category = this.extractCategory(item.file_name, item.zip_file_name);
    const title = this.extractTitle(item.file_name, item.content);
    
    const frontmatter = {
      title: title,
      description: `Document from ${item.zip_file_name || 'Weaviate'}`,
      file_name: item.file_name || '',
      file_type: item.file_type || '',
      upload_date: item.upload_date || '',
      category: category
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
      category: category
    };

    const yamlFrontmatter = Object.entries(frontmatter)
      .filter(([key, value]) => value !== '' && value !== 0)
      .map(([key, value]) => `${key}: "${value}"`)
      .join('\n');

    // Clean up the text content (remove document_metadata tags)
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
    
    // Try to extract title from content
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
    if (zipFileName && zipFileName.includes('conversation_archive')) {
      return 'conversations';
    }
    
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
      .substring(0, 50); // Limit length
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

  async updateDocsConfig(newFiles) {
    const configPath = path.join(this.docsPath, 'docs.json');
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    // Remove existing Internal Docs tab if it exists
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
    console.log('✅ Updated docs.json with Internal Docs navigation');
  }

  async commitAndPush(message) {
    try {
      execSync('git add .', { cwd: this.docsPath });
      execSync(`git commit -m "${message}"`, { cwd: this.docsPath });
      execSync('git push', { cwd: this.docsPath });
      console.log('✅ Changes pushed to repository');
    } catch (error) {
      console.log('⚠️  Git operation skipped (no git or no changes)');
    }
  }

  async syncAll() {
    console.log('🔄 Starting sync of your real Weaviate data...\n');
    
    try {
      const newFiles = [];
      
      // Sync Documents class
      const documents = await this.queryDocuments();
      console.log(`📄 Found ${documents.length} documents`);
      
      for (const doc of documents) {
        const category = this.extractCategory(doc.file_name, doc.zip_file_name);
        const content = this.generateMDXFromDocument(doc);
        const fileInfo = await this.writeContentFile(doc, content, category);
        newFiles.push(fileInfo);
        console.log(`📝 Created: ${fileInfo.title}`);
      }
      
      // Sync WeaviateUpload class
      const uploads = await this.queryWeaviateUpload();
      console.log(`📄 Found ${uploads.length} uploaded documents`);
      
      for (const upload of uploads) {
        const category = this.extractCategoryFromSource(upload.docSource, upload.chunkSource);
        const content = this.generateMDXFromWeaviateUpload(upload);
        const fileInfo = await this.writeContentFile(upload, content, category);
        newFiles.push(fileInfo);
        console.log(`📝 Created: ${fileInfo.title}`);
      }

      await this.updateDocsConfig(newFiles);
      await this.commitAndPush(`Sync ${newFiles.length} documents from Weaviate`);
      
      console.log(`\n🎉 Sync completed successfully!`);
      console.log(`✅ Synced ${newFiles.length} documents to Mintlify`);
      console.log(`📁 Categories: ${[...new Set(newFiles.map(f => f.category))].join(', ')}`);
      
    } catch (error) {
      console.error('❌ Sync failed:', error.message);
    }
  }
}

// Run the sync
const syncer = new RealWeaviateSync();
syncer.syncAll();
