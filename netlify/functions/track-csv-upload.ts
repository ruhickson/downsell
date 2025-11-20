// Netlify Function to track CSV uploads
import { supabase } from './_supabase';

export const handler = async (event: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const eventData = JSON.parse(event.body || '{}');
    const { rowCount, bankType, method } = eventData;
    const timestamp = new Date().toISOString();
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const userAgent = event.headers['user-agent'] || 'unknown';

    // Structured logging for easy filtering
    console.log(JSON.stringify({
      event: 'CSV_UPLOAD',
      rowCount: rowCount || 0,
      bankType: bankType || 'unknown',
      method: method || 'unknown',
      timestamp,
      ip,
      userAgent,
    }));

    // Also log a searchable line for quick filtering
    console.log(`[CSV_UPLOAD] Bank: ${bankType || 'unknown'} | Rows: ${rowCount || 0} | Method: ${method || 'unknown'}`);

    // Save to Supabase if configured
    if (supabase) {
      try {
        const { error } = await supabase
          .from('csv_uploads')
          .insert({
            row_count: rowCount || 0,
            bank_type: bankType || 'unknown',
            method: method || 'unknown',
            timestamp: timestamp,
            ip_address: ip,
            user_agent: userAgent,
          });

        if (error) {
          console.error('Error saving to Supabase:', error);
        }
      } catch (dbError) {
        console.error('Database error (non-blocking):', dbError);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, rowCount, bankType, method }),
    };
  } catch (error) {
    console.error('Error tracking CSV upload:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

