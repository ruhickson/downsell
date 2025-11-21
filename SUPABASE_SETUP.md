# Supabase Analytics Setup Guide

This guide explains how to set up Supabase to store analytics data from Netlify Functions.

## Prerequisites

1. A Supabase account and project
2. Netlify deployment with environment variables configured

## Step 1: Create Supabase Tables

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `supabase_schema.sql`
4. Click **Run** to execute the SQL

This will create:
- `button_clicks` - Tracks all button click events
- `csv_uploads` - Tracks CSV file uploads
- `tab_navigations` - Tracks tab navigation events
- `pdf_downloads` - Tracks PDF download events
- `page_views` - Tracks page view events

All tables include indexes for better query performance and Row Level Security (RLS) policies.

## Step 2: Get Supabase Credentials

1. In your Supabase project dashboard, go to **Project Settings** > **API**
2. Copy the **Project URL** (e.g., `https://xxxxx.supabase.co`)
3. Copy the **service_role** key (NOT the anon key)
   - ⚠️ **Important**: The service_role key bypasses Row Level Security (RLS)
   - Keep this key secret and never commit it to version control

## Step 3: Configure Netlify Environment Variables

1. Go to your Netlify dashboard
2. Select your site
3. Navigate to **Site settings** > **Environment variables**
4. Add the following variables:

   - **Key**: `SUPABASE_URL`
     **Value**: Your Supabase project URL (from Step 2)

   - **Key**: `SUPABASE_SERVICE_ROLE_KEY`
     **Value**: Your Supabase service_role key (from Step 2)

5. Click **Save**

These environment variables will be automatically available to all Netlify Functions.

## Step 4: Verify Setup

After deploying, check your Netlify Function logs to ensure:
- Functions are running without errors
- Supabase inserts are successful (check for any error messages)

You can also query your Supabase tables to verify data is being inserted:

```sql
-- Check recent button clicks
SELECT * FROM button_clicks ORDER BY created_at DESC LIMIT 10;

-- Check CSV uploads
SELECT * FROM csv_uploads ORDER BY created_at DESC LIMIT 10;

-- Check tab navigations
SELECT * FROM tab_navigations ORDER BY created_at DESC LIMIT 10;
```

## Optional: Local Development

For local development, create a `.env` file in the project root (this file is gitignored):

```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

Note: Netlify Functions can access environment variables set in the Netlify dashboard, but for local testing with `netlify dev`, you may need to configure them differently.

## Database Schema Overview

### button_clicks
- `button_name` - Name of the button clicked
- `location` - Where the button was clicked (optional)
- `subscription` - Related subscription name (optional)
- `status` - Status context (optional)
- `method` - Upload method (optional)
- `file_count` - Number of files (optional)
- `context` - Additional context as JSONB
- `timestamp` - Event timestamp
- `ip_address` - User IP address
- `user_agent` - User browser/device info

### csv_uploads
- `row_count` - Number of rows in uploaded CSV
- `bank_type` - Bank type (AIB, Revolut, BOI, etc.)
- `method` - Upload method (file_processing, drag_drop, etc.)
- `timestamp` - Event timestamp
- `ip_address` - User IP address
- `user_agent` - User browser/device info

### tab_navigations
- `tab_name` - Name of the tab navigated to
- `timestamp` - Event timestamp
- `ip_address` - User IP address
- `user_agent` - User browser/device info

### pdf_downloads
- `timestamp` - Event timestamp
- `ip_address` - User IP address
- `user_agent` - User browser/device info

### page_views
- `page` - Page name/path
- `timestamp` - Event timestamp
- `ip_address` - User IP address
- `user_agent` - User browser/device info

## Daily Analytics View

The schema includes a `daily_analytics` view that provides aggregated daily statistics:

```sql
SELECT * FROM daily_analytics ORDER BY date DESC;
```

This view shows:
- Unique visitors per day
- Total button clicks
- Total CSV uploads
- Total tab navigations
- Total PDF downloads
- Total page views

## Troubleshooting

### Functions not saving to Supabase
- Check that environment variables are set correctly in Netlify
- Verify the service_role key is correct (not the anon key)
- Check Netlify Function logs for error messages
- Ensure RLS policies allow inserts (the schema includes policies for this)

### Database connection errors
- Verify your Supabase project URL is correct
- Check that your Supabase project is active
- Ensure the service_role key hasn't been rotated

### Missing data
- Check that functions are being called (check Netlify Function logs)
- Verify inserts are successful (check Supabase table logs)
- Ensure RLS policies are configured correctly

