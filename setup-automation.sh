#!/bin/bash

# Weaviate Automation Setup Script
# Sets up cron jobs for automated maintenance and optimization

echo "🤖 Setting up Weaviate Automation..."
echo ""

PROJECT_DIR="/Users/franksimpson/CascadeProjects/docs"
CRON_FILE="/tmp/weaviate_cron"

# Create temporary cron file with existing crontab
crontab -l > "$CRON_FILE" 2>/dev/null || echo "" > "$CRON_FILE"

echo "📋 Current cron jobs:"
if [ -s "$CRON_FILE" ]; then
    cat "$CRON_FILE"
else
    echo "   No existing cron jobs"
fi
echo ""

# Add our automation jobs
echo "➕ Adding Weaviate automation jobs..."

# Auto-tagging every 15 minutes
echo "*/15 * * * * cd $PROJECT_DIR && node advanced-auto-tagger.js --auto-tag >> auto-tag.log 2>&1" >> "$CRON_FILE"

# Full optimization every hour
echo "0 * * * * cd $PROJECT_DIR && node weaviate-optimizer.js automated-tasks >> optimization.log 2>&1" >> "$CRON_FILE"

# Daily maintenance report at 9 AM
echo "0 9 * * * cd $PROJECT_DIR && node weaviate-optimizer.js maintenance-report >> maintenance.log 2>&1" >> "$CRON_FILE"

# Weekly duplicate check on Sundays at 10 AM
echo "0 10 * * 0 cd $PROJECT_DIR && node safe-duplicate-cleaner.js >> duplicate-check.log 2>&1" >> "$CRON_FILE"

echo "📝 New cron schedule:"
cat "$CRON_FILE"
echo ""

# Install the new crontab
crontab "$CRON_FILE"

# Clean up
rm "$CRON_FILE"

echo "✅ Automation setup complete!"
echo ""
echo "🔄 Scheduled tasks:"
echo "   • Auto-tagging: Every 15 minutes"
echo "   • Optimization: Every hour"
echo "   • Daily report: 9 AM daily"
echo "   • Duplicate check: 10 AM Sundays"
echo ""
echo "📊 Logs will be saved to:"
echo "   • auto-tag.log"
echo "   • optimization.log"
echo "   • maintenance.log"
echo "   • duplicate-check.log"
echo ""
echo "🎉 Your Weaviate is now self-maintaining!"
