#!/usr/bin/env node

/**
 * Content-Based Duplicate Detector
 * Analyzes actual content similarity, not just file names
 */

import https from 'https';
import crypto from 'crypto';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class ContentDuplicateDetector {
  constructor() {
    this.similarityThreshold = 0.8; // 80% similarity threshold
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

  // Create content hash for exact duplicate detection
  getContentHash(content) {
    if (!content) return null;
    return crypto.createHash('md5').update(content.trim()).digest('hex');
  }

  // Calculate similarity between two texts using Jaccard similarity
  calculateSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    // Normalize texts
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    
    const words1 = new Set(normalize(text1));
    const words2 = new Set(normalize(text2));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  async analyzeContentDuplicates() {
    console.log('🔍 Analyzing content-based duplicates (not just file names)...\n');
    
    const query = {
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

    const response = await this.makeRequest('/v1/graphql', 'POST', query);
    const documents = response.data?.data?.Get?.Documents || [];
    
    console.log(`📊 Analyzing ${documents.length} documents for content similarity...\n`);
    
    // Group by file name first (same as before)
    const fileGroups = {};
    documents.forEach(doc => {
      const name = doc.file_name;
      if (name) {
        if (!fileGroups[name]) fileGroups[name] = [];
        fileGroups[name].push(doc);
      }
    });
    
    // Analyze each group for content similarity
    const results = {
      exactDuplicates: [],
      similarContent: [],
      differentContent: [],
      totalSameNameFiles: 0
    };
    
    for (const [fileName, docs] of Object.entries(fileGroups)) {
      if (docs.length < 2) continue; // Skip files with no duplicates
      
      results.totalSameNameFiles += docs.length;
      
      console.log(`📄 Analyzing "${fileName}" (${docs.length} files):`);
      
      // Create content hashes and similarity matrix
      const contentAnalysis = docs.map(doc => ({
        ...doc,
        contentHash: this.getContentHash(doc.content),
        contentLength: doc.content?.length || 0,
        contentPreview: (doc.content || '').substring(0, 100) + '...'
      }));
      
      // Find exact content matches
      const hashGroups = {};
      contentAnalysis.forEach(doc => {
        if (doc.contentHash) {
          if (!hashGroups[doc.contentHash]) hashGroups[doc.contentHash] = [];
          hashGroups[doc.contentHash].push(doc);
        }
      });
      
      const exactMatches = Object.values(hashGroups).filter(group => group.length > 1);
      
      if (exactMatches.length > 0) {
        console.log(`   🎯 EXACT CONTENT DUPLICATES found:`);
        exactMatches.forEach((group, index) => {
          console.log(`     Group ${index + 1}: ${group.length} identical files`);
          group.forEach(doc => {
            console.log(`       - ${doc._additional.id} (${doc.contentLength} chars, ${doc.upload_date})`);
            console.log(`         Source: ${doc.zip_file_name}`);
            console.log(`         Preview: ${doc.contentPreview}`);
          });
          
          results.exactDuplicates.push({
            fileName,
            group,
            reason: 'Identical content (MD5 hash match)'
          });
        });
      } else {
        // Check for similar content (not exact)
        console.log(`   📝 Content comparison:`);
        
        let foundSimilar = false;
        for (let i = 0; i < contentAnalysis.length; i++) {
          for (let j = i + 1; j < contentAnalysis.length; j++) {
            const doc1 = contentAnalysis[i];
            const doc2 = contentAnalysis[j];
            
            const similarity = this.calculateSimilarity(doc1.content, doc2.content);
            
            console.log(`     ${doc1._additional.id} vs ${doc2._additional.id}:`);
            console.log(`       Similarity: ${(similarity * 100).toFixed(1)}%`);
            console.log(`       Lengths: ${doc1.contentLength} vs ${doc2.contentLength} chars`);
            console.log(`       Sources: ${doc1.zip_file_name} vs ${doc2.zip_file_name}`);
            
            if (similarity > this.similarityThreshold) {
              console.log(`       🔄 HIGH SIMILARITY - Likely duplicates`);
              foundSimilar = true;
              
              results.similarContent.push({
                fileName,
                doc1,
                doc2,
                similarity,
                reason: `${(similarity * 100).toFixed(1)}% content similarity`
              });
            } else {
              console.log(`       ✅ DIFFERENT CONTENT - Keep both`);
            }
          }
        }
        
        if (!foundSimilar) {
          results.differentContent.push({
            fileName,
            docs: contentAnalysis,
            reason: 'Same name but different content'
          });
        }
      }
      
      console.log('');
    }
    
    return results;
  }

  printSummary(results) {
    console.log('📊 === CONTENT DUPLICATE ANALYSIS SUMMARY ===\n');
    
    console.log(`📄 Files with same names: ${results.totalSameNameFiles}`);
    console.log(`🎯 Exact content duplicates: ${results.exactDuplicates.length} groups`);
    console.log(`🔄 Similar content (${this.similarityThreshold * 100}%+ match): ${results.similarContent.length} pairs`);
    console.log(`✅ Different content (same name only): ${results.differentContent.length} groups\n`);
    
    if (results.exactDuplicates.length > 0) {
      console.log('🎯 EXACT DUPLICATES (safe to delete):');
      results.exactDuplicates.forEach((item, index) => {
        const toDelete = item.group.length - 1;
        console.log(`   ${index + 1}. "${item.fileName}" - ${toDelete} files can be deleted`);
      });
      console.log('');
    }
    
    if (results.similarContent.length > 0) {
      console.log('🔄 SIMILAR CONTENT (review recommended):');
      results.similarContent.forEach((item, index) => {
        console.log(`   ${index + 1}. "${item.fileName}" - ${item.similarity.toFixed(2)} similarity`);
      });
      console.log('');
    }
    
    if (results.differentContent.length > 0) {
      console.log('✅ DIFFERENT CONTENT (keep all):');
      results.differentContent.forEach((item, index) => {
        console.log(`   ${index + 1}. "${item.fileName}" - ${item.docs.length} files with unique content`);
      });
      console.log('');
    }
    
    const totalExactDuplicates = results.exactDuplicates.reduce((sum, group) => sum + (group.group.length - 1), 0);
    const totalSimilarDuplicates = results.similarContent.length;
    
    console.log('🎯 RECOMMENDATIONS:');
    if (totalExactDuplicates > 0) {
      console.log(`   • SAFE TO DELETE: ${totalExactDuplicates} exact duplicate files`);
    }
    if (totalSimilarDuplicates > 0) {
      console.log(`   • REVIEW MANUALLY: ${totalSimilarDuplicates} similar content pairs`);
    }
    if (results.differentContent.length > 0) {
      console.log(`   • KEEP ALL: ${results.differentContent.length} groups have unique content despite same names`);
    }
    
    if (totalExactDuplicates === 0 && totalSimilarDuplicates === 0) {
      console.log('   ✅ No true content duplicates found! Files with same names have different content.');
    }
  }

  async run() {
    try {
      const results = await this.analyzeContentDuplicates();
      this.printSummary(results);
      return results;
    } catch (error) {
      console.error('❌ Error analyzing content duplicates:', error.message);
      return null;
    }
  }
}

// Run the analysis
const detector = new ContentDuplicateDetector();
detector.run();
