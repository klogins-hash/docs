#!/usr/bin/env node

/**
 * Content Relationship Mapper for Weaviate
 * Discovers and maps relationships between documents using keyword analysis and co-occurrence
 */

import https from 'https';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class ContentRelationshipMapper {
  constructor() {
    this.relationships = {
      citations: [],
      topicClusters: {},
      crossReferences: [],
      conceptConnections: {},
      documentSimilarity: []
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

  async getAllDocuments() {
    console.log('📊 Fetching all documents for relationship analysis...\n');
    
    const documentsQuery = {
      query: `{
        Get {
          Documents {
            content
            file_name
            zip_file_name
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
            docSource
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

    return [
      ...documents.map(doc => ({
        id: doc._additional.id,
        title: doc.file_name,
        content: doc.content,
        source: doc.zip_file_name,
        type: 'Documents'
      })),
      ...uploads.map(upload => ({
        id: upload._additional.id,
        title: upload.title,
        content: upload.text,
        source: upload.docSource,
        type: 'WeaviateUpload'
      }))
    ];
  }

  extractKeyTerms(content) {
    if (!content) return [];
    
    // Remove common words and extract meaningful terms
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'
    ]);
    
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.has(word));
    
    // Count frequency
    const frequency = {};
    words.forEach(word => {
      frequency[word] = (frequency[word] || 0) + 1;
    });
    
    // Return top terms
    return Object.entries(frequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 20)
      .map(([word, count]) => ({ term: word, frequency: count }));
  }

  findCrossReferences(documents) {
    console.log('🔗 Finding cross-references between documents...\n');
    
    const crossRefs = [];
    
    documents.forEach(doc1 => {
      documents.forEach(doc2 => {
        if (doc1.id === doc2.id) return;
        
        const content1 = (doc1.content || '').toLowerCase();
        const title2 = (doc2.title || '').toLowerCase();
        
        // Check if doc1 mentions doc2's title or key terms
        if (title2.length > 5 && content1.includes(title2)) {
          crossRefs.push({
            from: { id: doc1.id, title: doc1.title },
            to: { id: doc2.id, title: doc2.title },
            type: 'title_mention',
            strength: 0.8
          });
        }
        
        // Check for filename mentions
        const filename2 = doc2.title.replace(/\.[^/.]+$/, "").toLowerCase();
        if (filename2.length > 5 && content1.includes(filename2)) {
          crossRefs.push({
            from: { id: doc1.id, title: doc1.title },
            to: { id: doc2.id, title: doc2.title },
            type: 'filename_mention',
            strength: 0.6
          });
        }
      });
    });
    
    this.relationships.crossReferences = crossRefs;
    console.log(`   Found ${crossRefs.length} cross-references`);
    
    return crossRefs;
  }

  findTopicClusters(documents) {
    console.log('🏷️ Identifying topic clusters...\n');
    
    const allTerms = {};
    const docTerms = {};
    
    // Extract terms from all documents
    documents.forEach(doc => {
      const terms = this.extractKeyTerms(doc.content);
      docTerms[doc.id] = terms;
      
      terms.forEach(({ term, frequency }) => {
        if (!allTerms[term]) {
          allTerms[term] = { totalFreq: 0, documents: [] };
        }
        allTerms[term].totalFreq += frequency;
        allTerms[term].documents.push({ docId: doc.id, frequency });
      });
    });
    
    // Find terms that appear in multiple documents (potential topics)
    const topicTerms = Object.entries(allTerms)
      .filter(([term, data]) => data.documents.length >= 2)
      .sort(([,a], [,b]) => b.totalFreq - a.totalFreq)
      .slice(0, 50);
    
    // Group documents by shared topics
    const clusters = {};
    
    topicTerms.forEach(([term, data]) => {
      if (data.documents.length >= 2) {
        clusters[term] = {
          topic: term,
          documents: data.documents.map(d => {
            const doc = documents.find(doc => doc.id === d.docId);
            return {
              id: d.docId,
              title: doc?.title,
              frequency: d.frequency
            };
          }),
          strength: data.totalFreq,
          documentCount: data.documents.length
        };
      }
    });
    
    this.relationships.topicClusters = clusters;
    console.log(`   Identified ${Object.keys(clusters).length} topic clusters`);
    
    return clusters;
  }

  calculateDocumentSimilarity(documents) {
    console.log('📊 Calculating document similarity...\n');
    
    const similarities = [];
    
    documents.forEach(doc1 => {
      documents.forEach(doc2 => {
        if (doc1.id >= doc2.id) return; // Avoid duplicates and self-comparison
        
        const terms1 = this.extractKeyTerms(doc1.content);
        const terms2 = this.extractKeyTerms(doc2.content);
        
        if (terms1.length === 0 || terms2.length === 0) return;
        
        // Calculate Jaccard similarity
        const set1 = new Set(terms1.map(t => t.term));
        const set2 = new Set(terms2.map(t => t.term));
        
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        
        const similarity = intersection.size / union.size;
        
        if (similarity > 0.1) { // Only keep meaningful similarities
          similarities.push({
            doc1: { id: doc1.id, title: doc1.title },
            doc2: { id: doc2.id, title: doc2.title },
            similarity: similarity,
            sharedTerms: Array.from(intersection).slice(0, 5)
          });
        }
      });
    });
    
    // Sort by similarity
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    this.relationships.documentSimilarity = similarities.slice(0, 50); // Top 50 most similar pairs
    console.log(`   Found ${similarities.length} document pairs with similarity > 0.1`);
    
    return similarities;
  }

  findConceptConnections(documents) {
    console.log('🧠 Mapping concept connections...\n');
    
    const concepts = {
      'collective': ['collective', 'cooperation', 'collaborative', 'community'],
      'business': ['business', 'strategy', 'market', 'revenue', 'profit'],
      'technology': ['technology', 'tech', 'software', 'development', 'automation'],
      'ai': ['artificial intelligence', 'machine learning', 'automation', 'neural'],
      'finance': ['financial', 'money', 'investment', 'funding', 'budget'],
      'strategy': ['strategy', 'planning', 'roadmap', 'vision', 'goals']
    };
    
    const conceptConnections = {};
    
    Object.entries(concepts).forEach(([conceptName, keywords]) => {
      const relatedDocs = [];
      
      documents.forEach(doc => {
        const content = (doc.content || '').toLowerCase();
        const matchCount = keywords.reduce((count, keyword) => {
          return count + (content.match(new RegExp(keyword, 'gi')) || []).length;
        }, 0);
        
        if (matchCount > 0) {
          relatedDocs.push({
            id: doc.id,
            title: doc.title,
            matches: matchCount,
            source: doc.source
          });
        }
      });
      
      if (relatedDocs.length > 0) {
        conceptConnections[conceptName] = {
          concept: conceptName,
          keywords: keywords,
          documents: relatedDocs.sort((a, b) => b.matches - a.matches),
          totalDocuments: relatedDocs.length
        };
      }
    });
    
    this.relationships.conceptConnections = conceptConnections;
    console.log(`   Mapped ${Object.keys(conceptConnections).length} concept connections`);
    
    return conceptConnections;
  }

  async generateRelationshipReport() {
    console.log('\n📊 === CONTENT RELATIONSHIP ANALYSIS REPORT ===\n');
    
    // Cross-references
    console.log('🔗 CROSS-REFERENCES:');
    if (this.relationships.crossReferences.length > 0) {
      this.relationships.crossReferences.slice(0, 10).forEach((ref, index) => {
        console.log(`${index + 1}. "${ref.from.title}" → "${ref.to.title}"`);
        console.log(`   Type: ${ref.type}, Strength: ${ref.strength}`);
      });
      if (this.relationships.crossReferences.length > 10) {
        console.log(`   ... and ${this.relationships.crossReferences.length - 10} more`);
      }
    } else {
      console.log('   No explicit cross-references found');
    }
    console.log('');
    
    // Topic clusters
    console.log('🏷️ TOP TOPIC CLUSTERS:');
    const topClusters = Object.values(this.relationships.topicClusters)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10);
    
    topClusters.forEach((cluster, index) => {
      console.log(`${index + 1}. Topic: "${cluster.topic}"`);
      console.log(`   Documents: ${cluster.documentCount}, Strength: ${cluster.strength}`);
      console.log(`   Examples: ${cluster.documents.slice(0, 3).map(d => d.title).join(', ')}`);
      console.log('');
    });
    
    // Document similarity
    console.log('📊 MOST SIMILAR DOCUMENTS:');
    this.relationships.documentSimilarity.slice(0, 10).forEach((sim, index) => {
      console.log(`${index + 1}. "${sim.doc1.title}" ↔ "${sim.doc2.title}"`);
      console.log(`   Similarity: ${(sim.similarity * 100).toFixed(1)}%`);
      console.log(`   Shared terms: ${sim.sharedTerms.join(', ')}`);
      console.log('');
    });
    
    // Concept connections
    console.log('🧠 CONCEPT CONNECTIONS:');
    Object.values(this.relationships.conceptConnections)
      .sort((a, b) => b.totalDocuments - a.totalDocuments)
      .forEach(concept => {
        console.log(`• ${concept.concept}: ${concept.totalDocuments} documents`);
        console.log(`  Top docs: ${concept.documents.slice(0, 3).map(d => d.title).join(', ')}`);
      });
    console.log('');
  }

  async generateKnowledgeGraph() {
    console.log('🌐 Generating knowledge graph visualization...\n');
    
    const fs = await import('fs/promises');
    
    // Create a simple HTML visualization
    const graphData = {
      nodes: [],
      links: []
    };
    
    // Add document nodes
    const docIds = new Set();
    this.relationships.documentSimilarity.slice(0, 20).forEach(sim => {
      if (!docIds.has(sim.doc1.id)) {
        graphData.nodes.push({
          id: sim.doc1.id,
          name: sim.doc1.title,
          type: 'document'
        });
        docIds.add(sim.doc1.id);
      }
      if (!docIds.has(sim.doc2.id)) {
        graphData.nodes.push({
          id: sim.doc2.id,
          name: sim.doc2.title,
          type: 'document'
        });
        docIds.add(sim.doc2.id);
      }
      
      graphData.links.push({
        source: sim.doc1.id,
        target: sim.doc2.id,
        strength: sim.similarity,
        type: 'similarity'
      });
    });
    
    // Add concept nodes
    Object.values(this.relationships.conceptConnections).forEach(concept => {
      const conceptId = `concept_${concept.concept}`;
      graphData.nodes.push({
        id: conceptId,
        name: concept.concept,
        type: 'concept'
      });
      
      concept.documents.slice(0, 5).forEach(doc => {
        if (docIds.has(doc.id)) {
          graphData.links.push({
            source: conceptId,
            target: doc.id,
            strength: doc.matches / 10,
            type: 'concept'
          });
        }
      });
    });
    
    const graphHtml = `<!DOCTYPE html>
<html>
<head>
    <title>Knowledge Graph</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .graph { width: 100%; height: 600px; border: 1px solid #ccc; }
        .node { cursor: pointer; }
        .node.document { fill: #69b3a2; }
        .node.concept { fill: #ff6b6b; }
        .link { stroke: #999; stroke-opacity: 0.6; }
        .tooltip { position: absolute; background: rgba(0,0,0,0.8); color: white; padding: 5px; border-radius: 3px; pointer-events: none; }
    </style>
</head>
<body>
    <h1>🌐 Knowledge Graph</h1>
    <div id="graph" class="graph"></div>
    <div id="tooltip" class="tooltip" style="display: none;"></div>
    
    <script>
        const data = ${JSON.stringify(graphData, null, 2)};
        
        const width = 1000;
        const height = 600;
        
        const svg = d3.select("#graph")
            .append("svg")
            .attr("width", width)
            .attr("height", height);
        
        const simulation = d3.forceSimulation(data.nodes)
            .force("link", d3.forceLink(data.links).id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-300))
            .force("center", d3.forceCenter(width / 2, height / 2));
        
        const link = svg.append("g")
            .selectAll("line")
            .data(data.links)
            .enter().append("line")
            .attr("class", "link")
            .attr("stroke-width", d => Math.sqrt(d.strength * 10));
        
        const node = svg.append("g")
            .selectAll("circle")
            .data(data.nodes)
            .enter().append("circle")
            .attr("class", d => "node " + d.type)
            .attr("r", d => d.type === 'concept' ? 8 : 5)
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));
        
        const tooltip = d3.select("#tooltip");
        
        node.on("mouseover", function(event, d) {
            tooltip.style("display", "block")
                .html(d.name)
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            tooltip.style("display", "none");
        });
        
        simulation.on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            
            node
                .attr("cx", d => d.x)
                .attr("cy", d => d.y);
        });
        
        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }
        
        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }
        
        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }
    </script>
</body>
</html>`;
    
    await fs.writeFile('./knowledge-graph.html', graphHtml);
    console.log('✅ Knowledge graph saved to knowledge-graph.html');
    console.log('🌐 Open this file in a browser to explore your knowledge connections');
  }

  async run() {
    console.log('🕸️ Content Relationship Mapper\n');
    
    try {
      const documents = await this.getAllDocuments();
      console.log(`📊 Analyzing relationships in ${documents.length} documents...\n`);
      
      // Run all analysis methods
      this.findCrossReferences(documents);
      this.findTopicClusters(documents);
      this.calculateDocumentSimilarity(documents);
      this.findConceptConnections(documents);
      
      // Generate reports
      await this.generateRelationshipReport();
      await this.generateKnowledgeGraph();
      
      // Save raw data
      const fs = await import('fs/promises');
      await fs.writeFile('./content-relationships.json', JSON.stringify(this.relationships, null, 2));
      console.log('💾 Raw relationship data saved to content-relationships.json');
      
      console.log('\n🎉 Relationship analysis complete!');
      console.log('🌐 Open knowledge-graph.html to visualize your content connections');
      
    } catch (error) {
      console.error('❌ Error during relationship analysis:', error.message);
    }
  }
}

// CLI handling
const mapper = new ContentRelationshipMapper();

if (process.argv.includes('--help')) {
  console.log(`
🕸️ Content Relationship Mapper

Analyzes and maps relationships between documents including:
• Cross-references and citations
• Topic clusters and themes
• Document similarity analysis
• Concept connections
• Knowledge graph generation

Usage:
  node content-relationship-mapper.js
  
Output:
  • content-relationships.json - Raw relationship data
  • knowledge-graph.html - Interactive visualization
  `);
} else {
  mapper.run();
}
