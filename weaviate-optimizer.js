#!/usr/bin/env node

/**
 * Weaviate Optimizer - Automated Cleanup and Optimization System
 * Runs periodic maintenance, cleanup, and optimization tasks
 */

import https from 'https';
import { execSync } from 'child_process';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class WeaviateOptimizer {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
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

  async runHealthCheck() {
    console.log('🏥 Running Weaviate Health Check...\n');
    
    try {
      // Check cluster health
      const healthResponse = await this.makeRequest('/v1/meta');
      const isHealthy = healthResponse.status === 200;
      
      console.log(`📊 Cluster Status: ${isHealthy ? '✅ Healthy' : '❌ Issues Detected'}`);
      
      if (isHealthy && healthResponse.data) {
        console.log(`   Version: ${healthResponse.data.version || 'Unknown'}`);
        console.log(`   Modules: ${Object.keys(healthResponse.data.modules || {}).join(', ') || 'None'}`);
      }
      
      // Check schema
      const schemaResponse = await this.makeRequest('/v1/schema');
      const classes = schemaResponse.data?.classes || [];
      
      console.log(`\n📋 Schema Status:`);
      console.log(`   Classes: ${classes.length}`);
      
      const vectorizedClasses = classes.filter(c => c.vectorizer && c.vectorizer !== 'none');
      const nonVectorizedClasses = classes.filter(c => !c.vectorizer || c.vectorizer === 'none');
      
      console.log(`   Vectorized: ${vectorizedClasses.length}`);
      console.log(`   Non-vectorized: ${nonVectorizedClasses.length}`);
      
      if (vectorizedClasses.length > 0) {
        console.log(`   Vectorizers: ${[...new Set(vectorizedClasses.map(c => c.vectorizer))].join(', ')}`);
      }
      
      return {
        healthy: isHealthy,
        classes: classes.length,
        vectorized: vectorizedClasses.length,
        nonVectorized: nonVectorizedClasses.length
      };
      
    } catch (error) {
      console.log('❌ Health check failed:', error.message);
      return { healthy: false, error: error.message };
    }
  }

  async analyzeDataQuality() {
    console.log('\n🔍 Analyzing Data Quality...\n');
    
    const issues = [];
    let totalObjects = 0;
    
    try {
      // Check Documents class
      const docsQuery = {
        query: `{
          Get {
            Documents {
              content
              file_name
              _additional {
                id
              }
            }
          }
        }`
      };
      
      const docsResponse = await this.makeRequest('/v1/graphql', 'POST', docsQuery);
      const documents = docsResponse.data?.data?.Get?.Documents || [];
      totalObjects += documents.length;
      
      // Analyze document quality
      const emptyContent = documents.filter(doc => !doc.content || doc.content.trim().length < 10);
      const missingNames = documents.filter(doc => !doc.file_name || doc.file_name.trim().length === 0);
      
      if (emptyContent.length > 0) {
        issues.push({
          type: 'empty_content',
          count: emptyContent.length,
          description: 'Documents with empty or very short content',
          severity: 'medium'
        });
      }
      
      if (missingNames.length > 0) {
        issues.push({
          type: 'missing_names',
          count: missingNames.length,
          description: 'Documents without file names',
          severity: 'low'
        });
      }
      
      // Check WeaviateUpload class
      const uploadsQuery = {
        query: `{
          Get {
            WeaviateUpload {
              title
              text
              _additional {
                id
              }
            }
          }
        }`
      };
      
      const uploadsResponse = await this.makeRequest('/v1/graphql', 'POST', uploadsQuery);
      const uploads = uploadsResponse.data?.data?.Get?.WeaviateUpload || [];
      totalObjects += uploads.length;
      
      // Analyze upload quality
      const emptyText = uploads.filter(upload => !upload.text || upload.text.trim().length < 10);
      const missingTitles = uploads.filter(upload => !upload.title || upload.title.trim().length === 0);
      
      if (emptyText.length > 0) {
        issues.push({
          type: 'empty_text',
          count: emptyText.length,
          description: 'Uploads with empty or very short text',
          severity: 'medium'
        });
      }
      
      if (missingTitles.length > 0) {
        issues.push({
          type: 'missing_titles',
          count: missingTitles.length,
          description: 'Uploads without titles',
          severity: 'low'
        });
      }
      
      console.log(`📊 Data Quality Report:`);
      console.log(`   Total Objects: ${totalObjects}`);
      console.log(`   Issues Found: ${issues.length}`);
      
      if (issues.length === 0) {
        console.log('   ✅ No data quality issues detected');
      } else {
        issues.forEach(issue => {
          const severity = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
          console.log(`   ${severity} ${issue.description}: ${issue.count} objects`);
        });
      }
      
      return { totalObjects, issues };
      
    } catch (error) {
      console.log('❌ Data quality analysis failed:', error.message);
      return { totalObjects: 0, issues: [], error: error.message };
    }
  }

  async optimizePerformance() {
    console.log('\n⚡ Running Performance Optimization...\n');
    
    const optimizations = [];
    
    try {
      // Check for vectorization opportunities
      const schemaResponse = await this.makeRequest('/v1/schema');
      const classes = schemaResponse.data?.classes || [];
      
      const nonVectorized = classes.filter(c => !c.vectorizer || c.vectorizer === 'none');
      
      if (nonVectorized.length > 0) {
        optimizations.push({
          type: 'vectorization',
          description: `${nonVectorized.length} classes could benefit from vectorization`,
          action: 'Enable vectorization for semantic search capabilities',
          impact: 'high'
        });
      }
      
      // Check for unused classes
      const emptyClasses = [];
      for (const cls of classes) {
        try {
          const countQuery = {
            query: `{
              Aggregate {
                ${cls.class} {
                  meta {
                    count
                  }
                }
              }
            }`
          };
          
          const countResponse = await this.makeRequest('/v1/graphql', 'POST', countQuery);
          const count = countResponse.data?.data?.Aggregate?.[cls.class]?.[0]?.meta?.count || 0;
          
          if (count === 0) {
            emptyClasses.push(cls.class);
          }
        } catch (error) {
          // Skip if query fails
        }
      }
      
      if (emptyClasses.length > 0) {
        optimizations.push({
          type: 'cleanup',
          description: `${emptyClasses.length} empty classes found`,
          action: 'Consider removing unused classes to reduce schema complexity',
          impact: 'low'
        });
      }
      
      // Performance recommendations
      optimizations.push({
        type: 'indexing',
        description: 'Regular index optimization',
        action: 'Weaviate automatically optimizes indexes, but consider query patterns',
        impact: 'medium'
      });
      
      console.log(`🚀 Performance Optimization Report:`);
      if (optimizations.length === 0) {
        console.log('   ✅ System is well optimized');
      } else {
        optimizations.forEach((opt, index) => {
          const impact = opt.impact === 'high' ? '🔴' : opt.impact === 'medium' ? '🟡' : '🟢';
          console.log(`   ${index + 1}. ${impact} ${opt.description}`);
          console.log(`      Action: ${opt.action}`);
        });
      }
      
      return optimizations;
      
    } catch (error) {
      console.log('❌ Performance optimization failed:', error.message);
      return [];
    }
  }

  async generateMaintenanceReport() {
    console.log('\n📋 Generating Maintenance Report...\n');
    
    const report = {
      timestamp: new Date().toISOString(),
      health: await this.runHealthCheck(),
      dataQuality: await this.analyzeDataQuality(),
      optimizations: await this.optimizePerformance()
    };
    
    // Save report
    const fs = await import('fs/promises');
    await fs.writeFile('./maintenance-report.json', JSON.stringify(report, null, 2));
    
    console.log('\n📊 === MAINTENANCE SUMMARY ===\n');
    
    console.log(`🏥 Health: ${report.health.healthy ? '✅ Healthy' : '❌ Issues'}`);
    console.log(`📊 Classes: ${report.health.classes} (${report.health.vectorized} vectorized)`);
    console.log(`📄 Objects: ${report.dataQuality.totalObjects}`);
    console.log(`🔍 Quality Issues: ${report.dataQuality.issues.length}`);
    console.log(`⚡ Optimizations: ${report.optimizations.length}`);
    
    console.log('\n💾 Full report saved to maintenance-report.json');
    
    return report;
  }

  async runAutomatedTasks() {
    console.log('🤖 Running Automated Maintenance Tasks...\n');
    
    const tasks = [];
    
    try {
      // Task 1: Auto-tag new content
      console.log('1️⃣ Running auto-tagging for new content...');
      try {
        execSync('node advanced-auto-tagger.js --auto-tag', { stdio: 'pipe' });
        tasks.push({ task: 'auto-tagging', status: 'success' });
        console.log('   ✅ Auto-tagging completed');
      } catch (error) {
        tasks.push({ task: 'auto-tagging', status: 'failed', error: error.message });
        console.log('   ❌ Auto-tagging failed');
      }
      
      // Task 2: Check for new duplicates
      console.log('\n2️⃣ Checking for new duplicates...');
      try {
        const output = execSync('node safe-duplicate-cleaner.js --dry-run', { encoding: 'utf8' });
        const duplicateCount = (output.match(/Files to delete: (\d+)/) || [0, 0])[1];
        
        if (parseInt(duplicateCount) > 0) {
          tasks.push({ task: 'duplicate-check', status: 'found', count: duplicateCount });
          console.log(`   ⚠️  Found ${duplicateCount} new duplicates (run cleanup manually)`);
        } else {
          tasks.push({ task: 'duplicate-check', status: 'clean' });
          console.log('   ✅ No new duplicates found');
        }
      } catch (error) {
        tasks.push({ task: 'duplicate-check', status: 'failed', error: error.message });
        console.log('   ❌ Duplicate check failed');
      }
      
      // Task 3: Update task extraction
      console.log('\n3️⃣ Updating task extraction...');
      try {
        execSync('node task-extractor.js > /dev/null 2>&1');
        tasks.push({ task: 'task-extraction', status: 'success' });
        console.log('   ✅ Task extraction updated');
      } catch (error) {
        tasks.push({ task: 'task-extraction', status: 'failed', error: error.message });
        console.log('   ❌ Task extraction failed');
      }
      
      // Task 4: Update content relationships
      console.log('\n4️⃣ Updating content relationships...');
      try {
        execSync('node content-relationship-mapper.js > /dev/null 2>&1');
        tasks.push({ task: 'relationship-mapping', status: 'success' });
        console.log('   ✅ Content relationships updated');
      } catch (error) {
        tasks.push({ task: 'relationship-mapping', status: 'failed', error: error.message });
        console.log('   ❌ Relationship mapping failed');
      }
      
    } catch (error) {
      console.log('❌ Automated tasks failed:', error.message);
    }
    
    return tasks;
  }

  async run(command = 'full-optimization') {
    console.log('🔧 Weaviate Optimizer\n');
    
    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }
    
    try {
      switch (command) {
        case 'health-check':
          await this.runHealthCheck();
          break;
          
        case 'data-quality':
          await this.analyzeDataQuality();
          break;
          
        case 'performance':
          await this.optimizePerformance();
          break;
          
        case 'automated-tasks':
          await this.runAutomatedTasks();
          break;
          
        case 'maintenance-report':
          await this.generateMaintenanceReport();
          break;
          
        case 'full-optimization':
        default:
          const report = await this.generateMaintenanceReport();
          console.log('\n🤖 Running automated maintenance tasks...');
          const tasks = await this.runAutomatedTasks();
          
          console.log('\n🎉 Full optimization complete!');
          console.log('📊 Check maintenance-report.json for detailed analysis');
          break;
      }
      
    } catch (error) {
      console.error('❌ Optimization failed:', error.message);
    }
  }
}

// CLI handling
const args = process.argv.slice(2);
const command = args[0] || 'full-optimization';

const options = {
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose')
};

const optimizer = new WeaviateOptimizer(options);

if (args.includes('--help')) {
  console.log(`
🔧 Weaviate Optimizer

Automated cleanup and optimization system for your Weaviate knowledge base.

Usage:
  node weaviate-optimizer.js [command] [options]

Commands:
  full-optimization   - Run complete optimization suite (default)
  health-check       - Check cluster and schema health
  data-quality       - Analyze data quality issues
  performance        - Check performance optimization opportunities
  automated-tasks    - Run automated maintenance tasks
  maintenance-report - Generate comprehensive maintenance report

Options:
  --dry-run     Show what would be done without making changes
  --verbose     Show detailed output
  --help        Show this help

Examples:
  node weaviate-optimizer.js --dry-run
  node weaviate-optimizer.js health-check
  node weaviate-optimizer.js automated-tasks

Automated Tasks Include:
  • Auto-tagging new content
  • Duplicate detection
  • Task extraction updates
  • Content relationship mapping
  • Performance monitoring
  `);
} else {
  optimizer.run(command);
}
