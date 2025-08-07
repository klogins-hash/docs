#!/usr/bin/env node

/**
 * Semantic Search Enhancer for Weaviate
 * Enables vector search and advanced semantic capabilities
 */

import https from 'https';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class SemanticSearchEnhancer {
  constructor() {
    this.searchMethods = this.initializeSearchMethods();
  }

  initializeSearchMethods() {
    return {
      // Hybrid search combining keyword + semantic
      hybrid_search: {
        name: "Hybrid Search",
        description: "Combines keyword matching with semantic similarity",
        query: (searchTerm, alpha = 0.7) => ({
          query: `{
            Get {
              Documents(
                hybrid: {
                  query: "${searchTerm}"
                  alpha: ${alpha}
                }
                limit: 10
              ) {
                content
                file_name
                zip_file_name
                _additional {
                  score
                  explainScore
                }
              }
            }
          }`
        })
      },

      // Near text semantic search
      semantic_search: {
        name: "Semantic Search",
        description: "Pure semantic similarity search",
        query: (searchTerm, distance = 0.7) => ({
          query: `{
            Get {
              Documents(
                nearText: {
                  concepts: ["${searchTerm}"]
                  distance: ${distance}
                }
                limit: 10
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
        })
      },

      // Question answering
      question_answering: {
        name: "Question Answering",
        description: "Get direct answers to questions",
        query: (question) => ({
          query: `{
            Get {
              Documents(
                ask: {
                  question: "${question}"
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
          }`
        })
      },

      // Multi-concept search
      multi_concept: {
        name: "Multi-Concept Search",
        description: "Search for multiple related concepts",
        query: (concepts, distance = 0.7) => ({
          query: `{
            Get {
              Documents(
                nearText: {
                  concepts: [${concepts.map(c => `"${c}"`).join(', ')}]
                  distance: ${distance}
                }
                limit: 15
              ) {
                content
                file_name
                zip_file_name
                _additional {
                  distance
                }
              }
            }
          }`
        })
      },

      // Filtered semantic search
      filtered_semantic: {
        name: "Filtered Semantic Search",
        description: "Semantic search with filters",
        query: (searchTerm, fileType = null, source = null) => {
          let whereClause = '';
          if (fileType || source) {
            const conditions = [];
            if (fileType) conditions.push(`{path: ["file_type"], operator: Equal, valueText: "${fileType}"}`);
            if (source) conditions.push(`{path: ["zip_file_name"], operator: Like, valueText: "*${source}*"}`);
            whereClause = `where: {${conditions.length > 1 ? `operator: And, operands: [${conditions.join(', ')}]` : conditions[0]}}`;
          }
          
          return {
            query: `{
              Get {
                Documents(
                  nearText: {
                    concepts: ["${searchTerm}"]
                  }
                  ${whereClause}
                  limit: 10
                ) {
                  content
                  file_name
                  file_type
                  zip_file_name
                  _additional {
                    distance
                  }
                }
              }
            }`
          };
        }
      }
    };
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

  async checkVectorizationStatus() {
    console.log('🔍 Checking vectorization status...\n');
    
    const schemaResponse = await this.makeRequest('/v1/schema');
    const classes = schemaResponse.data?.classes || [];
    
    const documentsClass = classes.find(c => c.class === 'Documents');
    const uploadsClass = classes.find(c => c.class === 'WeaviateUpload');
    
    const status = {
      documentsVectorized: documentsClass?.vectorizer !== 'none' && documentsClass?.vectorizer,
      uploadsVectorized: uploadsClass?.vectorizer !== 'none' && uploadsClass?.vectorizer,
      vectorizer: documentsClass?.vectorizer || 'none'
    };
    
    console.log('📊 VECTORIZATION STATUS:');
    console.log(`   Documents Class: ${status.documentsVectorized ? '✅ Vectorized' : '❌ Not Vectorized'}`);
    console.log(`   WeaviateUpload Class: ${status.uploadsVectorized ? '✅ Vectorized' : '❌ Not Vectorized'}`);
    console.log(`   Vectorizer: ${status.vectorizer}\n`);
    
    return status;
  }

  async enableVectorization() {
    console.log('⚡ Enabling vectorization for better semantic search...\n');
    
    // Note: This would typically require recreating the schema with vectorization enabled
    // For existing data, we'd need to migrate to a new vectorized class
    console.log('⚠️  IMPORTANT: To enable vectorization on existing data, you would need to:');
    console.log('   1. Create new classes with vectorization enabled');
    console.log('   2. Migrate existing data to the new classes');
    console.log('   3. Update all queries to use the new classes\n');
    
    console.log('🔧 Recommended vectorizer configurations:');
    console.log('   • text2vec-openai: Best quality, requires OpenAI API key');
    console.log('   • text2vec-cohere: Good quality, requires Cohere API key');
    console.log('   • text2vec-huggingface: Free, decent quality');
    console.log('   • text2vec-transformers: Local processing, good for privacy\n');
  }

  async performAdvancedSearch(method, ...params) {
    console.log(`🔍 Performing ${this.searchMethods[method].name}...\n`);
    
    const query = this.searchMethods[method].query(...params);
    const response = await this.makeRequest('/v1/graphql', 'POST', query);
    
    if (response.data?.errors) {
      console.log('❌ Search failed:', response.data.errors[0].message);
      return null;
    }
    
    const results = response.data?.data?.Get?.Documents || [];
    
    console.log(`📊 Found ${results.length} results:\n`);
    
    results.forEach((doc, index) => {
      console.log(`${index + 1}. "${doc.file_name}"`);
      console.log(`   Source: ${doc.zip_file_name}`);
      console.log(`   Content: ${doc.content?.substring(0, 150)}...`);
      
      if (doc._additional?.score) {
        console.log(`   Score: ${doc._additional.score.toFixed(3)}`);
      }
      if (doc._additional?.distance) {
        console.log(`   Distance: ${doc._additional.distance.toFixed(3)}`);
      }
      if (doc._additional?.certainty) {
        console.log(`   Certainty: ${doc._additional.certainty.toFixed(3)}`);
      }
      if (doc._additional?.answer) {
        console.log(`   Answer: ${doc._additional.answer.result}`);
        console.log(`   Answer Certainty: ${doc._additional.answer.certainty.toFixed(3)}`);
      }
      console.log('');
    });
    
    return results;
  }

  async demonstrateSearchCapabilities() {
    console.log('🎯 Demonstrating Advanced Search Capabilities\n');
    
    const vectorStatus = await this.checkVectorizationStatus();
    
    if (!vectorStatus.documentsVectorized) {
      console.log('⚠️  Vectorization is not enabled. Showing keyword-based search instead.\n');
      
      // Perform keyword search as fallback
      const keywordQuery = {
        query: `{
          Get {
            Documents(
              where: {
                path: ["content"]
                operator: Like
                valueText: "*collective*"
              }
              limit: 5
            ) {
              content
              file_name
              zip_file_name
            }
          }
        }`
      };
      
      const response = await this.makeRequest('/v1/graphql', 'POST', keywordQuery);
      const results = response.data?.data?.Get?.Documents || [];
      
      console.log(`🔍 Keyword search for "collective" found ${results.length} results:\n`);
      
      results.forEach((doc, index) => {
        console.log(`${index + 1}. "${doc.file_name}"`);
        console.log(`   Source: ${doc.zip_file_name}`);
        console.log(`   Content: ${doc.content?.substring(0, 100)}...`);
        console.log('');
      });
      
      await this.enableVectorization();
      
    } else {
      console.log('✅ Vectorization is enabled! Demonstrating advanced search...\n');
      
      // Demonstrate different search methods
      console.log('=== SEMANTIC SEARCH DEMO ===\n');
      
      await this.performAdvancedSearch('semantic_search', 'collective project strategy', 0.7);
      
      console.log('=== MULTI-CONCEPT SEARCH DEMO ===\n');
      
      await this.performAdvancedSearch('multi_concept', ['business', 'strategy', 'collective'], 0.6);
      
      console.log('=== QUESTION ANSWERING DEMO ===\n');
      
      await this.performAdvancedSearch('question_answering', 'What is the Collective project about?');
    }
  }

  async generateSearchInterface() {
    console.log('🎨 Generating Advanced Search Interface...\n');
    
    const fs = await import('fs/promises');
    
    const searchInterface = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Advanced Weaviate Search</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .search-box { width: 100%; padding: 15px; font-size: 16px; border: 2px solid #e1e5e9; border-radius: 8px; margin-bottom: 20px; }
        .search-type { display: flex; gap: 10px; margin-bottom: 20px; }
        .search-type button { padding: 10px 20px; border: 1px solid #ddd; background: white; border-radius: 5px; cursor: pointer; }
        .search-type button.active { background: #007bff; color: white; }
        .results { margin-top: 30px; }
        .result-item { border: 1px solid #e1e5e9; border-radius: 8px; padding: 20px; margin-bottom: 15px; }
        .result-title { font-weight: bold; color: #333; margin-bottom: 5px; }
        .result-source { color: #666; font-size: 14px; margin-bottom: 10px; }
        .result-content { color: #444; line-height: 1.6; }
        .result-score { background: #f8f9fa; padding: 5px 10px; border-radius: 4px; font-size: 12px; color: #666; }
        .loading { text-align: center; padding: 40px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 Advanced Weaviate Search</h1>
        <p>Search your knowledge base using advanced semantic capabilities</p>
        
        <input type="text" class="search-box" placeholder="Search your documents..." id="searchInput">
        
        <div class="search-type">
            <button class="active" data-type="semantic">Semantic Search</button>
            <button data-type="hybrid">Hybrid Search</button>
            <button data-type="question">Question Answering</button>
            <button data-type="multi">Multi-Concept</button>
        </div>
        
        <div class="results" id="results"></div>
    </div>

    <script>
        let currentSearchType = 'semantic';
        
        document.querySelectorAll('.search-type button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelector('.search-type button.active').classList.remove('active');
                btn.classList.add('active');
                currentSearchType = btn.dataset.type;
            });
        });
        
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
        
        async function performSearch() {
            const query = document.getElementById('searchInput').value;
            if (!query) return;
            
            const resultsDiv = document.getElementById('results');
            resultsDiv.innerHTML = '<div class="loading">🔍 Searching...</div>';
            
            try {
                // This would connect to your backend API
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query, type: currentSearchType })
                });
                
                const results = await response.json();
                displayResults(results);
                
            } catch (error) {
                resultsDiv.innerHTML = '<div class="loading">❌ Search failed. Please try again.</div>';
            }
        }
        
        function displayResults(results) {
            const resultsDiv = document.getElementById('results');
            
            if (results.length === 0) {
                resultsDiv.innerHTML = '<div class="loading">No results found.</div>';
                return;
            }
            
            resultsDiv.innerHTML = results.map((result, index) => \`
                <div class="result-item">
                    <div class="result-title">\${result.file_name}</div>
                    <div class="result-source">Source: \${result.zip_file_name || result.source}</div>
                    <div class="result-content">\${result.content.substring(0, 300)}...</div>
                    \${result.score ? \`<div class="result-score">Score: \${result.score.toFixed(3)}</div>\` : ''}
                    \${result.distance ? \`<div class="result-score">Distance: \${result.distance.toFixed(3)}</div>\` : ''}
                </div>
            \`).join('');
        }
    </script>
</body>
</html>`;
    
    await fs.writeFile('./advanced-search-interface.html', searchInterface);
    console.log('✅ Advanced search interface saved to advanced-search-interface.html');
    console.log('🌐 Open this file in a browser to use the search interface');
  }

  async run(command = 'demo') {
    console.log('🔍 Semantic Search Enhancer for Weaviate\n');
    
    try {
      switch (command) {
        case 'demo':
          await this.demonstrateSearchCapabilities();
          break;
          
        case 'status':
          await this.checkVectorizationStatus();
          break;
          
        case 'interface':
          await this.generateSearchInterface();
          break;
          
        case 'search':
          const searchTerm = process.argv[3] || 'collective';
          await this.performAdvancedSearch('semantic_search', searchTerm);
          break;
          
        default:
          console.log('Available commands:');
          console.log('  demo      - Demonstrate search capabilities');
          console.log('  status    - Check vectorization status');
          console.log('  interface - Generate search interface');
          console.log('  search    - Perform a search (requires search term)');
      }
      
    } catch (error) {
      console.error('❌ Error:', error.message);
    }
  }
}

// CLI handling
const args = process.argv.slice(2);
const command = args[0] || 'demo';

const enhancer = new SemanticSearchEnhancer();

if (args.includes('--help')) {
  console.log(`
🔍 Semantic Search Enhancer

Enhances Weaviate with advanced semantic search capabilities including:
• Hybrid search (keyword + semantic)
• Pure semantic similarity search  
• Question answering
• Multi-concept search
• Filtered semantic search

Usage:
  node semantic-search-enhancer.js [command]

Commands:
  demo      - Demonstrate search capabilities (default)
  status    - Check vectorization status
  interface - Generate advanced search interface
  search    - Perform a search (add search term as next argument)
  --help    - Show this help
  `);
} else {
  enhancer.run(command);
}
