#!/usr/bin/env node

/**
 * Weaviate to Mintlify Real-time Sync Script
 * 
 * This script:
 * 1. Connects to Weaviate database
 * 2. Queries for updated content
 * 3. Generates MDX files with proper Mintlify formatting
 * 4. Commits and pushes changes to trigger Mintlify rebuild
 */

import weaviate from 'weaviate-ts-client';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

class WeaviateToMintlify {
  constructor(config) {
    this.weaviateClient = weaviate.client({
      scheme: config.weaviate.scheme || 'http',
      host: config.weaviate.host || 'localhost:8080',
      apiKey: config.weaviate.apiKey,
    });
    
    this.docsPath = config.docs.path || './';
    this.className = config.weaviate.className;
    this.lastSyncFile = path.join(this.docsPath, '.last-sync');
  }

  async getLastSyncTime() {
    try {
      const timestamp = await fs.readFile(this.lastSyncFile, 'utf8');
      return new Date(timestamp.trim());
    } catch {
      return new Date(0); // Start from beginning if no sync file
    }
  }

  async updateLastSyncTime() {
    await fs.writeFile(this.lastSyncFile, new Date().toISOString());
  }

  async queryUpdatedContent(since) {
    const query = this.weaviateClient.graphql
      .get()
      .withClassName(this.className)
      .withFields('title content description category tags _additional { id lastUpdateTimeUnix }')
      .withWhere({
        path: ['_additional', 'lastUpdateTimeUnix'],
        operator: 'GreaterThan',
        valueNumber: since.getTime() / 1000
      });

    const result = await query.do();
    return result.data.Get[this.className] || [];
  }

  generateMDXContent(item) {
    const frontmatter = {
      title: item.title,
      description: item.description || '',
      category: item.category || 'General',
      tags: item.tags || []
    };

    const yamlFrontmatter = Object.entries(frontmatter)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}: [${value.map(v => `"${v}"`).join(', ')}]`;
        }
        return `${key}: "${value}"`;
      })
      .join('\n');

    return `---
${yamlFrontmatter}
---

${item.content}

<Note>
This content was automatically synced from Weaviate on ${new Date().toISOString()}
</Note>
`;
  }

  async writeContentFile(item, content) {
    const filename = this.sanitizeFilename(item.title) + '.mdx';
    const category = item.category || 'general';
    const dirPath = path.join(this.docsPath, 'weaviate-content', category);
    
    await fs.mkdir(dirPath, { recursive: true });
    
    const filePath = path.join(dirPath, filename);
    await fs.writeFile(filePath, content);
    
    return { filePath, category, filename };
  }

  sanitizeFilename(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async updateDocsConfig(newFiles) {
    const configPath = path.join(this.docsPath, 'docs.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    
    // Add Weaviate content tab if it doesn't exist
    const weaviateTab = config.navigation.tabs.find(tab => tab.tab === 'Weaviate Content');
    
    if (!weaviateTab) {
      const groups = {};
      
      newFiles.forEach(file => {
        if (!groups[file.category]) {
          groups[file.category] = [];
        }
        groups[file.category].push(`weaviate-content/${file.category}/${file.filename.replace('.mdx', '')}`);
      });

      config.navigation.tabs.push({
        tab: 'Weaviate Content',
        groups: Object.entries(groups).map(([category, pages]) => ({
          group: category.charAt(0).toUpperCase() + category.slice(1),
          pages
        }))
      });

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    }
  }

  async commitAndPush(message) {
    try {
      execSync('git add .', { cwd: this.docsPath });
      execSync(`git commit -m "${message}"`, { cwd: this.docsPath });
      execSync('git push', { cwd: this.docsPath });
      console.log('✅ Changes pushed to repository');
    } catch (error) {
      console.error('❌ Git operation failed:', error.message);
    }
  }

  async sync() {
    console.log('🔄 Starting Weaviate sync...');
    
    try {
      const lastSync = await this.getLastSyncTime();
      console.log(`📅 Last sync: ${lastSync.toISOString()}`);
      
      const updatedItems = await this.queryUpdatedContent(lastSync);
      console.log(`📊 Found ${updatedItems.length} updated items`);
      
      if (updatedItems.length === 0) {
        console.log('✅ No updates found');
        return;
      }

      const newFiles = [];
      
      for (const item of updatedItems) {
        const content = this.generateMDXContent(item);
        const fileInfo = await this.writeContentFile(item, content);
        newFiles.push(fileInfo);
        console.log(`📝 Created: ${fileInfo.filePath}`);
      }

      await this.updateDocsConfig(newFiles);
      await this.updateLastSyncTime();
      
      await this.commitAndPush(`Sync ${updatedItems.length} items from Weaviate`);
      
      console.log('✅ Sync completed successfully');
      
    } catch (error) {
      console.error('❌ Sync failed:', error);
    }
  }

  async startRealTimeSync(intervalMinutes = 5) {
    console.log(`🚀 Starting real-time sync (every ${intervalMinutes} minutes)`);
    
    // Initial sync
    await this.sync();
    
    // Set up interval
    setInterval(async () => {
      await this.sync();
    }, intervalMinutes * 60 * 1000);
  }
}

// Configuration
const config = {
  weaviate: {
    scheme: process.env.WEAVIATE_SCHEME || 'http',
    host: process.env.WEAVIATE_HOST || 'localhost:8080',
    apiKey: process.env.WEAVIATE_API_KEY,
    className: process.env.WEAVIATE_CLASS_NAME || 'Document'
  },
  docs: {
    path: process.cwd()
  }
};

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const syncer = new WeaviateToMintlify(config);
  
  const command = process.argv[2];
  
  switch (command) {
    case 'sync':
      await syncer.sync();
      break;
    case 'watch':
      const interval = parseInt(process.argv[3]) || 5;
      await syncer.startRealTimeSync(interval);
      break;
    default:
      console.log(`
Usage:
  node weaviate-sync.js sync          # One-time sync
  node weaviate-sync.js watch [mins]  # Real-time sync (default: 5 min intervals)
      `);
  }
}

export default WeaviateToMintlify;
