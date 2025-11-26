// Netlify Function to exchange Plaid public token for access token
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

    const requestBody = JSON.parse(event.body || '{}');
    const { public_token } = requestBody;

    if (!public_token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'public_token is required' }),
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

    // Exchange public token for access token
    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const { access_token, item_id } = response.data;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        access_token,
        item_id,
      }),
    };
  } catch (error: any) {
    console.error('Error exchanging Plaid token:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to exchange token',
        details: error.message || 'Unknown error'
      }),
    };
  }
};

