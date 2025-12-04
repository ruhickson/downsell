// Netlify Function to add waitlist signups to Google Sheet
// This function calls a Google Apps Script web app endpoint

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
    const { email } = JSON.parse(event.body || '{}');
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid email address is required' }),
      };
    }

    // Get Google Apps Script web app URL from environment variable
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    
    if (!scriptUrl) {
      console.error('GOOGLE_APPS_SCRIPT_URL environment variable is not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' }),
      };
    }

    // Call Google Apps Script web app
    // The existing script expects URL parameters, not JSON body
    const timestamp = new Date().toISOString();
    const params = new URLSearchParams({
      email: email,
      timestamp: timestamp,
    });
    
    const response = await fetch(`${scriptUrl}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Apps Script error:', errorText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to add signup to sheet' }),
      };
    }

    // Parse response to check for duplicates
    const result = await response.json();
    
    if (result.status === 'duplicate') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: true, 
          message: 'Email already on waitlist',
          duplicate: true 
        }),
      };
    }

    if (result.status === 'error') {
      console.error('Google Apps Script error:', result.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: result.message || 'Failed to add signup to sheet' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        message: result.message || 'Signup added successfully' 
      }),
    };
  } catch (error: any) {
    console.error('Error in signup-waitlist function:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};

