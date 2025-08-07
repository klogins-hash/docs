#!/usr/bin/env node

/**
 * Test All Weaviate Classes
 * Check all your classes to find where your data actually lives
 */

import https from 'https';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
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

async function queryClass(className, properties) {
  console.log(`\n📊 Querying ${className}...`);
  
  const propertyFields = properties.map(p => p.name).join('\n          ');
  
  const query = {
    query: `{
      Get {
        ${className}(limit: 3) {
          ${propertyFields}
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
      console.log(`✅ Found ${items.length} items in ${className}`);
      
      if (items.length > 0) {
        console.log(`\n📄 Sample data from ${className}:`);
        items.forEach((item, index) => {
          console.log(`\n${index + 1}. Item ${item._additional?.id || 'Unknown ID'}`);
          properties.forEach(prop => {
            const value = item[prop.name];
            if (value) {
              if (typeof value === 'string' && value.length > 100) {
                console.log(`   ${prop.name}: ${value.substring(0, 100)}...`);
              } else {
                console.log(`   ${prop.name}: ${value}`);
              }
            }
          });
        });
        return { className, items, properties };
      }
    } else {
      console.log(`❌ Query failed for ${className}:`, response.data?.errors?.[0]?.message || 'Unknown error');
    }
  } catch (error) {
    console.log(`❌ Query error for ${className}: ${error.message}`);
  }
  
  return null;
}

async function findDataClasses() {
  console.log('🔍 Checking all classes for data...');
  
  // Get schema first
  const schemaResponse = await makeRequest('/v1/schema');
  if (schemaResponse.status !== 200) {
    console.log('❌ Failed to get schema');
    return;
  }

  const classes = schemaResponse.data.classes || [];
  console.log(`📋 Found ${classes.length} classes: ${classes.map(c => c.class).join(', ')}`);
  
  const classesWithData = [];
  
  // Test each class
  for (const classInfo of classes) {
    const result = await queryClass(classInfo.class, classInfo.properties);
    if (result && result.items.length > 0) {
      classesWithData.push(result);
    }
  }
  
  return classesWithData;
}

async function runTest() {
  console.log('🧪 Testing All Weaviate Classes for Data\n');
  
  const classesWithData = await findDataClasses();
  
  if (classesWithData && classesWithData.length > 0) {
    console.log('\n🎉 Found data in the following classes:');
    classesWithData.forEach(classData => {
      console.log(`\n✅ ${classData.className}: ${classData.items.length} items`);
      console.log(`   Properties: ${classData.properties.map(p => p.name).join(', ')}`);
    });
    
    // Recommend the best class for sync
    const bestClass = classesWithData.reduce((best, current) => {
      return current.items.length > best.items.length ? current : best;
    });
    
    console.log(`\n🎯 Recommended class for sync: ${bestClass.className}`);
    console.log(`   Contains ${bestClass.items.length} items`);
    console.log(`   Properties: ${bestClass.properties.map(p => `${p.name} (${p.dataType.join(', ')})`).join(', ')}`);
    
    return { success: true, recommendedClass: bestClass };
  } else {
    console.log('\n⚠️  No data found in any classes');
    return { success: false };
  }
}

// Run the test
runTest().then(result => {
  if (result.success) {
    console.log('\n🚀 Next steps:');
    console.log(`1. Update WEAVIATE_CLASS_NAME to: ${result.recommendedClass.className}`);
    console.log('2. Adapt sync script to use the correct properties');
    console.log('3. Run sync to import your data to Mintlify');
  }
  process.exit(result.success ? 0 : 1);
}).catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});
