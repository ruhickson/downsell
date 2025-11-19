// Netlify Function to track button clicks
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
    const { buttonName, location, subscription, status, method, file_count, ...otherContext } = eventData;
    const timestamp = new Date().toISOString();
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const userAgent = event.headers['user-agent'] || 'unknown';

    // Structured logging for easy filtering
    console.log(JSON.stringify({
      event: 'BUTTON_CLICK',
      buttonName,
      location: location || 'unknown',
      subscription: subscription || null,
      status: status || null,
      method: method || null,
      file_count: file_count || null,
      ...otherContext,
      timestamp,
      ip,
      userAgent,
    }));

    // Also log a searchable line for quick filtering
    console.log(`[BUTTON_CLICK] ${buttonName} | Location: ${location || 'unknown'} | Subscription: ${subscription || 'N/A'} | Status: ${status || 'N/A'}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, buttonName, location, subscription, status }),
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

