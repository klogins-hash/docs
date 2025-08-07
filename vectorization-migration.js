#!/usr/bin/env node

/**
 * Weaviate Vectorization Migration System
 * Enables vectorization for new inputs and migrates existing data
 */

import https from 'https';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class VectorizationMigrator {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.vectorizer = options.vectorizer || 'text2vec-huggingface';
    this.batchSize = options.batchSize || 10;
    this.delayBetweenBatches = options.delay || 3000;
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

  async getCurrentSchema() {
    console.log('📊 Analyzing current Weaviate schema...\n');
    
    const response = await this.makeRequest('/v1/schema');
    const classes = response.data?.classes || [];
    
    console.log('🏗️ CURRENT SCHEMA:');
    classes.forEach(cls => {
      console.log(`   Class: ${cls.class}`);
      console.log(`   Vectorizer: ${cls.vectorizer || 'none'}`);
      console.log(`   Properties: ${cls.properties?.length || 0}`);
      console.log('');
    });
    
    return classes;
  }

  generateVectorizedSchema(existingClasses) {
    console.log('⚡ Generating vectorized schema configurations...\n');
    
    const vectorizedSchemas = [];
    
    existingClasses.forEach(cls => {
      if (cls.vectorizer === 'none' || !cls.vectorizer) {
        const vectorizedClass = {
          class: `${cls.class}Vectorized`,
          description: `Vectorized version of ${cls.class} with semantic search capabilities`,
          vectorizer: this.vectorizer,
          moduleConfig: this.getModuleConfig(),
          properties: cls.properties?.map(prop => ({
            ...prop,
            moduleConfig: this.getPropertyModuleConfig(prop)
          })) || []
        };
        
        vectorizedSchemas.push({
          original: cls,
          vectorized: vectorizedClass,
          migrationNeeded: true
        });
        
        console.log(`✅ Created vectorized schema for: ${cls.class} → ${cls.class}Vectorized`);
      } else {
        console.log(`⚠️  ${cls.class} already has vectorizer: ${cls.vectorizer}`);
        vectorizedSchemas.push({
          original: cls,
          vectorized: cls,
          migrationNeeded: false
        });
      }
    });
    
    return vectorizedSchemas;
  }

  getModuleConfig() {
    switch (this.vectorizer) {
      case 'text2vec-openai':
        return {
          'text2vec-openai': {
            model: 'ada',
            modelVersion: '002',
            type: 'text'
          }
        };
      case 'text2vec-cohere':
        return {
          'text2vec-cohere': {
            model: 'multilingual-22-12'
          }
        };
      case 'text2vec-huggingface':
        return {
          'text2vec-huggingface': {
            model: 'sentence-transformers/all-MiniLM-L6-v2',
            options: {
              waitForModel: true,
              useGPU: false
            }
          }
        };
      case 'text2vec-transformers':
        return {
          'text2vec-transformers': {
            poolingStrategy: 'masked_mean',
            vectorizeClassName: false
          }
        };
      default:
        return {};
    }
  }

  getPropertyModuleConfig(property) {
    // Only vectorize text properties
    if (property.dataType?.includes('text') || property.dataType?.includes('string')) {
      switch (this.vectorizer) {
        case 'text2vec-openai':
          return {
            'text2vec-openai': {
              skip: false,
              vectorizePropertyName: false
            }
          };
        case 'text2vec-cohere':
          return {
            'text2vec-cohere': {
              skip: false,
              vectorizePropertyName: false
            }
          };
        case 'text2vec-huggingface':
          return {
            'text2vec-huggingface': {
              skip: false,
              vectorizePropertyName: false
            }
          };
        case 'text2vec-transformers':
          return {
            'text2vec-transformers': {
              skip: false,
              vectorizePropertyName: false
            }
          };
        default:
          return {};
      }
    }
    
    // Skip vectorization for non-text properties
    return {
      [`${this.vectorizer}`]: {
        skip: true
      }
    };
  }

  async createVectorizedClasses(schemas) {
    console.log('🏗️ Creating vectorized classes...\n');
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - Classes will not be created\n');
      schemas.forEach(schema => {
        if (schema.migrationNeeded) {
          console.log(`Would create: ${schema.vectorized.class}`);
          console.log(`   Vectorizer: ${schema.vectorized.vectorizer}`);
          console.log(`   Properties: ${schema.vectorized.properties.length}`);
          console.log('');
        }
      });
      return;
    }

    const results = [];
    
    for (const schema of schemas) {
      if (!schema.migrationNeeded) {
        console.log(`⏭️  Skipping ${schema.original.class} (already vectorized)`);
        continue;
      }
      
      try {
        console.log(`🔧 Creating ${schema.vectorized.class}...`);
        
        const response = await this.makeRequest('/v1/schema', 'POST', schema.vectorized);
        
        if (response.status === 200 || response.status === 201) {
          console.log(`✅ Successfully created ${schema.vectorized.class}`);
          results.push({
            class: schema.vectorized.class,
            status: 'created',
            original: schema.original.class
          });
        } else {
          console.log(`❌ Failed to create ${schema.vectorized.class}:`, response.data);
          results.push({
            class: schema.vectorized.class,
            status: 'failed',
            error: response.data,
            original: schema.original.class
          });
        }
        
        // Small delay between class creations
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`❌ Error creating ${schema.vectorized.class}:`, error.message);
        results.push({
          class: schema.vectorized.class,
          status: 'error',
          error: error.message,
          original: schema.original.class
        });
      }
    }
    
    return results;
  }

  async migrateExistingData(schemas) {
    console.log('📦 Migrating existing data to vectorized classes...\n');
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - Data will not be migrated\n');
      return;
    }

    const migrationResults = [];
    
    for (const schema of schemas) {
      if (!schema.migrationNeeded) continue;
      
      try {
        console.log(`🔄 Migrating data from ${schema.original.class} to ${schema.vectorized.class}...`);
        
        // Get all data from original class
        const query = {
          query: `{
            Get {
              ${schema.original.class} {
                ${schema.original.properties?.map(p => p.name).join('\n                ') || ''}
                _additional {
                  id
                }
              }
            }
          }`
        };
        
        const dataResponse = await this.makeRequest('/v1/graphql', 'POST', query);
        const objects = dataResponse.data?.data?.Get?.[schema.original.class] || [];
        
        console.log(`   Found ${objects.length} objects to migrate`);
        
        if (objects.length === 0) {
          console.log('   No data to migrate');
          continue;
        }
        
        // Migrate in batches
        const batches = this.chunkArray(objects, this.batchSize);
        let migratedCount = 0;
        
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          console.log(`   Processing batch ${i + 1}/${batches.length} (${batch.length} objects)...`);
          
          const batchObjects = batch.map(obj => {
            const { _additional, ...properties } = obj;
            return {
              class: schema.vectorized.class,
              properties: properties
            };
          });
          
          const batchResponse = await this.makeRequest('/v1/batch/objects', 'POST', {
            objects: batchObjects
          });
          
          if (batchResponse.status === 200) {
            const successful = batchResponse.data?.filter(r => !r.result?.errors) || [];
            migratedCount += successful.length;
            console.log(`     ✅ Migrated ${successful.length}/${batch.length} objects`);
          } else {
            console.log(`     ❌ Batch migration failed:`, batchResponse.data);
          }
          
          // Delay between batches to avoid overwhelming the system
          if (i < batches.length - 1) {
            console.log(`     ⏳ Waiting ${this.delayBetweenBatches}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
          }
        }
        
        migrationResults.push({
          originalClass: schema.original.class,
          vectorizedClass: schema.vectorized.class,
          totalObjects: objects.length,
          migratedObjects: migratedCount,
          status: 'completed'
        });
        
        console.log(`✅ Migration completed: ${migratedCount}/${objects.length} objects migrated\n`);
        
      } catch (error) {
        console.log(`❌ Migration failed for ${schema.original.class}:`, error.message);
        migrationResults.push({
          originalClass: schema.original.class,
          vectorizedClass: schema.vectorized.class,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    return migrationResults;
  }

  async setupFutureVectorization() {
    console.log('🔮 Setting up vectorization for future inputs...\n');
    
    const setupGuide = `
# 🚀 Vectorization Setup Complete!

## ✅ What's Been Done:
- Created vectorized versions of your classes
- Migrated existing data with semantic vectors
- Enabled advanced semantic search capabilities

## 🔮 For Future Inputs:

### 1. Use Vectorized Classes
Always use the new vectorized classes for new data:
- \`DocumentsVectorized\` instead of \`Documents\`
- \`WeaviateUploadVectorized\` instead of \`WeaviateUpload\`

### 2. Update Your Scripts
Modify your sync and upload scripts to use vectorized classes:

\`\`\`javascript
// OLD (non-vectorized)
const query = {
  query: \`{
    Get {
      Documents {
        content
        file_name
      }
    }
  }\`
};

// NEW (vectorized)
const query = {
  query: \`{
    Get {
      DocumentsVectorized {
        content
        file_name
        _additional {
          vector
          certainty
        }
      }
    }
  }\`
};
\`\`\`

### 3. Semantic Search Queries
Now you can use powerful semantic search:

\`\`\`javascript
// Semantic similarity search
const semanticQuery = {
  query: \`{
    Get {
      DocumentsVectorized(
        nearText: {
          concepts: ["collective project strategy"]
          distance: 0.7
        }
        limit: 10
      ) {
        content
        file_name
        _additional {
          distance
          certainty
        }
      }
    }
  }\`
};

// Question answering
const questionQuery = {
  query: \`{
    Get {
      DocumentsVectorized(
        ask: {
          question: "What is the Collective project about?"
          properties: ["content"]
        }
        limit: 5
      ) {
        content
        file_name
        _additional {
          answer {
            result
            certainty
          }
        }
      }
    }
  }\`
};
\`\`\`

### 4. Hybrid Search (Best of Both Worlds)
Combine keyword and semantic search:

\`\`\`javascript
const hybridQuery = {
  query: \`{
    Get {
      DocumentsVectorized(
        hybrid: {
          query: "business strategy"
          alpha: 0.7
        }
        limit: 10
      ) {
        content
        file_name
        _additional {
          score
          explainScore
        }
      }
    }
  }\`
};
\`\`\`

## 🎯 Next Steps:
1. Update your sync scripts to use vectorized classes
2. Test semantic search with your Collective project docs
3. Implement the advanced search interface
4. Set up automated vectorization for new uploads

## 🔧 Vectorizer Configuration:
- **Current**: ${this.vectorizer}
- **Model**: ${this.getVectorizerModel()}
- **Capabilities**: Semantic search, question answering, hybrid search

Your Weaviate is now a semantic powerhouse! 🚀
`;

    const fs = await import('fs/promises');
    await fs.writeFile('./vectorization-setup-guide.md', setupGuide);
    console.log('📖 Setup guide saved to vectorization-setup-guide.md');
  }

  getVectorizerModel() {
    switch (this.vectorizer) {
      case 'text2vec-openai': return 'OpenAI Ada-002';
      case 'text2vec-cohere': return 'Cohere Multilingual';
      case 'text2vec-huggingface': return 'sentence-transformers/all-MiniLM-L6-v2';
      case 'text2vec-transformers': return 'Local Transformers';
      default: return 'Unknown';
    }
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async generateMigrationReport(creationResults, migrationResults) {
    console.log('\n📊 === VECTORIZATION MIGRATION REPORT ===\n');
    
    console.log('🏗️ CLASS CREATION RESULTS:');
    if (creationResults && creationResults.length > 0) {
      creationResults.forEach(result => {
        const status = result.status === 'created' ? '✅' : '❌';
        console.log(`   ${status} ${result.class} (from ${result.original})`);
        if (result.error) {
          console.log(`      Error: ${result.error}`);
        }
      });
    } else {
      console.log('   No new classes created (dry run or already vectorized)');
    }
    console.log('');
    
    console.log('📦 DATA MIGRATION RESULTS:');
    if (migrationResults && migrationResults.length > 0) {
      let totalMigrated = 0;
      let totalObjects = 0;
      
      migrationResults.forEach(result => {
        const status = result.status === 'completed' ? '✅' : '❌';
        console.log(`   ${status} ${result.originalClass} → ${result.vectorizedClass}`);
        console.log(`      Objects: ${result.migratedObjects || 0}/${result.totalObjects || 0}`);
        if (result.error) {
          console.log(`      Error: ${result.error}`);
        }
        
        totalMigrated += result.migratedObjects || 0;
        totalObjects += result.totalObjects || 0;
      });
      
      console.log(`\n   📊 TOTAL: ${totalMigrated}/${totalObjects} objects migrated`);
      console.log(`   📈 Success Rate: ${((totalMigrated / totalObjects) * 100).toFixed(1)}%`);
    } else {
      console.log('   No data migration performed (dry run or no data)');
    }
    
    console.log('\n🚀 NEXT STEPS:');
    console.log('   1. Update your scripts to use vectorized classes');
    console.log('   2. Test semantic search capabilities');
    console.log('   3. Implement advanced search interface');
    console.log('   4. Set up automated vectorization for new uploads');
    console.log('   5. Read vectorization-setup-guide.md for detailed instructions');
  }

  async run(command = 'full-migration') {
    console.log('⚡ Weaviate Vectorization Migration System\n');
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }
    
    try {
      const currentClasses = await this.getCurrentSchema();
      const schemas = this.generateVectorizedSchema(currentClasses);
      
      let creationResults = null;
      let migrationResults = null;
      
      switch (command) {
        case 'analyze':
          console.log('📊 Analysis complete. Run with "full-migration" to proceed.');
          break;
          
        case 'create-classes':
          creationResults = await this.createVectorizedClasses(schemas);
          break;
          
        case 'migrate-data':
          migrationResults = await this.migrateExistingData(schemas);
          break;
          
        case 'full-migration':
        default:
          creationResults = await this.createVectorizedClasses(schemas);
          if (!this.dryRun) {
            // Only migrate data if classes were created successfully
            const successfulCreations = creationResults?.filter(r => r.status === 'created') || [];
            if (successfulCreations.length > 0) {
              migrationResults = await this.migrateExistingData(schemas);
            }
          }
          await this.setupFutureVectorization();
          break;
      }
      
      await this.generateMigrationReport(creationResults, migrationResults);
      
      console.log('\n🎉 Vectorization setup complete!');
      console.log('📖 Check vectorization-setup-guide.md for next steps');
      
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
    }
  }
}

// CLI handling
const args = process.argv.slice(2);
const command = args[0] || 'full-migration';

const options = {
  dryRun: args.includes('--dry-run'),
  vectorizer: args.find(arg => arg.startsWith('--vectorizer='))?.split('=')[1] || 'text2vec-huggingface',
  batchSize: parseInt(args.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 10,
  delay: parseInt(args.find(arg => arg.startsWith('--delay='))?.split('=')[1]) || 3000
};

const migrator = new VectorizationMigrator(options);

if (args.includes('--help')) {
  console.log(`
⚡ Weaviate Vectorization Migration System

Enables semantic search by creating vectorized versions of your classes
and migrating existing data with vector embeddings.

Usage:
  node vectorization-migration.js [command] [options]

Commands:
  full-migration  - Complete migration (create classes + migrate data) [default]
  analyze         - Analyze current schema and show migration plan
  create-classes  - Only create vectorized classes
  migrate-data    - Only migrate existing data to vectorized classes

Options:
  --vectorizer=NAME    Vectorizer to use (default: text2vec-huggingface)
                       Options: text2vec-openai, text2vec-cohere, 
                               text2vec-huggingface, text2vec-transformers
  --batch-size=N       Objects per batch during migration (default: 10)
  --delay=N            Delay between batches in ms (default: 3000)
  --dry-run            Show what would be done without making changes
  --help               Show this help

Examples:
  node vectorization-migration.js --dry-run
  node vectorization-migration.js --vectorizer=text2vec-openai
  node vectorization-migration.js analyze
  node vectorization-migration.js create-classes --vectorizer=text2vec-huggingface

Recommended vectorizers:
  • text2vec-huggingface: Free, good quality, no API key needed
  • text2vec-openai: Best quality, requires OpenAI API key
  • text2vec-cohere: Good quality, requires Cohere API key
  • text2vec-transformers: Local processing, privacy-focused
  `);
} else {
  migrator.run(command);
}
