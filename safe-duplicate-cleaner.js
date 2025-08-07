#!/usr/bin/env node

/**
 * Safe Duplicate Cleaner
 * Only deletes files with truly identical content (MD5 hash match)
 */

import https from 'https';
import crypto from 'crypto';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class SafeDuplicateCleaner {
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

  getContentHash(content) {
    if (!content) return null;
    return crypto.createHash('md5').update(content.trim()).digest('hex');
  }

  async findExactDuplicates() {
    console.log('🔍 Finding files with identical content (MD5 hash match)...\n');
    
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
    
    // Create content hash map
    const hashMap = {};
    documents.forEach(doc => {
      const hash = this.getContentHash(doc.content);
      if (hash) {
        if (!hashMap[hash]) hashMap[hash] = [];
        hashMap[hash].push(doc);
      }
    });
    
    // Find groups with multiple files (exact duplicates)
    const exactDuplicates = Object.values(hashMap).filter(group => group.length > 1);
    
    return exactDuplicates;
  }

  selectBestVersion(duplicateGroup) {
    // Keep the most recent file, or the one with the most complete metadata
    return duplicateGroup.sort((a, b) => {
      // Primary: Most recent upload date
      const dateA = new Date(a.upload_date || 0).getTime();
      const dateB = new Date(b.upload_date || 0).getTime();
      if (dateA !== dateB) return dateB - dateA;
      
      // Secondary: More complete metadata
      const scoreA = (a.zip_file_name ? 1 : 0) + (a.file_path ? 1 : 0) + (a.file_type ? 1 : 0);
      const scoreB = (b.zip_file_name ? 1 : 0) + (b.file_path ? 1 : 0) + (b.file_type ? 1 : 0);
      return scoreB - scoreA;
    });
  }

  async cleanExactDuplicates() {
    const duplicateGroups = await this.findExactDuplicates();
    
    if (duplicateGroups.length === 0) {
      console.log('✅ No exact content duplicates found!');
      return;
    }
    
    console.log(`🎯 Found ${duplicateGroups.length} groups of files with identical content:\n`);
    
    const deletionPlan = [];
    let totalToDelete = 0;
    
    duplicateGroups.forEach((group, index) => {
      const sortedGroup = this.selectBestVersion(group);
      const keepFile = sortedGroup[0];
      const deleteFiles = sortedGroup.slice(1);
      
      console.log(`📄 Group ${index + 1}: "${keepFile.file_name}" (${group.length} identical files)`);
      console.log(`   ✅ KEEP: ${keepFile._additional.id}`);
      console.log(`      - Upload: ${keepFile.upload_date}`);
      console.log(`      - Source: ${keepFile.zip_file_name}`);
      console.log(`      - Content: ${keepFile.content?.length || 0} chars`);
      
      deleteFiles.forEach(file => {
        console.log(`   ❌ DELETE: ${file._additional.id}`);
        console.log(`      - Upload: ${file.upload_date}`);
        console.log(`      - Source: ${file.zip_file_name}`);
        
        deletionPlan.push({
          id: file._additional.id,
          fileName: file.file_name,
          reason: `Exact duplicate of ${keepFile._additional.id}`,
          uploadDate: file.upload_date,
          source: file.zip_file_name
        });
      });
      
      totalToDelete += deleteFiles.length;
      console.log('');
    });
    
    console.log(`📊 SUMMARY:`);
    console.log(`   Duplicate groups: ${duplicateGroups.length}`);
    console.log(`   Files to delete: ${totalToDelete}`);
    console.log(`   Files to keep: ${duplicateGroups.length}`);
    console.log(`   Space saved: ${totalToDelete} documents\n`);
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN - No files actually deleted');
      console.log('   Run with --dry-run=false to delete these exact duplicates');
      return deletionPlan;
    }
    
    // Actually delete the duplicates
    console.log('🗑️  Deleting exact duplicate files...\n');
    let deleted = 0;
    
    for (const item of deletionPlan) {
      try {
        const response = await this.makeRequest(`/v1/objects/${item.id}`, 'DELETE');
        if (response.status === 204) {
          console.log(`✅ Deleted: ${item.fileName} (${item.id})`);
          deleted++;
        } else {
          console.log(`❌ Failed to delete: ${item.fileName} (${item.id})`);
        }
      } catch (error) {
        console.log(`❌ Error deleting ${item.fileName}: ${error.message}`);
      }
    }
    
    console.log(`\n🎉 Safe cleanup complete! Deleted ${deleted} exact duplicate files.`);
    console.log(`✅ All unique content preserved.`);
    
    return deletionPlan;
  }
}

// CLI handling
const args = process.argv.slice(2);
const dryRun = !args.includes('--dry-run=false');

const cleaner = new SafeDuplicateCleaner(dryRun);

console.log('🧹 Safe Duplicate Cleaner');
console.log('Only deletes files with identical content (MD5 hash match)');
console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE (will delete files)'}\n`);

cleaner.cleanExactDuplicates().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
