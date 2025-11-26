import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Papa from 'papaparse';
import { Bar, Pie, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js';
import './App.css';
import jsPDF from 'jspdf';
import { usePlaidLink } from 'react-plaid-link';
import { trackPageView, trackButtonClick, trackCSVUpload, trackPDFDownload, trackTabNavigation } from './analytics';
import { categorizeTransactionSync, type Category, getCategoryColor } from './categories';
import { enhanceCategoriesWithLLM } from './categoryEnhancer';
import SankeyDiagram from './SankeyDiagram';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
  Filler
);

// Helper function to get currency symbol
function getCurrencySymbol(currency: string): string {
  switch (currency?.toUpperCase()) {
    case 'GBP':
      return '£';
    case 'USD':
      return '$';
    case 'EUR':
    default:
      return '€';
  }
}

// Raw transaction from CSV (can be from any bank)
type RawTransaction = {
  [key: string]: any;
};

// Normalized transaction format (unified across all banks)
type Transaction = {
  Description: string;
  Amount: number;
  Type: string;
  Date: string;
  Currency: string;
  Balance?: number;
  BankSource: string; // 'AIB', 'Revolut', 'BOI', 'N26', 'BUNQ', 'Nationwide', 'PTSB', or 'Plaid'
  Account: string; // 'AIB-1', 'REV-1', 'REV-2', 'BUN-1', 'NAT-1', 'PTSB-1', 'PLAID-1', etc.
  Category?: string; // Transaction category (e.g., 'Entertainment', 'Food & Dining')
  OriginalData: RawTransaction; // Keep original for reference
};

type Subscription = {
  description: string;
  total: number;
  count: number;
  average: number;
  maxAmount: number;
  standardDeviation: number;
  timeSpan: number | null;
  frequency: number | null;
  avgDaysBetween: number | null;
  subscriptionScore: number;
  firstDate: Date | null;
  lastDate: Date | null;
  frequencyLabel: string;
};

function calculateVariance(numbers: number[], mean: number) {
  return numbers.reduce((acc, num) => acc + Math.pow(num - mean, 2), 0) / numbers.length;
}

function calculateSubscriptionScore({ count, standardDeviation, frequency, timeSpan, avgDaysBetween, description }: any) {
  let score = 0;
  if (count >= 2) score += 0.3;
  else if (count >= 1) score += 0.2;
  if (standardDeviation < 5) score += 0.3;
  else if (standardDeviation < 10) score += 0.2;
  else if (standardDeviation < 20) score += 0.1;
  if (frequency) {
    if (Math.abs(frequency - 1) < 0.2) score += 0.3;
    else if (Math.abs(frequency - 2) < 0.2) score += 0.3;
    else if (Math.abs(frequency - 4) < 0.2) score += 0.3;
    else if (frequency > 0.5) score += 0.2;
  }
  const subscriptionKeywords = [
    'subscription', 'monthly', 'recurring', 'membership', 'premium', 'pro', 'plus',
    'service', 'plan', 'billing', 'payment', 'charge', 'fee', 'rent', 'lease',
  ];
  const descriptionLower = description.toLowerCase();
  if (subscriptionKeywords.some((keyword) => descriptionLower.includes(keyword))) {
    score += 0.2;
  }
  if (avgDaysBetween) {
    if (avgDaysBetween >= 25 && avgDaysBetween <= 35) score += 0.2;
    else if (avgDaysBetween >= 12 && avgDaysBetween <= 16) score += 0.15;
    else if (avgDaysBetween >= 5 && avgDaysBetween <= 9) score += 0.1;
    else if (avgDaysBetween > 0) score += 0.05;
  }
  if (timeSpan && timeSpan > 30) score += 0.1;
  return score;
}

function getFrequencyLabel(count: number, firstDate: Date | null, lastDate: Date | null): string {
  if (!firstDate || !lastDate || count < 1) return 'N/A';
  if (count === 1) return 'Once-off/yearly';
  const daysBetween = Math.max(1, Math.ceil((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const freqPerYear = count / (daysBetween / 365);
  if (freqPerYear < 1) return 'Once-off/yearly';
  if (freqPerYear < 4) return 'Quarterly';
  if (freqPerYear < 16) return 'Monthly';
  if (freqPerYear < 52) {
    if (count < 10) return 'Irregular';
    return 'Weekly';
  }
  if (freqPerYear < 156) return 'Three or more times a week';
  // Only return 'Daily' if count >= 60, otherwise treat as once-off/yearly
  if (count >= 60) return 'Daily';
  return 'Once-off/yearly';
}

// Normalize a raw transaction from any bank to unified format
function normalizeTransaction(rawTx: RawTransaction, account: string): Transaction | null {
  const keys = Object.keys(rawTx);
  
  // Detect bank format (check in order: Revolut, AIB, BOI, N26, BUNQ)
  const isRevolut = keys.some(k => 
    k.includes('Type') && 
    (k.includes('Started Date') || k.includes('Completed Date'))
  );
  const isAIB = !isRevolut && keys.some(k => 
    k.includes('Posted Account') || 
    k.includes('Posted Transactions Date') || 
    k.includes('Description1')
  );
  const isBOI = !isRevolut && !isAIB && keys.some(k => 
    k.trim() === 'Date' && 
    keys.some(k2 => k2.trim() === 'Details') &&
    keys.some(k3 => k3.trim() === 'Debit') &&
    keys.some(k4 => k4.trim() === 'Credit')
  );
  const isN26 = !isRevolut && !isAIB && !isBOI && (
    keys.some(k => k.trim() === 'Booking Date' || k.includes('Booking Date')) &&
    keys.some(k => k.trim() === 'Value Date' || k.includes('Value Date')) &&
    keys.some(k => k.trim() === 'Partner Name' || k.includes('Partner Name')) &&
    keys.some(k => k.trim() === 'Amount (EUR)' || k.includes('Amount (EUR)'))
  );
  const isBUNQ = !isRevolut && !isAIB && !isBOI && !isN26 && (
    keys.some(k => k.trim() === 'Date' || k.includes('Date')) &&
    keys.some(k => k.trim() === 'Interest Date' || k.includes('Interest Date')) &&
    keys.some(k => k.trim() === 'Amount' || k.includes('Amount')) &&
    keys.some(k => k.trim() === 'Account' || k.includes('Account')) &&
    keys.some(k => k.trim() === 'Name' || k.includes('Name')) &&
    keys.some(k => k.trim() === 'Description' || k.includes('Description'))
  );
  const isNationwide = !isRevolut && !isAIB && !isBOI && !isN26 && !isBUNQ && (
    keys.some(k => k.trim() === 'Date' || k.includes('Date')) &&
    keys.some(k => (k.trim() === 'Transaction type' || k.includes('Transaction type') || k.trim() === 'Type' || k.includes('Type'))) &&
    keys.some(k => k.trim() === 'Description' || k.includes('Description')) &&
    keys.some(k => k.trim() === 'Paid out' || k.includes('Paid out')) &&
    keys.some(k => k.trim() === 'Paid in' || k.includes('Paid in')) &&
    keys.some(k => k.trim() === 'Balance' || k.includes('Balance'))
  );
  const isPTSB = !isRevolut && !isAIB && !isBOI && !isN26 && !isBUNQ && !isNationwide && (
    keys.some(k => k.trim() === 'Date' || k.includes('Date')) &&
    keys.some(k => k.trim() === 'Payee' || k.includes('Payee')) &&
    keys.some(k => k.trim() === 'Outflow' || k.includes('Outflow')) &&
    keys.some(k => k.trim() === 'Inflow' || k.includes('Inflow')) &&
    keys.some(k => (k.trim() === 'Running Balance' || k.includes('Running Balance') || k.includes('Balance')))
  );
  
  // Extract description
  let description = '';
  if (isAIB) {
    // AIB: use only Description1, remove prefixes like VDP-, VDC-, D/D, etc.
    const desc1Key = keys.find(k => k.trim() === 'Description1' || k.includes('Description1'));
    let rawDescription = desc1Key ? String(rawTx[desc1Key] || '').trim() : '';
    // Remove prefixes like VDP-, VDC-, D/D, etc. (everything up to and including the first hyphen)
    if (rawDescription.includes('-')) {
      const parts = rawDescription.split('-');
      if (parts.length > 1) {
        description = parts.slice(1).join('-').trim();
      } else {
        description = rawDescription;
      }
    } else {
      description = rawDescription;
    }
  } else if (isBOI) {
    // BOI: use Details field directly
    const detailsKey = keys.find(k => k.trim() === 'Details' || k.includes('Details'));
    description = detailsKey ? String(rawTx[detailsKey] || '').trim() : '';
  } else if (isN26) {
    // N26: use Partner Name field directly
    const partnerNameKey = keys.find(k => k.trim() === 'Partner Name' || k.includes('Partner Name'));
    description = partnerNameKey ? String(rawTx[partnerNameKey] || '').trim() : '';
  } else if (isBUNQ) {
    // BUNQ: use Name field directly
    const nameKey = keys.find(k => k.trim() === 'Name' || k.includes('Name'));
    description = nameKey ? String(rawTx[nameKey] || '').trim() : '';
  } else if (isNationwide) {
    // Nationwide: use Description field directly
    const descKey = keys.find(k => k.trim() === 'Description' || k.includes('Description'));
    description = descKey ? String(rawTx[descKey] || '').trim() : '';
  } else if (isPTSB) {
    // PTSB: use Payee field directly
    const payeeKey = keys.find(k => k.trim() === 'Payee' || k.includes('Payee'));
    description = payeeKey ? String(rawTx[payeeKey] || '').trim() : '';
  } else {
    // Revolut: single Description field
    description = rawTx.Description || rawTx.description || '';
  }
  
  if (!description.trim()) return null; // Skip transactions without description
  
  // Extract amount
  let amount = 0;
  if (isAIB) {
    // AIB: use Debit Amount (negative) or Credit Amount (positive)
    const debitKey = keys.find(k => k.trim() === 'Debit Amount' || k.includes('Debit Amount'));
    const creditKey = keys.find(k => k.trim() === 'Credit Amount' || k.includes('Credit Amount'));
    
    const debitAmount = debitKey ? rawTx[debitKey] : '';
    const creditAmount = creditKey ? rawTx[creditKey] : '';
    
    if (debitAmount && String(debitAmount).trim()) {
      amount = -parseFloat(String(debitAmount).replace(/,/g, ''));
    } else if (creditAmount && String(creditAmount).trim()) {
      amount = parseFloat(String(creditAmount).replace(/,/g, ''));
    }
  } else if (isBOI) {
    // BOI: use Debit (negative) or Credit (positive)
    const debitKey = keys.find(k => k.trim() === 'Debit' || k.includes('Debit'));
    const creditKey = keys.find(k => k.trim() === 'Credit' || k.includes('Credit'));
    
    const debitAmount = debitKey ? rawTx[debitKey] : '';
    const creditAmount = creditKey ? rawTx[creditKey] : '';
    
    if (debitAmount && String(debitAmount).trim()) {
      amount = -parseFloat(String(debitAmount).replace(/,/g, ''));
    } else if (creditAmount && String(creditAmount).trim()) {
      amount = parseFloat(String(creditAmount).replace(/,/g, ''));
    }
  } else if (isN26) {
    // N26: use Amount (EUR) field (already signed)
    const amountKey = keys.find(k => k.trim() === 'Amount (EUR)' || k.includes('Amount (EUR)'));
    if (amountKey) {
      amount = parseFloat(String(rawTx[amountKey] || '0').replace(/,/g, ''));
    }
  } else if (isBUNQ) {
    // BUNQ: use Amount field (already signed, negative for debits, positive for credits)
    const amountKey = keys.find(k => k.trim() === 'Amount' || k.includes('Amount'));
    if (amountKey) {
      amount = parseFloat(String(rawTx[amountKey] || '0').replace(/,/g, ''));
    }
  } else if (isNationwide) {
    // Nationwide: use Paid out (negative) or Paid in (positive), remove £ symbol
    const paidOutKey = keys.find(k => k.trim() === 'Paid out' || k.includes('Paid out'));
    const paidInKey = keys.find(k => k.trim() === 'Paid in' || k.includes('Paid in'));
    
    const paidOut = paidOutKey ? rawTx[paidOutKey] : '';
    const paidIn = paidInKey ? rawTx[paidInKey] : '';
    
    if (paidOut && String(paidOut).trim()) {
      // Remove £ symbol and commas, then parse
      amount = -parseFloat(String(paidOut).replace(/[£,]/g, ''));
    } else if (paidIn && String(paidIn).trim()) {
      // Remove £ symbol and commas, then parse
      amount = parseFloat(String(paidIn).replace(/[£,]/g, ''));
    }
  } else if (isPTSB) {
    // PTSB: use Outflow (negative) or Inflow (positive)
    const outflowKey = keys.find(k => k.trim() === 'Outflow' || k.includes('Outflow'));
    const inflowKey = keys.find(k => k.trim() === 'Inflow' || k.includes('Inflow'));
    
    const outflow = outflowKey ? rawTx[outflowKey] : '';
    const inflow = inflowKey ? rawTx[inflowKey] : '';
    
    if (outflow && String(outflow).trim()) {
      // Remove commas, then parse as negative
      amount = -parseFloat(String(outflow).replace(/,/g, ''));
    } else if (inflow && String(inflow).trim()) {
      // Remove commas, then parse as positive
      amount = parseFloat(String(inflow).replace(/,/g, ''));
    }
  } else {
    // Revolut: single Amount field (already signed)
    amount = parseFloat(rawTx.Amount || rawTx.amount || '0');
  }
  
  // Extract transaction type
  let type = '';
  if (isAIB) {
    const typeKey = keys.find(k => k.trim() === 'Transaction Type' || k.includes('Transaction Type'));
    type = typeKey ? String(rawTx[typeKey] || '').toUpperCase() : '';
  } else if (isBOI) {
    // BOI doesn't have explicit transaction type - infer from Debit/Credit
    if (amount < 0) {
      type = 'DEBIT';
    } else if (amount > 0) {
      type = 'CREDIT';
    } else {
      type = 'UNKNOWN';
    }
  } else if (isN26) {
    // N26: use Type field (Presentment, Debit Transfer, Credit Transfer, Direct Debit, Fee, etc.)
    const typeKey = keys.find(k => k.trim() === 'Type' || k.includes('Type'));
    type = typeKey ? String(rawTx[typeKey] || '').toUpperCase() : '';
  } else if (isBUNQ) {
    // BUNQ doesn't have explicit transaction type - infer from Amount sign
    if (amount < 0) {
      type = 'DEBIT';
    } else if (amount > 0) {
      type = 'CREDIT';
    } else {
      type = 'UNKNOWN';
    }
  } else if (isPTSB) {
    // PTSB doesn't have explicit transaction type - infer from Outflow/Inflow
    if (amount < 0) {
      type = 'DEBIT';
    } else if (amount > 0) {
      type = 'CREDIT';
    } else {
      type = 'UNKNOWN';
    }
  } else {
    type = (rawTx.Type || rawTx.type || '').toUpperCase();
  }
  
  // Extract date
  let dateStr = '';
  if (isAIB) {
    // AIB: use Posted Transactions Date (DD/MM/YYYY format)
    const dateKey = keys.find(k => k.trim() === 'Posted Transactions Date' || k.includes('Posted Transactions Date'));
    if (dateKey) {
      dateStr = String(rawTx[dateKey] || '').trim();
      // Convert DD/MM/YYYY to ISO format for consistency
      if (dateStr) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1].padStart(2, '0');
          const year = parts[2];
          dateStr = `${year}-${month}-${day}`;
        }
      }
    }
  } else if (isBOI) {
    // BOI: use Date field (DD/MM/YYYY format)
    const dateKey = keys.find(k => k.trim() === 'Date' || k.includes('Date'));
    if (dateKey) {
      dateStr = String(rawTx[dateKey] || '').trim();
      // Convert DD/MM/YYYY to ISO format for consistency
      if (dateStr) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1].padStart(2, '0');
          const year = parts[2];
          dateStr = `${year}-${month}-${day}`;
        }
      }
    }
  } else if (isN26) {
    // N26: use Booking Date (YYYY-MM-DD format, already ISO)
    const dateKey = keys.find(k => k.trim() === 'Booking Date' || k.includes('Booking Date'));
    if (dateKey) {
      dateStr = String(rawTx[dateKey] || '').trim();
      // N26 dates are already in YYYY-MM-DD format
    }
  } else if (isBUNQ) {
    // BUNQ: use Date field (YYYY-MM-DD format, already ISO)
    const dateKey = keys.find(k => k.trim() === 'Date' || k.includes('Date'));
    if (dateKey) {
      dateStr = String(rawTx[dateKey] || '').trim();
      // BUNQ dates are already in YYYY-MM-DD format
    }
  } else if (isNationwide) {
    // Nationwide: use Date field (DD-MMM-YY format, e.g., "29-Dec-14")
    const dateKey = keys.find(k => k.trim() === 'Date' || k.includes('Date'));
    if (dateKey) {
      const dateValue = String(rawTx[dateKey] || '').trim();
      if (dateValue) {
        // Parse DD-MMM-YY format (e.g., "29-Dec-14")
        const parts = dateValue.split('-');
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const monthNames: Record<string, string> = {
            'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
            'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
            'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
          };
          const month = monthNames[parts[1]] || '01';
          // Handle 2-digit year: assume 20xx for years < 50, 19xx otherwise
          let year = parts[2];
          if (year.length === 2) {
            const yearNum = parseInt(year, 10);
            year = yearNum < 50 ? `20${year}` : `19${year}`;
          }
          dateStr = `${year}-${month}-${day}`;
        }
      }
    }
  } else {
    // Revolut: use Completed Date or Started Date (YYYY-MM-DD HH:MM:SS format)
    dateStr = (rawTx['Completed Date'] || rawTx['Started Date'] || rawTx.Date || rawTx.date || '').toString();
    // Extract just the date part if it includes time
    if (dateStr.includes(' ')) {
      dateStr = dateStr.split(' ')[0];
    }
  }
  
  // Extract currency
  let currency = '';
  if (isAIB) {
    const currencyKey = keys.find(k => k.trim() === 'Posted Currency' || k.includes('Posted Currency'));
    currency = currencyKey ? String(rawTx[currencyKey] || '').trim() : 'EUR';
  } else if (isBOI) {
    // BOI doesn't have explicit currency field - default to EUR
    currency = 'EUR';
  } else if (isN26) {
    // N26 exports show amounts in EUR in 'Amount (EUR)' field - default to EUR
    currency = 'EUR';
  } else if (isBUNQ) {
    // BUNQ doesn't have explicit currency field - default to EUR
    currency = 'EUR';
  } else if (isNationwide) {
    // Nationwide is a UK bank - default to GBP
    currency = 'GBP';
  } else if (isPTSB) {
    // PTSB is an Irish bank - default to EUR
    currency = 'EUR';
  } else {
    currency = (rawTx.Currency || rawTx.currency || 'EUR').toString().trim();
  }
  
  // Extract balance (optional)
  let balance: number | undefined;
  const balanceKey = keys.find(k => k.trim() === 'Balance' || k.includes('Balance'));
  if (balanceKey && rawTx[balanceKey]) {
    balance = parseFloat(String(rawTx[balanceKey]).replace(/,/g, ''));
  }
  
  // Initial categorization: check cache first, then rule-based matching
  // Cache will be checked later in enhanceCategoriesWithLLM, but we can do a quick sync check here
  // For now, use rule-based matching as initial categorization
  const category = categorizeTransactionSync(description);
  
  return {
    Description: description,
    Amount: amount,
    Type: type,
    Date: dateStr,
    Currency: currency || 'EUR',
    Balance: balance,
    BankSource: isAIB ? 'AIB' : (isBOI ? 'BOI' : (isN26 ? 'N26' : (isBUNQ ? 'BUNQ' : (isNationwide ? 'Nationwide' : (isPTSB ? 'PTSB' : 'Revolut'))))),
    Account: account,
    Category: category,
    OriginalData: rawTx
  };
}

// Normalize Plaid transaction to unified Transaction format
function normalizePlaidTransaction(plaidTx: any, account: string, accountCurrency: string = 'USD'): Transaction | null {
  if (!plaidTx.name && !plaidTx.merchant_name) {
    return null; // Skip transactions without description
  }

  const description = plaidTx.merchant_name || plaidTx.name || '';
  const amount = plaidTx.amount || 0; // Plaid amounts are positive for debits (outgoing), negative for credits (incoming)
  const date = plaidTx.date || plaidTx.authorized_date || '';
  const currency = plaidTx.iso_currency_code || plaidTx.unofficial_currency_code || accountCurrency;
  
  // Plaid transaction types
  let type = 'TRANSACTION';
  if (plaidTx.pending) {
    type = 'PENDING';
  } else if (amount > 0) {
    type = 'DEBIT';
  } else {
    type = 'CREDIT';
  }

  // Categorize transaction
  const category = categorizeTransactionSync(description);

  return {
    Description: description,
    Amount: -amount, // Invert to match our convention (negative = outgoing, positive = incoming)
    Type: type,
    Date: date,
    Currency: currency,
    Balance: undefined,
    BankSource: 'Plaid',
    Account: account,
    Category: category,
    OriginalData: plaidTx
  };
}

function analyzeBankStatement(data: Transaction[]): Subscription[] {
  const transactionsByDescription: Record<string, any> = {};
  data.forEach((transaction) => {
    const description = transaction.Description;
    const amount = transaction.Amount;
    const type = transaction.Type;
    
    if (amount > 0) return; // Skip credits
    if (type === 'EXCHANGE' || type === 'TRANSFER') return;
    if (!transactionsByDescription[description]) {
      transactionsByDescription[description] = {
        total: 0,
        count: 0,
        amounts: [],
        lastDate: null,
        firstDate: null,
        dates: [],
        maxAmount: -Infinity,
      };
    }
    transactionsByDescription[description].total += amount;
    transactionsByDescription[description].count += 1;
    transactionsByDescription[description].amounts.push(amount);
    if (Math.abs(amount) > Math.abs(transactionsByDescription[description].maxAmount)) {
      transactionsByDescription[description].maxAmount = amount;
    }
    
    // Extract date (already normalized to ISO format)
    const date = transaction.Date;
    if (date) {
      // Parse date (already normalized to ISO format YYYY-MM-DD)
      let transactionDate: Date;
      try {
        transactionDate = new Date(date);
        
        // Only add if date is valid
        if (!isNaN(transactionDate.getTime())) {
      transactionsByDescription[description].dates.push(transactionDate);
      if (!transactionsByDescription[description].firstDate || transactionDate < transactionsByDescription[description].firstDate) {
        transactionsByDescription[description].firstDate = transactionDate;
      }
      if (!transactionsByDescription[description].lastDate || transactionDate > transactionsByDescription[description].lastDate) {
        transactionsByDescription[description].lastDate = transactionDate;
          }
        }
      } catch (e) {
        // If parsing fails, skip this transaction's date
      }
    }
  });

  // Ensure firstDate and lastDate are set correctly for each group
  Object.values(transactionsByDescription).forEach((group: any) => {
    if (group.dates.length > 0) {
      group.dates.sort((a: Date, b: Date) => a.getTime() - b.getTime());
      group.firstDate = group.dates[0];
      group.lastDate = group.dates[group.dates.length - 1];
    } else {
      group.firstDate = null;
      group.lastDate = null;
    }
  });

  return Object.entries(transactionsByDescription)
    .map(([description, data]) => {
      const average = data.total / data.count;
      const variance = calculateVariance(data.amounts, average);
      const standardDeviation = Math.sqrt(variance);
      let timeSpan = null;
      if (data.firstDate && data.lastDate) {
        timeSpan = Math.ceil((data.lastDate - data.firstDate) / (1000 * 60 * 60 * 24));
      }
      const frequency = timeSpan ? data.count / (timeSpan / 30) : null;
      let avgDaysBetween = null;
      if (data.dates.length > 1) {
        const sortedDates = data.dates.sort((a: Date, b: Date) => a.getTime() - b.getTime());
        const daysBetween = [];
        for (let i = 1; i < sortedDates.length; i++) {
          daysBetween.push(Math.ceil((sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / (1000 * 60 * 60 * 24)));
        }
        avgDaysBetween = daysBetween.reduce((a, b) => a + b, 0) / daysBetween.length;
      }
      if (data.dates.length > 0) {
        console.log('Description:', description);
        console.log('Dates:', data.dates);
        console.log('First date:', data.firstDate);
        console.log('Last date:', data.lastDate);
      }
      return {
        description,
        total: data.total,
        count: data.count,
        average,
        maxAmount: data.amounts.length > 0 ? -1 * Math.max(...data.amounts.map(Math.abs)) : 0,
        standardDeviation,
        timeSpan,
        frequency,
        avgDaysBetween,
        firstDate: data.firstDate instanceof Date ? data.firstDate : null,
        lastDate: data.lastDate instanceof Date ? data.lastDate : null,
        frequencyLabel: getFrequencyLabel(
          data.count,
          data.firstDate instanceof Date ? data.firstDate : null,
          data.lastDate instanceof Date ? data.lastDate : null
        ),
        subscriptionScore: calculateSubscriptionScore({
          count: data.count,
          standardDeviation,
          frequency,
          timeSpan,
          avgDaysBetween,
          description,
        }),
      };
    })
    .sort((a, b) => a.total - b.total);
}

const TAB_LABELS = [
  { label: 'Analysis', icon: '📊' },
  { label: 'Report', icon: '📄' },
  { label: 'Actions', icon: '⚡' },
  { label: 'Transactions', icon: '💳' },
  { label: 'Account (soon)', icon: '👤' },
  { label: 'About', icon: 'ℹ️' },
  { label: 'Privacy Policy', icon: '🔒' },
];

// Local storage key for statistics
const STATS_STORAGE_KEY = 'downsell_stats';

// Fetch stats from localStorage
function fetchStats(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STATS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.warn('Failed to fetch statistics from localStorage:', error);
  return {};
  }
}

// Increment stat in localStorage
// Check if user has consented to cookies
function hasConsentedToCookies(): boolean {
  if (typeof window === 'undefined') return false;
  const consent = localStorage.getItem('cookie-consent');
  return consent === 'accepted';
}

function incrementStat(key: string, amount = 1) {
  // Only track if user has consented to cookies
  if (!hasConsentedToCookies()) {
    return;
  }
  try {
    const stats = fetchStats();
    stats[key] = (stats[key] || 0) + amount;
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch (error) {
    console.warn('Failed to increment statistic:', error);
  }
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('Analysis');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [csvData, setCsvData] = useState<Transaction[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ file: File; bankType: string; rowCount: number; account: string }>>([]);
  const [_accountCounters, setAccountCounters] = useState<{ AIB: number; Revolut: number; BOI: number; N26: number; BUNQ: number; Nationwide: number; PTSB: number; Plaid: number }>({ AIB: 0, Revolut: 0, BOI: 0, N26: 0, BUNQ: 0, Nationwide: 0, PTSB: 0, Plaid: 0 });
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isEnhancingRef = React.useRef<boolean>(false);
  const lastDataLengthRef = React.useRef<number>(0);
  const [isClassifying, setIsClassifying] = React.useState<boolean>(false);
  const [showWaitlistModal, setShowWaitlistModal] = React.useState<boolean>(false);
  const [hasShownWaitlistModal, setHasShownWaitlistModal] = React.useState<boolean>(false);
  const [showCookieBanner, setShowCookieBanner] = React.useState<boolean>(false);
  const [waitlistEmail, setWaitlistEmail] = React.useState<string>('');
  const [showThankYou, setShowThankYou] = React.useState<boolean>(false);
  const [linkToken, setLinkToken] = React.useState<string | null>(null);
  const [isPlaidLoading, setIsPlaidLoading] = React.useState<boolean>(false);
  const [connectedBanks, setConnectedBanks] = React.useState<Array<{ institutionId: string; name: string; connectedAt: string }>>([]);

  // Check cookie consent on mount
  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent');
    if (!consent) {
      setShowCookieBanner(true);
    }
  }, []);

  // Load connected banks from localStorage on mount
  useEffect(() => {
    const savedBanks = localStorage.getItem('connected-banks');
    if (savedBanks) {
      try {
        setConnectedBanks(JSON.parse(savedBanks));
      } catch (e) {
        console.error('Error loading connected banks:', e);
      }
    }
  }, []);

  const handleAcceptCookies = () => {
    localStorage.setItem('cookie-consent', 'accepted');
    localStorage.setItem('cookie-consent-date', new Date().toISOString());
    setShowCookieBanner(false);
  };

  const handleRejectCookies = () => {
    localStorage.setItem('cookie-consent', 'rejected');
    localStorage.setItem('cookie-consent-date', new Date().toISOString());
    setShowCookieBanner(false);
    // Note: Netlify Analytics script is injected server-side by Netlify
    // We cannot disable it client-side, but our custom tracking functions
    // will respect the consent and not send data
    // Netlify Analytics may still collect basic page views, but we've done our best
    // to disable custom tracking when consent is rejected
  };

  // Fetch Plaid link token
  const fetchLinkToken = async () => {
    setIsPlaidLoading(true);
    try {
      const response = await fetch('/.netlify/functions/create-plaid-link-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to create link token');
      }

      const data = await response.json();
      setLinkToken(data.link_token);
    } catch (error) {
      console.error('Error fetching link token:', error);
      alert('Failed to connect to Plaid. Please try again.');
    } finally {
      setIsPlaidLoading(false);
    }
  };

  // Handle Plaid success
  const onPlaidSuccess = useCallback(async (publicToken: string, metadata: any) => {
    trackButtonClick('Plaid Success', { institution: metadata.institution?.name });
    console.log('Plaid Link success:', { publicToken, metadata });
    
    setIsPlaidLoading(true);
    
    try {
      // Exchange public token for access token
      const exchangeResponse = await fetch('/.netlify/functions/exchange-plaid-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ public_token: publicToken }),
      });

      if (!exchangeResponse.ok) {
        throw new Error('Failed to exchange token');
      }

      const { access_token, item_id } = await exchangeResponse.json();
      
      // Add connected bank to state
      const institutionName = metadata.institution?.name || 'Unknown Bank';
      const institutionId = metadata.institution?.institution_id || `bank_${Date.now()}`;
      
      const newBank = {
        institutionId,
        name: institutionName,
        connectedAt: new Date().toISOString(),
        accessToken: access_token,
        itemId: item_id,
      };
      
      const updatedBanks = [...connectedBanks, newBank];
      setConnectedBanks(updatedBanks);
      localStorage.setItem('connected-banks', JSON.stringify(updatedBanks));

      // Fetch transactions from Plaid
      const transactionsResponse = await fetch('/.netlify/functions/fetch-plaid-transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          access_token: access_token,
          // Fetch last 2 years of transactions
          start_date: (() => {
            const date = new Date();
            date.setFullYear(date.getFullYear() - 2);
            return date.toISOString().split('T')[0];
          })(),
          end_date: new Date().toISOString().split('T')[0],
        }),
      });

      if (!transactionsResponse.ok) {
        throw new Error('Failed to fetch transactions');
      }

      const { transactions: plaidTransactions, accounts } = await transactionsResponse.json();
      
      // Get account counter for Plaid
      setAccountCounters(prevCounters => {
        const newCounters = { ...prevCounters };
        newCounters.Plaid = (newCounters.Plaid || 0) + 1;
        const account = `PLAID-${newCounters.Plaid}`;

        // Normalize Plaid transactions
        const normalizedTransactions = plaidTransactions
          .map((plaidTx: any) => {
            // Get currency from account
            const accountInfo = accounts.find((acc: any) => acc.account_id === plaidTx.account_id);
            const currency = accountInfo?.iso_currency_code || accountInfo?.unofficial_currency_code || 'USD';
            return normalizePlaidTransaction(plaidTx, account, currency);
          })
          .filter((tx): tx is Transaction => tx !== null);

        // Merge with existing data
        setCsvData(prevData => {
          const mergedData = [...prevData, ...normalizedTransactions];
          
          // Sort by date (newest first)
          mergedData.sort((a, b) => {
            const dateA = new Date(a.Date).getTime();
            const dateB = new Date(b.Date).getTime();
            return dateB - dateA;
          });
          
          // Re-analyze subscriptions with merged data
          setSubscriptions(analyzeBankStatement(mergedData));
          
          return mergedData;
        });

        // Update uploaded files list (track Plaid connections)
        setUploadedFiles(prevFiles => {
          const fileInfo = {
            file: new File([], `${institutionName}_Plaid`, { type: 'application/json' }),
            bankType: 'Plaid',
            rowCount: plaidTransactions.length,
            account: account,
          };
          return [...prevFiles, fileInfo];
        });

        return newCounters;
      });

      alert(`Successfully connected to ${institutionName} and loaded ${plaidTransactions.length} transactions!`);
    } catch (error: any) {
      console.error('Error processing Plaid connection:', error);
      alert(`Connected to bank, but failed to fetch transactions: ${error.message}`);
    } finally {
      setIsPlaidLoading(false);
    }
  }, [connectedBanks]);

  // Plaid Link hook
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: (err, _metadata) => {
      if (err) {
        console.error('Plaid Link error:', err);
      }
      setLinkToken(null);
    },
  });

  // Open Plaid Link when token is ready
  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  // Handle Connect to Bank button click
  const handleConnectBank = () => {
    trackButtonClick('Connect to Bank', { location: 'analysis_page' });
    fetchLinkToken();
  };
  const [frequencyFilter, setFrequencyFilter] = useState<string>('All');
  const [transactionFilter, setTransactionFilter] = useState<string>('All');
  const [transactionSearch, setTransactionSearch] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [amountFilterType, setAmountFilterType] = useState<string>('none');
  const [amountFilterValue, setAmountFilterValue] = useState<string>('');
  const [aboutCollapsed, setAboutCollapsed] = useState<boolean>(false);
  const [privacyCollapsed, setPrivacyCollapsed] = useState<boolean>(false);
  const [autopilotCollapsed, setAutopilotCollapsed] = useState<boolean>(false);
  const frequencyOptions = [
    'All',
    'Once-off/yearly',
    'Irregular',
    'Quarterly',
    'Monthly',
    'Weekly',
    'Three or more times a week',
    'Daily',
  ];


  const handleSidebarTabClick = (tab: string) => {
    setActiveTab(tab);
    setSidebarOpen(false);
    trackTabNavigation(tab);
  };

  // Track page views when tab changes
  useEffect(() => {
    trackPageView(activeTab);
  }, [activeTab]);

  // Helper function to enhance "Other" categories with LLM
  const enhanceOtherCategories = async (dataToEnhance?: Transaction[]) => {
    // Prevent multiple simultaneous enhancements
    if (isEnhancingRef.current) {
      console.log('⏸️ Enhancement already in progress, skipping...');
      return;
    }
    
    isEnhancingRef.current = true;
    setIsClassifying(true);
    console.log('🔄 Starting category enhancement with Gemini (via server)...');
    
    // Use provided data or current state
    const currentData = dataToEnhance || csvData;
    const otherCount = currentData.filter(tx => !tx.Category || tx.Category === 'Other').length;
    console.log(`📊 Found ${otherCount} transactions in "Other" category to enhance`);
    
    if (otherCount === 0) {
      console.log('✅ No transactions to enhance');
      isEnhancingRef.current = false;
      setIsClassifying(false);
      return currentData;
    }
    
    try {
      // Enhance categories (pass API key for development fallback)
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      const enhanced = await enhanceCategoriesWithLLM(currentData, apiKey);
      const enhancedCount = enhanced.filter(tx => tx.Category && tx.Category !== 'Other').length - 
                           currentData.filter(tx => tx.Category && tx.Category !== 'Other').length;
      console.log(`✅ Enhanced ${enhancedCount} transactions with LLM`);
      
      // Update state with enhanced data
      setCsvData(enhanced);
      
      // Recalculate subscriptions with new categories
      const updatedSubscriptions = analyzeBankStatement(enhanced);
      setSubscriptions(updatedSubscriptions);
      
      console.log(`✅ State updated: ${enhanced.length} transactions, ${updatedSubscriptions.length} subscriptions`);
      isEnhancingRef.current = false;
      setIsClassifying(false);
      return enhanced;
    } catch (err) {
      console.error('❌ Failed to enhance categories:', err);
      isEnhancingRef.current = false;
      setIsClassifying(false);
      return currentData;
    }
  };

  // Auto-enhance when new data is added (but not on initial load or after enhancement)
  React.useEffect(() => {
    // Only enhance if data length increased (new upload) and we're not already enhancing
    if (csvData.length > lastDataLengthRef.current && csvData.length > 0 && !isEnhancingRef.current) {
      const previousLength = lastDataLengthRef.current;
      lastDataLengthRef.current = csvData.length;
      
      // Wait a bit for state to stabilize, then enhance with current data
      const timer = setTimeout(() => {
        if (!isEnhancingRef.current && csvData.length > previousLength) {
          enhanceOtherCategories(csvData);
        }
      }, 1000);
      return () => clearTimeout(timer);
    } else if (csvData.length > 0) {
      lastDataLengthRef.current = csvData.length;
    }
  }, [csvData.length]);

  // Process a single CSV file and merge with existing data
  const processCSVFile = (file: File, mergeWithExisting: boolean = true, onComplete?: () => void): Promise<void> => {
    return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
        complete: (results: Papa.ParseResult<RawTransaction>) => {
        const rawData = results.data as RawTransaction[];
        const rowCount = rawData.length;
        
        // Detect bank type from first row (check in order: Revolut, AIB, BOI, N26)
        const firstRow = rawData[0];
        const keys = firstRow ? Object.keys(firstRow) : [];
        
        // Check for Revolut
        const isRevolut = keys.some(k => 
          k.includes('Type') && 
          (k.includes('Started Date') || k.includes('Completed Date'))
        );
        
        // Check for AIB
        const isAIB = !isRevolut && keys.some(k => 
          k.includes('Posted Account') || 
          k.includes('Posted Transactions Date') || 
          k.includes('Description1')
        );
        
        // Check for BOI (must have all: Date, Details, Debit, Credit)
        const isBOI = !isRevolut && !isAIB && 
          keys.some(k => k.trim() === 'Date') &&
          keys.some(k => k.trim() === 'Details') &&
          keys.some(k => k.trim() === 'Debit') &&
          keys.some(k => k.trim() === 'Credit');
        
        // Check for N26 (must have: Booking Date, Value Date, Partner Name, Amount (EUR))
        const isN26 = !isRevolut && !isAIB && !isBOI && (
          (keys.some(k => k.trim() === 'Booking Date' || k.includes('Booking Date')) &&
           keys.some(k => k.trim() === 'Value Date' || k.includes('Value Date')) &&
           keys.some(k => k.trim() === 'Partner Name' || k.includes('Partner Name')) &&
           keys.some(k => k.trim() === 'Amount (EUR)' || k.includes('Amount (EUR)')))
        );
        
        // Check for BUNQ (must have: Date, Interest Date, Amount, Account, Name, Description)
        const isBUNQ = !isRevolut && !isAIB && !isBOI && !isN26 && (
          keys.some(k => k.trim() === 'Date' || k.includes('Date')) &&
          keys.some(k => k.trim() === 'Interest Date' || k.includes('Interest Date')) &&
          keys.some(k => k.trim() === 'Amount' || k.includes('Amount')) &&
          keys.some(k => k.trim() === 'Account' || k.includes('Account')) &&
          keys.some(k => k.trim() === 'Name' || k.includes('Name')) &&
          keys.some(k => k.trim() === 'Description' || k.includes('Description'))
        );
        
        // Check for Nationwide (must have: Date, Type, Description, Paid out, Paid in, Balance)
        const isNationwide = !isRevolut && !isAIB && !isBOI && !isN26 && !isBUNQ && (
          keys.some(k => k.trim() === 'Date' || k.includes('Date')) &&
          keys.some(k => (k.trim() === 'Transaction type' || k.includes('Transaction type') || k.trim() === 'Type' || k.includes('Type'))) &&
          keys.some(k => k.trim() === 'Description' || k.includes('Description')) &&
          keys.some(k => k.trim() === 'Paid out' || k.includes('Paid out')) &&
          keys.some(k => k.trim() === 'Paid in' || k.includes('Paid in')) &&
          keys.some(k => k.trim() === 'Balance' || k.includes('Balance'))
        );
        
        // Check for PTSB (must have: Date, Payee, Outflow, Inflow, Running Balance)
        const isPTSB = !isRevolut && !isAIB && !isBOI && !isN26 && !isBUNQ && !isNationwide && (
          keys.some(k => k.trim() === 'Date' || k.includes('Date')) &&
          keys.some(k => k.trim() === 'Payee' || k.includes('Payee')) &&
          keys.some(k => k.trim() === 'Outflow' || k.includes('Outflow')) &&
          keys.some(k => k.trim() === 'Inflow' || k.includes('Inflow')) &&
          keys.some(k => (k.trim() === 'Running Balance' || k.includes('Running Balance') || k.includes('Balance')))
        );
        
        const bankType = isAIB ? 'AIB' : (isBOI ? 'BOI' : (isN26 ? 'N26' : (isBUNQ ? 'BUNQ' : (isNationwide ? 'Nationwide' : (isPTSB ? 'PTSB' : 'Revolut')))));
        
        // Get or create account identifier
        setAccountCounters(prevCounters => {
          const newCounters = { ...prevCounters };
          newCounters[bankType] = (newCounters[bankType] || 0) + 1;
          const account = bankType === 'AIB' 
            ? `AIB-${newCounters[bankType]}` 
            : bankType === 'BOI'
            ? `BOI-${newCounters[bankType]}`
            : bankType === 'N26'
            ? `N26-${newCounters[bankType]}`
            : bankType === 'BUNQ'
            ? `BUN-${newCounters[bankType]}`
            : bankType === 'Nationwide'
            ? `NAT-${newCounters[bankType]}`
            : bankType === 'PTSB'
            ? `PTSB-${newCounters[bankType]}`
            : `REV-${newCounters[bankType]}`;
          
          // Normalize all transactions with account identifier
          const normalizedTransactions = rawData
            .map(rawTx => normalizeTransaction(rawTx, account))
            .filter((tx): tx is Transaction => tx !== null);
          
          // Merge with existing data or replace
          setCsvData(prevData => {
            const mergedData = mergeWithExisting 
              ? [...prevData, ...normalizedTransactions]
              : normalizedTransactions;
            
            // Sort by date (newest first)
            mergedData.sort((a, b) => {
              const dateA = new Date(a.Date).getTime();
              const dateB = new Date(b.Date).getTime();
              return dateB - dateA;
            });
            
            // Re-analyze subscriptions with merged data
            setSubscriptions(analyzeBankStatement(mergedData));
            
            return mergedData;
          });
          
          // Update uploaded files list (check for duplicates)
          setUploadedFiles(prevFiles => {
            // Check if this file already exists (by name, size, and lastModified)
            const isDuplicate = prevFiles.some(existingFile => 
              existingFile.file.name === file.name &&
              existingFile.file.size === file.size &&
              existingFile.file.lastModified === file.lastModified
            );
            
            if (isDuplicate) {
              console.log(`Skipping duplicate file: ${file.name}`);
              return prevFiles; // Don't add duplicate
            }
            
            const newFile = { file, bankType, rowCount, account };
            return mergeWithExisting ? [...prevFiles, newFile] : [newFile];
          });
          
        incrementStat('files_uploaded');
          incrementStat('rows_analyzed', rowCount);
          trackCSVUpload(rowCount, bankType, 'file_processing');
          
          // Call completion callback and resolve promise
          if (onComplete) {
            onComplete();
          }
          resolve();
          
          return newCounters;
        });
      },
      error: (error) => {
        console.error('Error parsing CSV:', error);
        if (onComplete) {
          onComplete();
        }
        resolve();
      }
    });
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    // Limit to 5 files
    const fileArray = Array.from(files).slice(0, 5);
    if (files.length > 5) {
      alert(`You can upload up to 5 files at once. Only the first 5 files will be processed.`);
    }
    
    trackButtonClick('CSV Upload', { location: 'analysis_page', method: 'file_input', file_count: fileArray.length });
    
    // Process files sequentially to avoid state conflicts
    for (let i = 0; i < fileArray.length; i++) {
      await processCSVFile(fileArray[i], i > 0 || csvData.length > 0);
    }
    
    // Reset input to allow selecting the same files again
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    
    // Show waitlist modal after processing (only once per session)
    if (!hasShownWaitlistModal) {
      setTimeout(() => {
        setShowWaitlistModal(true);
        setHasShownWaitlistModal(true);
      }, 1000); // Small delay to ensure processing is complete
    }
    // Enhancement will be triggered by useEffect when csvData updates
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    
    // Limit to 5 files
    const fileArray = Array.from(files).slice(0, 5);
    if (files.length > 5) {
      alert(`You can upload up to 5 files at once. Only the first 5 files will be processed.`);
    }
    
    trackButtonClick('CSV Upload', { location: 'analysis_page', method: 'drag_drop', file_count: fileArray.length });
    
    // Process files sequentially to avoid state conflicts
    for (let i = 0; i < fileArray.length; i++) {
      await processCSVFile(fileArray[i], i > 0 || csvData.length > 0);
    }
    
    // Show waitlist modal after processing (only once per session)
    if (!hasShownWaitlistModal) {
      setTimeout(() => {
        setShowWaitlistModal(true);
        setHasShownWaitlistModal(true);
      }, 1000); // Small delay to ensure processing is complete
    }
    // Enhancement will be triggered by useEffect when csvData updates
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  const totalTransactions = csvData.length;
  const totalPotentialSubscriptions = subscriptions.length;

  const top10ByTotal = useMemo(() => {
    return subscriptions
      .slice()
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .slice(0, 10);
  }, [subscriptions]);
  const top10ByCount = useMemo(() => {
    return subscriptions
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [subscriptions]);

  // Get primary currency (most common currency in transactions)
  const primaryCurrency = useMemo(() => {
    if (csvData.length === 0) return 'EUR';
    const currencyCounts: Record<string, number> = {};
    csvData.forEach(tx => {
      const currency = tx.Currency || 'EUR';
      currencyCounts[currency] = (currencyCounts[currency] || 0) + 1;
    });
    return Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'EUR';
  }, [csvData]);

  const totalOutgoing = useMemo(() => {
    return csvData.reduce((sum, tx) => {
      return tx.Amount < 0 ? sum + Math.abs(tx.Amount) : sum;
    }, 0);
  }, [csvData]);

  const totalSubscriptions = useMemo(() => {
    return subscriptions.reduce((sum, sub) => sum + Math.abs(sub.total), 0);
  }, [subscriptions]);

  const totalNonSubscriptions = Math.max(0, totalOutgoing - totalSubscriptions);

  // Top 15 outgoings sorted by total spend
  const top15Outgoings = useMemo(() => {
    return subscriptions
      .slice()
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .slice(0, 15);
  }, [subscriptions]);

  const pieData = {
    labels: ['Subscriptions', 'Non-Subscriptions'],
    datasets: [
      {
        data: [totalSubscriptions, totalNonSubscriptions],
        backgroundColor: ['#2d8cff', '#f4b400'],
      },
    ],
  };

  // Calculate average spend per day of month (1-31), then cumulative sum
  const avgSpendByDay = useMemo(() => {
    const dayTotals: number[] = Array(31).fill(0);
    const dayCounts: number[] = Array(31).fill(0);
    csvData.forEach((tx) => {
      if (tx.Amount >= 0) return;
      const date = new Date(tx.Date);
      if (!isNaN(date.getTime())) {
        const day = date.getDate();
        dayTotals[day - 1] += Math.abs(tx.Amount);
        dayCounts[day - 1] += 1;
      }
    });
    const avg: number[] = dayTotals.map((total, i) => (dayCounts[i] > 0 ? total / dayCounts[i] : 0));
    // Cumulative sum
    const cumulative: number[] = [];
    avg.reduce((acc, val, i) => {
      cumulative[i] = acc + val;
      return cumulative[i];
    }, 0);
    return { avg, cumulative };
  }, [csvData]);

  // Map: description -> { dates: Date[], amounts: number[], accounts: string[] }
  const subscriptionRawData = useMemo(() => {
    const map: Record<string, { dates: Date[]; amounts: number[]; accounts: Set<string> }> = {};
    csvData.forEach((tx) => {
      if (tx.Amount >= 0) return;
      const date = new Date(tx.Date);
      if (!isNaN(date.getTime())) {
        if (!map[tx.Description]) {
          map[tx.Description] = { dates: [], amounts: [], accounts: new Set<string>() };
        }
        map[tx.Description].dates.push(date);
        map[tx.Description].amounts.push(tx.Amount);
        map[tx.Description].accounts.add(tx.Account);
      }
    });
    return map;
  }, [csvData]);

  // Map: description -> all accounts that have this expense
  const accountsByDescription = useMemo(() => {
    const map: Record<string, string[]> = {};
    csvData.forEach((tx) => {
      if (!map[tx.Description]) {
        map[tx.Description] = [];
      }
      if (!map[tx.Description].includes(tx.Account)) {
        map[tx.Description].push(tx.Account);
      }
    });
    // Sort accounts for consistent display
    Object.keys(map).forEach(desc => {
      map[desc].sort();
    });
    return map;
  }, [csvData]);

  // Identify high-confidence subscriptions (same price for 6 months straight)
  const highConfidenceSubscriptions = useMemo(() => {
    return subscriptions.filter((sub) => {
    const raw = subscriptionRawData[sub.description] || { dates: [], amounts: [], accounts: new Set<string>() };
      if (raw.amounts.length < 6) return false; // Need at least 6 payments
      
      // Sort by date
      const sorted = raw.dates.map((date, idx) => ({ date, amount: raw.amounts[idx] }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      
      // Get the last 6 payments
      const last6 = sorted.slice(-6);
      
      // Check if all 6 have the same amount (within 0.01 tolerance for rounding)
      const firstAmount = Math.abs(last6[0].amount);
      const allSame = last6.every(item => Math.abs(Math.abs(item.amount) - firstAmount) < 0.01);
      
      // Also check that they're monthly (roughly 25-35 days apart)
      if (last6.length >= 2) {
        const daysBetween = (last6[last6.length - 1].date.getTime() - last6[0].date.getTime()) / (1000 * 60 * 60 * 24);
        const avgDaysBetween = daysBetween / (last6.length - 1);
        const isMonthly = avgDaysBetween >= 25 && avgDaysBetween <= 35;
        return allSame && isMonthly;
      }
      
      return allSame;
    }).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [subscriptions, subscriptionRawData]);

  // Time-series data for total spend and subscription spend over time
  const spendOverTime = useMemo(() => {
    const monthlyData: Record<string, { total: number; subscriptions: number }> = {};
    
    // Process all transactions (using normalized Transaction format)
    csvData.forEach((tx) => {
      // Use normalized Amount field (already negative for debits)
      const amount = tx.Amount || 0;
      
      if (amount >= 0) return; // Only outgoing transactions
      
      // Use normalized Date field (already in ISO format string)
      let date: Date | null = null;
      if (tx.Date) {
        // Parse ISO date string (YYYY-MM-DD)
        date = new Date(tx.Date);
      }
      
      if (!date || isNaN(date.getTime())) return;
      
      const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { total: 0, subscriptions: 0 };
      }
      monthlyData[monthKey].total += Math.abs(amount);
    });

    // Process subscription transactions
    subscriptions.forEach((sub) => {
      const raw = subscriptionRawData[sub.description] || { dates: [], amounts: [] };
      raw.dates.forEach((date, idx) => {
        const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        if (monthlyData[monthKey]) {
          monthlyData[monthKey].subscriptions += Math.abs(raw.amounts[idx] || 0);
        }
      });
    });

    // Sort by date and create arrays
    const sortedKeys = Object.keys(monthlyData).sort();
    const monthlyTotalSpend = sortedKeys.map(key => monthlyData[key].total);
    const monthlySubscriptionSpend = sortedKeys.map(key => monthlyData[key].subscriptions);
    
    // Calculate cumulative sums
    const cumulativeTotalSpend: number[] = [];
    const cumulativeSubscriptionSpend: number[] = [];
    
    monthlyTotalSpend.reduce((acc, val) => {
      const cum = acc + val;
      cumulativeTotalSpend.push(cum);
      return cum;
    }, 0);
    
    monthlySubscriptionSpend.reduce((acc, val) => {
      const cum = acc + val;
      cumulativeSubscriptionSpend.push(cum);
      return cum;
    }, 0);
    
    return {
      labels: sortedKeys,
      totalSpend: cumulativeTotalSpend,
      subscriptionSpend: cumulativeSubscriptionSpend,
    };
  }, [csvData, subscriptions, subscriptionRawData]);

  // Generate PDF report matching the Report tab
  const handleDownloadReport = async () => {
    incrementStat('reports_downloaded');
    trackPDFDownload();
    trackButtonClick('Download PDF Report', { location: 'report_page' });
    
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 40;
    const pageWidth = 595.28; // A4 width in points
    const margin = 40;
    const contentWidth = pageWidth - (margin * 2);
    
    // Title
    doc.setFontSize(24);
    doc.setTextColor(45, 140, 255);
    doc.setFont('helvetica', 'bold');
    doc.text('Financial Analysis Report', margin, y);
    y += 35;
    
    // Account summary
    if (uploadedFiles.length > 0) {
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.setFont('helvetica', 'normal');
      const accountList = uploadedFiles.map(f => `${f.bankType} (${f.account})`).join(', ');
      const accountText = `Analyzed ${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''}: ${accountList}`;
      const accountLines = doc.splitTextToSize(accountText, contentWidth);
      doc.text(accountLines, margin, y);
      y += accountLines.length * 12 + 10;
    }
    
    // Currency info
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text(`Currency: ${primaryCurrency} (${getCurrencySymbol(primaryCurrency)})`, margin, y);
    y += 15;
    
    // Three paragraphs
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    
    const paragraph1 = 'This comprehensive analysis examines your bank statement transactions from multiple accounts to identify recurring payments and subscription patterns. By analyzing transaction frequency, amounts, descriptions, and categories, the system categorizes potential subscriptions and calculates confidence scores based on payment regularity, consistency, and subscription-related keywords. The analysis filters out one-time transactions and transfers to focus on recurring expenses that may represent ongoing subscriptions or services.';
    const paragraph2 = 'The system evaluates each transaction group by calculating statistical measures including average payment amounts, standard deviation, and payment frequency. Transactions are classified by frequency labels such as Daily, Weekly, Monthly, Quarterly, or Irregular based on the time span and number of occurrences. Each transaction is also automatically categorized (e.g., Entertainment, Food & Dining, Utilities) to help you understand your spending patterns across different areas of your life.';
    const paragraph3 = 'The analysis tracks spending patterns over time, comparing total outgoing expenses against identified subscription costs. This enables you to understand what portion of your spending is dedicated to recurring services versus one-time purchases. By identifying these patterns across multiple accounts, you can make informed decisions about which subscriptions to keep, optimize, or cancel to better manage your finances and reduce unnecessary recurring expenses.';
    
    const lines1 = doc.splitTextToSize(paragraph1, contentWidth);
    doc.text(lines1, margin, y);
    y += lines1.length * 14 + 12;
    
    const lines2 = doc.splitTextToSize(paragraph2, contentWidth);
    doc.text(lines2, margin, y);
    y += lines2.length * 14 + 12;
    
    const lines3 = doc.splitTextToSize(paragraph3, contentWidth);
    doc.text(lines3, margin, y);
    y += lines3.length * 14 + 25;
    
    // Category breakdown section (if categories exist)
    const categorySpending: Record<string, number> = {};
    csvData.forEach(tx => {
      if (tx.Amount < 0 && tx.Category) {
        categorySpending[tx.Category] = (categorySpending[tx.Category] || 0) + Math.abs(tx.Amount);
      }
    });
    const hasCategories = Object.keys(categorySpending).length > 0 && 
                          !Object.keys(categorySpending).every(cat => cat === 'Other' || !cat);
    
    if (hasCategories && y > 600) {
      doc.addPage();
      y = 40;
    }
    
    if (hasCategories) {
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('Spending by Category', margin, y);
      y += 20;
      
      // Sort categories by spend
      const sortedCategories = Object.entries(categorySpending)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Top 10 categories
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
      
      sortedCategories.forEach(([category, amount]) => {
        if (y > 750) {
          doc.addPage();
          y = 40;
        }
        doc.text(`${category}:`, margin, y);
        doc.text(`${getCurrencySymbol(primaryCurrency)}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, margin + 200, y);
        y += 15;
      });
      
      y += 15;
    }
    
    // Top 15 Outgoings section
    if (y > 650) {
      doc.addPage();
      y = 40;
    }
    
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Top 15 Outgoings', margin, y);
    y += 20;
    
    // Table header (no gridlines)
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(45, 140, 255);
    const col1 = margin;
    const col2 = margin + 200;
    const col3 = margin + 320;
    const col4 = margin + 400;
    const col5 = margin + 480;
    
    doc.text('Name', col1, y);
    doc.text('Category', col2, y);
    doc.text('Total Spend', col3, y);
    doc.text('Frequency', col4, y);
    doc.text('Payments', col5, y);
    y += 15;
    
    // Table rows (no gridlines)
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    
    top15Outgoings.forEach((sub) => {
      if (y > 750) {
        doc.addPage();
        y = 40;
        // Redraw header
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(45, 140, 255);
        doc.setFontSize(10);
        doc.text('Name', col1, y);
        doc.text('Category', col2, y);
        doc.text('Total Spend', col3, y);
        doc.text('Frequency', col4, y);
        doc.text('Payments', col5, y);
        y += 15;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
      }
      
      // Get category and accounts from csvData
      const firstTx = csvData.find(tx => tx.Description === sub.description);
      const category = firstTx?.Category || 'Other';
      const accounts = accountsByDescription[sub.description] || [];
      const accountStr = accounts.length > 0 ? accounts.join(', ') : '';
      
      const nameLines = doc.splitTextToSize(sub.description, 190);
      const categoryLines = doc.splitTextToSize(category, 110);
      const accountLines = accountStr ? doc.splitTextToSize(`(${accountStr})`, 190) : [];
      
      doc.text(nameLines, col1, y);
      doc.text(categoryLines, col2, y);
      doc.text(`${getCurrencySymbol(primaryCurrency)}${(-sub.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, col3, y);
      doc.text(sub.frequencyLabel, col4, y);
      doc.text(sub.count.toString(), col5, y);
      
      // Add account info below name if available
      if (accountLines.length > 0) {
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(accountLines, col1, y + 12);
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
      }
      
      y += Math.max(nameLines.length * 12, categoryLines.length * 12, accountLines.length * 10, 15) + 5;
    });
    
    y += 20;
    
    // Cumulative Spending Trends section
    if (y > 600) {
        doc.addPage();
        y = 40;
      }
    
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Cumulative Spending Trends Over Time', margin, y);
    y += 25;
    
    // Create line chart
    const chartWidth = contentWidth;
    const chartHeight = 200;
    const chartCanvas = document.createElement('canvas');
    chartCanvas.width = chartWidth * 2; // Higher resolution
    chartCanvas.height = chartHeight * 2;
    chartCanvas.style.position = 'fixed';
    chartCanvas.style.left = '-9999px';
    document.body.appendChild(chartCanvas);
    
    const chartCtx = chartCanvas.getContext('2d');
    if (chartCtx && spendOverTime.labels.length > 0) {
      // Background
      chartCtx.fillStyle = '#ffffff';
      chartCtx.fillRect(0, 0, chartCanvas.width, chartCanvas.height);
      
      // Chart area
      const padding = 60;
      const chartAreaWidth = chartCanvas.width - (padding * 2);
      const chartAreaHeight = chartCanvas.height - (padding * 2);
      const chartX = padding;
      const chartY = padding;
      
      // Find max value for scaling
      const maxTotal = Math.max(...spendOverTime.totalSpend, ...spendOverTime.subscriptionSpend);
      const maxValue = maxTotal * 1.1;
      
      // Draw axes (no gridlines)
      chartCtx.strokeStyle = '#333333';
      chartCtx.lineWidth = 2;
      chartCtx.beginPath();
      chartCtx.moveTo(chartX, chartY);
      chartCtx.lineTo(chartX, chartY + chartAreaHeight);
      chartCtx.lineTo(chartX + chartAreaWidth, chartY + chartAreaHeight);
      chartCtx.stroke();
      
      // Draw lines
      const pointSpacing = chartAreaWidth / (spendOverTime.labels.length - 1 || 1);
      
      // Total Spend line (blue)
      chartCtx.strokeStyle = '#2d8cff';
      chartCtx.lineWidth = 3;
      chartCtx.beginPath();
      spendOverTime.totalSpend.forEach((value, idx) => {
        const x = chartX + (idx * pointSpacing);
        const y = chartY + chartAreaHeight - (value / maxValue) * chartAreaHeight;
        if (idx === 0) {
          chartCtx.moveTo(x, y);
        } else {
          chartCtx.lineTo(x, y);
        }
      });
      chartCtx.stroke();
      
      // Subscription Spend line (red)
      chartCtx.strokeStyle = '#ff4444';
      chartCtx.lineWidth = 3;
      chartCtx.beginPath();
      spendOverTime.subscriptionSpend.forEach((value, idx) => {
        const x = chartX + (idx * pointSpacing);
        const y = chartY + chartAreaHeight - (value / maxValue) * chartAreaHeight;
        if (idx === 0) {
          chartCtx.moveTo(x, y);
        } else {
          chartCtx.lineTo(x, y);
        }
      });
      chartCtx.stroke();
      
      // Draw points
      spendOverTime.totalSpend.forEach((value, idx) => {
        const x = chartX + (idx * pointSpacing);
        const y = chartY + chartAreaHeight - (value / maxValue) * chartAreaHeight;
        chartCtx.fillStyle = '#2d8cff';
        chartCtx.beginPath();
        chartCtx.arc(x, y, 4, 0, Math.PI * 2);
        chartCtx.fill();
      });
      
      spendOverTime.subscriptionSpend.forEach((value, idx) => {
        const x = chartX + (idx * pointSpacing);
        const y = chartY + chartAreaHeight - (value / maxValue) * chartAreaHeight;
        chartCtx.fillStyle = '#ff4444';
        chartCtx.beginPath();
        chartCtx.arc(x, y, 4, 0, Math.PI * 2);
        chartCtx.fill();
      });
      
      // Labels
      chartCtx.fillStyle = '#333333';
      chartCtx.font = '12px Arial';
      chartCtx.textAlign = 'center';
      spendOverTime.labels.forEach((label, idx) => {
        const x = chartX + (idx * pointSpacing);
        chartCtx.fillText(label.slice(5), x, chartCanvas.height - 20);
      });
      
      // Y-axis labels
      chartCtx.textAlign = 'right';
      for (let i = 0; i <= 5; i++) {
        const value = (maxValue / 5) * (5 - i);
        const yPos = chartY + (chartAreaHeight / 5) * i;
        chartCtx.fillText(`${getCurrencySymbol(primaryCurrency)}${Math.round(value).toLocaleString()}`, chartX - 10, yPos + 4);
      }
      
      // Legend
      chartCtx.textAlign = 'left';
      chartCtx.fillStyle = '#2d8cff';
      chartCtx.fillRect(chartCanvas.width - 150, 20, 15, 3);
      chartCtx.fillStyle = '#333333';
      chartCtx.fillText('Total Spend', chartCanvas.width - 130, 25);
      
      chartCtx.fillStyle = '#ff4444';
      chartCtx.fillRect(chartCanvas.width - 150, 35, 15, 3);
      chartCtx.fillStyle = '#333333';
      chartCtx.fillText('Subscription Spend', chartCanvas.width - 130, 40);
      
      // Add chart to PDF
      const chartImgData = chartCanvas.toDataURL('image/png');
      doc.addImage(chartImgData, 'PNG', margin, y, chartWidth, chartHeight);
      
      // Clean up
      document.body.removeChild(chartCanvas);
    }
    
    doc.save('downsell_report.pdf');
  };


  // On mount, increment visits
  React.useEffect(() => {
    incrementStat('visits');
  }, []);

  return (
      <div className="app-layout">
        {/* Sidebar */}
        <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
          <div className="sidebar-logo" onClick={() => window.location.reload()} style={{ cursor: 'pointer' }}>
            <img src="/header.png" alt="Broc" style={{ height: '40px', width: 'auto' }} />
          </div>
          <nav className="sidebar-nav">
            {TAB_LABELS.map(tab => {
              const isAccountTab = tab.label.startsWith('Account');
              const isDisabled = isAccountTab || ((tab.label === 'Report' || tab.label === 'Actions' || tab.label === 'Transactions') && csvData.length === 0);
              return (
              <div
                key={tab.label}
                  className={`sidebar-item ${activeTab === tab.label ? 'sidebar-item-active' : ''} ${isDisabled ? 'sidebar-item-disabled' : ''}`}
                  onClick={() => !isDisabled && handleSidebarTabClick(tab.label)}
              >
                <span className="sidebar-icon">{tab.icon}</span>
                <span className="sidebar-label">{tab.label}</span>
              </div>
              );
            })}
          </nav>
          <div style={{ padding: '1rem', marginTop: 'auto' }}>
            <button 
              className="optimize-btn" 
              onClick={() => {
                trackButtonClick('Join Waitlist', { location: 'sidebar' });
                window.open('https://broc.fi', '_blank');
              }}
              style={{ width: '100%', padding: '0.75rem 1rem', fontSize: '0.95rem' }}
            >
              Join the Waitlist
            </button>
          </div>
        </aside>
        {/* Main Area */}
        <div className="main-area">
          {/* Top Bar */}
          <header className="topbar">
            {/* Hamburger for mobile */}
            <button
              className="topbar-hamburger"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Open navigation"
            >
              <span />
              <span />
              <span />
            </button>
            <div className="topbar-title" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700 }}>Downsell by Broc.fi</div>
            <div className="topbar-right">
              <button 
                className="optimize-btn" 
                onClick={() => {
                  trackButtonClick('Join Waitlist', { location: 'header' });
                  window.open('https://broc.fi', '_blank');
                }}
                style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
              >
                Join the Waitlist
              </button>
            </div>
          </header>
          {/* Main Content */}
          <main className="main-content">
            {activeTab === 'Analysis' && (
              <>
                <h1>Analyze Your Subscriptions</h1>
                <div style={{ 
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '1.5rem',
                  marginBottom: '1.5rem'
                }}>
                  <div style={{ 
                    padding: '1rem 1.5rem', 
                    background: 'rgba(255, 255, 255, 0.05)', 
                    border: '1px solid rgba(255, 255, 255, 0.1)', 
                    borderRadius: '12px', 
                    color: '#bfc9da',
                    fontSize: '0.95rem',
                    lineHeight: '1.6'
                  }}>
                    <div 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        cursor: 'pointer'
                      }}
                      onClick={() => setAboutCollapsed(!aboutCollapsed)}
                    >
                      <strong style={{ color: 'white', display: 'block', marginBottom: '0.5rem' }}>🪪 About Downsell</strong>
                      <span style={{ color: '#888', fontSize: '1.2rem', userSelect: 'none' }}>
                        {aboutCollapsed ? '▼' : '▲'}
                      </span>
                    </div>
                    {!aboutCollapsed && (
                      <>
                        <p style={{ margin: 0 }}>
                          Downsell is an early slice of the <strong>Broc</strong> vision—built to help you understand your finances without the overwhelm.
                        </p>
                        <p style={{ margin: '0.75rem 0 0 0' }}>
                          We know the real solution needs to be automatic. That's what we're building with Broc: A solution that monitors your finances continuously and takes action for you. But right now, especially as payday approaches, Downsell gives you the clarity to see your patterns and plan your next move.
                        </p>
                        <p style={{ margin: '0.75rem 0 0 0' }}>
                          Upload your bank statement (CSV) and get insights in seconds. We recommend 12 months of data for the clearest picture, but shorter periods work too.
                        </p>
                      </>
                    )}
                  </div>
                  <div style={{ 
                    padding: '1rem 1.5rem', 
                    background: 'rgba(45, 140, 255, 0.15)', 
                    border: '1px solid rgba(45, 140, 255, 0.3)', 
                    borderRadius: '12px', 
                    color: '#bfc9da',
                    fontSize: '0.95rem',
                    lineHeight: '1.6'
                  }}>
                    <div 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        cursor: 'pointer'
                      }}
                      onClick={() => setPrivacyCollapsed(!privacyCollapsed)}
                    >
                      <strong style={{ color: '#2d8cff', display: 'block', marginBottom: '0.5rem' }}>🔒 Your Privacy Matters</strong>
                      <span style={{ color: '#888', fontSize: '1.2rem', userSelect: 'none' }}>
                        {privacyCollapsed ? '▼' : '▲'}
                      </span>
                    </div>
                    {!privacyCollapsed && (
                      <>
                        <p style={{ margin: 0 }}>
                          All analysis happens entirely on your device. Nothing is stored on our servers or sent anywhere. Your financial data never leaves your browser.
                        </p>
                        <p style={{ margin: '0.75rem 0 0 0' }}>
                          This is a free public tool designed to help everyone understand their finances better.
                        </p>
                      </>
                    )}
                  </div>
                  <div style={{ 
                    padding: '1rem 1.5rem', 
                    background: 'rgba(0, 217, 255, 0.1)', 
                    border: '1px solid rgba(0, 217, 255, 0.3)', 
                    borderRadius: '12px', 
                    color: '#bfc9da',
                    fontSize: '0.95rem',
                    lineHeight: '1.6'
                  }}>
                    <div 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        cursor: 'pointer'
                      }}
                      onClick={() => setAutopilotCollapsed(!autopilotCollapsed)}
                    >
                      <strong style={{ color: '#00d9ff', display: 'block', marginBottom: '0.5rem' }}>🚀 Ready for Financial Autopilot?</strong>
                      <span style={{ color: '#888', fontSize: '1.2rem', userSelect: 'none' }}>
                        {autopilotCollapsed ? '▼' : '▲'}
                      </span>
                    </div>
                    {!autopilotCollapsed && (
                      <>
                        <p style={{ margin: 0 }}>
                          Downsell is the first step to showing you the problems. <strong>Broc solves them for you.</strong>
                        </p>
                        <p style={{ margin: '0.75rem 0 0 0' }}>
                          Imagine this analysis running continuously in the background. When you're overpaying, Broc doesn't just tell you—it finds better deals, makes providers compete, and switches you automatically.
                        </p>
                        <p style={{ margin: '0.75rem 0 0 0' }}>
                          Active financial management that was once only available to the wealthy, now accessible to everyone through AI.
                        </p>
                        <p style={{ margin: '0.75rem 0 0 0' }}>
                          Join the waitlist and be first when we launch.
                        </p>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ 
                  padding: '1rem 1.5rem', 
                  background: 'rgba(255, 255, 255, 0.05)', 
                  border: '1px solid rgba(255, 255, 255, 0.1)', 
                  borderRadius: '12px', 
                  marginBottom: '2rem',
                  color: '#bfc9da',
                  fontSize: '0.95rem',
                  lineHeight: '1.6'
                }}>
                  <strong style={{ color: 'white', display: 'block', marginBottom: '0.75rem' }}>📋 Supported Banks</strong>
                  <div style={{ 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    gap: '1rem', 
                    alignItems: 'center',
                    marginBottom: '0.75rem'
                  }}>
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.75rem',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)'
                    }}>
                      <img 
                        src="https://i.imgur.com/ZcvnQ83.png" 
                        alt="AIB" 
                        style={{ width: '100px', height: '100px', objectFit: 'contain' }}
                      />
                      <strong style={{ color: 'white', fontSize: '0.9rem' }}>AIB</strong>
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.75rem',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)'
                    }}>
                      <img 
                        src="https://i.imgur.com/Z9cqIo8.png" 
                        alt="Bank of Ireland" 
                        style={{ width: '100px', height: '100px', objectFit: 'contain' }}
                      />
                      <strong style={{ color: 'white', fontSize: '0.9rem' }}>Bank of Ireland</strong>
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.75rem',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)'
                    }}>
                      <img 
                        src="https://i.imgur.com/3HBtReM.png" 
                        alt="Bunq" 
                        style={{ width: '100px', height: '100px', objectFit: 'contain' }}
                      />
                      <strong style={{ color: 'white', fontSize: '0.9rem' }}>Bunq</strong>
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.75rem',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)'
                    }}>
                      <img 
                        src="https://i.imgur.com/rr9wMgQ.png" 
                        alt="N26" 
                        style={{ width: '100px', height: '100px', objectFit: 'contain' }}
                      />
                      <strong style={{ color: 'white', fontSize: '0.9rem' }}>N26</strong>
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.75rem',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)'
                    }}>
                      <img 
                        src="https://i.imgur.com/hNxpqq9.png" 
                        alt="Revolut" 
                        style={{ width: '100px', height: '100px', objectFit: 'contain' }}
                      />
                      <strong style={{ color: 'white', fontSize: '0.9rem' }}>Revolut</strong>
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.75rem',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)'
                    }}>
                      <img 
                        src="https://i.imgur.com/nwQPNwc.png" 
                        alt="Nationwide" 
                        style={{ width: '100px', height: '100px', objectFit: 'contain' }}
                      />
                      <strong style={{ color: 'white', fontSize: '0.9rem' }}>Nationwide</strong>
                    </div>
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.75rem',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.2)'
                    }}>
                      <img 
                        src="https://i.imgur.com/sHapB2W.png" 
                        alt="Permanent TSB" 
                        style={{ width: '100px', height: '100px', objectFit: 'contain' }}
                      />
                      <strong style={{ color: 'white', fontSize: '0.9rem' }}>Permanent TSB</strong>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#888' }}>
                    We're expanding to support more banks in the coming weeks.
                  </p>
                </div>
                <div className={"upload-area" + (dragActive ? " drag-active" : "")}
                     onClick={handleClick}
                     onDragEnter={handleDrag}
                     onDragOver={handleDrag}
                     onDragLeave={handleDrag}
                     onDrop={handleDrop}
                     style={{ marginBottom: '2rem' }}>
                  <input
                    type="file"
                    accept=".csv"
                    multiple
                    ref={inputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                  />
                  <div className="upload-prompt">
                    {uploadedFiles.length > 0 ? (
                      <div>
                        <div style={{ marginBottom: '0.5rem' }}>
                          <strong>{uploadedFiles.length} file{uploadedFiles.length > 1 ? 's' : ''} uploaded</strong>
                        </div>
                        <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>
                          {uploadedFiles.map((fileInfo, idx) => (
                            <div key={idx} style={{ marginTop: '0.3rem' }}>
                              {fileInfo.file.name} ({fileInfo.bankType}, {fileInfo.rowCount} rows)
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', opacity: 0.8 }}>
                          You can upload more files to merge them
                        </div>
                      </div>
                    ) : (
                      <span>Drag and drop your CSV file(s) here, or <span className="upload-link">click to upload</span></span>
                    )}
                  </div>
                </div>
                <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
                  <button
                    onClick={handleConnectBank}
                    disabled={isPlaidLoading}
                    style={{
                      padding: '1rem 2rem',
                      fontSize: '1.1rem',
                      backgroundColor: 'var(--brand-primary, #4a6cf7)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: isPlaidLoading ? 'not-allowed' : 'pointer',
                      opacity: isPlaidLoading ? 0.6 : 1,
                      fontWeight: 600,
                      transition: 'opacity 0.2s, transform 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isPlaidLoading) {
                        e.currentTarget.style.transform = 'scale(1.02)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    {isPlaidLoading ? 'Connecting...' : 'Connect to bank'}
                  </button>
                  
                  {connectedBanks.length > 0 && (
                    <div style={{ 
                      marginTop: '1.5rem', 
                      padding: '1rem',
                      backgroundColor: '#f0f7ff',
                      borderRadius: '8px',
                      border: '1px solid #4a6cf7',
                      maxWidth: '500px',
                      margin: '1.5rem auto 0',
                    }}>
                      <div style={{ 
                        fontSize: '0.9rem', 
                        fontWeight: 600, 
                        color: '#4a6cf7',
                        marginBottom: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                      }}>
                        <span style={{ fontSize: '1.2rem' }}>✓</span>
                        <span>Connected Banks ({connectedBanks.length})</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {connectedBanks.map((bank, idx) => (
                          <div 
                            key={bank.institutionId || idx}
                            style={{
                              padding: '0.75rem',
                              backgroundColor: 'white',
                              borderRadius: '6px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '0.9rem',
                            }}
                          >
                            <span style={{ fontWeight: 500, color: '#333' }}>{bank.name}</span>
                            <span style={{ fontSize: '0.8rem', color: '#666' }}>
                              {new Date(bank.connectedAt).toLocaleDateString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {csvData.length > 0 && (
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', justifyContent: 'center' }}>
                    <button 
                      className="optimize-btn" 
                      onClick={() => {
                        trackButtonClick('Report Button', { location: 'analysis_page' });
                        handleSidebarTabClick('Report');
                      }}
                      style={{ padding: '1rem 2rem', fontSize: '1.1rem', flex: '1', maxWidth: '300px' }}
                    >
                      Report
                    </button>
                    <button 
                      onClick={() => {
                        trackButtonClick('Actions Button', { location: 'analysis_page' });
                        handleSidebarTabClick('Actions');
                      }}
                      style={{ 
                        padding: '1rem 2rem', 
                        fontSize: '1.1rem', 
                        flex: '1', 
                        maxWidth: '300px',
                        background: 'rgba(247, 37, 133, 0.2)',
                        border: '2px solid #f72585',
                        color: '#f72585',
                        borderRadius: '8px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        fontFamily: 'Inter, sans-serif'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(247, 37, 133, 0.3)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(247, 37, 133, 0.2)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      Actions
                    </button>
                  </div>
                )}
                <div className="big-numbers-row">
                  <div className="big-number-tile">
                    <div className="big-number-label">Total Transactions</div>
                    <div className="big-number-value">{totalTransactions.toLocaleString()}</div>
                  </div>
                  <div className="big-number-tile">
                    <div className="big-number-label">Potential Subscriptions</div>
                    <div className="big-number-value">{totalPotentialSubscriptions.toLocaleString()}</div>
                  </div>
                  <div className="big-number-tile">
                    <div className="big-number-label">Total Spend</div>
                    <div className="big-number-value">{getCurrencySymbol(primaryCurrency)}{totalOutgoing.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                  </div>
                  <div className="big-number-tile">
                    <div className="big-number-label">Subscription Spend</div>
                    <div className="big-number-value">{getCurrencySymbol(primaryCurrency)}{totalSubscriptions.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                  </div>
                </div>
                {subscriptions.length > 0 && (
                  <div className="charts-grid-2x2">
                    <div className="chart-col" style={{ height: 400 }}>
                      <Bar
                        data={{
                          labels: top10ByTotal.map((s) => s.description),
                          datasets: [
                            {
                              label: 'Total Spent',
                              backgroundColor: '#2d8cff',
                              data: top10ByTotal.map((s) => -s.total),
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          indexAxis: 'y' as const,
                          plugins: {
                            legend: { 
                              display: false,
                              labels: {
                                color: 'white'
                              }
                            },
                            title: { 
                              display: true, 
                              text: 'Top 10 Subscriptions by Total Spent',
                              color: 'white'
                            },
                          },
                          scales: { 
                            x: { 
                              beginAtZero: true,
                              title: {
                                display: true,
                                text: 'Total Spent (€)',
                                color: 'white',
                                font: { weight: 'bold' }
                              },
                              ticks: {
                                color: 'white',
                                callback: (value: any) => `${getCurrencySymbol(primaryCurrency)}${value}`
                              },
                              grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                              }
                            },
                            y: {
                              ticks: {
                                color: 'white'
                              },
                              grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                              }
                            }
                          },
                        }}
                      />
                    </div>
                    <div className="chart-col" style={{ height: 400 }}>
                      <Bar
                        data={{
                          labels: top10ByCount.map((s) => s.description),
                          datasets: [
                            {
                              label: 'Count',
                              backgroundColor: '#f4b400',
                              data: top10ByCount.map((s) => s.count),
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          indexAxis: 'y' as const,
                          plugins: {
                            legend: { 
                              display: false,
                              labels: {
                                color: 'white'
                              }
                            },
                            title: { 
                              display: true, 
                              text: 'Top 10 Subscriptions by Count',
                              color: 'white'
                            },
                          },
                          scales: { 
                            x: { 
                              beginAtZero: true,
                              title: {
                                display: true,
                                text: 'Number of Payments',
                                color: 'white',
                                font: { weight: 'bold' }
                              },
                              ticks: {
                                color: 'white'
                              },
                              grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                              }
                            },
                            y: {
                              ticks: {
                                color: 'white'
                              },
                              grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                              }
                            }
                          },
                        }}
                      />
                    </div>
                    <div className="chart-col" style={{ height: 400 }}>
                      <Pie
                        data={pieData}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            title: { 
                              display: true, 
                              text: 'Subscriptions vs Non-Subscriptions (Total Spend)',
                              color: 'white'
                            },
                            legend: { 
                              display: true, 
                              position: 'bottom',
                              labels: {
                                color: 'white'
                              }
                            }
                          }
                        }}
                      />
                    </div>
                    <div className="chart-col" style={{ height: 400 }}>
                      <Line
                        data={{
                          labels: Array.from({ length: 31 }, (_, i) => (i + 1).toString()),
                          datasets: [
                            {
                              label: 'Cumulative Average Spend',
                              data: avgSpendByDay.cumulative,
                              borderColor: '#4a6cf7',
                              backgroundColor: 'rgba(74, 108, 247, 0.2)',
                              fill: true,
                              tension: 0.3,
                              pointRadius: 2,
                              yAxisID: 'y',
                            },
                            {
                              label: 'Average Spend (Non-Cumulative)',
                              data: avgSpendByDay.avg,
                              borderColor: '#f72585',
                              backgroundColor: 'rgba(247, 37, 133, 0.15)',
                              fill: false,
                              tension: 0.3,
                              pointRadius: 2,
                              yAxisID: 'y1',
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              labels: { color: 'white' }
                            },
                            title: {
                              display: true,
                              text: 'Cumulative & Daily Average Spend by Day of Month',
                              color: 'white',
                            },
                          },
                          scales: {
                            x: {
                              title: {
                                display: true,
                                text: 'Day of Month',
                                color: 'white',
                                font: { weight: 'bold' }
                              },
                              ticks: { color: 'white' },
                              grid: { color: 'rgba(255,255,255,0.1)' }
                            },
                            y: {
                              title: {
                                display: true,
                                text: `Cumulative Average Spend (${getCurrencySymbol(primaryCurrency)})`,
                                color: 'white',
                                font: { weight: 'bold' }
                              },
                              ticks: {
                                color: 'white',
                                callback: (value: any) => `${getCurrencySymbol(primaryCurrency)}${value}`
                              },
                              grid: { color: 'rgba(255,255,255,0.1)' }
                            },
                            y1: {
                              position: 'right',
                              title: {
                                display: true,
                                text: 'Average Spend (€)',
                                color: 'white',
                                font: { weight: 'bold' }
                              },
                              ticks: {
                                color: 'white',
                                callback: (value: any) => `${getCurrencySymbol(primaryCurrency)}${value}`
                              },
                              grid: {
                                drawOnChartArea: false
                              }
                            }
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
                {csvData.length > 0 && (
                  <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                    <strong>Total Transactions:</strong> {totalTransactions}
                    <br />
                    <strong>Potential Subscriptions:</strong> {totalPotentialSubscriptions}
                  </div>
                )}
                {csvData.length > 0 && (
                  <>
                    <h2 style={{ marginTop: '2rem' }}>Potential Subscriptions</h2>
                    <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <label htmlFor="frequency-filter" style={{ color: 'white', fontWeight: 500 }}>Filter by Frequency:</label>
                      <select
                        id="frequency-filter"
                        value={frequencyFilter}
                        onChange={e => setFrequencyFilter(e.target.value)}
                        style={{ padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid #4a6cf7', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}
                      >
                        {frequencyOptions.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                    <div className="subscriptions-grid-responsive">
                      {subscriptions
                        .filter(sub => frequencyFilter === 'All' || sub.frequencyLabel === frequencyFilter)
                        .map((sub) => {
                          const raw = subscriptionRawData[sub.description] || { dates: [], amounts: [] };
                          // Month analysis
                          const monthCounts: Record<string, number> = {};
                          raw.dates.forEach((d) => {
                            const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                            monthCounts[key] = (monthCounts[key] || 0) + 1;
                          });
                          const monthLabels = Object.keys(monthCounts).sort();
                          const monthValues = monthLabels.map((k) => monthCounts[k]);
                          // Day of week analysis
                          const dowCounts: number[] = Array(7).fill(0);
                          raw.dates.forEach((d) => { dowCounts[d.getDay()] += 1; });
                          const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                          return (
                            <div className="subscription-card" key={sub.description} style={{ position: 'relative' }}>
                              {/* Category and Account badges (right-aligned) */}
                              {(() => {
                                const raw = subscriptionRawData[sub.description] || { accounts: new Set<string>() };
                                const accounts = Array.from(raw.accounts).sort();
                                const firstTx = csvData.find(tx => tx.Description === sub.description);
                                const category = firstTx?.Category || 'Other';
                                const categoryColor = getCategoryColor(category as Category);
                                const showClassifying = (category === 'Other' || !category) && isClassifying;
                                
                                return (
                                  <div style={{
                                    position: 'absolute',
                                    top: '1rem',
                                    right: '1rem',
                                    display: 'flex',
                                    gap: '0.5rem',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    justifyContent: 'flex-end'
                                  }}>
                                    {/* Category badge */}
                                    <div style={{
                                      padding: '0.25rem 0.75rem',
                                      borderRadius: '6px',
                                      fontSize: '0.85rem',
                                      fontWeight: 600,
                                      background: showClassifying ? 'rgba(45, 140, 255, 0.2)' : `${categoryColor}20`,
                                      color: showClassifying ? '#2d8cff' : categoryColor,
                                      border: showClassifying ? '1px solid #2d8cff' : `1px solid ${categoryColor}`,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.5rem',
                                    }}>
                                      {showClassifying && (
                                        <span style={{
                                          display: 'inline-block',
                                          width: '12px',
                                          height: '12px',
                                          border: '2px solid #2d8cff',
                                          borderTopColor: 'transparent',
                                          borderRadius: '50%',
                                          animation: 'spin 1s linear infinite',
                                        }} />
                                      )}
                                      {showClassifying ? 'Classifying...' : category}
                                    </div>
                                    {/* Account badge */}
                                    {accounts.length > 0 && (
                                      <div style={{
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '6px',
                                        fontSize: '0.85rem',
                                        fontWeight: 600,
                                        background: 'rgba(247, 37, 133, 0.2)',
                                        color: '#f72585',
                                        border: '1px solid #f72585',
                                        fontFamily: 'monospace'
                                      }}>
                                        {accounts.join(', ')}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              <h3>{sub.description}</h3>
                              <div className="subscription-details">
                                <table className="mini-stats-table">
                                  <tbody>
                                    <tr>
                                      <td>Total Spent:</td>
                                      <td>{getCurrencySymbol(primaryCurrency)}{(-sub.total).toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                      <td>Number of Payments:</td>
                                      <td>{sub.count}</td>
                                    </tr>
                                    <tr>
                                      <td>Average Payment:</td>
                                      <td>{getCurrencySymbol(primaryCurrency)}{(-sub.average).toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                      <td>Maximum Payment:</td>
                                      <td>{getCurrencySymbol(primaryCurrency)}{(-sub.maxAmount).toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                      <td>Frequency:</td>
                                      <td>{sub.frequencyLabel}</td>
                                    </tr>
                                    <tr>
                                      <td>Confidence Score:</td>
                                      <td>{Math.min(100, (sub.subscriptionScore * 100)).toFixed(0)}%</td>
                                    </tr>
                                  </tbody>
                                </table>
                                {/* Visuals: Only show if at least 2 transactions */}
                                {raw.dates.length >= 2 && (
                                  <div style={{ margin: '1rem 0' }}>
                                    <div style={{ marginBottom: 12 }}>
                                      <Bar
                                        data={{
                                          labels: monthLabels,
                                          datasets: [{
                                            label: 'Payments per Month',
                                            data: monthValues,
                                            backgroundColor: '#4a6cf7',
                                          }],
                                        }}
                                        options={{
                                          responsive: true,
                                          maintainAspectRatio: false,
                                          plugins: { legend: { display: false }, title: { display: true, text: 'Payments per Month', color: 'white' } },
                                          scales: { x: { ticks: { color: 'white' }, grid: { color: 'rgba(255,255,255,0.1)' } }, y: { beginAtZero: true, ticks: { color: 'white' }, grid: { color: 'rgba(255,255,255,0.1)' } } },
                                        }}
                                        height={120}
                                      />
                                    </div>
                                    <div>
                                      <Bar
                                        data={{
                                          labels: dowLabels,
                                          datasets: [{
                                            label: 'Payments by Day of Week',
                                            data: dowCounts,
                                            backgroundColor: '#00d9ff',
                                          }],
                                        }}
                                        options={{
                                          responsive: true,
                                          maintainAspectRatio: false,
                                          plugins: { legend: { display: false }, title: { display: true, text: 'Payments by Day of Week', color: 'white' } },
                                          scales: { x: { ticks: { color: 'white' }, grid: { color: 'rgba(255,255,255,0.1)' } }, y: { beginAtZero: true, ticks: { color: 'white' }, grid: { color: 'rgba(255,255,255,0.1)' } } },
                                        }}
                                        height={120}
                                      />
                                    </div>
                                  </div>
                                )}
                                <div className="subscription-actions">
                                  <button 
                                    className="optimize-btn" 
                                    disabled
                                    onClick={() => trackButtonClick('Optimise Button', { subscription: sub.description, status: 'disabled' })}
                                  >
                                    Optimise (soon)
                                  </button>
                                  <button 
                                    className="alt-btn"
                                    onClick={() => trackButtonClick('Find Alternative Button', { subscription: sub.description, status: 'coming_soon' })}
                                  >
                                    Find Alternative (coming soon)
                                  </button>
                                </div>
                                    </div>
                                  </div>
                          );
                        })}
                    </div>
                  </>
                )}
                {csvData.length === 0 && <p style={{ marginTop: '2rem', color: '#888' }}>No data loaded. Please upload a CSV file.</p>}
              </>
            )}
            {activeTab === 'Report' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                  <h1 style={{ margin: 0 }}>Financial Analysis Report</h1>
                  {csvData.length > 0 && (
                    <button className="optimize-btn" onClick={handleDownloadReport}>Download PDF Report</button>
                  )}
                                  </div>
                
                {csvData.length > 0 ? (
                  <>
                    <div style={{ marginBottom: '2.5rem', lineHeight: '1.8', color: '#bfc9da', fontSize: '1.05rem' }}>
                      <p style={{ marginBottom: '1.5rem' }}>
                        This comprehensive analysis examines your bank statement transactions to identify recurring payments and subscription patterns. 
                        By analyzing transaction frequency, amounts, and descriptions, the system categorizes potential subscriptions and calculates 
                        confidence scores based on payment regularity, consistency, and subscription-related keywords. The analysis filters out 
                        one-time transactions and transfers to focus on recurring expenses that may represent ongoing subscriptions or services.
                      </p>
                      <p style={{ marginBottom: '1.5rem' }}>
                        The system evaluates each transaction group by calculating statistical measures including average payment amounts, standard 
                        deviation, and payment frequency. Transactions are classified by frequency labels such as Daily, Weekly, Monthly, Quarterly, 
                        or Irregular based on the time span and number of occurrences. This helps distinguish between true recurring subscriptions 
                        and occasional purchases, providing you with a clear picture of your ongoing financial commitments.
                      </p>
                      <p>
                        The analysis also tracks spending patterns over time, comparing total outgoing expenses against identified subscription costs. 
                        This enables you to understand what portion of your spending is dedicated to recurring services versus one-time purchases. 
                        By identifying these patterns, you can make informed decisions about which subscriptions to keep, optimize, or cancel to 
                        better manage your finances and reduce unnecessary recurring expenses.
                      </p>
                    </div>

                    {/* Sankey Diagram - Spending Flow by Category */}
                    {(() => {
                      // Calculate spending by category
                      const categorySpending: Record<string, number> = {};
                      csvData.forEach(tx => {
                        if (tx.Amount < 0) { // Only outgoing transactions
                          const category = tx.Category || 'Other';
                          categorySpending[category] = (categorySpending[category] || 0) + Math.abs(tx.Amount);
                        }
                      });

                      // Show if there's any spending data
                      const totalSpending = Object.values(categorySpending).reduce((sum, val) => sum + val, 0);
                      const hasCategories = totalSpending > 0;
                      
                      return hasCategories ? (
                        <>
                          <h2 style={{ marginTop: '2.5rem', marginBottom: '1.5rem' }}>Spending Flow by Category</h2>
                          <p style={{ marginBottom: '1rem', color: '#bfc9da', fontSize: '0.95rem' }}>
                            Click on any category to see a detailed breakdown of transactions.
                          </p>
                          <div style={{ marginBottom: '2rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '2rem' }}>
                            <SankeyDiagram data={categorySpending} transactions={csvData} />
                          </div>
                        </>
                      ) : null;
                    })()}

                    <h2 style={{ marginTop: '2.5rem', marginBottom: '1.5rem' }}>Top 15 Outgoings</h2>
                    <div style={{ marginBottom: '2.5rem', overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', overflow: 'hidden' }}>
                        <thead>
                          <tr style={{ background: 'rgba(45, 140, 255, 0.2)' }}>
                            <th style={{ padding: '1rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Name</th>
                            <th style={{ padding: '1rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Total Spend</th>
                            <th style={{ padding: '1rem', textAlign: 'center', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Frequency</th>
                            <th style={{ padding: '1rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Number of Payments</th>
                          </tr>
                        </thead>
                        <tbody>
                          {top15Outgoings.map((sub, index) => (
                            <tr key={sub.description} style={{ borderBottom: index < top15Outgoings.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none' }}>
                              <td style={{ padding: '1rem', color: 'white' }}>{sub.description}</td>
                              <td style={{ padding: '1rem', textAlign: 'right', color: 'white', fontWeight: 500 }}>{getCurrencySymbol(primaryCurrency)}{(-sub.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td style={{ padding: '1rem', textAlign: 'center', color: '#00d9ff' }}>{sub.frequencyLabel}</td>
                              <td style={{ padding: '1rem', textAlign: 'right', color: 'white' }}>{sub.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <h2 style={{ marginTop: '2.5rem', marginBottom: '1.5rem' }}>Cumulative Spending Trends Over Time</h2>
                    <div className="chart-col" style={{ height: 400, marginBottom: '2rem' }}>
                      <Line
                        data={{
                          labels: spendOverTime.labels,
                          datasets: [
                            {
                              label: 'Cumulative Total Spend',
                              data: spendOverTime.totalSpend,
                              borderColor: '#2d8cff',
                              backgroundColor: 'rgba(45, 140, 255, 0.2)',
                              fill: false,
                              tension: 0.3,
                              pointRadius: 4,
                              pointHoverRadius: 6,
                            },
                            {
                              label: 'Cumulative Subscription Spend',
                              data: spendOverTime.subscriptionSpend,
                              borderColor: '#ff4444',
                              backgroundColor: 'rgba(255, 68, 68, 0.2)',
                              fill: false,
                              tension: 0.3,
                              pointRadius: 4,
                              pointHoverRadius: 6,
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              labels: { color: 'white' },
                              display: true,
                              position: 'top',
                            },
                            title: {
                              display: true,
                              text: 'Cumulative Total Spend vs Cumulative Subscription Spend Over Time',
                              color: 'white',
                              font: { size: 16, weight: 'bold' },
                            },
                          },
                          scales: {
                            x: {
                              title: {
                                display: true,
                                text: 'Month',
                                color: 'white',
                                font: { weight: 'bold' },
                              },
                              ticks: { color: 'white' },
                              grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            },
                            y: {
                              title: {
                                display: true,
                                text: 'Cumulative Amount (€)',
                                color: 'white',
                                font: { weight: 'bold' },
                              },
                              ticks: {
                                color: 'white',
                                callback: (value: any) => `${getCurrencySymbol(primaryCurrency)}${value.toLocaleString()}`,
                              },
                              grid: { color: 'rgba(255, 255, 255, 0.1)' },
                            },
                          },
                        }}
                      />
                    </div>

                    <div style={{ marginTop: '2rem', textAlign: 'center' }}>
                      <button className="optimize-btn" onClick={handleDownloadReport}>Download PDF Report</button>
                    </div>
                  </>
                ) : (
                  <p style={{ marginTop: '2rem', color: '#888' }}>Please upload a CSV file to generate the report.</p>
                                )}
                              </div>
            )}
            {activeTab === 'Actions' && (
              <div>
                <h1>Subscription Actions</h1>
                
                {csvData.length > 0 ? (
                  <>
                    <p style={{ marginBottom: '2rem', color: '#bfc9da', fontSize: '1.05rem' }}>
                      The following subscriptions have been identified with high confidence (same price for 6+ months). 
                      You can switch to alternative plans or cancel these subscriptions directly.
                    </p>

                    {highConfidenceSubscriptions.length > 0 ? (
                      <div style={{ marginBottom: '2rem', overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', overflow: 'hidden' }}>
                          <thead>
                            <tr style={{ background: 'rgba(45, 140, 255, 0.2)' }}>
                              <th style={{ padding: '1rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Name</th>
                              <th style={{ padding: '1rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Category</th>
                              <th style={{ padding: '1rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Total Spend</th>
                              <th style={{ padding: '1rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Monthly Spend</th>
                              <th style={{ padding: '1rem', textAlign: 'center', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {highConfidenceSubscriptions.map((sub, index) => {
                              const monthlySpend = sub.frequencyLabel === 'Monthly' 
                                ? -sub.average 
                                : sub.frequencyLabel === 'Weekly' 
                                  ? -sub.average * 4.33 
                                  : sub.frequencyLabel === 'Daily'
                                    ? -sub.average * 30
                                    : -sub.average;
                              const rowNumber = index + 1; // 1-indexed row number
                              const totalAmount = -sub.total; // Total amount (negative because it's a debit)
                              const firstTx = csvData.find(tx => tx.Description === sub.description);
                              const category = firstTx?.Category || 'Other';
                              const categoryColor = getCategoryColor(category as Category);
                              const showClassifying = (category === 'Other' || !category) && isClassifying;
                              return (
                                <tr key={sub.description} style={{ borderBottom: index < highConfidenceSubscriptions.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none' }}>
                                  <td style={{ padding: '1rem', color: 'white' }}>{sub.description}</td>
                                  <td style={{ padding: '1rem' }}>
                                    <span style={{
                                      padding: '0.25rem 0.5rem',
                                      borderRadius: '4px',
                                      fontSize: '0.85rem',
                                      fontWeight: 500,
                                      background: showClassifying ? 'rgba(45, 140, 255, 0.2)' : `${categoryColor}20`,
                                      color: showClassifying ? '#2d8cff' : categoryColor,
                                      border: showClassifying ? '1px solid #2d8cff' : `1px solid ${categoryColor}`,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.5rem',
                                    }}>
                                      {showClassifying && (
                                        <span style={{
                                          display: 'inline-block',
                                          width: '10px',
                                          height: '10px',
                                          border: '2px solid #2d8cff',
                                          borderTopColor: 'transparent',
                                          borderRadius: '50%',
                                          animation: 'spin 1s linear infinite',
                                        }} />
                                      )}
                                      {showClassifying ? 'Classifying...' : category}
                                    </span>
                                  </td>
                                  <td style={{ padding: '1rem', textAlign: 'right', color: 'white', fontWeight: 500 }}>€{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td style={{ padding: '1rem', textAlign: 'right', color: 'white', fontWeight: 500 }}>€{monthlySpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td style={{ padding: '1rem', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                      <a 
                                        href={`https://duckduckgo.com/?q=${encodeURIComponent(sub.description + ' alternatives')}`}
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="optimize-btn"
                                        style={{ padding: '0.5rem 1rem', textDecoration: 'none', display: 'inline-block' }}
                                        onClick={() => trackButtonClick('Switch Subscription', { location: 'actions_page', row_number: rowNumber, amount: totalAmount, subscription: sub.description, category: category })}
                                      >
                                        Switch
                                      </a>
                                      <a 
                                        href={`https://duckduckgo.com/?q=${encodeURIComponent('Cancel ' + sub.description)}`}
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="alt-btn"
                                        style={{ padding: '0.5rem 1rem', textDecoration: 'none', display: 'inline-block', background: 'rgba(247, 37, 133, 0.2)', color: '#f72585', border: '1px solid #f72585' }}
                                        onClick={() => trackButtonClick('Cancel Subscription', { location: 'actions_page', row_number: rowNumber, amount: totalAmount, subscription: sub.description, category: category })}
                                      >
                                        Cancel
                                      </a>
                            </div>
                                  </td>
                                </tr>
                          );
                        })}
                          </tbody>
                        </table>
                    </div>
                    ) : (
                      <p style={{ marginTop: '2rem', color: '#888' }}>
                        No high-confidence subscriptions found. High-confidence subscriptions are those with the same price for 6+ consecutive months.
                      </p>
                )}
              </>
                ) : (
                  <p style={{ marginTop: '2rem', color: '#888' }}>Please upload a CSV file to see subscription actions.</p>
            )}
              </div>
            )}
            {activeTab === 'Transactions' && (
              <div>
                <h1>All Transactions</h1>
                
                {csvData.length > 0 ? (
                  <>
                    <p style={{ marginBottom: '1.5rem', color: '#bfc9da', fontSize: '1.05rem' }}>
                      View all transactions from your bank statement. Subscriptions are highlighted in red, credits in green, and debits in orange.
                    </p>

                    {/* Filter and Search Controls */}
                    <div style={{ 
                      display: 'flex', 
                      gap: '1rem', 
                      marginBottom: '1.5rem', 
                      flexWrap: 'wrap',
                      alignItems: 'center'
                    }}>
                      <div style={{ flex: '1', minWidth: '150px' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#bfc9da', fontSize: '0.9rem' }}>
                          Filter by Account
                        </label>
                        <select
                          value={accountFilter}
                          onChange={(e) => setAccountFilter(e.target.value)}
                          className="transaction-filter-select"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '1rem',
                            fontFamily: 'Inter, sans-serif',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="All" style={{ background: '#2a3b4c', color: 'white' }}>All Accounts</option>
                          {Array.from(new Set(csvData.map(tx => tx.Account))).sort().map(account => (
                            <option key={account} value={account} style={{ background: '#2a3b4c', color: 'white' }}>{account}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: '1', minWidth: '200px' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#bfc9da', fontSize: '0.9rem' }}>
                          Filter by Type
                        </label>
                        <select
                          value={transactionFilter}
                          onChange={(e) => setTransactionFilter(e.target.value)}
                          className="transaction-filter-select"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '1rem',
                            fontFamily: 'Inter, sans-serif',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="All" style={{ background: '#2a3b4c', color: 'white' }}>All Transactions</option>
                          <option value="Credit" style={{ background: '#2a3b4c', color: 'white' }}>Credits Only</option>
                          <option value="Debit" style={{ background: '#2a3b4c', color: 'white' }}>Debits Only</option>
                          <option value="Subscription" style={{ background: '#2a3b4c', color: 'white' }}>Subscriptions Only</option>
                        </select>
                      </div>
                      <div style={{ flex: '1', minWidth: '200px' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#bfc9da', fontSize: '0.9rem' }}>
                          Filter by Category
                        </label>
                        <select
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                          className="transaction-filter-select"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '1rem',
                            fontFamily: 'Inter, sans-serif',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="All" style={{ background: '#2a3b4c', color: 'white' }}>All Categories</option>
                          {Array.from(new Set(csvData.map(tx => tx.Category || 'Other').filter(cat => cat))).sort().map(category => (
                            <option key={category} value={category} style={{ background: '#2a3b4c', color: 'white' }}>{category}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: '2', minWidth: '250px' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#bfc9da', fontSize: '0.9rem' }}>
                          Search
                        </label>
                        <input
                          type="text"
                          value={transactionSearch}
                          onChange={(e) => setTransactionSearch(e.target.value)}
                          placeholder="Search by description..."
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '1rem',
                            fontFamily: 'Inter, sans-serif',
                            outline: 'none'
                          }}
                        />
                      </div>
                      <div style={{ flex: '1', minWidth: '200px' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#bfc9da', fontSize: '0.9rem' }}>
                          Amount Filter
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                          <select
                            value={amountFilterType}
                            onChange={(e) => setAmountFilterType(e.target.value)}
                            className="transaction-filter-select"
                            style={{
                              flex: '1',
                              minWidth: '120px',
                              padding: '0.75rem',
                              background: 'rgba(255, 255, 255, 0.1)',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              borderRadius: '8px',
                              color: 'white',
                              fontSize: '1rem',
                              fontFamily: 'Inter, sans-serif',
                              cursor: 'pointer'
                            }}
                          >
                            <option value="none" style={{ background: '#2a3b4c', color: 'white' }}>No Filter</option>
                            <option value="greater" style={{ background: '#2a3b4c', color: 'white' }}>Greater Than</option>
                            <option value="less" style={{ background: '#2a3b4c', color: 'white' }}>Less Than</option>
                          </select>
                          {amountFilterType !== 'none' && (
                            <input
                              type="number"
                              value={amountFilterValue}
                              onChange={(e) => setAmountFilterValue(e.target.value)}
                              placeholder="Amount..."
                              step="0.01"
                              style={{
                                flex: '1',
                                minWidth: '100px',
                                padding: '0.75rem',
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '8px',
                                color: 'white',
                                fontSize: '1rem',
                                fontFamily: 'Inter, sans-serif',
                                outline: 'none'
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Filtered Transactions */}
                    <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', overflow: 'hidden' }}>
                        <thead>
                          <tr style={{ background: 'rgba(45, 140, 255, 0.2)' }}>
                            <th style={{ padding: '1rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Date</th>
                            <th style={{ padding: '1rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Account</th>
                            <th style={{ padding: '1rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Category</th>
                            <th style={{ padding: '1rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Description</th>
                            <th style={{ padding: '1rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Amount</th>
                            <th style={{ padding: '1rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                    {(() => {
                      const filteredTransactions = csvData.filter((transaction) => {
                        // Apply account filter
                        if (accountFilter !== 'All') {
                          const allAccounts = accountsByDescription[transaction.Description] || [transaction.Account];
                          if (!allAccounts.includes(accountFilter)) {
                            return false;
                          }
                        }
                        
                        // Check if subscription
                        const isSubscription = subscriptions.some(sub => 
                          sub.description.toLowerCase() === transaction.Description.toLowerCase()
                        );
                        const isCredit = transaction.Amount > 0;
                        const isDebit = transaction.Amount < 0;
                        
                        // Apply type filter
                        if (transactionFilter === 'Credit' && !isCredit) return false;
                        if (transactionFilter === 'Debit' && !isDebit) return false;
                        if (transactionFilter === 'Subscription' && !isSubscription) return false;
                        
                        // Apply category filter
                        if (categoryFilter !== 'All') {
                          const txCategory = transaction.Category || 'Other';
                          if (txCategory !== categoryFilter) {
                            return false;
                          }
                        }
                        
                        // Apply search filter
                        if (transactionSearch && !transaction.Description.toLowerCase().includes(transactionSearch.toLowerCase())) {
                          return false;
                        }
                        
                        // Apply amount filter
                        if (amountFilterType !== 'none' && amountFilterValue) {
                          const filterAmount = parseFloat(amountFilterValue);
                          if (!isNaN(filterAmount)) {
                            const absAmount = Math.abs(transaction.Amount);
                            if (amountFilterType === 'greater' && absAmount <= filterAmount) {
                              return false;
                            }
                            if (amountFilterType === 'less' && absAmount >= filterAmount) {
                              return false;
                            }
                          }
                        }
                        
                        return true;
                      });
                      
                      return filteredTransactions.map((transaction, index) => {
                            // Check if this transaction is a subscription
                            const isSubscription = subscriptions.some(sub => 
                              sub.description.toLowerCase() === transaction.Description.toLowerCase()
                            );
                            
                            // Determine transaction type
                            const isCredit = transaction.Amount > 0;
                            const isDebit = transaction.Amount < 0;
                            
                            // Set row background color
                            let rowBgColor = 'transparent';
                            if (isSubscription) {
                              rowBgColor = 'rgba(255, 68, 68, 0.15)'; // Soft red for subscriptions
                            } else if (isCredit) {
                              rowBgColor = 'rgba(76, 175, 80, 0.15)'; // Soft green for credits
                            } else if (isDebit) {
                              rowBgColor = 'rgba(255, 152, 0, 0.15)'; // Soft orange for debits
                            }
                            
                            // Format date for display (already normalized to ISO format)
                            const dateObj = new Date(transaction.Date);
                            const formattedDate = !isNaN(dateObj.getTime()) 
                              ? dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                              : transaction.Date;
                            
                            return (
                              <tr 
                                key={index} 
                                style={{ 
                                  backgroundColor: rowBgColor,
                                  borderBottom: index < filteredTransactions.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
                                  transition: 'background-color 0.2s'
                                }}
                              >
                                <td style={{ padding: '1rem', color: 'white' }}>{formattedDate}</td>
                                <td style={{ padding: '1rem', color: 'white', fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 500 }}>{transaction.Account}</td>
                                <td style={{ padding: '1rem' }}>
                                  {(() => {
                                    const category = transaction.Category || 'Other';
                                    const categoryColor = getCategoryColor(category as Category);
                                    const showClassifying = (category === 'Other' || !category) && isClassifying;
                                    return (
                                      <span style={{
                                        padding: '0.25rem 0.5rem',
                                        borderRadius: '4px',
                                        fontSize: '0.85rem',
                                        fontWeight: 500,
                                        background: showClassifying ? 'rgba(45, 140, 255, 0.2)' : `${categoryColor}20`,
                                        color: showClassifying ? '#2d8cff' : categoryColor,
                                        border: showClassifying ? '1px solid #2d8cff' : `1px solid ${categoryColor}`,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                      }}>
                                        {showClassifying && (
                                          <span style={{
                                            display: 'inline-block',
                                            width: '10px',
                                            height: '10px',
                                            border: '2px solid #2d8cff',
                                            borderTopColor: 'transparent',
                                            borderRadius: '50%',
                                            animation: 'spin 1s linear infinite',
                                          }} />
                                        )}
                                        {showClassifying ? 'Classifying...' : category}
                                      </span>
                                    );
                                  })()}
                                </td>
                                <td style={{ padding: '1rem', color: 'white' }}>{transaction.Description}</td>
                                <td style={{ 
                                  padding: '1rem', 
                                  textAlign: 'right', 
                                  color: isCredit ? '#4cc9f0' : 'white', 
                                  fontWeight: 500 
                                }}>
                                  {transaction.Amount >= 0 ? '+' : ''}{getCurrencySymbol(transaction.Currency)}{Math.abs(transaction.Amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td style={{ padding: '1rem', textAlign: 'right', color: 'white', fontWeight: 500 }}>
                                  {transaction.Balance !== undefined && transaction.Balance !== 0 
                                    ? `${getCurrencySymbol(transaction.Currency)}${transaction.Balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                                    : '-'}
                                </td>
                              </tr>
                            );
                          });
                    })()}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p style={{ marginTop: '2rem', color: '#888' }}>No data loaded. Please upload a CSV file.</p>
                )}
              </div>
            )}
            {activeTab === 'Account (soon)' && (
              <div className="tab-placeholder"><h2>Account</h2><p>Account management features coming soon.</p></div>
            )}
            {activeTab === 'About' && (
              <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 0', width: '100%' }}>
                {/* Hero Section */}
                <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
                  <h1 style={{ fontSize: '3rem', fontWeight: 700, marginBottom: '1.5rem', background: 'linear-gradient(90deg, var(--brand-primary), var(--brand-accent))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                    Financial freedom for everyone, not just the few
                  </h1>
                  <p style={{ fontSize: '1.3rem', color: '#bfc9da', lineHeight: '1.6' }}>
                    We're building a world where expert financial advice isn't a luxury—it's a right.
                  </p>
                </div>

                {/* NDRC Badge */}
                <div style={{ textAlign: 'center', marginBottom: '4rem', padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                  <img src="/ndrc.png" alt="NDRC" style={{ maxWidth: '200px', height: 'auto', marginBottom: '1rem' }} />
                  <div style={{ fontSize: '0.95rem', color: '#bfc9da' }}>NDRC Pre-Accelerator Graduate</div>
                  <div style={{ fontSize: '0.9rem', color: '#888', marginTop: '0.3rem' }}>Autumn 2025 Cohort</div>
                </div>

                {/* Mission Section */}
                <div style={{ marginBottom: '4rem' }}>
                  <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>Our Mission</h2>
                  <p style={{ fontSize: '1.1rem', color: '#bfc9da', lineHeight: '1.8', marginBottom: '2rem' }}>
                    Broc makes expert financial advice accessible for everyone. We put real people, not just the wealthy, at the centre of better financial decisions—combining clear, practical insights with agentic AI support.
                  </p>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginTop: '2rem' }}>
                    <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💡</div>
                      <div style={{ fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>Cut Through Jargon</div>
                      <div style={{ color: '#bfc9da', fontSize: '0.95rem' }}>Plain English explanations that actually make sense</div>
                    </div>
                    <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🤝</div>
                      <div style={{ fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>Transparent Marketplace</div>
                      <div style={{ color: '#bfc9da', fontSize: '0.95rem' }}>Brokers and providers compete fairly for your business</div>
                    </div>
                    <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✨</div>
                      <div style={{ fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>AI That Acts for You</div>
                      <div style={{ color: '#bfc9da', fontSize: '0.95rem' }}>Save time and money with seamless, proactive support</div>
                    </div>
                    <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎯</div>
                      <div style={{ fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>We Only Win When You Win</div>
                      <div style={{ color: '#bfc9da', fontSize: '0.95rem' }}>Broc only profits when we deliver real value. No hidden fees, no conflicts of interest—just aligned incentives that put you first</div>
                    </div>
                  </div>
                </div>

                {/* Founding Team Section */}
                <div style={{ marginBottom: '4rem' }}>
                  <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1rem', color: 'white' }}>The Founding Team</h2>
                  <p style={{ fontSize: '1.1rem', color: '#bfc9da', lineHeight: '1.8', marginBottom: '2rem' }}>
                    The Broc Founding Team
                  </p>
                  <p style={{ fontSize: '1rem', color: '#bfc9da', lineHeight: '1.8', marginBottom: '3rem' }}>
                    Barry, Stephen, and Ru bring a rare combination of hyperscale tech infrastructure, financial systems expertise, and consumer product experience. Together, they're uniquely positioned to build AI that makes professional financial advice and action accessible to everyone.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
                    <div style={{ padding: '2rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>Barry / Co-Founder</div>
                      <p style={{ color: '#bfc9da', lineHeight: '1.7', marginBottom: '1rem', fontSize: '0.95rem' }}>
                        A decade at Google in Strategic Revenue Operations and Product Ownership, founder of Kindora (TechStars '21), and Director of Business Intelligence at StoryToys. Barry brings deep experience building scalable AI systems and taking them from concept to market.
                      </p>
                      <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none', fontWeight: 500 }}>
                        LinkedIn →
                      </a>
                    </div>
                    <div style={{ padding: '2rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>Stephen / Co-Founder</div>
                      <p style={{ color: '#bfc9da', lineHeight: '1.7', marginBottom: '1rem', fontSize: '0.95rem' }}>
                        Stephen spent 17 years at Google. His work spanned software engineering, financial analysis, data science, machine learning, and product management, most recently leading product areas for Google's hyperscale software deployment infrastructure. With degrees in Software Engineering and Evolutionary Biology, he brings a rare ability to bridge deep technical complexity with human-centered product design.
                      </p>
                      <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none', fontWeight: 500 }}>
                        LinkedIn →
                      </a>
                    </div>
                    <div style={{ padding: '2rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>Ru / Co-Founder</div>
                      <p style={{ color: '#bfc9da', lineHeight: '1.7', marginBottom: '1rem', fontSize: '0.95rem' }}>
                        Early team member at Kinzen and Boxever, New Frontiers alumnus, with product and analytics experience at AIB, Sitecore, and Optum. His M.Sc. in Analytics and B.Sc. in Mathematics underpin deep expertise in data science and machine learning, combining startup execution speed with financial services expertise.
                      </p>
                      <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none', fontWeight: 500 }}>
                        LinkedIn →
                      </a>
                    </div>
                  </div>
                </div>

                {/* CTA Section */}
                <div style={{ textAlign: 'center', padding: '3rem 2rem', background: 'rgba(45, 140, 255, 0.1)', borderRadius: '16px', border: '1px solid rgba(45, 140, 255, 0.3)' }}>
                  <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1rem', color: 'white' }}>
                    Ready to take control of your financial future?
                  </h2>
                  <button 
                    className="optimize-btn" 
                    style={{ marginTop: '1.5rem', padding: '1rem 2rem', fontSize: '1.1rem' }}
                    onClick={() => {
                      trackButtonClick('Join Waitlist', { location: 'about_page' });
                      window.open('https://broc.fi', '_blank');
                    }}
                  >
                    Join the Waitlist
                  </button>
                </div>
              </div>
            )}
            {activeTab === 'Privacy Policy' && (
              <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 0', width: '100%' }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '2rem', color: 'white' }}>
                  Privacy Policy
                </h1>
                <p style={{ fontSize: '0.95rem', color: '#888', marginBottom: '3rem' }}>
                  Last Updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>

                <div style={{ fontSize: '1.05rem', lineHeight: '1.8', color: '#bfc9da' }}>
                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      1. Data Controller
                    </h2>
                    <p style={{ marginBottom: '1rem' }}>
                      The data controller for Downsell is <strong style={{ color: 'white' }}>Broc.fi</strong> (referred to as "we", "us", or "our").
                    </p>
                    <p>
                      <strong style={{ color: 'white' }}>Contact Information:</strong><br />
                      Email: ruairi@broc.fi<br />
                      Website: <a href="https://broc.fi" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none' }}>https://broc.fi</a><br />
                      Source Code: <a href="https://github.com/ruhickson/downsell" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none' }}>https://github.com/ruhickson/downsell</a>
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      2. Purpose of Data Processing
                    </h2>
                    <p style={{ marginBottom: '1rem' }}>
                      Downsell is a free, client-side financial analysis tool designed to help you understand your spending patterns and identify recurring subscriptions. When you upload a CSV file containing your bank statement data, we process it to:
                    </p>
                    <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
                      <li>Identify recurring transactions and potential subscriptions</li>
                      <li>Analyze spending patterns over time</li>
                      <li>Generate visualizations and reports of your financial data</li>
                      <li>Provide insights to help you make informed decisions about your finances</li>
                    </ul>
                    <p>
                      <strong style={{ color: 'white' }}>Important:</strong> All data processing occurs entirely within your web browser. Your financial data never leaves your device and is not transmitted to our servers.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      3. Legal Basis for Processing
                    </h2>
                    <p>
                      Under the General Data Protection Regulation (GDPR), we process your data based on <strong style={{ color: 'white' }}>legitimate interests</strong> (Article 6(1)(f) GDPR). Our legitimate interest is to provide a free, public utility that helps individuals better understand their financial spending patterns. We also process data based on your <strong style={{ color: 'white' }}>consent</strong> when you choose to upload and analyze your CSV file.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      4. Data Storage and Processing
                    </h2>
                    <p style={{ marginBottom: '1rem' }}>
                      No financial data is stored permanently. No personal data is sent to servers. Your privacy is protected.
                    </p>
                    
                    {/* Privacy & Data Processing Diagram */}
                    <div style={{ 
                      marginBottom: '2rem', 
                      padding: '2rem', 
                      background: 'rgba(45, 140, 255, 0.1)', 
                      borderRadius: '12px', 
                      border: '1px solid rgba(45, 140, 255, 0.3)',
                      textAlign: 'center'
                    }}>
                      <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                        🔒 Your Data Never Leaves Your Device
                      </h3>
                      <div style={{ 
                        display: 'flex', 
                        flexWrap: 'wrap', 
                        justifyContent: 'center', 
                        alignItems: 'center', 
                        gap: '1rem',
                        marginBottom: '1rem'
                      }}>
                        <div style={{ 
                          padding: '1.5rem', 
                          background: 'rgba(255, 255, 255, 0.1)', 
                          borderRadius: '8px',
                          minWidth: '150px',
                          flex: '1',
                          maxWidth: '200px'
                        }}>
                          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📤</div>
                          <div style={{ fontWeight: 600, color: 'white', marginBottom: '0.3rem' }}>1. Upload CSV</div>
                          <div style={{ fontSize: '0.9rem', color: '#bfc9da' }}>You upload your bank statement CSV file</div>
                        </div>
                        <div style={{ fontSize: '1.5rem', color: '#2d8cff' }}>→</div>
                        <div style={{ 
                          padding: '1.5rem', 
                          background: 'rgba(255, 255, 255, 0.1)', 
                          borderRadius: '8px',
                          minWidth: '150px',
                          flex: '1',
                          maxWidth: '200px'
                        }}>
                          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚙️</div>
                          <div style={{ fontWeight: 600, color: 'white', marginBottom: '0.3rem' }}>2. Process in Memory</div>
                          <div style={{ fontSize: '0.9rem', color: '#bfc9da' }}>File processed entirely in your browser's memory</div>
                        </div>
                        <div style={{ fontSize: '1.5rem', color: '#2d8cff' }}>→</div>
                        <div style={{ 
                          padding: '1.5rem', 
                          background: 'rgba(255, 255, 255, 0.1)', 
                          borderRadius: '8px',
                          minWidth: '150px',
                          flex: '1',
                          maxWidth: '200px'
                        }}>
                          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
                          <div style={{ fontWeight: 600, color: 'white', marginBottom: '0.3rem' }}>3. Generate Output</div>
                          <div style={{ fontSize: '0.9rem', color: '#bfc9da' }}>Analysis, charts, and reports created</div>
                        </div>
                        <div style={{ fontSize: '1.5rem', color: '#2d8cff' }}>→</div>
                        <div style={{ 
                          padding: '1.5rem', 
                          background: 'rgba(255, 255, 255, 0.1)', 
                          borderRadius: '8px',
                          minWidth: '150px',
                          flex: '1',
                          maxWidth: '200px'
                        }}>
                          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗑️</div>
                          <div style={{ fontWeight: 600, color: 'white', marginBottom: '0.3rem' }}>4. Auto-Deleted</div>
                          <div style={{ fontSize: '0.9rem', color: '#bfc9da' }}>File automatically cleared when you close the browser</div>
                        </div>
                      </div>
                      <p style={{ 
                        marginTop: '1.5rem', 
                        fontSize: '1.1rem', 
                        fontWeight: 600, 
                        color: '#2d8cff',
                        padding: '1rem',
                        background: 'rgba(45, 140, 255, 0.15)',
                        borderRadius: '8px'
                      }}>
                        ✅ No financial data is stored permanently. No personal data is sent to servers. Your privacy is protected.
                      </p>
                    </div>

                    <p style={{ marginBottom: '1rem' }}>
                      <strong style={{ color: 'white' }}>Client-Side Processing Only:</strong>
                    </p>
                    <ul style={{ marginLeft: '1.5rem', marginBottom: '1.5rem' }}>
                      <li>Your CSV file and all transaction data are processed entirely within your web browser</li>
                      <li>No financial data is stored on our servers</li>
                      <li>No financial data is transmitted to our servers or any third-party services</li>
                      <li>Your data remains on your device and is cleared when you close your browser (unless you choose to keep it in browser storage)</li>
                    </ul>
                    <p style={{ marginBottom: '1rem' }}>
                      <strong style={{ color: 'white' }}>Local Storage (Statistics Only):</strong>
                    </p>
                    <p style={{ marginBottom: '1rem' }}>
                      We use your browser's local storage to maintain anonymous usage statistics, including:
                    </p>
                    <ul style={{ marginLeft: '1.5rem', marginBottom: '1.5rem' }}>
                      <li>Number of CSV files uploaded (aggregate count only)</li>
                      <li>Number of transactions analyzed (aggregate count only)</li>
                      <li>Number of PDF reports generated (aggregate count only)</li>
                    </ul>
                    <p>
                      <strong style={{ color: 'white' }}>No personal or financial data is stored.</strong> These statistics are anonymous and cannot be used to identify you or your financial information.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      5. Automated Processing
                    </h2>
                    <p style={{ marginBottom: '1rem' }}>
                      Downsell uses automated algorithms to:
                    </p>
                    <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
                      <li>Parse and analyze CSV files</li>
                      <li>Identify recurring transactions based on amount, frequency, and description patterns</li>
                      <li>Calculate spending statistics and trends</li>
                      <li>Generate visualizations and reports</li>
                    </ul>
                    <p>
                      All automated processing occurs client-side in your browser. We do not use artificial intelligence or machine learning models that process your data on external servers.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      6. Data Retention
                    </h2>
                    <p style={{ marginBottom: '1rem' }}>
                      <strong style={{ color: 'white' }}>Financial Data:</strong> Your CSV data and transaction information are not retained by us. They exist only in your browser's memory during your session and are cleared when you close your browser tab or refresh the page.
                    </p>
                    <p>
                      <strong style={{ color: 'white' }}>Usage Statistics:</strong> Anonymous usage statistics stored in your browser's local storage are retained indefinitely unless you clear your browser's local storage. You can clear this data at any time through your browser settings.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      7. Your Rights Under GDPR
                    </h2>
                    <p style={{ marginBottom: '1.5rem' }}>
                      As a data subject under GDPR, you have the following rights:
                    </p>
                    <ul style={{ marginLeft: '1.5rem', marginBottom: '1.5rem' }}>
                      <li><strong style={{ color: 'white' }}>Right of Access (Article 15):</strong> You can request information about what data we process. Since we don't store your financial data, there is no personal data to access.</li>
                      <li><strong style={{ color: 'white' }}>Right to Rectification (Article 16):</strong> Not applicable, as we don't store your financial data.</li>
                      <li><strong style={{ color: 'white' }}>Right to Erasure (Article 17):</strong> You can request deletion of any stored data. To delete anonymous usage statistics, clear your browser's local storage.</li>
                      <li><strong style={{ color: 'white' }}>Right to Restrict Processing (Article 18):</strong> You can stop using the service at any time by closing your browser.</li>
                      <li><strong style={{ color: 'white' }}>Right to Data Portability (Article 20):</strong> Not applicable, as we don't store your financial data.</li>
                      <li><strong style={{ color: 'white' }}>Right to Object (Article 21):</strong> You can object to processing by not using the service.</li>
                      <li><strong style={{ color: 'white' }}>Right to Withdraw Consent (Article 7):</strong> You can withdraw consent at any time by closing your browser and clearing local storage.</li>
                    </ul>
                    <p>
                      <strong style={{ color: 'white' }}>How to Exercise Your Rights:</strong> To request deletion of usage statistics or exercise any other rights, please contact us at <a href="mailto:ruairi@broc.fi" style={{ color: '#2d8cff', textDecoration: 'none' }}>ruairi@broc.fi</a>. You can also clear your browser's local storage directly through your browser settings.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      8. Third-Party Processors
                    </h2>
                    <p style={{ marginBottom: '1rem' }}>
                      <strong style={{ color: 'white' }}>Hosting Provider:</strong>
                    </p>
                    <p style={{ marginLeft: '1.5rem', marginBottom: '1.5rem' }}>
                      Our application is hosted by <strong style={{ color: 'white' }}>Netlify</strong> (Netlify, Inc., 44 Montgomery Street, Suite 750, San Francisco, CA 94104, USA). Netlify may process technical data (IP addresses, request logs) necessary for hosting the application. Netlify is GDPR-compliant and processes data in accordance with their privacy policy: <a href="https://www.netlify.com/privacy/" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none' }}>https://www.netlify.com/privacy/</a>
                    </p>
                    <p style={{ marginBottom: '1rem' }}>
                      <strong style={{ color: 'white' }}>No Data Sharing:</strong>
                    </p>
                    <p>
                      We do not share, sell, or transfer your financial data to any third parties. Your CSV data and transaction information never leave your browser and are not accessible to Netlify or any other third-party service.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      9. Cookies and Tracking
                    </h2>
                    <p style={{ marginBottom: '1rem' }}>
                      <strong style={{ color: 'white' }}>Local Storage:</strong> We use your browser's local storage (not cookies) to store anonymous usage statistics and category caching. This data is stored locally on your device and is not transmitted to our servers.
                    </p>
                    <p style={{ marginBottom: '1rem' }}>
                      <strong style={{ color: 'white' }}>Netlify Analytics:</strong> We use Netlify Analytics to collect aggregate, anonymized usage statistics about how visitors interact with our site. Netlify Analytics uses cookies to track page views and user interactions. This helps us understand which features are most used and improve the user experience. Netlify Analytics is privacy-focused and does not collect personally identifiable information. For more information, see <a href="https://www.netlify.com/legal/privacy/" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none' }}>Netlify's Privacy Policy</a>.
                    </p>
                    <p style={{ marginBottom: '1rem' }}>
                      <strong style={{ color: 'white' }}>Cookie Consent:</strong> When you first visit our site, we will ask for your consent to use analytics cookies. You can accept or reject these cookies. Your choice will be remembered for future visits. You can change your cookie preferences at any time by clearing your browser's local storage.
                    </p>
                    <p>
                      <strong style={{ color: 'white' }}>No Third-Party Analytics:</strong> We do not use Google Analytics, Facebook Pixel, or any other third-party analytics services beyond Netlify Analytics.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      10. Data Security
                    </h2>
                    <p style={{ marginBottom: '1rem' }}>
                      Since all data processing occurs client-side in your browser, your financial data is protected by:
                    </p>
                    <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
                      <li>Your browser's built-in security features</li>
                      <li>The fact that data never leaves your device</li>
                      <li>No server-side storage means no risk of data breaches on our servers</li>
                    </ul>
                    <p>
                      We recommend using a secure, up-to-date web browser and clearing your browser data after each session if you're using a shared or public computer.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      11. International Data Transfers
                    </h2>
                    <p>
                      Since your financial data is processed entirely within your browser and never transmitted to our servers, there are no international data transfers of your financial information. Our hosting provider (Netlify) may process technical data (IP addresses) in the United States, but this does not include any of your financial or transaction data.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      12. Children's Privacy
                    </h2>
                    <p>
                      Downsell is not intended for use by individuals under the age of 18. We do not knowingly collect or process data from children. If you are a parent or guardian and believe your child has provided us with data, please contact us at <a href="mailto:ruairi@broc.fi" style={{ color: '#2d8cff', textDecoration: 'none' }}>ruairi@broc.fi</a>.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      13. Changes to This Privacy Policy
                    </h2>
                    <p>
                      We may update this Privacy Policy from time to time. We will notify you of any material changes by updating the "Last Updated" date at the top of this policy. We encourage you to review this Privacy Policy periodically to stay informed about how we protect your privacy.
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      14. Supervisory Authority
                    </h2>
                    <p>
                      If you are located in the European Economic Area (EEA) and believe we have not addressed your privacy concerns, you have the right to lodge a complaint with your local data protection supervisory authority. For Ireland, this is the Data Protection Commission (<a href="https://www.dataprotection.ie" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none' }}>www.dataprotection.ie</a>).
                    </p>
                  </section>

                  <section style={{ marginBottom: '3rem', padding: '2rem', background: 'rgba(45, 140, 255, 0.1)', borderRadius: '12px', border: '1px solid rgba(45, 140, 255, 0.3)' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '1.5rem', color: 'white' }}>
                      15. Contact Us
                    </h2>
                    <p style={{ marginBottom: '1rem' }}>
                      If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
                    </p>
                    <p>
                      <strong style={{ color: 'white' }}>Email:</strong> <a href="mailto:ruairi@broc.fi" style={{ color: '#2d8cff', textDecoration: 'none' }}>ruairi@broc.fi</a><br />
                      <strong style={{ color: 'white' }}>Website:</strong> <a href="https://broc.fi" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none' }}>https://broc.fi</a><br />
                      <strong style={{ color: 'white' }}>Source Code:</strong> <a href="https://github.com/ruhickson/downsell" target="_blank" rel="noopener noreferrer" style={{ color: '#2d8cff', textDecoration: 'none' }}>https://github.com/ruhickson/downsell</a>
                    </p>
                  </section>
                </div>
              </div>
            )}
          </main>
        </div>
        {/* Overlay for mobile sidebar */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        
        {/* Waitlist Modal */}
        {showWaitlistModal && (
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              padding: '1rem'
            }}
            onClick={() => setShowWaitlistModal(false)}
          >
            <div 
              style={{
                background: 'linear-gradient(135deg, #1a2332 0%, #2a3b4c 100%)',
                borderRadius: '16px',
                padding: '2.5rem',
                maxWidth: '500px',
                width: '100%',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                border: '2px solid rgba(45, 140, 255, 0.3)',
                position: 'relative',
                textAlign: 'center'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setShowWaitlistModal(false)}
                style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: 'white',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                ×
              </button>
              
              {/* Logo */}
              <div style={{ marginBottom: '1.5rem' }}>
                <img 
                  src="/broc_favicon1.png" 
                  alt="Broc.fi Logo" 
                  style={{ 
                    width: '120px', 
                    height: '120px', 
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))'
                  }} 
                />
              </div>
              
              {/* Text */}
              <p style={{
                color: 'white',
                fontSize: '1.1rem',
                lineHeight: 1.6,
                marginBottom: '1.5rem',
                fontWeight: 400
              }}>
                Psst, if you want the ultimate advantage in autonomous, agentic personal financial management, sign up here
              </p>
              
              {/* Email Input */}
              <input
                type="email"
                value={waitlistEmail}
                onChange={(e) => setWaitlistEmail(e.target.value)}
                placeholder="Enter your email address"
                style={{
                  width: '100%',
                  padding: '0.875rem 1rem',
                  borderRadius: '8px',
                  border: '2px solid rgba(255, 255, 255, 0.2)',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: '1rem',
                  marginBottom: '1.5rem',
                  outline: 'none',
                  transition: 'all 0.3s ease',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#2d8cff';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                }}
              />
              
              {/* Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Sign up Button */}
                <button
                  onClick={async () => {
                    if (waitlistEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail)) {
                      trackButtonClick('Sign Up', { location: 'waitlist_modal', email: waitlistEmail });
                      
                      try {
                        // Call Netlify Function to add to Google Sheet
                        const response = await fetch('/.netlify/functions/signup-waitlist', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({ email: waitlistEmail }),
                        });

                        if (response.ok) {
                          const result = await response.json();
                          // Success (including duplicates) - close modal and show thank you message
                          if (result.duplicate) {
                            // Email already on waitlist - still show success
                            console.log('Email already on waitlist');
                          }
                          setShowWaitlistModal(false);
                          setWaitlistEmail('');
                          // Show thank you message
                          setShowThankYou(true);
                          // Hide message after 3 seconds
                          setTimeout(() => {
                            setShowThankYou(false);
                          }, 3000);
                        } else {
                          // Error - show alert
                          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                          console.error('Failed to add signup to waitlist:', errorData);
                          alert('There was an error adding you to the waitlist. Please try again.');
                        }
                      } catch (error) {
                        // Network error
                        console.error('Error signing up:', error);
                        alert('There was an error adding you to the waitlist. Please try again.');
                      }
                    }
                  }}
                  disabled={!waitlistEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail)}
                  style={{
                    background: waitlistEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail)
                      ? 'linear-gradient(135deg, #2d8cff 0%, #1a5fcc 100%)'
                      : 'rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    border: 'none',
                    padding: '1rem 2rem',
                    borderRadius: '8px',
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    cursor: waitlistEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail) ? 'pointer' : 'not-allowed',
                    width: '100%',
                    boxShadow: waitlistEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail)
                      ? '0 4px 12px rgba(45, 140, 255, 0.4)'
                      : 'none',
                    transition: 'all 0.3s ease',
                    opacity: waitlistEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail) ? 1 : 0.5
                  }}
                  onMouseEnter={(e) => {
                    if (waitlistEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail)) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(45, 140, 255, 0.6)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (waitlistEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail)) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(45, 140, 255, 0.4)';
                    }
                  }}
                >
                  Sign up
                </button>
                
                {/* What is Broc? Button */}
                <button
                  onClick={() => {
                    trackButtonClick('What is Broc?', { location: 'waitlist_modal' });
                    window.open('https://broc.fi', '_blank');
                  }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    padding: '0.875rem 2rem',
                    borderRadius: '8px',
                    fontSize: '1rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    width: '100%',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  }}
                >
                  What is Broc?
                </button>
                
                {/* I'm already signed up Button */}
                <button
                  onClick={() => {
                    trackButtonClick('Already Signed Up', { location: 'waitlist_modal' });
                    setShowWaitlistModal(false);
                    setWaitlistEmail('');
                  }}
                  style={{
                    background: 'transparent',
                    color: '#bfc9da',
                    border: 'none',
                    padding: '0.75rem 2rem',
                    borderRadius: '8px',
                    fontSize: '0.95rem',
                    fontWeight: 400,
                    cursor: 'pointer',
                    width: '100%',
                    transition: 'all 0.3s ease',
                    textDecoration: 'underline'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'white';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#bfc9da';
                  }}
                >
                  I'm already signed up
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Cookie Consent Banner */}
        {showCookieBanner && (
          <div 
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'linear-gradient(135deg, #1a2332 0%, #2a3b4c 100%)',
              borderTop: '2px solid rgba(45, 140, 255, 0.3)',
              padding: '1.5rem',
              zIndex: 10001,
              boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              maxWidth: '100%'
            }}
          >
            <div style={{ flex: '1', minWidth: '300px' }}>
              <p style={{ 
                color: 'white', 
                margin: 0, 
                marginBottom: '0.5rem',
                fontSize: '1rem',
                fontWeight: 600
              }}>
                🍪 Cookie Consent
              </p>
              <p style={{ 
                color: '#bfc9da', 
                margin: 0, 
                fontSize: '0.9rem',
                lineHeight: 1.5
              }}>
                We use Netlify Analytics cookies to collect aggregate, anonymized usage statistics to improve our site. 
                This helps us understand how visitors use Downsell. No personally identifiable information is collected. 
                <a 
                  href="#privacy" 
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveTab('Privacy Policy');
                    setShowCookieBanner(false);
                  }}
                  style={{ color: '#2d8cff', textDecoration: 'none', marginLeft: '0.25rem' }}
                >
                  Learn more
                </a>
              </p>
            </div>
            <div style={{ 
              display: 'flex', 
              gap: '0.75rem',
              flexWrap: 'wrap'
            }}>
              <button
                onClick={handleRejectCookies}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: 'white',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '8px',
                  fontSize: '0.95rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                Reject
              </button>
              <button
                onClick={handleAcceptCookies}
                style={{
                  background: 'linear-gradient(135deg, #2d8cff 0%, #1a5fcc 100%)',
                  border: 'none',
                  color: 'white',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '8px',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(45, 140, 255, 0.4)',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(45, 140, 255, 0.6)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(45, 140, 255, 0.4)';
                }}
              >
                Accept
              </button>
            </div>
          </div>
        )}
        
        {/* Thank You Message */}
        {showThankYou && (
          <div
            style={{
              position: 'fixed',
              bottom: '2rem',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'linear-gradient(135deg, #2d8cff 0%, #1a5fcc 100%)',
              color: 'white',
              padding: '1.5rem 2.5rem',
              borderRadius: '12px',
              fontSize: '1.5rem',
              fontWeight: 600,
              zIndex: 10002,
              boxShadow: '0 8px 24px rgba(45, 140, 255, 0.5)',
              animation: 'slideUp 0.5s ease-out, fadeOut 0.5s ease-in 2.5s',
              animationFillMode: 'forwards',
              pointerEvents: 'none'
            }}
          >
            thank you! &lt;3
          </div>
        )}
      </div>
  );
};

export default App;
