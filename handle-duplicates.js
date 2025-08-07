#!/usr/bin/env node

/**
 * Weaviate Duplicate Handler
 * Intelligently handle duplicate files by keeping the best version
 */

import https from 'https';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class DuplicateHandler {
  constructor(dryRun = true) {
    this.dryRun = dryRun;
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

  async findDuplicates() {
    console.log('🔍 Finding duplicate files in Documents class...\n');
    
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
    
    // Group by file name
    const fileGroups = {};
    documents.forEach(doc => {
      const name = doc.file_name;
      if (name) {
        if (!fileGroups[name]) fileGroups[name] = [];
        fileGroups[name].push(doc);
      }
    });
    
    // Find duplicates
    const duplicates = {};
    Object.entries(fileGroups).forEach(([name, docs]) => {
      if (docs.length > 1) {
        duplicates[name] = docs;
      }
    });
    
    return duplicates;
  }

  selectBestVersion(duplicates) {
    // Scoring criteria:
    // 1. Most recent upload date (higher score)
    // 2. Longest content (higher score)
    // 3. Most complete metadata (higher score)
    
    return duplicates.map(doc => {
      let score = 0;
      
      // Content length score (0-40 points)
      const contentLength = doc.content?.length || 0;
      score += Math.min(40, contentLength / 100);
      
      // Upload date score (0-30 points)
      if (doc.upload_date) {
        const uploadTime = new Date(doc.upload_date).getTime();
        const now = Date.now();
        const daysSinceUpload = (now - uploadTime) / (1000 * 60 * 60 * 24);
        score += Math.max(0, 30 - daysSinceUpload / 10); // Newer = higher score
      }
      
      // Metadata completeness score (0-20 points)
      if (doc.zip_file_name) score += 5;
      if (doc.file_path) score += 5;
      if (doc.file_type) score += 5;
      if (doc.upload_date) score += 5;
      
      // File path specificity (0-10 points)
      if (doc.file_path && !doc.file_path.includes('temp')) score += 10;
      
      return { ...doc, score };
    }).sort((a, b) => b.score - a.score);
  }

  async handleDuplicates() {
    const duplicates = await this.findDuplicates();
    const duplicateNames = Object.keys(duplicates);
    
    if (duplicateNames.length === 0) {
      console.log('✅ No duplicates found!');
      return;
    }
    
    console.log(`🔄 Found ${duplicateNames.length} files with duplicates:\n`);
    
    let totalToDelete = 0;
    const deletionPlan = [];
    
    for (const [fileName, docs] of Object.entries(duplicates)) {
      console.log(`📄 "${fileName}" - ${docs.length} copies:`);
      
      const rankedDocs = this.selectBestVersion(docs);
      const bestDoc = rankedDocs[0];
      const toDelete = rankedDocs.slice(1);
      
      console.log(`   ✅ KEEP: ${bestDoc._additional.id} (score: ${bestDoc.score.toFixed(1)})`);
      console.log(`      - Content: ${bestDoc.content?.length || 0} chars`);
      console.log(`      - Upload: ${bestDoc.upload_date || 'Unknown'}`);
      console.log(`      - Source: ${bestDoc.zip_file_name || 'Unknown'}`);
      
      toDelete.forEach(doc => {
        console.log(`   ❌ DELETE: ${doc._additional.id} (score: ${doc.score.toFixed(1)})`);
        console.log(`      - Content: ${doc.content?.length || 0} chars`);
        console.log(`      - Upload: ${doc.upload_date || 'Unknown'}`);
        console.log(`      - Source: ${doc.zip_file_name || 'Unknown'}`);
        
        deletionPlan.push({
          id: doc._additional.id,
          fileName: fileName,
          reason: `Duplicate (kept better version ${bestDoc._additional.id})`
        });
      });
      
      totalToDelete += toDelete.length;
      console.log('');
    }
    
    console.log(`📊 SUMMARY:`);
    console.log(`   Files with duplicates: ${duplicateNames.length}`);
    console.log(`   Total documents to delete: ${totalToDelete}`);
    console.log(`   Space savings: ~${totalToDelete} documents\n`);
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN - No files actually deleted');
      console.log('   Run with --dry-run=false to actually delete duplicates');
      return deletionPlan;
    }
    
    // Actually delete duplicates
    console.log('🗑️  Deleting duplicate files...\n');
    let deleted = 0;
    
    for (const item of deletionPlan) {
      try {
        const response = await this.makeRequest(`/v1/objects/${item.id}`, 'DELETE');
        if (response.status === 204) {
          console.log(`✅ Deleted duplicate: ${item.fileName} (${item.id})`);
          deleted++;
        } else {
          console.log(`❌ Failed to delete: ${item.fileName} (${item.id})`);
        }
      } catch (error) {
        console.log(`❌ Error deleting ${item.fileName}: ${error.message}`);
      }
    }
    
    console.log(`\n🎉 Cleanup complete! Deleted ${deleted} duplicate files.`);
    return deletionPlan;
  }
}

// CLI handling
const args = process.argv.slice(2);
const dryRun = !args.includes('--dry-run=false');

const handler = new DuplicateHandler(dryRun);

console.log('🔄 Weaviate Duplicate Handler');
console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE (will delete files)'}\n`);

handler.handleDuplicates().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
