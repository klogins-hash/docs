#!/usr/bin/env node

/**
 * Smart Content Tagger for Weaviate
 * Analyzes content and adds contextual tags before sync to Mintlify
 */

import https from 'https';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class SmartContentTagger {
  constructor(dryRun = true) {
    this.dryRun = dryRun;
    this.tagPatterns = this.initializeTagPatterns();
  }

  initializeTagPatterns() {
    return {
      // Primary Collective project patterns
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
        priority: 'high'
      },

      // Business/Strategy content
      business: {
        patterns: [
          /\bbusiness plan\b/gi,
          /\bbusiness model\b/gi,
          /\bbusiness strategy\b/gi,
          /\bstartup\b/gi,
          /\bentrepreneurship\b/gi,
          /\bmarket research\b/gi,
          /\bcompetitive analysis\b/gi,
          /\brevenue model\b/gi,
          /\bmonetization\b/gi,
          /\binvestment\b/gi,
          /\bfunding\b/gi
        ],
        tag: 'business',
        priority: 'medium'
      },

      // AI/Technology content
      ai_tech: {
        patterns: [
          /\bartificial intelligence\b/gi,
          /\bmachine learning\b/gi,
          /\bai agent\b/gi,
          /\bai employee\b/gi,
          /\bautomation\b/gi,
          /\bneural network\b/gi,
          /\bllm\b/gi,
          /\blarge language model\b/gi,
          /\bgpt\b/gi,
          /\bchatbot\b/gi,
          /\bapi integration\b/gi,
          /\bweaviate\b/gi,
          /\bvector database\b/gi
        ],
        tag: 'ai-tech',
        priority: 'medium'
      },

      // Marketing/Sales content
      marketing: {
        patterns: [
          /\bmarketing strategy\b/gi,
          /\badvertising\b/gi,
          /\blead generation\b/gi,
          /\bsales funnel\b/gi,
          /\bcustomer acquisition\b/gi,
          /\bsocial media\b/gi,
          /\bcontent marketing\b/gi,
          /\bseo\b/gi,
          /\bppc\b/gi,
          /\btargeted ads\b/gi,
          /\bconversion\b/gi,
          /\bhormozi\b/gi,
          /\b\$100m offer\b/gi
        ],
        tag: 'marketing',
        priority: 'medium'
      },

      // Development/Technical content
      development: {
        patterns: [
          /\bsoftware development\b/gi,
          /\bweb development\b/gi,
          /\bapi development\b/gi,
          /\bdatabase\b/gi,
          /\bfrontend\b/gi,
          /\bbackend\b/gi,
          /\bfull.?stack\b/gi,
          /\bjavascript\b/gi,
          /\bpython\b/gi,
          /\bnode\.?js\b/gi,
          /\breact\b/gi,
          /\bvue\b/gi,
          /\barchitecture\b/gi,
          /\bdeployment\b/gi,
          /\bdevops\b/gi
        ],
        tag: 'development',
        priority: 'medium'
      },

      // Religious/LDS content
      lds: {
        patterns: [
          /\blds\b/gi,
          /\bchurch of jesus christ\b/gi,
          /\blatter.?day saints\b/gi,
          /\bmormon\b/gi,
          /\bmissionary\b/gi,
          /\breturn missionary\b/gi,
          /\belders quorum\b/gi,
          /\brelief society\b/gi,
          /\bstake\b/gi,
          /\bward\b/gi,
          /\btemple\b/gi,
          /\bpriesthood\b/gi,
          /\bgeneral conference\b/gi
        ],
        tag: 'lds',
        priority: 'medium'
      },

      // Personal/Life content
      personal: {
        patterns: [
          /\blife coach\b/gi,
          /\bpersonal development\b/gi,
          /\bgoal setting\b/gi,
          /\bproductivity\b/gi,
          /\btime management\b/gi,
          /\bhabit\b/gi,
          /\bmindset\b/gi,
          /\bself improvement\b/gi,
          /\bwellness\b/gi,
          /\bhealth\b/gi
        ],
        tag: 'personal',
        priority: 'low'
      },

      // Research/Analysis content
      research: {
        patterns: [
          /\bresearch findings\b/gi,
          /\banalysis\b/gi,
          /\bdata analysis\b/gi,
          /\bcase study\b/gi,
          /\bwhitepaper\b/gi,
          /\breport\b/gi,
          /\bsurvey\b/gi,
          /\bstatistics\b/gi,
          /\bmetrics\b/gi,
          /\bkpi\b/gi,
          /\bbenchmark\b/gi
        ],
        tag: 'research',
        priority: 'medium'
      },

      // Financial content
      financial: {
        patterns: [
          /\bfinancial\b/gi,
          /\bbudget\b/gi,
          /\bpricing\b/gi,
          /\bcost\b/gi,
          /\bprofit\b/gi,
          /\brevenue\b/gi,
          /\bincome\b/gi,
          /\bexpense\b/gi,
          /\broi\b/gi,
          /\breturn on investment\b/gi,
          /\bvaluation\b/gi,
          /\bcash flow\b/gi
        ],
        tag: 'financial',
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

  analyzeContent(content, fileName, source) {
    const tags = new Set();
    const matches = {};
    
    if (!content) return { tags: [], matches: {} };
    
    // Combine content, filename, and source for analysis
    const fullText = `${content} ${fileName || ''} ${source || ''}`;
    
    // Check each tag pattern
    Object.entries(this.tagPatterns).forEach(([category, config]) => {
      const categoryMatches = [];
      
      config.patterns.forEach(pattern => {
        const matches = fullText.match(pattern);
        if (matches) {
          categoryMatches.push(...matches);
          tags.add(config.tag);
        }
      });
      
      if (categoryMatches.length > 0) {
        matches[category] = {
          tag: config.tag,
          count: categoryMatches.length,
          examples: [...new Set(categoryMatches)].slice(0, 3), // First 3 unique matches
          priority: config.priority
        };
      }
    });
    
    return {
      tags: Array.from(tags),
      matches: matches
    };
  }

  async getAllDocuments() {
    console.log('📊 Fetching all documents for tagging analysis...\n');
    
    // Get Documents class
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
              lastUpdateTimeUnix
            }
          }
        }
      }`
    };

    // Get WeaviateUpload class
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

    const documents = docsResponse.data?.data?.Get?.Documents || [];
    const uploads = uploadsResponse.data?.data?.Get?.WeaviateUpload || [];

    // Normalize data structure
    const normalizedDocs = documents.map(doc => ({
      id: doc._additional.id,
      content: doc.content,
      title: doc.file_name,
      source: doc.zip_file_name,
      type: 'Documents',
      originalData: doc
    }));

    const normalizedUploads = uploads.map(upload => ({
      id: upload._additional.id,
      content: upload.text,
      title: upload.title,
      source: upload.docSource,
      type: 'WeaviateUpload',
      originalData: upload
    }));

    return [...normalizedDocs, ...normalizedUploads];
  }

  async analyzeAllContent() {
    const allDocuments = await this.getAllDocuments();
    
    console.log(`🔍 Analyzing ${allDocuments.length} documents for contextual tags...\n`);
    
    const results = {
      totalDocuments: allDocuments.length,
      taggedDocuments: 0,
      tagStats: {},
      documentAnalysis: []
    };
    
    allDocuments.forEach((doc, index) => {
      const analysis = this.analyzeContent(doc.content, doc.title, doc.source);
      
      if (analysis.tags.length > 0) {
        results.taggedDocuments++;
        
        // Update tag statistics
        analysis.tags.forEach(tag => {
          if (!results.tagStats[tag]) {
            results.tagStats[tag] = { count: 0, documents: [] };
          }
          results.tagStats[tag].count++;
          results.tagStats[tag].documents.push({
            id: doc.id,
            title: doc.title,
            type: doc.type
          });
        });
        
        results.documentAnalysis.push({
          id: doc.id,
          title: doc.title,
          type: doc.type,
          source: doc.source,
          tags: analysis.tags,
          matches: analysis.matches,
          originalData: doc.originalData
        });
        
        // Show progress for important tags
        if (analysis.tags.includes('collectiv')) {
          console.log(`🎯 COLLECTIV FOUND: "${doc.title}" (${doc.type})`);
          console.log(`   Source: ${doc.source}`);
          console.log(`   Matches: ${Object.values(analysis.matches).map(m => m.examples.join(', ')).join('; ')}`);
          console.log('');
        }
      }
    });
    
    return results;
  }

  printTaggingReport(results) {
    console.log('📊 === SMART TAGGING ANALYSIS REPORT ===\n');
    
    console.log(`📄 Total documents analyzed: ${results.totalDocuments}`);
    console.log(`🏷️  Documents with tags: ${results.taggedDocuments}`);
    console.log(`📈 Coverage: ${((results.taggedDocuments / results.totalDocuments) * 100).toFixed(1)}%\n`);
    
    console.log('🏷️  TAG STATISTICS:');
    const sortedTags = Object.entries(results.tagStats)
      .sort(([,a], [,b]) => b.count - a.count);
    
    sortedTags.forEach(([tag, stats]) => {
      console.log(`   ${tag}: ${stats.count} documents`);
      
      // Show examples for collectiv tag
      if (tag === 'collectiv') {
        console.log('      📋 Collectiv documents:');
        stats.documents.slice(0, 5).forEach(doc => {
          console.log(`         - ${doc.title} (${doc.type})`);
        });
        if (stats.documents.length > 5) {
          console.log(`         ... and ${stats.documents.length - 5} more`);
        }
      }
    });
    
    console.log('\n🎯 COLLECTIV PROJECT ANALYSIS:');
    const collectivDocs = results.documentAnalysis.filter(doc => doc.tags.includes('collectiv'));
    
    if (collectivDocs.length > 0) {
      console.log(`   Found ${collectivDocs.length} documents related to Collective project:`);
      collectivDocs.forEach(doc => {
        console.log(`   📄 "${doc.title}"`);
        console.log(`      Type: ${doc.type}`);
        console.log(`      Source: ${doc.source}`);
        console.log(`      Tags: ${doc.tags.join(', ')}`);
        
        // Show specific matches
        if (doc.matches.collectiv) {
          console.log(`      Matches: ${doc.matches.collectiv.examples.join(', ')}`);
        }
        console.log('');
      });
    } else {
      console.log('   ⚠️  No documents found with Collective-related content');
    }
    
    console.log('🚀 NEXT STEPS:');
    console.log('   1. Review the tagged documents above');
    console.log('   2. Add any missing tag patterns if needed');
    console.log('   3. Proceed with chunked sync using these tags');
    console.log('   4. Tags will be added to Mintlify frontmatter for organization');
  }

  async run() {
    console.log('🏷️  Smart Content Tagger for Weaviate\n');
    console.log('Analyzing content for contextual tags...\n');
    
    try {
      const results = await this.analyzeAllContent();
      this.printTaggingReport(results);
      
      // Save results for use in sync
      const fs = await import('fs/promises');
      await fs.writeFile('./tagging-results.json', JSON.stringify(results, null, 2));
      console.log('\n💾 Tagging results saved to tagging-results.json');
      
      return results;
    } catch (error) {
      console.error('❌ Error during content analysis:', error.message);
      return null;
    }
  }
}

// CLI handling
const args = process.argv.slice(2);
const dryRun = !args.includes('--dry-run=false');

const tagger = new SmartContentTagger(dryRun);

if (args.includes('--help')) {
  console.log(`
🏷️  Smart Content Tagger Usage:
  node smart-content-tagger.js                    # Analyze and show tagging results
  node smart-content-tagger.js --help             # Show this help
  
Tags detected:
  • collectiv - The Collective project content
  • business - Business strategy and planning
  • ai-tech - AI and technology content  
  • marketing - Marketing and sales content
  • development - Software development content
  • lds - LDS/religious content
  • personal - Personal development content
  • research - Research and analysis content
  • financial - Financial and budget content
  `);
} else {
  tagger.run();
}
