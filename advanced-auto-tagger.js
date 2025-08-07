#!/usr/bin/env node

/**
 * Advanced Auto-Tagger for Weaviate
 * Includes sentiment analysis, priority scoring, relationship detection, and auto-tagging for new docs
 */

import https from 'https';
import crypto from 'crypto';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class AdvancedAutoTagger {
  constructor() {
    this.tagPatterns = this.initializeAdvancedPatterns();
    this.lastProcessedTime = this.loadLastProcessedTime();
  }

  initializeAdvancedPatterns() {
    return {
      // PRIORITY LEVELS
      priority_high: {
        patterns: [
          /\burgent\b/gi,
          /\basap\b/gi,
          /\bimmediate\b/gi,
          /\bcritical\b/gi,
          /\bhigh priority\b/gi,
          /\bdeadline\b/gi,
          /\bemergency\b/gi,
          /\btime sensitive\b/gi
        ],
        tag: 'priority-high',
        category: 'priority'
      },

      priority_medium: {
        patterns: [
          /\bimportant\b/gi,
          /\bmedium priority\b/gi,
          /\bshould do\b/gi,
          /\bfollow up\b/gi,
          /\baction item\b/gi,
          /\btask\b/gi
        ],
        tag: 'priority-medium',
        category: 'priority'
      },

      // DOCUMENT TYPES
      doc_meeting: {
        patterns: [
          /\bmeeting notes\b/gi,
          /\bmeeting minutes\b/gi,
          /\bagenda\b/gi,
          /\battendees\b/gi,
          /\baction items\b/gi,
          /\bmeeting summary\b/gi,
          /\bstandup\b/gi,
          /\bscrum\b/gi
        ],
        tag: 'meeting',
        category: 'document-type'
      },

      doc_strategy: {
        patterns: [
          /\bstrategy\b/gi,
          /\bstrategic plan\b/gi,
          /\broadmap\b/gi,
          /\bvision\b/gi,
          /\bmission\b/gi,
          /\bgoals\b/gi,
          /\bobjectives\b/gi,
          /\bokr\b/gi,
          /\bkpi\b/gi
        ],
        tag: 'strategy',
        category: 'document-type'
      },

      doc_tutorial: {
        patterns: [
          /\bhow to\b/gi,
          /\btutorial\b/gi,
          /\bguide\b/gi,
          /\bstep by step\b/gi,
          /\binstructions\b/gi,
          /\bwalkthrough\b/gi,
          /\bsetup\b/gi,
          /\binstallation\b/gi
        ],
        tag: 'tutorial',
        category: 'document-type'
      },

      // SENTIMENT ANALYSIS
      sentiment_positive: {
        patterns: [
          /\bsuccess\b/gi,
          /\bexcellent\b/gi,
          /\bgreat\b/gi,
          /\bawesome\b/gi,
          /\bfantastic\b/gi,
          /\bwonderful\b/gi,
          /\bperfect\b/gi,
          /\bamazing\b/gi,
          /\bbrilliant\b/gi,
          /\boutstanding\b/gi
        ],
        tag: 'positive',
        category: 'sentiment'
      },

      sentiment_negative: {
        patterns: [
          /\bproblem\b/gi,
          /\bissue\b/gi,
          /\berror\b/gi,
          /\bfailed\b/gi,
          /\bbroken\b/gi,
          /\bbug\b/gi,
          /\bconcern\b/gi,
          /\bworried\b/gi,
          /\bdifficult\b/gi,
          /\bchallenging\b/gi
        ],
        tag: 'needs-attention',
        category: 'sentiment'
      },

      // TIME-BASED TAGS
      time_recent: {
        patterns: [
          /\btoday\b/gi,
          /\byesterday\b/gi,
          /\bthis week\b/gi,
          /\brecently\b/gi,
          /\bjust now\b/gi,
          /\bcurrent\b/gi,
          /\blatest\b/gi,
          /\bnew\b/gi
        ],
        tag: 'recent',
        category: 'temporal'
      },

      time_future: {
        patterns: [
          /\btomorrow\b/gi,
          /\bnext week\b/gi,
          /\bnext month\b/gi,
          /\bupcoming\b/gi,
          /\bplanned\b/gi,
          /\bfuture\b/gi,
          /\bwill\b/gi,
          /\bgoing to\b/gi
        ],
        tag: 'future-planning',
        category: 'temporal'
      },

      // RELATIONSHIP TAGS
      relationship_client: {
        patterns: [
          /\bclient\b/gi,
          /\bcustomer\b/gi,
          /\bstakeholder\b/gi,
          /\bpartner\b/gi,
          /\bvendor\b/gi,
          /\bsupplier\b/gi,
          /\bcontractor\b/gi
        ],
        tag: 'external-relations',
        category: 'relationship'
      },

      relationship_team: {
        patterns: [
          /\bteam\b/gi,
          /\bcolleague\b/gi,
          /\bemployee\b/gi,
          /\bstaff\b/gi,
          /\bmember\b/gi,
          /\binternal\b/gi,
          /\bdepartment\b/gi
        ],
        tag: 'internal-team',
        category: 'relationship'
      },

      // CONTENT COMPLEXITY
      complexity_technical: {
        patterns: [
          /\bapi\b/gi,
          /\bcode\b/gi,
          /\bprogramming\b/gi,
          /\balgorithm\b/gi,
          /\barchitecture\b/gi,
          /\bframework\b/gi,
          /\blibrary\b/gi,
          /\bdatabase\b/gi,
          /\bserver\b/gi,
          /\bdeployment\b/gi
        ],
        tag: 'technical',
        category: 'complexity'
      },

      complexity_business: {
        patterns: [
          /\bstrategy\b/gi,
          /\bmarket\b/gi,
          /\bcompetition\b/gi,
          /\brevenue\b/gi,
          /\bprofit\b/gi,
          /\bcustomer\b/gi,
          /\bsales\b/gi,
          /\bmarketing\b/gi
        ],
        tag: 'business-level',
        category: 'complexity'
      },

      // STATUS TAGS
      status_draft: {
        patterns: [
          /\bdraft\b/gi,
          /\bwip\b/gi,
          /\bwork in progress\b/gi,
          /\bunfinished\b/gi,
          /\bincomplete\b/gi,
          /\btodo\b/gi,
          /\bto do\b/gi
        ],
        tag: 'draft',
        category: 'status'
      },

      status_complete: {
        patterns: [
          /\bcomplete\b/gi,
          /\bfinished\b/gi,
          /\bdone\b/gi,
          /\bfinal\b/gi,
          /\bapproved\b/gi,
          /\bsigned off\b/gi,
          /\bdelivered\b/gi
        ],
        tag: 'complete',
        category: 'status'
      },

      // EXISTING PATTERNS (from previous tagger)
      collectiv: {
        patterns: [
          /\bthe collective\b/gi,
          /\bcollective tech\b/gi,
          /\bcollectiv\b/gi,
          /\bkollektiv\b/gi,
          /\bcollective\.tech\b/gi,
          /\bcollective project\b/gi,
          /\bcollective platform\b/gi,
          /\bcollective development\b/gi,
          /\bcollective team\b/gi,
          /\bcollective strategy\b/gi
        ],
        tag: 'collectiv',
        category: 'project'
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

  loadLastProcessedTime() {
    try {
      const fs = require('fs');
      const data = fs.readFileSync('.last-auto-tag-time', 'utf8');
      return new Date(data.trim());
    } catch {
      return new Date(0); // Start from beginning if no file
    }
  }

  async saveLastProcessedTime() {
    const fs = await import('fs/promises');
    await fs.writeFile('.last-auto-tag-time', new Date().toISOString());
  }

  analyzeAdvancedContent(content, fileName, source, uploadDate) {
    const tags = new Set();
    const analysis = {
      categories: {},
      priority: 'low',
      sentiment: 'neutral',
      complexity: 'simple',
      status: 'unknown',
      relationships: [],
      temporal: 'current'
    };
    
    if (!content) return { tags: [], analysis };
    
    const fullText = `${content} ${fileName || ''} ${source || ''}`;
    
    // Analyze each pattern category
    Object.entries(this.tagPatterns).forEach(([patternKey, config]) => {
      const matches = [];
      
      config.patterns.forEach(pattern => {
        const found = fullText.match(pattern);
        if (found) {
          matches.push(...found);
          tags.add(config.tag);
        }
      });
      
      if (matches.length > 0) {
        if (!analysis.categories[config.category]) {
          analysis.categories[config.category] = [];
        }
        analysis.categories[config.category].push({
          tag: config.tag,
          matches: matches.length,
          examples: [...new Set(matches)].slice(0, 2)
        });
        
        // Set primary attributes
        if (config.category === 'priority' && matches.length > 0) {
          analysis.priority = config.tag.replace('priority-', '');
        }
        if (config.category === 'sentiment' && matches.length > 0) {
          analysis.sentiment = config.tag;
        }
        if (config.category === 'complexity' && matches.length > 0) {
          analysis.complexity = config.tag;
        }
        if (config.category === 'status' && matches.length > 0) {
          analysis.status = config.tag;
        }
      }
    });
    
    // Add date-based tags
    if (uploadDate) {
      const docDate = new Date(uploadDate);
      const now = new Date();
      const daysDiff = (now - docDate) / (1000 * 60 * 60 * 24);
      
      if (daysDiff < 7) {
        tags.add('recent');
        analysis.temporal = 'recent';
      } else if (daysDiff < 30) {
        tags.add('this-month');
        analysis.temporal = 'this-month';
      } else if (daysDiff < 90) {
        tags.add('this-quarter');
        analysis.temporal = 'this-quarter';
      } else {
        tags.add('archive');
        analysis.temporal = 'archive';
      }
    }
    
    // Content length tags
    const wordCount = content.split(/\s+/).length;
    if (wordCount < 100) {
      tags.add('short-form');
    } else if (wordCount > 1000) {
      tags.add('long-form');
    }
    
    return {
      tags: Array.from(tags),
      analysis,
      wordCount
    };
  }

  async getNewDocuments() {
    console.log(`🔍 Checking for new documents since ${this.lastProcessedTime.toISOString()}...\n`);
    
    const sinceTimestamp = Math.floor(this.lastProcessedTime.getTime() / 1000);
    
    // Query for new Documents
    const documentsQuery = {
      query: `{
        Get {
          Documents(
            where: {
              path: ["_additional", "lastUpdateTimeUnix"]
              operator: GreaterThan
              valueNumber: ${sinceTimestamp}
            }
          ) {
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

    // Query for new WeaviateUploads
    const uploadsQuery = {
      query: `{
        Get {
          WeaviateUpload(
            where: {
              path: ["_additional", "lastUpdateTimeUnix"]
              operator: GreaterThan
              valueNumber: ${sinceTimestamp}
            }
          ) {
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
              lastUpdateTimeUnix
            }
          }
        }
      }`
    };

    const [docsResponse, uploadsResponse] = await Promise.all([
      this.makeRequest('/v1/graphql', 'POST', documentsQuery),
      this.makeRequest('/v1/graphql', 'POST', uploadsQuery)
    ]);

    const newDocuments = docsResponse.data?.data?.Get?.Documents || [];
    const newUploads = uploadsResponse.data?.data?.Get?.WeaviateUpload || [];

    return {
      documents: newDocuments,
      uploads: newUploads,
      total: newDocuments.length + newUploads.length
    };
  }

  async autoTagNewDocuments() {
    console.log('🤖 Auto-Tagging New Documents\n');
    
    const newDocs = await this.getNewDocuments();
    
    if (newDocs.total === 0) {
      console.log('✅ No new documents to tag');
      return;
    }
    
    console.log(`📄 Found ${newDocs.total} new documents to tag:`);
    console.log(`   - Documents: ${newDocs.documents.length}`);
    console.log(`   - WeaviateUploads: ${newDocs.uploads.length}\n`);
    
    const taggedResults = [];
    
    // Process Documents
    for (const doc of newDocs.documents) {
      const result = this.analyzeAdvancedContent(
        doc.content,
        doc.file_name,
        doc.zip_file_name,
        doc.upload_date
      );
      
      if (result.tags.length > 0) {
        taggedResults.push({
          id: doc._additional.id,
          title: doc.file_name,
          type: 'Documents',
          tags: result.tags,
          analysis: result.analysis,
          wordCount: result.wordCount
        });
        
        console.log(`🏷️  Tagged: "${doc.file_name}"`);
        console.log(`   Tags: ${result.tags.join(', ')}`);
        console.log(`   Priority: ${result.analysis.priority}`);
        console.log(`   Status: ${result.analysis.status}`);
        console.log('');
      }
    }
    
    // Process WeaviateUploads
    for (const upload of newDocs.uploads) {
      const result = this.analyzeAdvancedContent(
        upload.text,
        upload.title,
        upload.docSource,
        upload.published
      );
      
      if (result.tags.length > 0) {
        taggedResults.push({
          id: upload._additional.id,
          title: upload.title,
          type: 'WeaviateUpload',
          tags: result.tags,
          analysis: result.analysis,
          wordCount: result.wordCount
        });
        
        console.log(`🏷️  Tagged: "${upload.title}"`);
        console.log(`   Tags: ${result.tags.join(', ')}`);
        console.log(`   Priority: ${result.analysis.priority}`);
        console.log(`   Status: ${result.analysis.status}`);
        console.log('');
      }
    }
    
    // Save results
    const fs = await import('fs/promises');
    await fs.writeFile('./auto-tag-results.json', JSON.stringify(taggedResults, null, 2));
    await this.saveLastProcessedTime();
    
    console.log(`🎉 Auto-tagging complete! Tagged ${taggedResults.length} new documents`);
    console.log('💾 Results saved to auto-tag-results.json');
    
    return taggedResults;
  }

  async setupAutoTaggingSchedule() {
    console.log('⏰ Setting up Auto-Tagging Schedule\n');
    
    const scheduleScript = `#!/bin/bash
# Auto-tagging cron job script
# Add this to your crontab: */15 * * * * /path/to/auto-tag-cron.sh

cd "${process.cwd()}"
node advanced-auto-tagger.js --auto-tag >> auto-tag.log 2>&1
`;
    
    const fs = await import('fs/promises');
    await fs.writeFile('./auto-tag-cron.sh', scheduleScript);
    await fs.chmod('./auto-tag-cron.sh', 0o755);
    
    console.log('📝 Created auto-tag-cron.sh script');
    console.log('⚙️  To enable automatic tagging every 15 minutes, run:');
    console.log('   crontab -e');
    console.log('   Add line: */15 * * * * /path/to/your/project/auto-tag-cron.sh');
    console.log('');
    console.log('🔄 Or run manually with: node advanced-auto-tagger.js --auto-tag');
  }

  async showRecommendations() {
    console.log('💡 === ADVANCED TAGGING RECOMMENDATIONS ===\n');
    
    console.log('🏷️  CURRENT ADVANCED FEATURES:');
    console.log('   ✅ Priority Detection (high/medium/low)');
    console.log('   ✅ Document Type Classification (meeting/strategy/tutorial)');
    console.log('   ✅ Sentiment Analysis (positive/negative/needs-attention)');
    console.log('   ✅ Time-based Tags (recent/archive/future-planning)');
    console.log('   ✅ Relationship Tags (client/team/external)');
    console.log('   ✅ Complexity Analysis (technical/business)');
    console.log('   ✅ Status Tracking (draft/complete/wip)');
    console.log('   ✅ Content Length Tags (short-form/long-form)');
    console.log('   ✅ Auto-tagging for New Documents\n');
    
    console.log('🚀 ADDITIONAL FEATURES YOU COULD ADD:');
    console.log('   • Geographic Tags (locations mentioned)');
    console.log('   • People/Contact Tags (names and roles)');
    console.log('   • Industry Tags (fintech, healthcare, etc.)');
    console.log('   • Confidentiality Tags (public/internal/confidential)');
    console.log('   • Action Required Tags (review-needed/approval-pending)');
    console.log('   • Source Quality Tags (verified/draft/rumor)');
    console.log('   • Language Detection (english/spanish/etc.)');
    console.log('   • Topic Modeling (using AI for semantic clustering)');
    console.log('   • Duplicate Detection Integration');
    console.log('   • Version Control Tags (v1.0/latest/deprecated)\n');
    
    console.log('🤖 AUTO-TAGGING SETUP:');
    console.log('   • Webhook Integration (tag on upload)');
    console.log('   • Scheduled Processing (every 15 minutes)');
    console.log('   • Real-time Processing (using Weaviate triggers)');
    console.log('   • Batch Processing (nightly comprehensive scan)');
    console.log('   • Smart Learning (improve patterns based on usage)\n');
    
    console.log('📊 INTEGRATION OPTIONS:');
    console.log('   • Mintlify Sync (tags become navigation categories)');
    console.log('   • Search Enhancement (filter by tags)');
    console.log('   • Dashboard Creation (tag-based analytics)');
    console.log('   • Notification System (alert on high-priority tags)');
    console.log('   • Workflow Automation (route docs by tags)');
  }
}

// CLI handling
const args = process.argv.slice(2);
const command = args[0];

const tagger = new AdvancedAutoTagger();

switch (command) {
  case '--auto-tag':
    tagger.autoTagNewDocuments();
    break;
  case '--setup-schedule':
    tagger.setupAutoTaggingSchedule();
    break;
  case '--recommendations':
  case '--help':
    tagger.showRecommendations();
    break;
  default:
    console.log('🤖 Advanced Auto-Tagger for Weaviate\n');
    console.log('Commands:');
    console.log('  --auto-tag         Tag new documents since last run');
    console.log('  --setup-schedule   Create cron job for automatic tagging');
    console.log('  --recommendations  Show advanced tagging recommendations');
    console.log('  --help            Show this help\n');
    tagger.showRecommendations();
}
