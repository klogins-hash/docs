#!/bin/bash
# Auto-tagging cron job script
# Add this to your crontab: */15 * * * * /path/to/auto-tag-cron.sh

cd "/Users/franksimpson/CascadeProjects/docs"
node advanced-auto-tagger.js --auto-tag >> auto-tag.log 2>&1
