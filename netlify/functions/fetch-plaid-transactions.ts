// Netlify Function to fetch transactions from Plaid
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
    const { access_token, start_date, end_date } = requestBody;

    if (!access_token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'access_token is required' }),
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

    // Default to last 2 years if dates not provided
    const endDate = end_date || new Date().toISOString().split('T')[0];
    const startDate = start_date || (() => {
      const date = new Date();
      date.setFullYear(date.getFullYear() - 2);
      return date.toISOString().split('T')[0];
    })();

    // Fetch transactions (with pagination support)
    let allTransactions: any[] = [];
    let cursor: string | undefined = undefined;
    let hasMore = true;
    
    while (hasMore) {
      const response = await plaidClient.transactionsGet({
        access_token,
        start_date: startDate,
        end_date: endDate,
        ...(cursor && { cursor }),
      });

      const { transactions } = response.data;
      
      allTransactions = allTransactions.concat(transactions);
      cursor = response.data.next_cursor || undefined;
      hasMore = !!cursor;

      // Safety limit: don't fetch more than 10,000 transactions at once
      if (allTransactions.length >= 10000) {
        hasMore = false;
      }
    }

    // Get accounts from the last response
    const accountsResponse = await plaidClient.accountsGet({
      access_token,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        transactions: allTransactions,
        accounts: accountsResponse.data.accounts,
        total_transactions: allTransactions.length,
      }),
    };
  } catch (error: any) {
    console.error('Error fetching Plaid transactions:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch transactions',
        details: error.message || 'Unknown error'
      }),
    };
  }
};

