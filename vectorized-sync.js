#!/usr/bin/env node

/**
 * Vectorized Sync System for Weaviate
 * Syncs data to vectorized classes with semantic search capabilities
 */

import https from 'https';
import { execSync } from 'child_process';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class VectorizedSyncManager {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 3;
    this.delayBetweenChunks = options.delay || 3000;
    this.dryRun = options.dryRun || false;
    this.useVectorizedClasses = true; // Always use vectorized classes now
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

  async getAllDocumentsFromOldClasses() {
    console.log('📊 Fetching documents from original (non-vectorized) classes...\n');
    
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

    const [docsResponse, uploadsResponse] = await Promise.all([
      this.makeRequest('/v1/graphql', 'POST', documentsQuery),
      this.makeRequest('/v1/graphql', 'POST', uploadsQuery)
    ]);

    const documents = docsResponse.data?.data?.Get?.Documents || [];
    const uploads = uploadsResponse.data?.data?.Get?.WeaviateUpload || [];

    console.log(`   Found ${documents.length} Documents and ${uploads.length} WeaviateUploads`);

    return { documents, uploads };
  }

  async syncToVectorizedClasses(documents, uploads) {
    console.log('⚡ Syncing data to vectorized classes with semantic capabilities...\n');
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - No data will be synced\n');
      return;
    }

    let totalSynced = 0;
    
    // Sync Documents to DocumentsVectorized
    if (documents.length > 0) {
      console.log(`📄 Syncing ${documents.length} documents to DocumentsVectorized...`);
      
      const docChunks = this.chunkArray(documents, this.chunkSize);
      
      for (let i = 0; i < docChunks.length; i++) {
        const chunk = docChunks[i];
        console.log(`   Processing chunk ${i + 1}/${docChunks.length} (${chunk.length} docs)...`);
        
        const batchObjects = chunk.map(doc => ({
          class: 'DocumentsVectorized',
          properties: {
            content: doc.content,
            file_name: doc.file_name,
            file_type: doc.file_type,
            zip_file_name: doc.zip_file_name,
            upload_date: doc.upload_date,
            file_path: doc.file_path
          }
        }));
        
        const response = await this.makeRequest('/v1/batch/objects', 'POST', {
          objects: batchObjects
        });
        
        if (response.status === 200) {
          const successful = response.data?.filter(r => !r.result?.errors) || [];
          totalSynced += successful.length;
          console.log(`     ✅ Synced ${successful.length}/${chunk.length} documents`);
          
          // Show any errors
          const errors = response.data?.filter(r => r.result?.errors) || [];
          if (errors.length > 0) {
            console.log(`     ⚠️  ${errors.length} documents had errors`);
          }
        } else {
          console.log(`     ❌ Batch sync failed:`, response.data);
        }
        
        // Delay between chunks
        if (i < docChunks.length - 1) {
          console.log(`     ⏳ Waiting ${this.delayBetweenChunks}ms before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenChunks));
        }
      }
    }
    
    // Sync WeaviateUploads to WeaviateUploadVectorized
    if (uploads.length > 0) {
      console.log(`\n📤 Syncing ${uploads.length} uploads to WeaviateUploadVectorized...`);
      
      const uploadChunks = this.chunkArray(uploads, this.chunkSize);
      
      for (let i = 0; i < uploadChunks.length; i++) {
        const chunk = uploadChunks[i];
        console.log(`   Processing chunk ${i + 1}/${uploadChunks.length} (${chunk.length} uploads)...`);
        
        const batchObjects = chunk.map(upload => ({
          class: 'WeaviateUploadVectorized',
          properties: {
            title: upload.title,
            text: upload.text,
            description: upload.description,
            docAuthor: upload.docAuthor,
            docSource: upload.docSource,
            published: upload.published,
            url: upload.url,
            chunkSource: upload.chunkSource,
            wordCount: upload.wordCount
          }
        }));
        
        const response = await this.makeRequest('/v1/batch/objects', 'POST', {
          objects: batchObjects
        });
        
        if (response.status === 200) {
          const successful = response.data?.filter(r => !r.result?.errors) || [];
          totalSynced += successful.length;
          console.log(`     ✅ Synced ${successful.length}/${chunk.length} uploads`);
          
          // Show any errors
          const errors = response.data?.filter(r => r.result?.errors) || [];
          if (errors.length > 0) {
            console.log(`     ⚠️  ${errors.length} uploads had errors`);
          }
        } else {
          console.log(`     ❌ Batch sync failed:`, response.data);
        }
        
        // Delay between chunks
        if (i < uploadChunks.length - 1) {
          console.log(`     ⏳ Waiting ${this.delayBetweenChunks}ms before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenChunks));
        }
      }
    }
    
    console.log(`\n🎉 Vectorized sync complete! Total objects synced: ${totalSynced}`);
    return totalSynced;
  }

  async testSemanticSearch() {
    console.log('\n🔍 Testing semantic search capabilities...\n');
    
    // Test 1: Semantic search for Collective project
    console.log('🎯 Test 1: Semantic search for "collective project strategy"');
    
    const semanticQuery = {
      query: `{
        Get {
          DocumentsVectorized(
            nearText: {
              concepts: ["collective project strategy"]
              distance: 0.7
            }
            limit: 5
          ) {
            content
            file_name
            zip_file_name
            _additional {
              distance
              certainty
            }
          }
        }
      }`
    };
    
    const semanticResponse = await this.makeRequest('/v1/graphql', 'POST', semanticQuery);
    const semanticResults = semanticResponse.data?.data?.Get?.DocumentsVectorized || [];
    
    console.log(`   Found ${semanticResults.length} semantically similar documents:`);
    semanticResults.forEach((doc, index) => {
      console.log(`   ${index + 1}. "${doc.file_name}"`);
      console.log(`      Distance: ${doc._additional?.distance?.toFixed(3) || 'N/A'}`);
      console.log(`      Certainty: ${doc._additional?.certainty?.toFixed(3) || 'N/A'}`);
      console.log(`      Content: ${doc.content?.substring(0, 100)}...`);
      console.log('');
    });
    
    // Test 2: Question answering
    console.log('❓ Test 2: Question answering - "What is the Collective project about?"');
    
    const questionQuery = {
      query: `{
        Get {
          WeaviateUploadVectorized(
            ask: {
              question: "What is the Collective project about?"
              properties: ["text"]
            }
            limit: 3
          ) {
            title
            text
            docSource
            _additional {
              answer {
                result
                certainty
              }
            }
          }
        }
      }`
    };
    
    const questionResponse = await this.makeRequest('/v1/graphql', 'POST', questionQuery);
    const questionResults = questionResponse.data?.data?.Get?.WeaviateUploadVectorized || [];
    
    console.log(`   Found ${questionResults.length} relevant documents with answers:`);
    questionResults.forEach((doc, index) => {
      console.log(`   ${index + 1}. "${doc.title}"`);
      if (doc._additional?.answer) {
        console.log(`      Answer: ${doc._additional.answer.result}`);
        console.log(`      Certainty: ${doc._additional.answer.certainty?.toFixed(3) || 'N/A'}`);
      }
      console.log(`      Source: ${doc.docSource}`);
      console.log('');
    });
    
    // Test 3: Hybrid search
    console.log('🔀 Test 3: Hybrid search for "business strategy"');
    
    const hybridQuery = {
      query: `{
        Get {
          WeaviateUploadVectorized(
            hybrid: {
              query: "business strategy"
              alpha: 0.7
            }
            limit: 5
          ) {
            title
            text
            docSource
            _additional {
              score
              explainScore
            }
          }
        }
      }`
    };
    
    const hybridResponse = await this.makeRequest('/v1/graphql', 'POST', hybridQuery);
    const hybridResults = hybridResponse.data?.data?.Get?.WeaviateUploadVectorized || [];
    
    console.log(`   Found ${hybridResults.length} hybrid search results:`);
    hybridResults.forEach((doc, index) => {
      console.log(`   ${index + 1}. "${doc.title}"`);
      console.log(`      Score: ${doc._additional?.score?.toFixed(3) || 'N/A'}`);
      console.log(`      Source: ${doc.docSource}`);
      console.log(`      Content: ${doc.text?.substring(0, 100)}...`);
      console.log('');
    });
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async run(command = 'full-sync') {
    console.log('⚡ Vectorized Sync Manager\n');
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - No data will be synced\n');
    }
    
    try {
      switch (command) {
        case 'test-search':
          await this.testSemanticSearch();
          break;
          
        case 'sync-only':
          const { documents, uploads } = await this.getAllDocumentsFromOldClasses();
          await this.syncToVectorizedClasses(documents, uploads);
          break;
          
        case 'full-sync':
        default:
          const data = await this.getAllDocumentsFromOldClasses();
          const totalSynced = await this.syncToVectorizedClasses(data.documents, data.uploads);
          
          if (totalSynced > 0) {
            console.log('\n⏳ Waiting for vectorization to complete...');
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            await this.testSemanticSearch();
          }
          break;
      }
      
    } catch (error) {
      console.error('❌ Vectorized sync failed:', error.message);
    }
  }
}

// CLI handling
const args = process.argv.slice(2);
const command = args[0] || 'full-sync';

const options = {
  chunkSize: parseInt(args.find(arg => arg.startsWith('--chunk-size='))?.split('=')[1]) || 3,
  delay: parseInt(args.find(arg => arg.startsWith('--delay='))?.split('=')[1]) || 3000,
  dryRun: args.includes('--dry-run')
};

const syncManager = new VectorizedSyncManager(options);

if (args.includes('--help')) {
  console.log(`
⚡ Vectorized Sync Manager

Syncs data to vectorized Weaviate classes with semantic search capabilities.

Usage:
  node vectorized-sync.js [command] [options]

Commands:
  full-sync    - Sync data and test semantic search (default)
  sync-only    - Only sync data to vectorized classes
  test-search  - Only test semantic search capabilities

Options:
  --chunk-size=N  Objects per batch (default: 3)
  --delay=N       Delay between batches in ms (default: 3000)
  --dry-run       Show what would be done without syncing
  --help          Show this help

Examples:
  node vectorized-sync.js --dry-run
  node vectorized-sync.js sync-only --chunk-size=5
  node vectorized-sync.js test-search
  `);
} else {
  syncManager.run(command);
}
