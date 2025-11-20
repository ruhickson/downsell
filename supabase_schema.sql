-- Supabase Tables for Downsell Analytics
-- Run these commands in your Supabase SQL Editor

-- Table for button click events
CREATE TABLE IF NOT EXISTS button_clicks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  button_name TEXT NOT NULL,
  location TEXT,
  subscription TEXT,
  status TEXT,
  method TEXT,
  file_count INTEGER,
  context JSONB, -- For any additional context data
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
-- Replace 'service_role_key' with your actual service role key pattern or use a different auth method
CREATE POLICY "Allow service role inserts" ON button_clicks
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service role inserts" ON csv_uploads
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service role inserts" ON tab_navigations
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service role inserts" ON pdf_downloads
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service role inserts" ON page_views
  FOR INSERT
  WITH CHECK (true);

-- Optional: Create a policy for reading (adjust based on your needs)
-- For now, we'll allow service role to read as well
CREATE POLICY "Allow service role reads" ON button_clicks
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service role reads" ON csv_uploads
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service role reads" ON tab_navigations
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service role reads" ON pdf_downloads
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service role reads" ON page_views
  FOR SELECT
  USING (true);

