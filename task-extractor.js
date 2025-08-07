#!/usr/bin/env node

/**
 * Task & Action Item Extractor for Weaviate Documents
 * Extracts TODOs, action items, deadlines, and tasks from all documents
 */

import https from 'https';

const WEAVIATE_CONFIG = {
  scheme: 'https',
  host: 'otv0nclnrjge62eizqvxhg.c0.us-west3.gcp.weaviate.cloud',
  apiKey: 'NzRFTWRHclVoZmFobERzZl9nZGlvWTZjMWt5b3Z1bWg3ekwvU2FWa09QcUJMTHZON3RUV2pIQ1ZEdzlrPV92MjAw'
};

class TaskExtractor {
  constructor() {
    this.taskPatterns = this.initializeTaskPatterns();
  }

  initializeTaskPatterns() {
    return {
      // TODO patterns
      todo: {
        patterns: [
          /(?:^|\s)(?:TODO|Todo|todo)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:^|\s)(?:\[ \]|\[\s\])[\s]*(.+?)(?:\n|$)/gim,
          /(?:^|\s)(?:-|\*|\d+\.)[\s]*(?:TODO|Todo|todo)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:^|\s)(?:need to|needs to|should|must)[\s]+(.+?)(?:\.|!|\?|\n|$)/gim,
          /(?:^|\s)(?:remember to|don't forget to)[\s]+(.+?)(?:\.|!|\?|\n|$)/gim
        ],
        type: 'todo',
        priority: 'medium'
      },

      // Action items
      action_items: {
        patterns: [
          /(?:^|\s)(?:action item|action|AI)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:^|\s)(?:\[action\]|\[AI\])[\s]*(.+?)(?:\n|$)/gim,
          /(?:^|\s)(?:-|\*|\d+\.)[\s]*(?:action|follow up|follow-up)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:^|\s)(?:next step|next steps)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:^|\s)(?:will|going to|plan to)[\s]+(.+?)(?:\.|!|\?|\n|$)/gim
        ],
        type: 'action',
        priority: 'high'
      },

      // Deadlines and dates
      deadlines: {
        patterns: [
          /(?:deadline|due|by)[\s:]*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}|[A-Za-z]+ \d{1,2}(?:st|nd|rd|th)?(?:, \d{4})?)/gim,
          /(?:deadline|due|by)[\s:]*([A-Za-z]+day|tomorrow|today|this week|next week|end of week|EOW|end of month|EOM)/gim,
          /(?:urgent|asap|immediately|critical)[\s:]*(.+?)(?:\.|!|\?|\n|$)/gim,
          /(?:before|by)[\s]+(\d{1,2}\/\d{1,2}|\d{1,2}-\d{1,2}|[A-Za-z]+day)[\s:]*(.+?)(?:\.|!|\?|\n|$)/gim
        ],
        type: 'deadline',
        priority: 'high'
      },

      // Assignments and responsibilities
      assignments: {
        patterns: [
          /(?:assigned to|assign to|owner|responsible)[\s:]*([A-Za-z\s]+?)(?:\n|$)/gim,
          /(?:@[A-Za-z0-9_]+)[\s]*(.+?)(?:\n|$)/gim,
          /([A-Za-z\s]+?)[\s]+(?:will|should|needs to|responsible for)[\s]+(.+?)(?:\.|!|\?|\n|$)/gim,
          /(?:task for|for)[\s]+([A-Za-z\s]+?)[\s:]*(.+?)(?:\n|$)/gim
        ],
        type: 'assignment',
        priority: 'medium'
      },

      // Meeting follow-ups
      meeting_followups: {
        patterns: [
          /(?:follow up|follow-up)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:action items?|AIs?)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:decisions?|decided)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:next meeting|schedule|meeting)[\s:]*(.+?)(?:\n|$)/gim
        ],
        type: 'followup',
        priority: 'medium'
      },

      // Questions and decisions needed
      questions: {
        patterns: [
          /(?:question|Q:|ask|clarify)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:decision needed|need to decide|decide)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:unclear|not sure|unsure)[\s:]*(.+?)(?:\n|$)/gim,
          /(.+?\?)(?:\n|$)/gim
        ],
        type: 'question',
        priority: 'medium'
      },

      // Research and investigation
      research: {
        patterns: [
          /(?:research|investigate|look into|find out)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:need to know|figure out|understand)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:analyze|review|check)[\s:]*(.+?)(?:\n|$)/gim
        ],
        type: 'research',
        priority: 'low'
      },

      // Bugs and issues
      issues: {
        patterns: [
          /(?:bug|issue|problem|error|fix)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:broken|not working|failing)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:troubleshoot|debug|resolve)[\s:]*(.+?)(?:\n|$)/gim
        ],
        type: 'issue',
        priority: 'high'
      },

      // Ideas and improvements
      ideas: {
        patterns: [
          /(?:idea|suggestion|improvement|enhance)[\s:]*(.+?)(?:\n|$)/gim,
          /(?:could|might|maybe|consider)[\s]+(.+?)(?:\n|$)/gim,
          /(?:feature|enhancement|upgrade)[\s:]*(.+?)(?:\n|$)/gim
        ],
        type: 'idea',
        priority: 'low'
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

  extractTasks(content, fileName, source) {
    if (!content) return [];
    
    const tasks = [];
    const lines = content.split('\n');
    
    Object.entries(this.taskPatterns).forEach(([categoryKey, config]) => {
      config.patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const taskText = match[1] || match[0];
          if (taskText && taskText.trim().length > 3) {
            
            // Find line number
            const lineIndex = lines.findIndex(line => line.includes(taskText.substring(0, 20)));
            
            // Extract assignee if present
            let assignee = null;
            const assigneeMatch = taskText.match(/@([A-Za-z0-9_]+)|assigned to ([A-Za-z\s]+)|for ([A-Za-z\s]+)/i);
            if (assigneeMatch) {
              assignee = assigneeMatch[1] || assigneeMatch[2] || assigneeMatch[3];
            }
            
            // Extract date if present
            let dueDate = null;
            const dateMatch = taskText.match(/(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}|[A-Za-z]+ \d{1,2}(?:st|nd|rd|th)?(?:, \d{4})?|[A-Za-z]+day|tomorrow|today|this week|next week)/i);
            if (dateMatch) {
              dueDate = dateMatch[1];
            }
            
            // Determine urgency
            let urgency = config.priority;
            if (/urgent|asap|critical|immediately|deadline/i.test(taskText)) {
              urgency = 'high';
            }
            
            tasks.push({
              id: `${fileName}-${lineIndex}-${tasks.length}`,
              text: taskText.trim(),
              type: config.type,
              priority: urgency,
              assignee: assignee?.trim(),
              dueDate: dueDate,
              source: {
                document: fileName,
                source: source,
                lineNumber: lineIndex + 1
              },
              extractedAt: new Date().toISOString(),
              status: 'open'
            });
          }
        }
        // Reset regex lastIndex to avoid issues with global flag
        pattern.lastIndex = 0;
      });
    });
    
    return tasks;
  }

  async getAllDocuments() {
    console.log('📊 Fetching all documents for task extraction...\n');
    
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

  async extractAllTasks() {
    console.log('📋 Task & Action Item Extractor\n');
    
    const documents = await this.getAllDocuments();
    console.log(`🔍 Analyzing ${documents.length} documents for actionable items...\n`);
    
    const allTasks = [];
    const tasksByDocument = {};
    const tasksByType = {};
    const tasksByPriority = { high: [], medium: [], low: [] };
    
    documents.forEach(doc => {
      const tasks = this.extractTasks(doc.content, doc.title, doc.source);
      
      if (tasks.length > 0) {
        allTasks.push(...tasks);
        tasksByDocument[doc.title] = tasks;
        
        // Organize by type
        tasks.forEach(task => {
          if (!tasksByType[task.type]) {
            tasksByType[task.type] = [];
          }
          tasksByType[task.type].push(task);
          tasksByPriority[task.priority].push(task);
        });
        
        console.log(`📄 "${doc.title}": ${tasks.length} tasks found`);
      }
    });
    
    return {
      allTasks,
      tasksByDocument,
      tasksByType,
      tasksByPriority,
      totalTasks: allTasks.length,
      documentsWithTasks: Object.keys(tasksByDocument).length
    };
  }

  generateTaskReport(results) {
    console.log('\n📊 === TASK EXTRACTION REPORT ===\n');
    
    console.log(`📋 Total actionable items found: ${results.totalTasks}`);
    console.log(`📄 Documents with tasks: ${results.documentsWithTasks}`);
    console.log(`📈 Task coverage: ${((results.documentsWithTasks / 200) * 100).toFixed(1)}%\n`);
    
    // Priority breakdown
    console.log('🚨 PRIORITY BREAKDOWN:');
    console.log(`   High Priority: ${results.tasksByPriority.high.length} tasks`);
    console.log(`   Medium Priority: ${results.tasksByPriority.medium.length} tasks`);
    console.log(`   Low Priority: ${results.tasksByPriority.low.length} tasks\n`);
    
    // Type breakdown
    console.log('📝 TASK TYPES:');
    Object.entries(results.tasksByType).forEach(([type, tasks]) => {
      console.log(`   ${type}: ${tasks.length} items`);
    });
    
    // High priority tasks
    console.log('\n🚨 HIGH PRIORITY TASKS:');
    results.tasksByPriority.high.slice(0, 10).forEach((task, index) => {
      console.log(`${index + 1}. [${task.type.toUpperCase()}] ${task.text}`);
      console.log(`   📄 Source: ${task.source.document}`);
      if (task.assignee) console.log(`   👤 Assignee: ${task.assignee}`);
      if (task.dueDate) console.log(`   📅 Due: ${task.dueDate}`);
      console.log('');
    });
    
    if (results.tasksByPriority.high.length > 10) {
      console.log(`   ... and ${results.tasksByPriority.high.length - 10} more high priority tasks\n`);
    }
    
    // Collective project tasks
    const collectivTasks = results.allTasks.filter(task => 
      /collective|collectiv/i.test(task.text) || 
      /collective|collectiv/i.test(task.source.document)
    );
    
    if (collectivTasks.length > 0) {
      console.log('🎯 COLLECTIVE PROJECT TASKS:');
      collectivTasks.forEach((task, index) => {
        console.log(`${index + 1}. [${task.type.toUpperCase()}] ${task.text}`);
        console.log(`   📄 Source: ${task.source.document}`);
        console.log('');
      });
    }
    
    // Documents with most tasks
    console.log('📊 DOCUMENTS WITH MOST TASKS:');
    const sortedDocs = Object.entries(results.tasksByDocument)
      .sort(([,a], [,b]) => b.length - a.length)
      .slice(0, 5);
    
    sortedDocs.forEach(([docName, tasks]) => {
      console.log(`   "${docName}": ${tasks.length} tasks`);
    });
  }

  async generateTaskDashboard(results) {
    console.log('\n📊 Generating Task Dashboard...');
    
    const fs = await import('fs/promises');
    
    // Create a comprehensive task dashboard
    const dashboard = `---
title: "📋 Task & Action Items Dashboard"
description: "Extracted actionable items from all documents"
tags: ["tasks", "todos", "action-items", "dashboard"]
category: "management"
priority: "high"
last-updated: "${new Date().toISOString().split('T')[0]}"
---

# 📋 Task & Action Items Dashboard

<Info>
**Auto-Generated Dashboard** - This dashboard was automatically created by extracting actionable items from ${results.documentsWithTasks} documents. Last updated: ${new Date().toLocaleString()}
</Info>

## 📊 Summary

- **Total Tasks**: ${results.totalTasks}
- **Documents Analyzed**: 200
- **Documents with Tasks**: ${results.documentsWithTasks}
- **Coverage**: ${((results.documentsWithTasks / 200) * 100).toFixed(1)}%

## 🚨 Priority Breakdown

| Priority | Count | Percentage |
|----------|-------|------------|
| High | ${results.tasksByPriority.high.length} | ${((results.tasksByPriority.high.length / results.totalTasks) * 100).toFixed(1)}% |
| Medium | ${results.tasksByPriority.medium.length} | ${((results.tasksByPriority.medium.length / results.totalTasks) * 100).toFixed(1)}% |
| Low | ${results.tasksByPriority.low.length} | ${((results.tasksByPriority.low.length / results.totalTasks) * 100).toFixed(1)}% |

## 📝 Task Types

${Object.entries(results.tasksByType).map(([type, tasks]) => 
  `- **${type}**: ${tasks.length} items`
).join('\n')}

## 🚨 High Priority Tasks

${results.tasksByPriority.high.slice(0, 15).map((task, index) => `
### ${index + 1}. ${task.text}

- **Type**: ${task.type}
- **Priority**: ${task.priority}
- **Source**: ${task.source.document}
${task.assignee ? `- **Assignee**: ${task.assignee}` : ''}
${task.dueDate ? `- **Due Date**: ${task.dueDate}` : ''}
- **Line**: ${task.source.lineNumber}

`).join('')}

${results.tasksByPriority.high.length > 15 ? `<Note>\n**${results.tasksByPriority.high.length - 15} more high priority tasks** - See full task export for complete list.\n</Note>\n` : ''}

## 🎯 Collective Project Tasks

${results.allTasks.filter(task => 
  /collective|collectiv/i.test(task.text) || 
  /collective|collectiv/i.test(task.source.document)
).map((task, index) => `
### ${index + 1}. ${task.text}

- **Type**: ${task.type}
- **Priority**: ${task.priority}
- **Source**: ${task.source.document}
- **Line**: ${task.source.lineNumber}

`).join('')}

## 📊 Documents with Most Tasks

${Object.entries(results.tasksByDocument)
  .sort(([,a], [,b]) => b.length - a.length)
  .slice(0, 10)
  .map(([docName, tasks]) => `- **"${docName}"**: ${tasks.length} tasks`)
  .join('\n')}

## 🔄 Next Steps

<Warning>
**Action Required** - Review high priority tasks above and assign owners/due dates as needed.
</Warning>

<Tip>
This dashboard is automatically generated. Run the task extractor again to update with new documents or changes.
</Tip>

---

*Generated by Task Extractor on ${new Date().toLocaleString()}*
`;

    await fs.writeFile('./task-dashboard.mdx', dashboard);
    console.log('✅ Task dashboard saved to task-dashboard.mdx');
    
    // Also save raw JSON data
    await fs.writeFile('./extracted-tasks.json', JSON.stringify(results, null, 2));
    console.log('✅ Raw task data saved to extracted-tasks.json');
  }

  async run() {
    try {
      const results = await this.extractAllTasks();
      this.generateTaskReport(results);
      await this.generateTaskDashboard(results);
      
      console.log('\n🎉 Task extraction complete!');
      console.log('📊 View task-dashboard.mdx for a comprehensive overview');
      console.log('📁 Raw data available in extracted-tasks.json');
      
      return results;
    } catch (error) {
      console.error('❌ Error during task extraction:', error.message);
      return null;
    }
  }
}

// CLI handling
const args = process.argv.slice(2);

const extractor = new TaskExtractor();

if (args.includes('--help')) {
  console.log(`
📋 Task & Action Item Extractor

Extracts actionable items from all Weaviate documents including:
• TODOs and task lists
• Action items and follow-ups  
• Deadlines and due dates
• Assignments and responsibilities
• Questions and decisions needed
• Research and investigation items
• Bugs and issues to fix
• Ideas and improvements

Usage:
  node task-extractor.js              # Extract all tasks and generate dashboard
  node task-extractor.js --help       # Show this help

Output:
  • task-dashboard.mdx - Comprehensive task dashboard
  • extracted-tasks.json - Raw task data for integration
  `);
} else {
  extractor.run();
}
