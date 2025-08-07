#!/usr/bin/env node

/**
 * Simple Weaviate Connection Test
 * Tests connection to your real Weaviate instance without heavy dependencies
 */

import https from 'https';
import http from 'http';

class WeaviateConnectionTest {
  constructor() {
    // Load environment variables if .env exists
    this.loadEnv();
    
    this.config = {
      scheme: process.env.WEAVIATE_SCHEME || 'http',
      host: process.env.WEAVIATE_HOST || 'localhost:8080',
      apiKey: process.env.WEAVIATE_API_KEY,
      className: process.env.WEAVIATE_CLASS_NAME || 'Document'
    };
  }

  loadEnv() {
    try {
      const fs = require('fs');
      const envContent = fs.readFileSync('.env', 'utf8');
      console.log('✅ Found .env file');
      envContent.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value && key.trim() && value.trim()) {
          process.env[key.trim()] = value.trim();
        }
      });
      console.log('✅ Loaded .env variables');
    } catch (error) {
      console.log('ℹ️  No .env file found, using environment variables or defaults');
    }
  }

  async makeRequest(path, method = 'GET', data = null) {
    const url = `${this.config.scheme}://${this.config.host}${path}`;
    const requestModule = this.config.scheme === 'https' ? https : http;
    
    return new Promise((resolve, reject) => {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        }
      };

      const req = requestModule.request(url, options, (res) => {
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

  async testConnection() {
    console.log('🔌 Testing Weaviate connection...');
    console.log(`📍 Connecting to: ${this.config.scheme}://${this.config.host}`);
    
    try {
      // Test basic connection
      const healthCheck = await this.makeRequest('/v1/meta');
      
      if (healthCheck.status === 200) {
        console.log('✅ Connection successful!');
        console.log(`📊 Weaviate version: ${healthCheck.data.version || 'Unknown'}`);
        return true;
      } else {
        console.log(`❌ Connection failed with status: ${healthCheck.status}`);
        return false;
      }
    } catch (error) {
      console.log(`❌ Connection error: ${error.message}`);
      return false;
    }
  }

  async testSchema() {
    console.log('\n🔍 Checking schema...');
    
    try {
      const schemaResponse = await this.makeRequest('/v1/schema');
      
      if (schemaResponse.status === 200) {
        const classes = schemaResponse.data.classes || [];
        console.log(`📋 Found ${classes.length} classes:`);
        
        classes.forEach(cls => {
          console.log(`  - ${cls.class} (${cls.properties?.length || 0} properties)`);
        });

        // Check if our target class exists
        const targetClass = classes.find(cls => cls.class === this.config.className);
        if (targetClass) {
          console.log(`✅ Target class '${this.config.className}' found!`);
          console.log('📝 Properties:');
          targetClass.properties?.forEach(prop => {
            console.log(`  - ${prop.name} (${prop.dataType.join(', ')})`);
          });
          return true;
        } else {
          console.log(`⚠️  Target class '${this.config.className}' not found`);
          console.log('Available classes:', classes.map(c => c.class).join(', '));
          return false;
        }
      }
    } catch (error) {
      console.log(`❌ Schema check error: ${error.message}`);
      return false;
    }
  }

  async testQuery() {
    console.log('\n📊 Testing data query...');
    
    const query = {
      query: `{
        Get {
          ${this.config.className}(limit: 3) {
            title
            content
            description
            category
            tags
            _additional {
              id
              lastUpdateTimeUnix
            }
          }
        }
      }`
    };

    try {
      const response = await this.makeRequest('/v1/graphql', 'POST', query);
      
      if (response.status === 200 && response.data.data) {
        const items = response.data.data.Get[this.config.className] || [];
        console.log(`✅ Query successful! Found ${items.length} items`);
        
        if (items.length > 0) {
          console.log('\n📄 Sample data:');
          items.forEach((item, index) => {
            console.log(`\n${index + 1}. ${item.title || 'Untitled'}`);
            console.log(`   Description: ${item.description || 'No description'}`);
            console.log(`   Category: ${item.category || 'No category'}`);
            console.log(`   Content length: ${item.content?.length || 0} characters`);
            console.log(`   Tags: ${item.tags?.join(', ') || 'No tags'}`);
          });
          
          return items;
        } else {
          console.log('⚠️  No data found in the class');
          return [];
        }
      } else {
        console.log(`❌ Query failed:`, response.data);
        return null;
      }
    } catch (error) {
      console.log(`❌ Query error: ${error.message}`);
      return null;
    }
  }

  async runFullTest() {
    console.log('🧪 Starting Weaviate Connection Test\n');
    console.log('Configuration:');
    console.log(`  Host: ${this.config.host}`);
    console.log(`  Scheme: ${this.config.scheme}`);
    console.log(`  Class: ${this.config.className}`);
    console.log(`  API Key: ${this.config.apiKey ? '***configured***' : 'not set'}\n`);

    const connectionOk = await this.testConnection();
    if (!connectionOk) return false;

    const schemaOk = await this.testSchema();
    if (!schemaOk) return false;

    const data = await this.testQuery();
    
    if (data && data.length > 0) {
      console.log('\n🎉 Test completed successfully!');
      console.log(`✅ Ready to sync ${data.length} sample items to Mintlify`);
      return true;
    } else {
      console.log('\n⚠️  Test completed but no data available for sync');
      return false;
    }
  }
}

// Run the test
const tester = new WeaviateConnectionTest();
tester.runFullTest().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});
