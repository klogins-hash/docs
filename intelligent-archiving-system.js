#!/usr/bin/env node

/**
 * Intelligent Archiving System for Weaviate Knowledge Base
 * Provides filtering, archiving, and lifecycle management with resurrection capabilities
 */

import https from 'https';
import fs from 'fs';

// Load environment variables manually
const loadEnv = () => {
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    const lines = envContent.split('\n');
    lines.forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    });
  } catch (error) {
    // .env file not found, continue with existing env vars
  }
};
loadEnv();

const WEAVIATE_HOST = `${process.env.WEAVIATE_SCHEME || 'https'}://${process.env.WEAVIATE_HOST}`;
const WEAVIATE_API_KEY = process.env.WEAVIATE_API_KEY;

if (!WEAVIATE_API_KEY) {
  console.error('❌ WEAVIATE_API_KEY not found in environment variables');
  process.exit(1);
}

// Archive configuration
const ARCHIVE_CONFIG = {
  // Archive levels (from most accessible to least)
  levels: {
    ACTIVE: {
      name: 'Active Workspace',
      description: 'Immediately searchable and accessible',
      retention_days: null, // Never auto-archive
      search_priority: 1
    },
    SEARCHABLE: {
      name: 'Searchable Archive',
      description: 'Searchable but not in primary workspace',
      retention_days: 180, // 6 months
      search_priority: 2
    },
    ACCESSIBLE: {
      name: 'Accessible Archive',
      description: 'Available on demand, not in search by default',
      retention_days: 365, // 1 year
      search_priority: 3
    },
    DEEP: {
      name: 'Deep Archive',
      description: 'Long-term storage, requires explicit retrieval',
      retention_days: 1095, // 3 years
      search_priority: 4
    },
    COLD: {
      name: 'Cold Storage',
      description: 'Rarely accessed, compressed storage',
      retention_days: null, // Permanent but compressed
      search_priority: 5
    }
  },
  
  // Filtering rules for automatic archiving
  auto_archive_rules: [
    {
      name: 'Empty Content',
      criteria: { title: null, content_length: 0 },
      target_level: 'DEEP',
      confidence: 0.95
    },
    {
      name: 'Minimal Content',
      criteria: { content_length: { max: 50 } },
      target_level: 'ACCESSIBLE',
      confidence: 0.8
    },
    {
      name: 'Junk Indicators',
      criteria: { title_contains: ['untitled', 'copy of', 'temp', 'test', 'debug'] },
      target_level: 'DEEP',
      confidence: 0.9
    },
    {
      name: 'Old Technical Docs',
      criteria: { age_days: { min: 365 }, category: 'technical', access_count: { max: 2 } },
      target_level: 'ACCESSIBLE',
      confidence: 0.7
    },
    {
      name: 'Duplicate Content',
      criteria: { is_duplicate: true },
      target_level: 'COLD',
      confidence: 0.99
    }
  ],
  
  // Resurrection rules for bringing content back to active
  resurrection_rules: [
    {
      name: 'High Value Content',
      criteria: { contains: ['collectiv', 'collective', 'business plan', 'strategy'] },
      target_level: 'ACTIVE',
      confidence: 0.9
    },
    {
      name: 'Recent Access',
      criteria: { last_accessed_days: { max: 7 } },
      target_level: 'SEARCHABLE',
      confidence: 0.8
    },
    {
      name: 'Frequent Access',
      criteria: { access_count: { min: 5 } },
      target_level: 'ACTIVE',
      confidence: 0.85
    }
  ]
};

// Weaviate API helper
function makeWeaviateRequest(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL('/v1/graphql', WEAVIATE_HOST);
    const postData = JSON.stringify({ query, variables });
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WEAVIATE_API_KEY}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Archive management functions
class ArchiveManager {
  constructor() {
    this.archiveLog = [];
  }

  // Analyze document for archiving recommendation
  analyzeForArchiving(doc) {
    const analysis = {
      document_id: doc._additional?.id,
      title: doc.title,
      current_level: doc.archive_level || 'ACTIVE',
      recommended_level: 'ACTIVE',
      confidence: 0.5,
      reasons: [],
      can_resurrect: true
    };

    // Apply auto-archive rules
    for (const rule of ARCHIVE_CONFIG.auto_archive_rules) {
      const matches = this.evaluateRule(doc, rule.criteria);
      if (matches) {
        analysis.recommended_level = rule.target_level;
        analysis.confidence = Math.max(analysis.confidence, rule.confidence);
        analysis.reasons.push(`${rule.name}: ${this.explainMatch(rule.criteria, doc)}`);
      }
    }

    // Apply resurrection rules (can override archiving)
    for (const rule of ARCHIVE_CONFIG.resurrection_rules) {
      const matches = this.evaluateRule(doc, rule.criteria);
      if (matches && this.isHigherPriority(rule.target_level, analysis.recommended_level)) {
        analysis.recommended_level = rule.target_level;
        analysis.confidence = Math.max(analysis.confidence, rule.confidence);
        analysis.reasons.push(`RESURRECTION - ${rule.name}: ${this.explainMatch(rule.criteria, doc)}`);
      }
    }

    return analysis;
  }

  // Evaluate if document matches rule criteria
  evaluateRule(doc, criteria) {
    for (const [key, value] of Object.entries(criteria)) {
      switch (key) {
        case 'title':
          if (value === null && doc.title !== null) return false;
          if (value !== null && doc.title !== value) return false;
          break;
        
        case 'content_length':
          const contentLength = (doc.content || doc.title || '').length;
          if (typeof value === 'number' && contentLength !== value) return false;
          if (value.max && contentLength > value.max) return false;
          if (value.min && contentLength < value.min) return false;
          break;
        
        case 'title_contains':
          const title = (doc.title || '').toLowerCase();
          const hasMatch = value.some(term => title.includes(term.toLowerCase()));
          if (!hasMatch) return false;
          break;
        
        case 'contains':
          const content = ((doc.content || '') + (doc.title || '')).toLowerCase();
          const hasContentMatch = value.some(term => content.includes(term.toLowerCase()));
          if (!hasContentMatch) return false;
          break;
        
        case 'age_days':
          if (doc._additional?.creationTimeUnix) {
            const ageInDays = (Date.now() - doc._additional.creationTimeUnix * 1000) / (1000 * 60 * 60 * 24);
            if (value.min && ageInDays < value.min) return false;
            if (value.max && ageInDays > value.max) return false;
          }
          break;
        
        case 'category':
          // This would need to be determined from content analysis
          // For now, skip this criteria
          break;
        
        case 'access_count':
          // This would need to be tracked separately
          // For now, assume all documents have access_count of 1
          const accessCount = doc.access_count || 1;
          if (value.min && accessCount < value.min) return false;
          if (value.max && accessCount > value.max) return false;
          break;
        
        case 'is_duplicate':
          // This would need to be determined from duplicate analysis
          // For now, skip this criteria
          break;
        
        case 'last_accessed_days':
          // This would need to be tracked separately
          // For now, skip this criteria
          break;
      }
    }
    return true;
  }

  // Explain why a rule matched
  explainMatch(criteria, doc) {
    const explanations = [];
    
    if (criteria.title === null && doc.title === null) {
      explanations.push('no title');
    }
    
    if (criteria.content_length) {
      const length = (doc.content || doc.title || '').length;
      if (criteria.content_length.max && length <= criteria.content_length.max) {
        explanations.push(`content length ${length} ≤ ${criteria.content_length.max}`);
      }
    }
    
    if (criteria.title_contains) {
      const title = (doc.title || '').toLowerCase();
      const matches = criteria.title_contains.filter(term => title.includes(term.toLowerCase()));
      if (matches.length > 0) {
        explanations.push(`title contains: ${matches.join(', ')}`);
      }
    }
    
    if (criteria.contains) {
      const content = ((doc.content || '') + (doc.title || '')).toLowerCase();
      const matches = criteria.contains.filter(term => content.includes(term.toLowerCase()));
      if (matches.length > 0) {
        explanations.push(`content contains: ${matches.join(', ')}`);
      }
    }
    
    return explanations.join('; ') || 'criteria matched';
  }

  // Check if one archive level has higher priority than another
  isHigherPriority(level1, level2) {
    const levels = Object.keys(ARCHIVE_CONFIG.levels);
    return levels.indexOf(level1) < levels.indexOf(level2);
  }

  // Archive documents based on analysis
  async archiveDocuments(documents, dryRun = true) {
    console.log(`🗂️  ${dryRun ? 'DRY RUN - ' : ''}Analyzing ${documents.length} documents for archiving...`);
    
    const results = {
      analyzed: 0,
      recommendations: {},
      actions: []
    };

    // Initialize recommendation counters
    Object.keys(ARCHIVE_CONFIG.levels).forEach(level => {
      results.recommendations[level] = 0;
    });

    for (const doc of documents) {
      const analysis = this.analyzeForArchiving(doc);
      results.analyzed++;
      results.recommendations[analysis.recommended_level]++;
      
      // Only take action if recommendation differs from current level
      if (analysis.recommended_level !== analysis.current_level) {
        const action = {
          document_id: analysis.document_id,
          title: analysis.title,
          from_level: analysis.current_level,
          to_level: analysis.recommended_level,
          confidence: analysis.confidence,
          reasons: analysis.reasons
        };
        
        results.actions.push(action);
        
        if (!dryRun) {
          await this.moveToArchiveLevel(doc, analysis.recommended_level);
        }
      }
      
      // Progress indicator
      if (results.analyzed % 100 === 0) {
        console.log(`   📊 Analyzed ${results.analyzed}/${documents.length} documents...`);
      }
    }

    return results;
  }

  // Move document to specific archive level
  async moveToArchiveLevel(doc, level) {
    // In a real implementation, this would update the document's archive_level property
    // For now, we'll simulate this by logging the action
    this.archiveLog.push({
      timestamp: new Date().toISOString(),
      document_id: doc._additional?.id,
      title: doc.title,
      action: 'archive',
      level: level
    });
  }

  // Resurrect archived documents
  async resurrectDocuments(criteria, targetLevel = 'ACTIVE') {
    console.log(`🔄 Searching for documents to resurrect to ${targetLevel}...`);
    
    // This would query archived documents and apply resurrection rules
    // For now, return a placeholder result
    return {
      found: 0,
      resurrected: 0,
      actions: []
    };
  }

  // Generate archiving report
  generateReport(results) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total_analyzed: results.analyzed,
        actions_recommended: results.actions.length,
        by_level: results.recommendations
      },
      recommendations: results.actions,
      archive_levels: ARCHIVE_CONFIG.levels,
      rules_applied: ARCHIVE_CONFIG.auto_archive_rules.length + ARCHIVE_CONFIG.resurrection_rules.length
    };

    return report;
  }
}

// Main archiving functions
async function runArchivingAnalysis(options = {}) {
  const {
    dryRun = true,
    maxDocuments = null,
    targetLevel = null,
    resurrect = false
  } = options;

  console.log('🗂️  Starting Intelligent Archiving Analysis...\n');

  try {
    const archiveManager = new ArchiveManager();

    // Get documents for analysis (simplified query for now)
    console.log('📄 Fetching documents for archiving analysis...');
    
    const query = `
      {
        Get {
          Documents(limit: ${maxDocuments || 100}) {
            title
            _additional {
              id
              creationTimeUnix
            }
          }
          WeaviateUpload(limit: ${maxDocuments || 100}) {
            title
            docSource
            _additional {
              id
              creationTimeUnix
            }
          }
        }
      }
    `;

    const response = await makeWeaviateRequest(query);
    
    if (response.errors) {
      console.error('❌ GraphQL errors:', response.errors);
      return;
    }

    const documents = response.data?.Get?.Documents || [];
    const uploads = response.data?.Get?.WeaviateUpload || [];
    
    // Normalize documents
    const allDocs = [
      ...documents.map(doc => ({ ...doc, weaviate_class: 'Documents', content: doc.title || '' })),
      ...uploads.map(doc => ({ ...doc, weaviate_class: 'WeaviateUpload', content: doc.title || '', source: doc.docSource }))
    ];

    console.log(`✅ Found ${allDocs.length} documents for analysis\n`);

    if (resurrect) {
      // Resurrection mode
      const resurrectResults = await archiveManager.resurrectDocuments({}, targetLevel);
      console.log(`🔄 Resurrection complete: ${resurrectResults.resurrected} documents restored`);
    } else {
      // Archiving mode
      const results = await archiveManager.archiveDocuments(allDocs, dryRun);
      
      // Generate and display report
      const report = archiveManager.generateReport(results);
      
      console.log('\n📊 === INTELLIGENT ARCHIVING ANALYSIS COMPLETE ===\n');
      console.log(`📄 Documents Analyzed: ${report.summary.total_analyzed}`);
      console.log(`🎯 Actions Recommended: ${report.summary.actions_recommended}\n`);
      
      console.log('📊 RECOMMENDED ARCHIVE LEVELS:');
      Object.entries(report.summary.by_level).forEach(([level, count]) => {
        const config = ARCHIVE_CONFIG.levels[level];
        console.log(`   ${level}: ${count} documents - ${config.description}`);
      });
      
      if (report.recommendations.length > 0) {
        console.log('\n🎯 TOP ARCHIVING RECOMMENDATIONS:');
        const topRecommendations = report.recommendations
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 10);
        
        topRecommendations.forEach((rec, index) => {
          console.log(`\n   ${index + 1}. "${rec.title || 'Untitled'}"`);
          console.log(`      ${rec.from_level} → ${rec.to_level} (${(rec.confidence * 100).toFixed(1)}% confidence)`);
          console.log(`      Reasons: ${rec.reasons.join('; ')}`);
        });
      }
      
      // Save detailed report
      fs.writeFileSync('intelligent-archiving-report.json', JSON.stringify(report, null, 2));
      console.log('\n💾 Detailed report saved to: intelligent-archiving-report.json');
      
      if (dryRun) {
        console.log('\n🔍 This was a DRY RUN - no documents were actually archived');
        console.log('   Run with --dry-run=false to execute the archiving actions');
      }
    }

  } catch (error) {
    console.error('❌ Archiving analysis failed:', error.message);
    process.exit(1);
  }
}

// Command line interface
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: true,
    maxDocuments: null,
    targetLevel: null,
    resurrect: false
  };

  args.forEach(arg => {
    if (arg === '--dry-run=false') options.dryRun = false;
    if (arg.startsWith('--max-documents=')) options.maxDocuments = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--target-level=')) options.targetLevel = arg.split('=')[1];
    if (arg === '--resurrect') options.resurrect = true;
    if (arg === '--help') {
      console.log(`
🗂️  Intelligent Archiving System for Weaviate

USAGE:
  node intelligent-archiving-system.js [options]

OPTIONS:
  --dry-run=false          Execute archiving actions (default: dry run only)
  --max-documents=N        Limit analysis to N documents
  --target-level=LEVEL     Target archive level (ACTIVE, SEARCHABLE, ACCESSIBLE, DEEP, COLD)
  --resurrect              Resurrect archived documents instead of archiving
  --help                   Show this help

ARCHIVE LEVELS:
  ACTIVE      - Immediately searchable and accessible
  SEARCHABLE  - Searchable but not in primary workspace  
  ACCESSIBLE  - Available on demand, not in search by default
  DEEP        - Long-term storage, requires explicit retrieval
  COLD        - Rarely accessed, compressed storage

EXAMPLES:
  node intelligent-archiving-system.js
  node intelligent-archiving-system.js --dry-run=false --max-documents=1000
  node intelligent-archiving-system.js --resurrect --target-level=ACTIVE
      `);
      process.exit(0);
    }
  });

  return options;
}

// Run the archiving system
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();
  runArchivingAnalysis(options);
}

export { ArchiveManager, runArchivingAnalysis, ARCHIVE_CONFIG };
