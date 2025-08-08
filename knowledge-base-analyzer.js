#!/usr/bin/env node

/**
 * Knowledge Base Deep Analysis Tool
 * Analyzes all documents to provide intelligent archiving and filtering recommendations
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

const WEAVIATE_HOST = `${process.env.WEAVIATE_SCHEME || 'https'}://${process.env.WEAVIATE_HOST}` || 'https://weaviate-cluster-1-jbqkqzrk.weaviate.network';
const WEAVIATE_API_KEY = process.env.WEAVIATE_API_KEY;

if (!WEAVIATE_API_KEY) {
  console.error('❌ WEAVIATE_API_KEY not found in environment variables');
  process.exit(1);
}

// Analysis categories
const ANALYSIS_CATEGORIES = {
  CONTENT_TYPE: {
    code: ['py', 'js', 'html', 'css', 'json', 'xml', 'yaml', 'sql'],
    documentation: ['md', 'txt', 'pdf', 'docx'],
    data: ['csv', 'json', 'xml', 'yaml'],
    media: ['png', 'jpg', 'gif', 'mp4', 'mp3'],
    archive: ['zip', 'tar', 'gz']
  },
  RELEVANCE_KEYWORDS: {
    high_priority: ['collectiv', 'collective', 'business plan', 'strategy', 'revenue', 'client', 'project'],
    medium_priority: ['ai', 'automation', 'marketing', 'development', 'research'],
    low_priority: ['test', 'temp', 'backup', 'old', 'deprecated', 'archive'],
    junk_indicators: ['untitled', 'copy', 'duplicate', 'temp', 'test', 'debug', 'sample']
  },
  SIZE_CATEGORIES: {
    tiny: { max: 100, description: 'Very small files (likely metadata or empty)' },
    small: { max: 1000, description: 'Small files (notes, snippets)' },
    medium: { max: 10000, description: 'Medium files (articles, documents)' },
    large: { max: 50000, description: 'Large files (comprehensive docs)' },
    huge: { min: 50000, description: 'Huge files (datasets, books)' }
  }
};

// Weaviate API helper
function makeWeaviateRequest(query) {
  return new Promise((resolve, reject) => {
    const url = new URL('/v1/graphql', WEAVIATE_HOST);
    const postData = JSON.stringify({ query });
    
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

// Get all documents with comprehensive metadata
async function getAllDocuments() {
  console.log('🔍 Fetching all documents for deep analysis...');
  
  const allDocs = [];
  let hasMore = true;
  let offset = 0;
  const limit = 100;

  while (hasMore) {
    const query = `
      {
        Get {
          Documents(limit: ${limit}, offset: ${offset}) {
            title
            _additional {
              id
              creationTimeUnix
            }
          }
          WeaviateUpload(limit: ${limit}, offset: ${offset}) {
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

    try {
      const response = await makeWeaviateRequest(query);
      
      if (response.errors) {
        console.error('❌ GraphQL errors:', response.errors);
        break;
      }

      const documents = response.data?.Get?.Documents || [];
      const uploads = response.data?.Get?.WeaviateUpload || [];
      
      // Add class type and normalize fields
      const docsWithClass = documents.map(doc => ({ 
        ...doc, 
        weaviate_class: 'Documents',
        source: 'Documents',
        content: doc.title || '',
        file_type: 'unknown'
      }));
      const uploadsWithClass = uploads.map(doc => ({ 
        ...doc, 
        weaviate_class: 'WeaviateUpload',
        source: doc.docSource || 'WeaviateUpload',
        content: doc.title || '',
        file_type: 'unknown'
      }));
      
      const batch = [...docsWithClass, ...uploadsWithClass];
      allDocs.push(...batch);

      console.log(`   📄 Fetched ${batch.length} documents (total: ${allDocs.length})`);

      if (batch.length < limit * 2) {
        hasMore = false;
      } else {
        offset += limit;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error('❌ Error fetching documents:', error.message);
      break;
    }
  }

  console.log(`✅ Total documents fetched: ${allDocs.length}`);
  return allDocs;
}

// Analyze content quality and relevance
function analyzeContentQuality(doc) {
  const title = (doc.title || '').toLowerCase();
  const content = (doc.content || '').toLowerCase();
  const source = (doc.source || '').toLowerCase();
  
  let score = 50; // Base score
  let flags = [];
  let category = 'unknown';

  // Title analysis
  if (!doc.title || doc.title.trim() === '') {
    score -= 20;
    flags.push('no_title');
  }

  // Content analysis
  const contentLength = (doc.content || '').length;
  if (contentLength === 0) {
    score -= 30;
    flags.push('empty_content');
    category = 'empty';
  } else if (contentLength < 50) {
    score -= 15;
    flags.push('minimal_content');
    category = 'minimal';
  }

  // Junk indicators
  const junkPatterns = ['untitled', 'copy of', 'copy (', 'new document', 'temp', 'test', 'debug', 'sample'];
  for (const pattern of junkPatterns) {
    if (title.includes(pattern) || content.includes(pattern)) {
      score -= 25;
      flags.push('junk_indicator');
      category = 'junk';
    }
  }

  // High-value content indicators
  const highValuePatterns = ['collectiv', 'collective', 'business plan', 'strategy', 'revenue', 'client'];
  for (const pattern of highValuePatterns) {
    if (title.includes(pattern) || content.includes(pattern)) {
      score += 30;
      flags.push('high_value');
      category = 'high_priority';
    }
  }

  // Technical content
  const techPatterns = ['api', 'code', 'function', 'class', 'import', 'export', 'def ', 'const ', 'var '];
  let techScore = 0;
  for (const pattern of techPatterns) {
    if (content.includes(pattern)) {
      techScore += 5;
    }
  }
  if (techScore > 15) {
    flags.push('technical_content');
    category = category === 'unknown' ? 'technical' : category;
  }

  // File type analysis
  const fileType = (doc.file_type || '').toLowerCase();
  if (ANALYSIS_CATEGORIES.CONTENT_TYPE.code.includes(fileType)) {
    score += 10;
    flags.push('code_file');
    category = category === 'unknown' ? 'code' : category;
  } else if (ANALYSIS_CATEGORIES.CONTENT_TYPE.documentation.includes(fileType)) {
    score += 5;
    flags.push('documentation');
    category = category === 'unknown' ? 'documentation' : category;
  }

  // Age analysis (if creation time available)
  if (doc._additional?.creationTimeUnix) {
    const ageInDays = (Date.now() - doc._additional.creationTimeUnix * 1000) / (1000 * 60 * 60 * 24);
    if (ageInDays > 365) {
      score -= 10;
      flags.push('old_content');
    } else if (ageInDays < 30) {
      score += 5;
      flags.push('recent_content');
    }
  }

  // Source analysis
  if (source.includes('obsidian')) {
    score += 15;
    flags.push('obsidian_vault');
    category = category === 'unknown' ? 'personal_knowledge' : category;
  } else if (source.includes('google drive')) {
    score += 10;
    flags.push('google_drive');
  } else if (source.includes('zip')) {
    score -= 5;
    flags.push('archive_extraction');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    flags,
    category,
    contentLength,
    recommendation: getRecommendation(score, flags, category)
  };
}

function getRecommendation(score, flags, category) {
  if (score >= 80) return 'keep_active';
  if (score >= 60) return 'keep_searchable';
  if (score >= 40) return 'archive_accessible';
  if (score >= 20) return 'archive_deep';
  return 'consider_deletion';
}

// Analyze patterns and generate recommendations
function generateRecommendations(documents, analysis) {
  const recommendations = {
    summary: {
      total_documents: documents.length,
      analysis_date: new Date().toISOString(),
    },
    categories: {},
    archiving_strategy: {},
    filtering_rules: [],
    lifecycle_management: {}
  };

  // Categorize by recommendation
  const byRecommendation = {};
  const byCategory = {};
  const bySource = {};
  const byFileType = {};
  const sizeDistribution = { tiny: 0, small: 0, medium: 0, large: 0, huge: 0 };

  analysis.forEach((doc, index) => {
    const rec = doc.analysis.recommendation;
    const cat = doc.analysis.category;
    const source = doc.source || 'unknown';
    const fileType = doc.file_type || 'unknown';
    const size = doc.analysis.contentLength;

    // By recommendation
    if (!byRecommendation[rec]) byRecommendation[rec] = [];
    byRecommendation[rec].push(doc);

    // By category
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(doc);

    // By source
    if (!bySource[source]) bySource[source] = [];
    bySource[source].push(doc);

    // By file type
    if (!byFileType[fileType]) byFileType[fileType] = [];
    byFileType[fileType].push(doc);

    // Size distribution
    if (size <= 100) sizeDistribution.tiny++;
    else if (size <= 1000) sizeDistribution.small++;
    else if (size <= 10000) sizeDistribution.medium++;
    else if (size <= 50000) sizeDistribution.large++;
    else sizeDistribution.huge++;
  });

  recommendations.summary.by_recommendation = Object.keys(byRecommendation).map(key => ({
    recommendation: key,
    count: byRecommendation[key].length,
    percentage: ((byRecommendation[key].length / documents.length) * 100).toFixed(1)
  }));

  recommendations.summary.by_category = Object.keys(byCategory).map(key => ({
    category: key,
    count: byCategory[key].length,
    percentage: ((byCategory[key].length / documents.length) * 100).toFixed(1)
  }));

  recommendations.summary.by_source = Object.keys(bySource).map(key => ({
    source: key,
    count: bySource[key].length,
    percentage: ((bySource[key].length / documents.length) * 100).toFixed(1)
  }));

  recommendations.summary.size_distribution = sizeDistribution;

  // Generate archiving strategy
  recommendations.archiving_strategy = {
    immediate_archive: {
      description: "Documents that should be archived immediately",
      criteria: "Score < 40, old content, junk indicators",
      count: (byRecommendation.archive_deep || []).length + (byRecommendation.consider_deletion || []).length,
      examples: (byRecommendation.archive_deep || []).slice(0, 5).map(d => ({
        title: d.title,
        score: d.analysis.score,
        flags: d.analysis.flags,
        reason: "Low relevance, minimal content, or junk indicators"
      }))
    },
    scheduled_archive: {
      description: "Documents to archive after 6 months of no access",
      criteria: "Score 40-60, older content, technical documentation",
      count: (byRecommendation.archive_accessible || []).length,
      examples: (byRecommendation.archive_accessible || []).slice(0, 5).map(d => ({
        title: d.title,
        score: d.analysis.score,
        flags: d.analysis.flags,
        reason: "Medium relevance, may be needed occasionally"
      }))
    },
    keep_active: {
      description: "Documents to keep in active workspace",
      criteria: "Score > 60, high-value content, recent activity",
      count: (byRecommendation.keep_active || []).length + (byRecommendation.keep_searchable || []).length,
      examples: (byRecommendation.keep_active || []).slice(0, 5).map(d => ({
        title: d.title,
        score: d.analysis.score,
        flags: d.analysis.flags,
        reason: "High relevance, business critical, or frequently accessed"
      }))
    }
  };

  // Generate filtering rules
  recommendations.filtering_rules = [
    {
      rule: "Auto-archive empty or minimal content",
      criteria: "content_length < 50 OR empty_content flag",
      affected_count: analysis.filter(d => d.analysis.flags.includes('empty_content') || d.analysis.flags.includes('minimal_content')).length
    },
    {
      rule: "Auto-archive junk indicators",
      criteria: "title contains 'untitled', 'copy of', 'temp', 'test'",
      affected_count: analysis.filter(d => d.analysis.flags.includes('junk_indicator')).length
    },
    {
      rule: "Keep all Collective project content active",
      criteria: "title or content contains 'collectiv' or 'collective'",
      affected_count: analysis.filter(d => d.analysis.flags.includes('high_value')).length
    },
    {
      rule: "Archive old technical documentation",
      criteria: "age > 1 year AND technical_content flag AND score < 60",
      affected_count: analysis.filter(d => d.analysis.flags.includes('old_content') && d.analysis.flags.includes('technical_content') && d.analysis.score < 60).length
    }
  ];

  // Lifecycle management recommendations
  recommendations.lifecycle_management = {
    daily: [
      "Auto-tag new documents",
      "Identify and flag potential junk content",
      "Update access timestamps for active documents"
    ],
    weekly: [
      "Review documents flagged for archiving",
      "Clean up empty or minimal content",
      "Update relevance scores based on access patterns"
    ],
    monthly: [
      "Archive documents not accessed in 30 days with score < 40",
      "Review and update filtering rules",
      "Generate knowledge base health report"
    ],
    quarterly: [
      "Deep archive documents not accessed in 90 days with score < 60",
      "Review archived content for potential restoration",
      "Optimize storage and search performance"
    ]
  };

  return recommendations;
}

// Main analysis function
async function runDeepAnalysis() {
  console.log('🔍 Starting Deep Knowledge Base Analysis...\n');

  try {
    // Get all documents
    const documents = await getAllDocuments();
    
    if (documents.length === 0) {
      console.log('❌ No documents found');
      return;
    }

    console.log('\n📊 Analyzing document quality and relevance...');
    
    // Analyze each document
    const analysis = documents.map((doc, index) => {
      if (index % 100 === 0) {
        console.log(`   🔍 Analyzed ${index}/${documents.length} documents...`);
      }
      
      return {
        ...doc,
        analysis: analyzeContentQuality(doc)
      };
    });

    console.log('\n🎯 Generating recommendations...');
    
    // Generate comprehensive recommendations
    const recommendations = generateRecommendations(documents, analysis);

    // Save detailed analysis
    const detailedReport = {
      analysis_metadata: {
        total_documents: documents.length,
        analysis_date: new Date().toISOString(),
        analyzer_version: '1.0.0'
      },
      recommendations,
      detailed_analysis: analysis.map(doc => ({
        id: doc._additional?.id,
        title: doc.title,
        source: doc.source,
        file_type: doc.file_type,
        weaviate_class: doc.weaviate_class,
        analysis: doc.analysis
      }))
    };

    fs.writeFileSync('knowledge-base-deep-analysis.json', JSON.stringify(detailedReport, null, 2));
    
    // Display summary
    console.log('\n🎉 DEEP ANALYSIS COMPLETE!\n');
    console.log('📊 === KNOWLEDGE BASE ANALYSIS SUMMARY ===\n');
    
    console.log(`📄 Total Documents Analyzed: ${documents.length}\n`);
    
    console.log('🏷️  RECOMMENDATION BREAKDOWN:');
    recommendations.summary.by_recommendation.forEach(item => {
      console.log(`   ${item.recommendation}: ${item.count} documents (${item.percentage}%)`);
    });
    
    console.log('\n📂 CATEGORY BREAKDOWN:');
    recommendations.summary.by_category.forEach(item => {
      console.log(`   ${item.category}: ${item.count} documents (${item.percentage}%)`);
    });
    
    console.log('\n📦 SIZE DISTRIBUTION:');
    Object.entries(recommendations.summary.size_distribution).forEach(([size, count]) => {
      console.log(`   ${size}: ${count} documents`);
    });
    
    console.log('\n🗂️  ARCHIVING STRATEGY:');
    Object.entries(recommendations.archiving_strategy).forEach(([key, strategy]) => {
      console.log(`\n   ${key.toUpperCase()}: ${strategy.count} documents`);
      console.log(`   ${strategy.description}`);
      console.log(`   Criteria: ${strategy.criteria}`);
      if (strategy.examples && strategy.examples.length > 0) {
        console.log('   Examples:');
        strategy.examples.forEach(example => {
          console.log(`     • "${example.title}" (score: ${example.score})`);
        });
      }
    });
    
    console.log('\n🔧 FILTERING RULES:');
    recommendations.filtering_rules.forEach(rule => {
      console.log(`   • ${rule.rule}`);
      console.log(`     Affects: ${rule.affected_count} documents`);
      console.log(`     Criteria: ${rule.criteria}\n`);
    });
    
    console.log('💾 Detailed report saved to: knowledge-base-deep-analysis.json');
    console.log('📋 Ready for archiving implementation and lifecycle management setup!\n');

  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

// Run the analysis
runDeepAnalysis();
