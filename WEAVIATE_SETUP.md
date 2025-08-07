---
title: "Weaviate to Mintlify Real-time Sync Setup"
description: "Complete guide for setting up real-time synchronization between Weaviate and Mintlify documentation"
---

# Weaviate to Mintlify Real-time Sync

This guide walks you through setting up real-time synchronization between your Weaviate database and Mintlify documentation site.

## Prerequisites

<Steps>
<Step title="Weaviate Instance">
You need a running Weaviate instance with:
- API access enabled
- A class/schema containing your documentation content
- Fields: `title`, `content`, `description`, `category`, `tags`
</Step>

<Step title="GitHub Repository">
- Repository with Mintlify setup (already done ✅)
- GitHub Actions enabled for automated deployments
- Write access for automated commits
</Step>

<Step title="Node.js Environment">
- Node.js 18+ installed
- npm or yarn package manager
</Step>
</Steps>

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your Weaviate configuration:

```bash
# For local Weaviate
WEAVIATE_SCHEME=http
WEAVIATE_HOST=localhost:8080
WEAVIATE_API_KEY=your_api_key

# For Weaviate Cloud Services
WEAVIATE_SCHEME=https
WEAVIATE_HOST=your-cluster.weaviate.network
WEAVIATE_API_KEY=your_wcs_api_key

# Your Weaviate class name
WEAVIATE_CLASS_NAME=Document
```

## Usage

### One-time Sync

Sync all content from Weaviate to Mintlify once:

```bash
npm run sync
```

### Real-time Sync

Start continuous synchronization (checks every 5 minutes):

```bash
npm run sync:watch
```

For faster sync intervals (every 1 minute):

```bash
npm run sync:watch:fast
```

## How It Works

<Tabs>
<Tab title="Data Flow">
1. **Query Weaviate**: Fetches content updated since last sync
2. **Transform Content**: Converts to MDX with proper frontmatter
3. **Generate Files**: Creates organized file structure
4. **Update Navigation**: Automatically updates `docs.json`
5. **Git Operations**: Commits and pushes changes
6. **Mintlify Rebuild**: GitHub webhook triggers automatic rebuild
</Tab>

<Tab title="File Structure">
```
docs/
├── weaviate-content/
│   ├── general/
│   │   ├── article-1.mdx
│   │   └── article-2.mdx
│   ├── tutorials/
│   │   └── tutorial-1.mdx
│   └── api/
│       └── endpoint-docs.mdx
├── scripts/
│   └── weaviate-sync.js
└── .last-sync (tracks sync timestamp)
```
</Tab>

<Tab title="Content Format">
Generated MDX files follow Mintlify standards:

```mdx
---
title: "Article Title from Weaviate"
description: "Description from Weaviate"
category: "General"
tags: ["tag1", "tag2"]
---

# Content from Weaviate

Your content here...

<Note>
This content was automatically synced from Weaviate on 2024-01-01T12:00:00Z
</Note>
```
</Tab>
</Tabs>

## Weaviate Schema Requirements

Your Weaviate class should have these properties:

<CodeGroup>
```python Python
import weaviate

client = weaviate.Client("http://localhost:8080")

class_schema = {
    "class": "Document",
    "properties": [
        {
            "name": "title",
            "dataType": ["text"],
            "description": "Document title"
        },
        {
            "name": "content", 
            "dataType": ["text"],
            "description": "Main content in Markdown format"
        },
        {
            "name": "description",
            "dataType": ["text"], 
            "description": "Brief description for SEO"
        },
        {
            "name": "category",
            "dataType": ["text"],
            "description": "Content category for organization"
        },
        {
            "name": "tags",
            "dataType": ["text[]"],
            "description": "Content tags"
        }
    ]
}

client.schema.create_class(class_schema)
```

```javascript JavaScript
import weaviate from 'weaviate-ts-client';

const client = weaviate.client({
  scheme: 'http',
  host: 'localhost:8080',
});

const classSchema = {
  class: 'Document',
  properties: [
    {
      name: 'title',
      dataType: ['text'],
      description: 'Document title'
    },
    {
      name: 'content',
      dataType: ['text'], 
      description: 'Main content in Markdown format'
    },
    {
      name: 'description',
      dataType: ['text'],
      description: 'Brief description for SEO'
    },
    {
      name: 'category', 
      dataType: ['text'],
      description: 'Content category for organization'
    },
    {
      name: 'tags',
      dataType: ['text[]'],
      description: 'Content tags'
    }
  ]
};

await client.schema.classCreator().withClass(classSchema).do();
```
</CodeGroup>

## Automation Options

### GitHub Actions (Recommended)

Create `.github/workflows/weaviate-sync.yml`:

```yaml
name: Weaviate Sync

on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch:       # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run sync
        env:
          WEAVIATE_HOST: ${{ secrets.WEAVIATE_HOST }}
          WEAVIATE_API_KEY: ${{ secrets.WEAVIATE_API_KEY }}
          WEAVIATE_CLASS_NAME: ${{ secrets.WEAVIATE_CLASS_NAME }}
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "sync:watch"]
```

## Troubleshooting

<Accordion title="Common Issues">

**Connection Failed**
- Verify Weaviate host and port
- Check API key permissions
- Ensure Weaviate instance is running

**No Content Synced**
- Check if your class name matches `WEAVIATE_CLASS_NAME`
- Verify your schema has required fields
- Check `.last-sync` file timestamp

**Git Push Failed**
- Ensure repository has write permissions
- Check if there are merge conflicts
- Verify GitHub token has proper scopes

</Accordion>

## Advanced Configuration

### Custom Content Transformation

Modify the `generateMDXContent()` method in `scripts/weaviate-sync.js` to customize how Weaviate content is transformed into MDX.

### Selective Sync

Add filters to the Weaviate query to sync only specific content:

```javascript
.withWhere({
  operator: 'And',
  operands: [
    {
      path: ['category'],
      operator: 'Equal',
      valueText: 'public'
    },
    {
      path: ['_additional', 'lastUpdateTimeUnix'],
      operator: 'GreaterThan', 
      valueNumber: since.getTime() / 1000
    }
  ]
})
```

<Tip>
For production deployments, consider using a message queue (Redis, RabbitMQ) or webhooks from Weaviate for more efficient real-time updates instead of polling.
</Tip>
