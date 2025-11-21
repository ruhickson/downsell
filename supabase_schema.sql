-- Supabase Tables for Downsell Analytics
-- Run these commands in your Supabase SQL Editor

-- Table for caching transaction name to category mappings
-- This builds up a knowledge base over time, reducing AI API calls
CREATE TABLE IF NOT EXISTS category_transaction (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  usage_count INTEGER DEFAULT 1 -- Track how many times this mapping has been used
);

-- Index for fast lookups by transaction name
CREATE INDEX IF NOT EXISTS idx_category_transaction_name ON category_transaction(transaction_name);

-- Index for fast lookups by category
CREATE INDEX IF NOT EXISTS idx_category_transaction_category ON category_transaction(category);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_category_transaction_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_category_transaction_updated_at ON category_transaction;
CREATE TRIGGER trigger_update_category_transaction_updated_at
  BEFORE UPDATE ON category_transaction
  FOR EACH ROW
  EXECUTE FUNCTION update_category_transaction_updated_at();

-- Enable RLS for category_transaction
ALTER TABLE category_transaction ENABLE ROW LEVEL SECURITY;

-- RLS Policies for category_transaction
-- Allow anyone to read (for client-side lookups)
DROP POLICY IF EXISTS "Allow public reads" ON category_transaction;
CREATE POLICY "Allow public reads" ON category_transaction
  FOR SELECT
  USING (true);

-- Allow anyone to insert/update (for building shared knowledge base)
-- This allows both client-side and server-side caching
DROP POLICY IF EXISTS "Allow public writes" ON category_transaction;
CREATE POLICY "Allow public writes" ON category_transaction
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public updates" ON category_transaction;
CREATE POLICY "Allow public updates" ON category_transaction
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Function to increment usage count (for better performance)
CREATE OR REPLACE FUNCTION increment_usage_count(tx_name TEXT)
RETURNS void AS $$
BEGIN
  UPDATE category_transaction
  SET usage_count = usage_count + 1
  WHERE transaction_name = tx_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Table for button click events
CREATE TABLE IF NOT EXISTS button_clicks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  button_name TEXT NOT NULL,
  location TEXT,
  row_number INTEGER, -- Row position in the list (1-indexed)
  amount NUMERIC(10, 2), -- Amount being switched or cancelled (for Switch/Cancel buttons)
  status TEXT,
  method TEXT,
  file_count INTEGER,
  context JSONB, -- For any additional context data
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: Update existing button_clicks table if it has the old schema
-- Remove subscription column and add row_number and amount columns
DO $$
BEGIN
  -- Drop subscription column if it exists
  IF EXISTS (SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'button_clicks' AND column_name = 'subscription') THEN
    ALTER TABLE button_clicks DROP COLUMN subscription;
  END IF;
  
  -- Add row_number column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'button_clicks' AND column_name = 'row_number') THEN
    ALTER TABLE button_clicks ADD COLUMN row_number INTEGER;
  END IF;
  
  -- Add amount column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'button_clicks' AND column_name = 'amount') THEN
    ALTER TABLE button_clicks ADD COLUMN amount NUMERIC(10, 2);
  END IF;
END $$;

-- Table for CSV upload events
CREATE TABLE IF NOT EXISTS csv_uploads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  row_count INTEGER NOT NULL,
  bank_type TEXT NOT NULL,
  method TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for tab navigation events
CREATE TABLE IF NOT EXISTS tab_navigations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tab_name TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for PDF download events
CREATE TABLE IF NOT EXISTS pdf_downloads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for page view events
CREATE TABLE IF NOT EXISTS page_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  page TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_button_clicks_timestamp ON button_clicks(timestamp);
CREATE INDEX IF NOT EXISTS idx_button_clicks_button_name ON button_clicks(button_name);
CREATE INDEX IF NOT EXISTS idx_button_clicks_row_number ON button_clicks(row_number);
CREATE INDEX IF NOT EXISTS idx_csv_uploads_timestamp ON csv_uploads(timestamp);
CREATE INDEX IF NOT EXISTS idx_csv_uploads_bank_type ON csv_uploads(bank_type);
CREATE INDEX IF NOT EXISTS idx_tab_navigations_timestamp ON tab_navigations(timestamp);
CREATE INDEX IF NOT EXISTS idx_tab_navigations_tab_name ON tab_navigations(tab_name);
CREATE INDEX IF NOT EXISTS idx_pdf_downloads_timestamp ON pdf_downloads(timestamp);
CREATE INDEX IF NOT EXISTS idx_page_views_timestamp ON page_views(timestamp);
CREATE INDEX IF NOT EXISTS idx_page_views_page ON page_views(page);

-- Optional: Create a view for daily analytics summary
CREATE OR REPLACE VIEW daily_analytics AS
WITH all_dates AS (
  SELECT DATE(timestamp) as date FROM button_clicks
  UNION
  SELECT DATE(timestamp) as date FROM csv_uploads
  UNION
  SELECT DATE(timestamp) as date FROM tab_navigations
  UNION
  SELECT DATE(timestamp) as date FROM pdf_downloads
  UNION
  SELECT DATE(timestamp) as date FROM page_views
)
SELECT 
  d.date,
  COUNT(DISTINCT CASE 
    WHEN bc.ip_address IS NOT NULL THEN bc.ip_address
    WHEN cu.ip_address IS NOT NULL THEN cu.ip_address
    WHEN tn.ip_address IS NOT NULL THEN tn.ip_address
    WHEN pd.ip_address IS NOT NULL THEN pd.ip_address
    WHEN pv.ip_address IS NOT NULL THEN pv.ip_address
  END) as unique_visitors,
  (SELECT COUNT(*) FROM button_clicks WHERE DATE(timestamp) = d.date) as button_clicks,
  (SELECT COUNT(*) FROM csv_uploads WHERE DATE(timestamp) = d.date) as csv_uploads,
  (SELECT COUNT(*) FROM tab_navigations WHERE DATE(timestamp) = d.date) as tab_navigations,
  (SELECT COUNT(*) FROM pdf_downloads WHERE DATE(timestamp) = d.date) as pdf_downloads,
  (SELECT COUNT(*) FROM page_views WHERE DATE(timestamp) = d.date) as page_views
FROM all_dates d
LEFT JOIN button_clicks bc ON DATE(bc.timestamp) = d.date
LEFT JOIN csv_uploads cu ON DATE(cu.timestamp) = d.date
LEFT JOIN tab_navigations tn ON DATE(tn.timestamp) = d.date
LEFT JOIN pdf_downloads pd ON DATE(pd.timestamp) = d.date
LEFT JOIN page_views pv ON DATE(pv.timestamp) = d.date
GROUP BY d.date
ORDER BY d.date DESC;

-- Enable Row Level Security (RLS) - adjust policies as needed
ALTER TABLE button_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tab_navigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows service role to insert (for Netlify Functions)
-- Drop existing policies first if they exist, then create new ones
DROP POLICY IF EXISTS "Allow service role inserts" ON button_clicks;
CREATE POLICY "Allow service role inserts" ON button_clicks
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role inserts" ON csv_uploads;
CREATE POLICY "Allow service role inserts" ON csv_uploads
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role inserts" ON tab_navigations;
CREATE POLICY "Allow service role inserts" ON tab_navigations
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role inserts" ON pdf_downloads;
CREATE POLICY "Allow service role inserts" ON pdf_downloads
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role inserts" ON page_views;
CREATE POLICY "Allow service role inserts" ON page_views
  FOR INSERT
  WITH CHECK (true);

-- Optional: Create a policy for reading (adjust based on your needs)
-- For now, we'll allow service role to read as well
DROP POLICY IF EXISTS "Allow service role reads" ON button_clicks;
CREATE POLICY "Allow service role reads" ON button_clicks
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow service role reads" ON csv_uploads;
CREATE POLICY "Allow service role reads" ON csv_uploads
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow service role reads" ON tab_navigations;
CREATE POLICY "Allow service role reads" ON tab_navigations
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow service role reads" ON pdf_downloads;
CREATE POLICY "Allow service role reads" ON pdf_downloads
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow service role reads" ON page_views;
CREATE POLICY "Allow service role reads" ON page_views
  FOR SELECT
  USING (true);

