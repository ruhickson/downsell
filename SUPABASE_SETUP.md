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

**Analytics Tables:**
- `button_clicks` - Tracks all button click events
- `csv_uploads` - Tracks CSV file uploads
- `tab_navigations` - Tracks tab navigation events
- `pdf_downloads` - Tracks PDF download events
- `page_views` - Tracks page view events

**User Data Tables (NEW):**
- `user_transactions` - Stores user's CSV transaction data (persists across logins)
- `user_subscriptions` - Stores detected subscriptions for each user
- `user_uploaded_files` - Stores metadata about uploaded CSV files

All tables include indexes for better query performance and Row Level Security (RLS) policies.

## Step 2: Get Supabase Credentials

1. In your Supabase project dashboard, go to **Project Settings** > **API**
2. Copy the **Project URL** (e.g., `https://xxxxx.supabase.co`)
3. Copy the **service_role** key (NOT the anon key)
   - ⚠️ **Important**: The service_role key bypasses Row Level Security (RLS)
   - Keep this key secret and never commit it to version control

## Step 3: Configure Environment Variables

### For Netlify Functions (Server-side)

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

### For Client-side (User Data Persistence)

To enable user data persistence (CSV uploads, transactions, subscriptions), you also need to configure client-side environment variables:

1. In your Supabase project dashboard, go to **Project Settings** > **API**
2. Copy the **anon/public** key (this is safe to expose in client-side code)
3. In your build system (Vite, etc.), set these environment variables:

   - **Key**: `VITE_SUPABASE_URL`
     **Value**: Your Supabase project URL

   - **Key**: `VITE_SUPABASE_ANON_KEY`
     **Value**: Your Supabase anon/public key

**Note:** The client-side code will automatically fall back to localStorage if Supabase is not configured, so this is optional but recommended for data persistence across devices and sessions.

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
# For Netlify Functions (server-side)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# For client-side (user data persistence)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
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

### user_transactions
- `user_email` - User's email address (used as identifier)
- `description` - Transaction description
- `amount` - Transaction amount
- `type` - Transaction type (debit/credit)
- `date` - Transaction date
- `currency` - Currency code
- `balance` - Account balance after transaction
- `bank_source` - Bank name (AIB, Revolut, etc.)
- `account` - Account identifier
- `category` - Transaction category (if categorized)
- `original_data` - Original transaction data as JSONB

### user_subscriptions
- `user_email` - User's email address
- `description` - Subscription description
- `total` - Total amount spent
- `count` - Number of transactions
- `average` - Average transaction amount
- `max_amount` - Maximum transaction amount
- `standard_deviation` - Standard deviation of amounts
- `time_span` - Time span in days
- `frequency` - Transactions per month
- `avg_days_between` - Average days between transactions
- `first_date` - First transaction date
- `last_date` - Last transaction date

### user_uploaded_files
- `user_email` - User's email address
- `bank_type` - Bank type (AIB, Revolut, etc.)
- `row_count` - Number of rows in the CSV
- `account` - Account identifier
- `file_name` - Original file name
- `file_size` - File size in bytes
- `file_type` - File MIME type
- `last_modified` - File last modified timestamp

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

### User data not persisting
- Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in your build environment
- Check browser console for Supabase connection errors
- Verify the user is logged in (data is saved per email address)
- Check that the tables `user_transactions`, `user_subscriptions`, and `user_uploaded_files` exist in Supabase
- The app will fall back to localStorage if Supabase is not configured, but this won't persist across devices

## User Data Persistence

The app now automatically saves and loads user data (CSV transactions, subscriptions, uploaded files) from Supabase. This means:

- ✅ Data persists across logins
- ✅ Data is available on any device (when logged in with the same email)
- ✅ Data survives browser cache clearing
- ✅ Falls back to localStorage if Supabase is not configured

The data is automatically saved when:
- User uploads a CSV file
- Transactions are processed
- Subscriptions are detected
- User logs in (data is loaded automatically)

To verify user data is being saved, you can query the tables:

```sql
-- Check a user's transactions
SELECT * FROM user_transactions WHERE user_email = 'user@example.com' ORDER BY date DESC LIMIT 10;

-- Check a user's subscriptions
SELECT * FROM user_subscriptions WHERE user_email = 'user@example.com';

-- Check a user's uploaded files
SELECT * FROM user_uploaded_files WHERE user_email = 'user@example.com';
```
