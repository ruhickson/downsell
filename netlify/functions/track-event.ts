// Netlify Function to track custom events
// Each event invocation will appear in Function Metrics
export const handler = async (event: any) => {
  // CORS headers for client-side requests
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const eventData = JSON.parse(event.body || '{}');
    const { eventName, data } = eventData;

    // Log the event (this will appear in Netlify Function logs)
    console.log('Event tracked:', {
      eventName,
      data,
      timestamp: new Date().toISOString(),
      ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown',
      userAgent: event.headers['user-agent'] || 'unknown',
    });

    // You could also store events in a database here if needed
    // For now, we'll just log them (visible in Function Metrics)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, eventName }),
    };
  } catch (error) {
    console.error('Error tracking event:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

