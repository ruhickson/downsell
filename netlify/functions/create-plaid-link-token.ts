// Netlify Function to create Plaid Link token
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

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
    // Get Plaid credentials from environment variables
    const clientId = process.env.PLAID_CLIENT_ID;
    const secret = process.env.PLAID_SECRET;
    // Default to sandbox environment if not specified
    const defaultEnv = 'sandbox';
    const environment = process.env.PLAID_ENV || defaultEnv;

    if (!clientId || !secret) {
      console.error('Plaid credentials not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Plaid credentials not configured' }),
      };
    }

    // Initialize Plaid client
    const envKey = environment as keyof typeof PlaidEnvironments;
    const plaidEnv = PlaidEnvironments[envKey] || PlaidEnvironments.sandbox;
    const configuration = new Configuration({
      basePath: plaidEnv,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    });

    const plaidClient = new PlaidApi(configuration);

    // Create link token
    const request = {
      user: {
        client_user_id: 'user_' + Date.now(), // In production, use actual user ID
      },
      client_name: 'Downsell',
      products: ['transactions'] as any[],
      country_codes: ['US', 'GB', 'IE'] as any[], // Support US, UK, and Ireland
      language: 'en',
    };

    const response = await plaidClient.linkTokenCreate(request);
    const linkToken = response.data.link_token;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ link_token: linkToken }),
    };
  } catch (error: any) {
    console.error('Error creating Plaid link token:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to create link token',
        details: error.message || 'Unknown error'
      }),
    };
  }
};

