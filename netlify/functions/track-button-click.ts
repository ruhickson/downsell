// Netlify Function to track button clicks
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
    const { buttonName, location, row_number, amount, status, method, file_count, subscription, category, ...otherContext } = eventData;
    const timestamp = new Date().toISOString();
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const userAgent = event.headers['user-agent'] || 'unknown';

    // Structured logging for easy filtering
    console.log(JSON.stringify({
      event: 'BUTTON_CLICK',
      buttonName,
      location: location || 'unknown',
      row_number: row_number || null,
      amount: amount || null,
      subscription: subscription || null,
      category: category || null,
      status: status || null,
      method: method || null,
      file_count: file_count || null,
      ...otherContext,
      timestamp,
      ip,
      userAgent,
    }));

    // Also log a searchable line for quick filtering
    console.log(`[BUTTON_CLICK] ${buttonName} | Location: ${location || 'unknown'} | Row: ${row_number || 'N/A'} | Amount: ${amount || 'N/A'} | Subscription: ${subscription || 'N/A'} | Category: ${category || 'N/A'}`);

    // Save to Supabase if configured
    if (supabase) {
      try {
        // Build context object with subscription and category
        const contextData: any = { ...otherContext };
        if (subscription) contextData.subscription = subscription;
        if (category) contextData.category = category;
        
        const { error } = await supabase
          .from('button_clicks')
          .insert({
            button_name: buttonName,
            location: location || null,
            row_number: row_number || null,
            amount: amount ? parseFloat(amount) : null,
            status: status || null,
            method: method || null,
            file_count: file_count || null,
            context: Object.keys(contextData).length > 0 ? contextData : null,
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
      body: JSON.stringify({ success: true, buttonName, location, row_number, amount, status }),
    };
  } catch (error) {
    console.error('Error tracking button click:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

