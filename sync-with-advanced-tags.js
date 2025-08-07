#!/usr/bin/env node

/**
 * Enhanced Weaviate to Mintlify Sync with Advanced Tagging
 * Combines chunked sync with smart tagging and auto-organization
 */

import https from 'https';
import { execSync } from 'child_process';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class EnhancedSyncManager {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 5;
    this.delayBetweenChunks = options.delay || 2000;
    this.dryRun = options.dryRun || false;
    this.tagPatterns = this.initializeTagPatterns();
  }

  initializeTagPatterns() {
    // Import patterns from advanced tagger
    return {
      collectiv: {
        patterns: [/\bthe collective\b/gi, /\bcollective tech\b/gi, /\bcollectiv\b/gi],
        tag: 'collectiv',
        priority: 'high'
      },
      priority_high: {
        patterns: [/\burgent\b/gi, /\bcritical\b/gi, /\bhigh priority\b/gi, /\bdeadline\b/gi],
        tag: 'priority-high',
        priority: 'high'
      },
      doc_meeting: {
        patterns: [/\bmeeting notes\b/gi, /\bagenda\b/gi, /\battendees\b/gi],
        tag: 'meeting',
        priority: 'medium'
      },
      doc_strategy: {
        patterns: [/\bstrategy\b/gi, /\broadmap\b/gi, /\bvision\b/gi, /\bokr\b/gi],
        tag: 'strategy',
        priority: 'high'
      },
      sentiment_negative: {
        patterns: [/\bproblem\b/gi, /\bissue\b/gi, /\berror\b/gi, /\bfailed\b/gi],
        tag: 'needs-attention',
        priority: 'high'
      },
      business: {
        patterns: [/\bbusiness plan\b/gi, /\bmarket research\b/gi, /\brevenue\b/gi],
        tag: 'business',
        priority: 'medium'
      },
      ai_tech: {
        patterns: [/\bai\b/gi, /\bmachine learning\b/gi, /\bautomation\b/gi],
        tag: 'ai-tech',
        priority: 'medium'
      }
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

  analyzeAndTag(content, fileName, source) {
    const tags = new Set();
    const analysis = {
      priority: 'low',
      category: 'general',
      needsAttention: false,
      isCollectiv: false
    };
    
    if (!content) return { tags: [], analysis };
    
    const fullText = `${content} ${fileName || ''} ${source || ''}`;
    
    // Check each tag pattern
    Object.entries(this.tagPatterns).forEach(([patternKey, config]) => {
      config.patterns.forEach(pattern => {
        if (pattern.test(fullText)) {
          tags.add(config.tag);
          
          // Set analysis flags
          if (config.tag === 'collectiv') {
            analysis.isCollectiv = true;
            analysis.priority = 'high';
          }
          if (config.tag === 'needs-attention') {
            analysis.needsAttention = true;
          }
          if (config.priority === 'high') {
            analysis.priority = 'high';
          }
        }
      });
    });
    
    // Determine category
    if (tags.has('collectiv')) analysis.category = 'collectiv';
    else if (tags.has('strategy')) analysis.category = 'strategy';
    else if (tags.has('meeting')) analysis.category = 'meetings';
    else if (tags.has('business')) analysis.category = 'business';
    else if (tags.has('ai-tech')) analysis.category = 'technology';
    
    return {
      tags: Array.from(tags),
      analysis
    };
  }

  generateMDXContent(doc, tags, analysis) {
    const title = doc.title || doc.file_name || 'Untitled Document';
    const content = doc.content || doc.text || '';
    const source = doc.source || doc.zip_file_name || doc.docSource || 'Unknown';
    
    // Create enhanced frontmatter with tags and metadata
    const frontmatter = {
      title: title,
      description: content.substring(0, 150).replace(/\n/g, ' ') + '...',
      tags: tags,
      category: analysis.category,
      priority: analysis.priority,
      source: source,
      'needs-attention': analysis.needsAttention,
      'is-collectiv': analysis.isCollectiv,
      'last-updated': new Date().toISOString().split('T')[0]
    };

    // Add priority callout for high-priority docs
    let priorityCallout = '';
    if (analysis.priority === 'high') {
      priorityCallout = `
<Warning>
**High Priority Document** - This content has been flagged as high priority and may require immediate attention.
</Warning>
`;
    }

    // Add Collectiv callout for project docs
    let collectivCallout = '';
    if (analysis.isCollectiv) {
      collectivCallout = `
<Info>
**Collective Project** - This document is related to the Collective project and has been automatically categorized for easy access.
</Info>
`;
    }

    // Add needs attention callout
    let attentionCallout = '';
    if (analysis.needsAttention) {
      attentionCallout = `
<Note>
**Needs Attention** - This document contains issues, problems, or items that may need follow-up.
</Note>
`;
    }

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

${priorityCallout}${collectivCallout}${attentionCallout}

## Document Information

**Source:** ${source}  
**Tags:** ${tags.join(', ') || 'None'}  
**Category:** ${analysis.category}  
**Priority:** ${analysis.priority}

---

## Content

${content}

---

<Tip>
This document was automatically imported and tagged using smart content analysis. Tags help organize and find related content across your documentation.
</Tip>
`;
  }

  createCategoryStructure(taggedDocs) {
    const structure = {
      'collectiv': {
        title: '🎯 Collective Project',
        description: 'Documents related to the Collective project',
        docs: []
      },
      'strategy': {
        title: '📋 Strategy & Planning',
        description: 'Strategic documents and planning materials',
        docs: []
      },
      'meetings': {
        title: '🤝 Meetings & Notes',
        description: 'Meeting notes, agendas, and discussion summaries',
        docs: []
      },
      'business': {
        title: '💼 Business & Market',
        description: 'Business plans, market research, and commercial content',
        docs: []
      },
      'technology': {
        title: '⚡ Technology & AI',
        description: 'Technical documentation and AI-related content',
        docs: []
      },
      'high-priority': {
        title: '🚨 High Priority',
        description: 'Urgent and critical documents requiring attention',
        docs: []
      },
      'needs-attention': {
        title: '⚠️ Needs Attention',
        description: 'Documents with issues or problems to address',
        docs: []
      },
      'general': {
        title: '📄 General Documents',
        description: 'Other imported documents',
        docs: []
      }
    };

    // Organize docs by category and priority
    taggedDocs.forEach(doc => {
      const category = doc.analysis.category;
      
      // Add to primary category
      if (structure[category]) {
        structure[category].docs.push(doc);
      }
      
      // Also add to priority/attention categories if applicable
      if (doc.analysis.priority === 'high') {
        structure['high-priority'].docs.push(doc);
      }
      if (doc.analysis.needsAttention) {
        structure['needs-attention'].docs.push(doc);
      }
    });

    return structure;
  }

  async updateNavigationWithTags(structure) {
    console.log('📝 Updating navigation with tagged categories...');
    
    const fs = await import('fs/promises');
    
    try {
      const docsConfig = await fs.readFile('./docs.json', 'utf8');
      const config = JSON.parse(docsConfig);
      
      // Create new navigation structure
      const importedDocsNav = {
        group: "📚 Imported Documents",
        pages: []
      };

      // Add categories with documents
      Object.entries(structure).forEach(([key, category]) => {
        if (category.docs.length > 0) {
          const categoryNav = {
            group: category.title,
            pages: category.docs.map(doc => `imported/${key}/${doc.filename.replace('.mdx', '')}`)
          };
          importedDocsNav.pages.push(categoryNav);
        }
      });

      // Update navigation
      const existingNavIndex = config.navigation.findIndex(
        item => item.group === "📚 Imported Documents"
      );
      
      if (existingNavIndex >= 0) {
        config.navigation[existingNavIndex] = importedDocsNav;
      } else {
        config.navigation.push(importedDocsNav);
      }
      
      await fs.writeFile('./docs.json', JSON.stringify(config, null, 2));
      console.log('✅ Navigation updated with tagged categories');
      
    } catch (error) {
      console.error('❌ Error updating navigation:', error.message);
    }
  }

  async syncWithAdvancedTags(filterTags = null) {
    console.log('🚀 Enhanced Weaviate to Mintlify Sync with Advanced Tagging\n');
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - No files will be created\n');
    }

    // Get all documents
    const documentsQuery = {
      query: `{
        Get {
          Documents {
            content
            file_name
            file_type
            zip_file_name
            upload_date
            file_path
            _additional {
              id
            }
          }
        }
      }`
    };

    const uploadsQuery = {
      query: `{
        Get {
          WeaviateUpload {
            title
            text
            description
            docAuthor
            docSource
            published
            url
            chunkSource
            wordCount
            _additional {
              id
            }
          }
        }
      }`
    };

    console.log('📊 Fetching documents from Weaviate...');
    const [docsResponse, uploadsResponse] = await Promise.all([
      this.makeRequest('/v1/graphql', 'POST', documentsQuery),
      this.makeRequest('/v1/graphql', 'POST', uploadsQuery)
    ]);

    const documents = docsResponse.data?.data?.Get?.Documents || [];
    const uploads = uploadsResponse.data?.data?.Get?.WeaviateUpload || [];

    // Normalize and tag all documents
    const allDocs = [
      ...documents.map(doc => ({
        id: doc._additional.id,
        title: doc.file_name,
        content: doc.content,
        source: doc.zip_file_name,
        type: 'Documents',
        originalData: doc
      })),
      ...uploads.map(upload => ({
        id: upload._additional.id,
        title: upload.title,
        content: upload.text,
        source: upload.docSource,
        type: 'WeaviateUpload',
        originalData: upload
      }))
    ];

    console.log(`🏷️  Analyzing and tagging ${allDocs.length} documents...`);
    
    // Tag all documents
    const taggedDocs = allDocs.map(doc => {
      const { tags, analysis } = this.analyzeAndTag(doc.content, doc.title, doc.source);
      return {
        ...doc,
        tags,
        analysis,
        filename: this.sanitizeFilename(doc.title) + '.mdx'
      };
    });

    // Filter by tags if specified
    let docsToSync = taggedDocs;
    if (filterTags) {
      docsToSync = taggedDocs.filter(doc => 
        filterTags.some(tag => doc.tags.includes(tag))
      );
      console.log(`🎯 Filtering to ${docsToSync.length} documents with tags: ${filterTags.join(', ')}`);
    }

    // Create category structure
    const structure = this.createCategoryStructure(docsToSync);
    
    // Show tagging summary
    console.log('\n📊 TAGGING SUMMARY:');
    Object.entries(structure).forEach(([key, category]) => {
      if (category.docs.length > 0) {
        console.log(`   ${category.title}: ${category.docs.length} documents`);
      }
    });

    if (this.dryRun) {
      console.log('\n🔍 DRY RUN COMPLETE - No files were created');
      return structure;
    }

    // Create directory structure and sync in chunks
    const fs = await import('fs/promises');
    
    console.log('\n📁 Creating directory structure...');
    await fs.mkdir('./imported', { recursive: true });
    
    for (const [categoryKey, category] of Object.entries(structure)) {
      if (category.docs.length > 0) {
        await fs.mkdir(`./imported/${categoryKey}`, { recursive: true });
      }
    }

    // Sync documents in chunks
    let totalSynced = 0;
    
    for (const [categoryKey, category] of Object.entries(structure)) {
      if (category.docs.length === 0) continue;
      
      console.log(`\n📂 Syncing ${category.title} (${category.docs.length} documents)...`);
      
      const chunks = this.chunkArray(category.docs, this.chunkSize);
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`   Processing chunk ${i + 1}/${chunks.length} (${chunk.length} docs)...`);
        
        // Process chunk
        for (const doc of chunk) {
          const mdxContent = this.generateMDXContent(doc, doc.tags, doc.analysis);
          const filePath = `./imported/${categoryKey}/${doc.filename}`;
          
          await fs.writeFile(filePath, mdxContent);
          totalSynced++;
          
          console.log(`     ✅ ${doc.title}`);
        }
        
        // Delay between chunks
        if (i < chunks.length - 1) {
          console.log(`     ⏳ Waiting ${this.delayBetweenChunks}ms before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenChunks));
        }
      }
    }

    // Update navigation
    await this.updateNavigationWithTags(structure);

    // Commit changes
    console.log('\n📤 Committing changes to Git...');
    try {
      execSync('git add .', { stdio: 'inherit' });
      execSync(`git commit -m "Enhanced sync: ${totalSynced} documents with advanced tagging"`, { stdio: 'inherit' });
      execSync('git push', { stdio: 'inherit' });
      console.log('✅ Changes pushed to GitHub');
    } catch (error) {
      console.log('⚠️  Git operations failed:', error.message);
    }

    console.log(`\n🎉 Enhanced sync complete! Synced ${totalSynced} documents with advanced tagging`);
    return structure;
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  sanitizeFilename(filename) {
    return filename
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .substring(0, 50);
  }
}

// CLI handling
const args = process.argv.slice(2);
const options = {
  chunkSize: parseInt(args.find(arg => arg.startsWith('--chunk-size='))?.split('=')[1]) || 5,
  delay: parseInt(args.find(arg => arg.startsWith('--delay='))?.split('=')[1]) || 2000,
  dryRun: args.includes('--dry-run')
};

const filterTagsArg = args.find(arg => arg.startsWith('--tags='));
const filterTags = filterTagsArg ? filterTagsArg.split('=')[1].split(',') : null;

const syncManager = new EnhancedSyncManager(options);

if (args.includes('--help')) {
  console.log(`
🚀 Enhanced Weaviate to Mintlify Sync with Advanced Tagging

Usage:
  node sync-with-advanced-tags.js [options]

Options:
  --chunk-size=N     Number of documents per chunk (default: 5)
  --delay=N          Delay between chunks in ms (default: 2000)
  --dry-run          Show what would be synced without creating files
  --tags=tag1,tag2   Only sync documents with specific tags
  --help             Show this help

Examples:
  node sync-with-advanced-tags.js --dry-run
  node sync-with-advanced-tags.js --tags=collectiv,priority-high
  node sync-with-advanced-tags.js --chunk-size=3 --delay=3000
  `);
} else {
  syncManager.syncWithAdvancedTags(filterTags);
}
