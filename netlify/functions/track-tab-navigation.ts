// Netlify Function to track tab navigation
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
    const { tabName } = eventData;
    const timestamp = new Date().toISOString();
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const userAgent = event.headers['user-agent'] || 'unknown';

    // Structured logging for easy filtering
    console.log(JSON.stringify({
      event: 'TAB_NAVIGATION',
      tabName,
      timestamp,
      ip,
      userAgent,
    }));

    // Also log a searchable line for quick filtering
    console.log(`[TAB_NAVIGATION] Tab: ${tabName}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, tabName }),
    };
  } catch (error) {
    console.error('Error tracking tab navigation:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

