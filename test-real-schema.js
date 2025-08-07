#!/usr/bin/env node

/**
 * Test with Real Weaviate Schema
 * Uses your actual schema fields: title, content, source, file_type, created_at, metadata
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

async function queryRealData() {
  console.log('📊 Querying your real Weaviate data...');
  
  // Query using your actual schema fields
  const query = {
    query: `{
      Get {
        Document(limit: 5) {
          title
          content
          source
          file_type
          created_at
          metadata
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
      const items = response.data.data.Get.Document || [];
      console.log(`✅ Query successful! Found ${items.length} documents`);
      
      if (items.length > 0) {
        console.log('\n📄 Your Real Weaviate Data:');
        items.forEach((item, index) => {
          console.log(`\n${index + 1}. ${item.title || 'Untitled'}`);
          console.log(`   Source: ${item.source || 'No source'}`);
          console.log(`   File Type: ${item.file_type || 'Unknown'}`);
          console.log(`   Created: ${item.created_at || 'No date'}`);
          console.log(`   Content length: ${item.content?.length || 0} characters`);
          console.log(`   Metadata: ${(item.metadata || 'No metadata').substring(0, 100)}${item.metadata?.length > 100 ? '...' : ''}`);
          console.log(`   ID: ${item._additional?.id || 'No ID'}`);
          
          // Show first 200 chars of content
          if (item.content) {
            console.log(`   Content preview: ${item.content.substring(0, 200)}${item.content.length > 200 ? '...' : ''}`);
          }
        });
        
        return items;
      } else {
        console.log('⚠️  No documents found');
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

function generateMintlifyMDX(item) {
  // Extract category from source or file_type
  const category = item.source?.split('/')[0] || item.file_type || 'general';
  
  // Parse metadata if it's JSON
  let parsedMetadata = {};
  try {
    if (item.metadata) {
      parsedMetadata = JSON.parse(item.metadata);
    }
  } catch (e) {
    // If metadata isn't JSON, treat as string
    parsedMetadata = { notes: item.metadata };
  }

  const frontmatter = {
    title: item.title || 'Untitled Document',
    description: parsedMetadata.description || `Document from ${item.source || 'Weaviate'}`,
    source: item.source || '',
    file_type: item.file_type || '',
    created_at: item.created_at || '',
    category: category.toLowerCase().replace(/[^a-z0-9]/g, '-')
  };

  const yamlFrontmatter = Object.entries(frontmatter)
    .filter(([key, value]) => value) // Only include non-empty values
    .map(([key, value]) => `${key}: "${value}"`)
    .join('\n');

  return `---
${yamlFrontmatter}
---

# ${item.title || 'Untitled Document'}

${item.content || 'No content available.'}

<Note>
**Source**: ${item.source || 'Unknown'}  
**File Type**: ${item.file_type || 'Unknown'}  
**Created**: ${item.created_at || 'Unknown'}  
**Synced from Weaviate**: ${new Date().toISOString()}
</Note>

${parsedMetadata.notes ? `\n<Info>\n**Additional Notes**: ${parsedMetadata.notes}\n</Info>` : ''}
`;
}

async function testMintlifyConversion() {
  console.log('\n🔄 Testing Mintlify conversion...');
  
  const data = await queryRealData();
  
  if (data && data.length > 0) {
    console.log('\n📝 Sample Mintlify MDX conversion:');
    console.log('=' .repeat(50));
    
    // Show conversion for first item
    const sampleMDX = generateMintlifyMDX(data[0]);
    console.log(sampleMDX);
    console.log('=' .repeat(50));
    
    console.log('\n🎉 Conversion test successful!');
    console.log(`✅ Ready to sync ${data.length} documents to Mintlify`);
    
    return { success: true, sampleData: data, sampleMDX };
  } else {
    console.log('\n❌ No data available for conversion test');
    return { success: false };
  }
}

// Run the test
testMintlifyConversion().then(result => {
  if (result.success) {
    console.log('\n🚀 Next steps:');
    console.log('1. The conversion looks good!');
    console.log('2. Ready to run actual sync to create MDX files');
    console.log('3. Your documents will be organized by source/file_type');
  }
  process.exit(result.success ? 0 : 1);
}).catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});
