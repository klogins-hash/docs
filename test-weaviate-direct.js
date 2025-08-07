#!/usr/bin/env node

/**
 * Direct Weaviate Connection Test
 * Uses hardcoded credentials to test your real Weaviate instance
 */

import https from 'https';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw',
  className: 'Document'
};

async function makeRequest(path, method = 'GET', data = null) {
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

async function testConnection() {
  console.log('🔌 Testing Weaviate Cloud Services connection...');
  console.log(`📍 Connecting to: ${WEAVIATE_CONFIG.scheme}://${WEAVIATE_CONFIG.host}`);
  
  try {
    const healthCheck = await makeRequest('/v1/meta');
    
    if (healthCheck.status === 200) {
      console.log('✅ Connection successful!');
      console.log(`📊 Weaviate version: ${healthCheck.data.version || 'Unknown'}`);
      return true;
    } else {
      console.log(`❌ Connection failed with status: ${healthCheck.status}`);
      console.log('Response:', healthCheck.data);
      return false;
    }
  } catch (error) {
    console.log(`❌ Connection error: ${error.message}`);
    return false;
  }
}

async function testSchema() {
  console.log('\n🔍 Checking schema...');
  
  try {
    const schemaResponse = await makeRequest('/v1/schema');
    
    if (schemaResponse.status === 200) {
      const classes = schemaResponse.data.classes || [];
      console.log(`📋 Found ${classes.length} classes:`);
      
      classes.forEach(cls => {
        console.log(`  - ${cls.class} (${cls.properties?.length || 0} properties)`);
      });

      // Check if our target class exists
      const targetClass = classes.find(cls => cls.class === WEAVIATE_CONFIG.className);
      if (targetClass) {
        console.log(`✅ Target class '${WEAVIATE_CONFIG.className}' found!`);
        console.log('📝 Properties:');
        targetClass.properties?.forEach(prop => {
          console.log(`  - ${prop.name} (${prop.dataType.join(', ')})`);
        });
        return targetClass;
      } else {
        console.log(`⚠️  Target class '${WEAVIATE_CONFIG.className}' not found`);
        console.log('Available classes:', classes.map(c => c.class).join(', '));
        return null;
      }
    }
  } catch (error) {
    console.log(`❌ Schema check error: ${error.message}`);
    return null;
  }
}

async function testQuery(className) {
  console.log('\n📊 Testing data query...');
  
  const query = {
    query: `{
      Get {
        ${className}(limit: 5) {
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
    const response = await makeRequest('/v1/graphql', 'POST', query);
    
    if (response.status === 200 && response.data.data) {
      const items = response.data.data.Get[className] || [];
      console.log(`✅ Query successful! Found ${items.length} items`);
      
      if (items.length > 0) {
        console.log('\n📄 Sample data from your Weaviate:');
        items.forEach((item, index) => {
          console.log(`\n${index + 1}. ${item.title || 'Untitled'}`);
          console.log(`   Description: ${(item.description || 'No description').substring(0, 100)}${item.description?.length > 100 ? '...' : ''}`);
          console.log(`   Category: ${item.category || 'No category'}`);
          console.log(`   Content length: ${item.content?.length || 0} characters`);
          console.log(`   Tags: ${item.tags?.join(', ') || 'No tags'}`);
          console.log(`   ID: ${item._additional?.id || 'No ID'}`);
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

async function runTest() {
  console.log('🧪 Testing Your Real Weaviate Data\n');
  
  const connectionOk = await testConnection();
  if (!connectionOk) return false;

  const targetClass = await testSchema();
  if (!targetClass) return false;

  // Use the actual class name found in schema
  const actualClassName = targetClass.class;
  console.log(`\n🎯 Using class: ${actualClassName}`);
  
  const data = await testQuery(actualClassName);
  
  if (data && data.length > 0) {
    console.log('\n🎉 Test completed successfully!');
    console.log(`✅ Ready to sync ${data.length} items from your Weaviate to Mintlify`);
    console.log(`📝 Class name to use: ${actualClassName}`);
    return { success: true, className: actualClassName, sampleData: data };
  } else {
    console.log('\n⚠️  Test completed but no data available for sync');
    return { success: false };
  }
}

// Run the test
runTest().then(result => {
  if (result.success) {
    console.log('\n🚀 Next steps:');
    console.log('1. Update WEAVIATE_CLASS_NAME in .env to:', result.className);
    console.log('2. Run the sync script to import your data to Mintlify');
    console.log('3. Test with a small batch first');
  }
  process.exit(result.success ? 0 : 1);
}).catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});
