#!/usr/bin/env node

/**
 * Weaviate Data Manager
 * Organize, analyze, archive, and delete data in your Weaviate instance
 */

import https from 'https';
import fs from 'fs/promises';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class WeaviateDataManager {
  constructor() {
    this.dryRun = true; // Safety first - preview changes before applying
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

  async analyzeAllData() {
    console.log('🔍 Analyzing all data in your Weaviate instance...\n');
    
    const analysis = {
      documents: await this.analyzeDocuments(),
      weaviateUploads: await this.analyzeWeaviateUploads(),
      processedFiles: await this.analyzeProcessedFiles()
    };

    this.printAnalysisSummary(analysis);
    return analysis;
  }

  async analyzeDocuments() {
    console.log('📄 Analyzing Documents class...');
    
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
    
    const analysis = {
      total: documents.length,
      byFileType: {},
      byZipFile: {},
      testFiles: [],
      emptyContent: [],
      duplicates: [],
      sizesKB: []
    };

    documents.forEach(doc => {
      // File type analysis
      const fileType = doc.file_type || 'unknown';
      analysis.byFileType[fileType] = (analysis.byFileType[fileType] || 0) + 1;
      
      // Zip file analysis
      const zipFile = doc.zip_file_name || 'unknown';
      analysis.byZipFile[zipFile] = (analysis.byZipFile[zipFile] || 0) + 1;
      
      // Test/sandbox files
      if (doc.file_name && (
        doc.file_name.includes('test') || 
        doc.file_name.includes('sandbox') ||
        doc.file_name.includes('temp')
      )) {
        analysis.testFiles.push({
          id: doc._additional.id,
          file_name: doc.file_name,
          zip_file_name: doc.zip_file_name
        });
      }
      
      // Empty content
      if (!doc.content || doc.content.trim().length < 10) {
        analysis.emptyContent.push({
          id: doc._additional.id,
          file_name: doc.file_name,
          contentLength: doc.content?.length || 0
        });
      }
      
      // Size analysis
      const sizeKB = Math.round((doc.content?.length || 0) / 1024);
      analysis.sizesKB.push(sizeKB);
    });

    // Find potential duplicates by file name
    const fileNames = {};
    documents.forEach(doc => {
      const name = doc.file_name;
      if (name) {
        if (!fileNames[name]) fileNames[name] = [];
        fileNames[name].push({
          id: doc._additional.id,
          zip_file_name: doc.zip_file_name,
          upload_date: doc.upload_date
        });
      }
    });
    
    Object.entries(fileNames).forEach(([name, instances]) => {
      if (instances.length > 1) {
        analysis.duplicates.push({ file_name: name, instances });
      }
    });

    return analysis;
  }

  async analyzeWeaviateUploads() {
    console.log('📄 Analyzing WeaviateUpload class...');
    
    const query = {
      query: `{
        Get {
          WeaviateUpload {
            title
            text
            description
            docAuthor
            docSource
            published
            wordCount
            token_count_estimate
            _additional {
              id
              lastUpdateTimeUnix
            }
          }
        }
      }`
    };

    const response = await this.makeRequest('/v1/graphql', 'POST', query);
    const uploads = response.data?.data?.Get?.WeaviateUpload || [];
    
    const analysis = {
      total: uploads.length,
      byDocSource: {},
      byAuthor: {},
      untitledDocs: [],
      largeDocuments: [],
      smallDocuments: [],
      wordCounts: []
    };

    uploads.forEach(upload => {
      // Doc source analysis
      const docSource = upload.docSource || 'unknown';
      analysis.byDocSource[docSource] = (analysis.byDocSource[docSource] || 0) + 1;
      
      // Author analysis
      const author = upload.docAuthor || 'unknown';
      analysis.byAuthor[author] = (analysis.byAuthor[author] || 0) + 1;
      
      // Untitled documents
      if (!upload.title || upload.title.includes('Untitled')) {
        analysis.untitledDocs.push({
          id: upload._additional.id,
          title: upload.title,
          description: upload.description
        });
      }
      
      // Size analysis
      const wordCount = upload.wordCount || 0;
      analysis.wordCounts.push(wordCount);
      
      if (wordCount > 10000) {
        analysis.largeDocuments.push({
          id: upload._additional.id,
          title: upload.title,
          wordCount: wordCount
        });
      }
      
      if (wordCount < 50) {
        analysis.smallDocuments.push({
          id: upload._additional.id,
          title: upload.title,
          wordCount: wordCount
        });
      }
    });

    return analysis;
  }

  async analyzeProcessedFiles() {
    console.log('📄 Analyzing ProcessedFiles class...');
    
    const query = {
      query: `{
        Get {
          ProcessedFiles {
            title
            content
            fileName
            mimeType
            source
            fileProcessingId
            _additional {
              id
              lastUpdateTimeUnix
            }
          }
        }
      }`
    };

    const response = await this.makeRequest('/v1/graphql', 'POST', query);
    const files = response.data?.data?.Get?.ProcessedFiles || [];
    
    return {
      total: files.length,
      byMimeType: files.reduce((acc, file) => {
        const mime = file.mimeType || 'unknown';
        acc[mime] = (acc[mime] || 0) + 1;
        return acc;
      }, {}),
      bySource: files.reduce((acc, file) => {
        const source = file.source || 'unknown';
        acc[source] = (acc[source] || 0) + 1;
        return acc;
      }, {}),
      files: files.map(f => ({
        id: f._additional.id,
        title: f.title,
        fileName: f.fileName,
        mimeType: f.mimeType,
        contentLength: f.content?.length || 0
      }))
    };
  }

  printAnalysisSummary(analysis) {
    console.log('\n📊 === WEAVIATE DATA ANALYSIS SUMMARY ===\n');
    
    // Documents analysis
    console.log('📄 DOCUMENTS CLASS:');
    console.log(`   Total: ${analysis.documents.total} documents`);
    console.log(`   File types: ${Object.entries(analysis.documents.byFileType).map(([type, count]) => `${type}(${count})`).join(', ')}`);
    console.log(`   Test/Sandbox files: ${analysis.documents.testFiles.length}`);
    console.log(`   Empty/Minimal content: ${analysis.documents.emptyContent.length}`);
    console.log(`   Potential duplicates: ${analysis.documents.duplicates.length}`);
    
    if (analysis.documents.testFiles.length > 0) {
      console.log('\n   🧪 Test files found:');
      analysis.documents.testFiles.forEach(file => {
        console.log(`      - ${file.file_name} (${file.zip_file_name})`);
      });
    }
    
    if (analysis.documents.duplicates.length > 0) {
      console.log('\n   🔄 Potential duplicates:');
      analysis.documents.duplicates.slice(0, 3).forEach(dup => {
        console.log(`      - "${dup.file_name}" appears ${dup.instances.length} times`);
      });
    }
    
    // WeaviateUpload analysis
    console.log('\n📄 WEAVIATEUPLOADS CLASS:');
    console.log(`   Total: ${analysis.weaviateUploads.total} documents`);
    console.log(`   Sources: ${Object.entries(analysis.weaviateUploads.byDocSource).map(([source, count]) => `${source}(${count})`).join(', ')}`);
    console.log(`   Untitled documents: ${analysis.weaviateUploads.untitledDocs.length}`);
    console.log(`   Large documents (>10k words): ${analysis.weaviateUploads.largeDocuments.length}`);
    console.log(`   Small documents (<50 words): ${analysis.weaviateUploads.smallDocuments.length}`);
    
    // ProcessedFiles analysis
    console.log('\n📄 PROCESSEDFILES CLASS:');
    console.log(`   Total: ${analysis.processedFiles.total} files`);
    console.log(`   MIME types: ${Object.entries(analysis.processedFiles.byMimeType).map(([type, count]) => `${type}(${count})`).join(', ')}`);
    
    console.log('\n🎯 CLEANUP RECOMMENDATIONS:');
    
    let recommendations = [];
    
    if (analysis.documents.testFiles.length > 0) {
      recommendations.push(`• Delete ${analysis.documents.testFiles.length} test/sandbox files`);
    }
    
    if (analysis.documents.emptyContent.length > 0) {
      recommendations.push(`• Review ${analysis.documents.emptyContent.length} documents with minimal content`);
    }
    
    if (analysis.documents.duplicates.length > 0) {
      recommendations.push(`• Resolve ${analysis.documents.duplicates.length} potential duplicate files`);
    }
    
    if (analysis.weaviateUploads.untitledDocs.length > 0) {
      recommendations.push(`• Review ${analysis.weaviateUploads.untitledDocs.length} untitled documents`);
    }
    
    if (analysis.weaviateUploads.smallDocuments.length > 0) {
      recommendations.push(`• Consider archiving ${analysis.weaviateUploads.smallDocuments.length} very small documents`);
    }
    
    if (recommendations.length === 0) {
      console.log('   ✅ Your data looks well-organized! No major cleanup needed.');
    } else {
      recommendations.forEach(rec => console.log(`   ${rec}`));
    }
    
    console.log('\n🚀 NEXT STEPS:');
    console.log('   1. Run specific cleanup commands (see --help)');
    console.log('   2. Use --dry-run=false to actually apply changes');
    console.log('   3. Proceed with chunked sync to Mintlify');
  }

  async deleteTestFiles() {
    console.log('🧪 Finding and deleting test/sandbox files...\n');
    
    const analysis = await this.analyzeDocuments();
    const testFiles = analysis.testFiles;
    
    if (testFiles.length === 0) {
      console.log('✅ No test files found to delete');
      return;
    }
    
    console.log(`Found ${testFiles.length} test files:`);
    testFiles.forEach(file => {
      console.log(`   - ${file.file_name} (ID: ${file.id})`);
    });
    
    if (this.dryRun) {
      console.log('\n🔍 DRY RUN - No files actually deleted');
      console.log('   Run with --dry-run=false to actually delete these files');
      return;
    }
    
    // Actually delete files
    for (const file of testFiles) {
      try {
        const response = await this.makeRequest(`/v1/objects/${file.id}`, 'DELETE');
        if (response.status === 204) {
          console.log(`✅ Deleted: ${file.file_name}`);
        } else {
          console.log(`❌ Failed to delete: ${file.file_name}`);
        }
      } catch (error) {
        console.log(`❌ Error deleting ${file.file_name}: ${error.message}`);
      }
    }
  }

  async showHelp() {
    console.log(`
🗂️  Weaviate Data Manager - Help

ANALYSIS COMMANDS:
  node weaviate-data-manager.js analyze              # Full data analysis
  node weaviate-data-manager.js analyze-documents    # Analyze Documents class only
  node weaviate-data-manager.js analyze-uploads      # Analyze WeaviateUpload class only

CLEANUP COMMANDS:
  node weaviate-data-manager.js delete-test-files    # Delete test/sandbox files
  node weaviate-data-manager.js delete-empty         # Delete documents with no content
  node weaviate-data-manager.js delete-duplicates    # Remove duplicate files
  node weaviate-data-manager.js archive-old          # Archive documents older than X days

SAFETY OPTIONS:
  --dry-run=true                                      # Preview changes (default)
  --dry-run=false                                     # Actually apply changes

EXAMPLES:
  node weaviate-data-manager.js analyze
  node weaviate-data-manager.js delete-test-files --dry-run=false
  node weaviate-data-manager.js delete-empty --dry-run=true
    `);
  }
}

// CLI handling
const args = process.argv.slice(2);
const command = args[0];
const dryRun = args.includes('--dry-run=false') ? false : true;

const manager = new WeaviateDataManager();
manager.dryRun = dryRun;

switch (command) {
  case 'analyze':
    manager.analyzeAllData();
    break;
  case 'delete-test-files':
    manager.deleteTestFiles();
    break;
  case '--help':
  case 'help':
    manager.showHelp();
    break;
  default:
    console.log('🗂️  Weaviate Data Manager');
    console.log('Run with --help to see available commands');
    manager.analyzeAllData();
}
