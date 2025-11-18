import React, { useState, useMemo } from 'react';
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

type Transaction = {
  Description?: string;
  description?: string;
  Amount?: string;
  amount?: string;
  Type?: string;
  type?: string;
  Date?: string;
  date?: string;
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

function analyzeBankStatement(data: Transaction[]): Subscription[] {
  const transactionsByDescription: Record<string, any> = {};
  data.forEach((transaction) => {
    // Detect bank format
    const keys = Object.keys(transaction);
    const isAIB = keys.some(k => 
      k.includes('Posted Account') || 
      k.includes('Posted Transactions Date') || 
      k.includes('Description1')
    );
    
    // Extract description
    let description = '';
    if (isAIB) {
      // AIB: concatenate Description1, Description2, Description3
      const desc1Key = keys.find(k => k.trim() === 'Description1' || k.includes('Description1'));
      const desc2Key = keys.find(k => k.trim() === 'Description2' || k.includes('Description2'));
      const desc3Key = keys.find(k => k.trim() === 'Description3' || k.includes('Description3'));
      
      const desc1 = desc1Key ? (transaction as any)[desc1Key] || '' : '';
      const desc2 = desc2Key ? (transaction as any)[desc2Key] || '' : '';
      const desc3 = desc3Key ? (transaction as any)[desc3Key] || '' : '';
      description = [desc1, desc2, desc3].filter(d => d && String(d).trim()).join(' ').trim();
    } else {
      // Revolut: single Description field
      description = transaction.Description || transaction.description || '';
    }
    
    // Extract amount
    let amount = 0;
    if (isAIB) {
      // AIB: use Debit Amount (negative) or Credit Amount (positive)
      const debitKey = keys.find(k => k.trim() === 'Debit Amount' || k.includes('Debit Amount'));
      const creditKey = keys.find(k => k.trim() === 'Credit Amount' || k.includes('Credit Amount'));
      
      const debitAmount = debitKey ? (transaction as any)[debitKey] : '';
      const creditAmount = creditKey ? (transaction as any)[creditKey] : '';
      
      if (debitAmount && String(debitAmount).trim()) {
        amount = -parseFloat(String(debitAmount).replace(/,/g, ''));
      } else if (creditAmount && String(creditAmount).trim()) {
        amount = parseFloat(String(creditAmount).replace(/,/g, ''));
      }
    } else {
      // Revolut: single Amount field (already signed)
      amount = parseFloat(transaction.Amount || transaction.amount || '0');
    }
    
    // Extract transaction type
    let type = '';
    if (isAIB) {
      const typeKey = keys.find(k => k.trim() === 'Transaction Type' || k.includes('Transaction Type'));
      type = typeKey ? String((transaction as any)[typeKey] || '').toUpperCase() : '';
    } else {
      type = (transaction.Type || transaction.type || '').toUpperCase();
    }
    
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
    // Extract date
    let date = '';
    if (isAIB) {
      const dateKey = keys.find(k => k.trim() === 'Posted Transactions Date' || k.includes('Posted Transactions Date'));
      date = dateKey ? (transaction as any)[dateKey] || '' : '';
    } else {
      date = (transaction as any)['Completed Date'] ||
      (transaction as any)['Started Date'] ||
      transaction.Date ||
             transaction.date || '';
    }
    if (date) {
      // Parse date based on format
      let transactionDate: Date;
      try {
        if (isAIB && date.includes('/')) {
          // AIB format: DD/MM/YYYY
          const [day, month, year] = date.split('/');
          transactionDate = new Date(`${year}-${month}-${day}`);
        } else if (date.includes('-') && date.includes(' ')) {
          // Revolut format: YYYY-MM-DD HH:MM:SS
          transactionDate = new Date(date);
        } else {
          transactionDate = new Date(date);
        }
        
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
function incrementStat(key: string, amount = 1) {
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [frequencyFilter, setFrequencyFilter] = useState<string>('All');
  const [transactionFilter, setTransactionFilter] = useState<string>('All');
  const [transactionSearch, setTransactionSearch] = useState<string>('');
  const [amountFilterType, setAmountFilterType] = useState<string>('none');
  const [amountFilterValue, setAmountFilterValue] = useState<string>('');
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
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<Transaction>) => {
        setCsvData(results.data as Transaction[]);
        setSubscriptions(analyzeBankStatement(results.data as Transaction[]));
        incrementStat('files_uploaded');
        incrementStat('rows_analyzed', (results.data as Transaction[]).length);
      },
    });
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

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
      Papa.parse(e.dataTransfer.files[0], {
        header: true,
        skipEmptyLines: true,
        complete: (results: Papa.ParseResult<Transaction>) => {
          setCsvData(results.data as Transaction[]);
          setSubscriptions(analyzeBankStatement(results.data as Transaction[]));
          incrementStat('files_uploaded');
          incrementStat('rows_analyzed', (results.data as Transaction[]).length);
        },
      });
    }
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

  const totalOutgoing = useMemo(() => {
    return csvData.reduce((sum, tx) => {
      const amount = parseFloat(tx.Amount || tx.amount || '0');
      return amount < 0 ? sum + Math.abs(amount) : sum;
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
      const amount = parseFloat(tx.Amount || tx.amount || '0');
      if (amount >= 0) return;
      const dateStr = ((tx as any)['Completed Date'] || (tx as any)['Started Date'] || tx.Date || tx.date || '').toString();
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const day = date.getDate();
        dayTotals[day - 1] += Math.abs(amount);
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

  // Map: description -> { dates: Date[], amounts: number[] }
  const subscriptionRawData = useMemo(() => {
    const map: Record<string, { dates: Date[]; amounts: number[] }> = {};
    csvData.forEach((tx) => {
      const description = tx.Description || tx.description || '';
      const amount = parseFloat(tx.Amount || tx.amount || '0');
      if (amount >= 0) return;
      const dateStr = ((tx as any)['Completed Date'] || (tx as any)['Started Date'] || tx.Date || tx.date || '').toString();
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        if (!map[description]) map[description] = { dates: [], amounts: [] };
        map[description].dates.push(date);
        map[description].amounts.push(amount);
      }
    });
    return map;
  }, [csvData]);

  // Identify high-confidence subscriptions (same price for 6 months straight)
  const highConfidenceSubscriptions = useMemo(() => {
    return subscriptions.filter((sub) => {
    const raw = subscriptionRawData[sub.description] || { dates: [], amounts: [] };
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
    
    // Process all transactions
    csvData.forEach((tx) => {
      const amount = parseFloat(tx.Amount || tx.amount || '0');
      if (amount >= 0) return; // Only outgoing transactions
      
      const dateStr = ((tx as any)['Completed Date'] || (tx as any)['Started Date'] || tx.Date || tx.date || '').toString();
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return;
      
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
    
    // Three paragraphs
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    
    const paragraph1 = 'This comprehensive analysis examines your bank statement transactions to identify recurring payments and subscription patterns. By analyzing transaction frequency, amounts, and descriptions, the system categorizes potential subscriptions and calculates confidence scores based on payment regularity, consistency, and subscription-related keywords. The analysis filters out one-time transactions and transfers to focus on recurring expenses that may represent ongoing subscriptions or services.';
    const paragraph2 = 'The system evaluates each transaction group by calculating statistical measures including average payment amounts, standard deviation, and payment frequency. Transactions are classified by frequency labels such as Daily, Weekly, Monthly, Quarterly, or Irregular based on the time span and number of occurrences. This helps distinguish between true recurring subscriptions and occasional purchases, providing you with a clear picture of your ongoing financial commitments.';
    const paragraph3 = 'The analysis also tracks spending patterns over time, comparing total outgoing expenses against identified subscription costs. This enables you to understand what portion of your spending is dedicated to recurring services versus one-time purchases. By identifying these patterns, you can make informed decisions about which subscriptions to keep, optimize, or cancel to better manage your finances and reduce unnecessary recurring expenses.';
    
    const lines1 = doc.splitTextToSize(paragraph1, contentWidth);
    doc.text(lines1, margin, y);
    y += lines1.length * 14 + 12;
    
    const lines2 = doc.splitTextToSize(paragraph2, contentWidth);
    doc.text(lines2, margin, y);
    y += lines2.length * 14 + 12;
    
    const lines3 = doc.splitTextToSize(paragraph3, contentWidth);
    doc.text(lines3, margin, y);
    y += lines3.length * 14 + 25;
    
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
    
    // Table header
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(45, 140, 255);
    const col1 = margin;
    const col2 = margin + 250;
    const col3 = margin + 380;
    const col4 = margin + 480;
    
    doc.text('Name', col1, y);
    doc.text('Total Spend', col2, y);
    doc.text('Frequency', col3, y);
    doc.text('Payments', col4, y);
    y += 3;
    doc.setDrawColor(45, 140, 255);
    doc.line(margin, y, pageWidth - margin, y);
    y += 12;
    
    // Table rows
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    
    top15Outgoings.forEach((sub, index) => {
      if (y > 750) {
        doc.addPage();
        y = 40;
        // Redraw header
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(45, 140, 255);
        doc.setFontSize(10);
        doc.text('Name', col1, y);
        doc.text('Total Spend', col2, y);
        doc.text('Frequency', col3, y);
        doc.text('Payments', col4, y);
        y += 15;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
      }
      
      const nameLines = doc.splitTextToSize(sub.description, 240);
      doc.text(nameLines, col1, y);
      doc.text(`€${(-sub.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, col2, y);
      doc.text(sub.frequencyLabel, col3, y);
      doc.text(sub.count.toString(), col4, y);
      y += Math.max(nameLines.length * 12, 15);
      
      if (index < top15Outgoings.length - 1) {
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, y - 3, pageWidth - margin, y - 3);
      }
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
      
      // Draw axes
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
        chartCtx.fillText(`€${Math.round(value).toLocaleString()}`, chartX - 10, yPos + 4);
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
              onClick={() => window.open('https://broc.fi', '_blank')}
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
                onClick={() => window.open('https://broc.fi', '_blank')}
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
                  padding: '1rem 1.5rem', 
                  background: 'rgba(255, 255, 255, 0.05)', 
                  border: '1px solid rgba(255, 255, 255, 0.1)', 
                  borderRadius: '12px', 
                  marginBottom: '1.5rem',
                  color: '#bfc9da',
                  fontSize: '0.95rem',
                  lineHeight: '1.6'
                }}>
                  <strong style={{ color: 'white', display: 'block', marginBottom: '0.5rem' }}>🪪 About Downsell</strong>
                  <p style={{ margin: 0 }}>
                    Downsell is an early slice of the <strong>Broc</strong> vision—built to help you understand your finances without the overwhelm.
                  </p>
                  <p style={{ margin: '0.75rem 0 0 0' }}>
                    We know the real solution needs to be automatic. That's what we're building with Broc: A solution that monitors your finances continuously and takes action for you. But right now, especially as payday approaches, Downsell gives you the clarity to see your patterns and plan your next move.
                  </p>
                  <p style={{ margin: '0.75rem 0 0 0' }}>
                    Upload your bank statement (CSV) and get insights in minutes. We recommend 12 months of data for the clearest picture, but shorter periods work too.
                  </p>
                </div>
                <div style={{ 
                  padding: '1rem 1.5rem', 
                  background: 'rgba(45, 140, 255, 0.15)', 
                  border: '1px solid rgba(45, 140, 255, 0.3)', 
                  borderRadius: '12px', 
                  marginBottom: '1.5rem',
                  color: '#bfc9da',
                  fontSize: '0.95rem',
                  lineHeight: '1.6'
                }}>
                  <strong style={{ color: '#2d8cff', display: 'block', marginBottom: '0.5rem' }}>🔒 Your Privacy Matters</strong>
                  <p style={{ margin: 0 }}>
                    All analysis happens entirely on your device. Nothing is stored on our servers or sent anywhere. Your financial data never leaves your browser.
                  </p>
                  <p style={{ margin: '0.75rem 0 0 0' }}>
                    This is a free public tool designed to help everyone understand their finances better.
                  </p>
                </div>
                <div style={{ 
                  padding: '1rem 1.5rem', 
                  background: 'rgba(0, 217, 255, 0.1)', 
                  border: '1px solid rgba(0, 217, 255, 0.3)', 
                  borderRadius: '12px', 
                  marginBottom: '1.5rem',
                  color: '#bfc9da',
                  fontSize: '0.95rem',
                  lineHeight: '1.6'
                }}>
                  <strong style={{ color: '#00d9ff', display: 'block', marginBottom: '0.5rem' }}>🚀 Ready for Financial Autopilot?</strong>
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
                  <strong style={{ color: 'white', display: 'block', marginBottom: '0.5rem' }}>📋 Supported Banks</strong>
                  <p style={{ margin: 0 }}>
                    Downsell currently only works with CSVs exported from <strong>Revolut</strong> and <strong>AIB</strong>, but will be expanding to support more banks in the coming weeks.
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
                    ref={inputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                  />
                  <div className="upload-prompt">
                    {selectedFile ? (
                      <span><b>{selectedFile.name}</b> selected</span>
                    ) : (
                      <span>Drag and drop your CSV here, or <span className="upload-link">click to upload</span></span>
                    )}
                  </div>
                </div>
                {csvData.length > 0 && (
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', justifyContent: 'center' }}>
                    <button 
                      className="optimize-btn" 
                      onClick={() => handleSidebarTabClick('Report')}
                      style={{ padding: '1rem 2rem', fontSize: '1.1rem', flex: '1', maxWidth: '300px' }}
                    >
                      Report
                    </button>
                    <button 
                      onClick={() => handleSidebarTabClick('Actions')}
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
                    <div className="big-number-value">€{totalOutgoing.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                  </div>
                  <div className="big-number-tile">
                    <div className="big-number-label">Subscription Spend</div>
                    <div className="big-number-value">€{totalSubscriptions.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
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
                                callback: (value: any) => `€${value}`
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
                                text: 'Cumulative Average Spend (€)',
                                color: 'white',
                                font: { weight: 'bold' }
                              },
                              ticks: {
                                color: 'white',
                                callback: (value: any) => `€${value}`
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
                                callback: (value: any) => `€${value}`
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
                            <div className="subscription-card" key={sub.description}>
                              <h3>{sub.description}</h3>
                              <div className="subscription-details">
                                <table className="mini-stats-table">
                                  <tbody>
                                    <tr>
                                      <td>Total Spent:</td>
                                      <td>€{(-sub.total).toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                      <td>Number of Payments:</td>
                                      <td>{sub.count}</td>
                                    </tr>
                                    <tr>
                                      <td>Average Payment:</td>
                                      <td>€{(-sub.average).toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                      <td>Maximum Payment:</td>
                                      <td>€{(-sub.maxAmount).toFixed(2)}</td>
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
                                  <button className="optimize-btn" disabled>
                                    Optimise (soon)
                                  </button>
                                  <button className="alt-btn">Find Alternative (coming soon)</button>
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
                              <td style={{ padding: '1rem', textAlign: 'right', color: 'white', fontWeight: 500 }}>€{(-sub.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
                                callback: (value: any) => `€${value.toLocaleString()}`,
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
                              return (
                                <tr key={sub.description} style={{ borderBottom: index < highConfidenceSubscriptions.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none' }}>
                                  <td style={{ padding: '1rem', color: 'white' }}>{sub.description}</td>
                                  <td style={{ padding: '1rem', textAlign: 'right', color: 'white', fontWeight: 500 }}>€{(-sub.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td style={{ padding: '1rem', textAlign: 'right', color: 'white', fontWeight: 500 }}>€{monthlySpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td style={{ padding: '1rem', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                      <a 
                                        href={`https://duckduckgo.com/?q=${encodeURIComponent(sub.description + ' alternatives')}`}
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="optimize-btn"
                                        style={{ padding: '0.5rem 1rem', textDecoration: 'none', display: 'inline-block' }}
                                      >
                                        Switch
                                      </a>
                                      <a 
                                        href={`https://duckduckgo.com/?q=${encodeURIComponent('Cancel ' + sub.description)}`}
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="alt-btn"
                                        style={{ padding: '0.5rem 1rem', textDecoration: 'none', display: 'inline-block', background: 'rgba(247, 37, 133, 0.2)', color: '#f72585', border: '1px solid #f72585' }}
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
                      <div style={{ flex: '1', minWidth: '200px' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#bfc9da', fontSize: '0.9rem' }}>
                          Filter by Type
                        </label>
                        <select
                          value={transactionFilter}
                          onChange={(e) => setTransactionFilter(e.target.value)}
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
                          <option value="All">All Transactions</option>
                          <option value="Credit">Credits Only</option>
                          <option value="Debit">Debits Only</option>
                          <option value="Subscription">Subscriptions Only</option>
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
                      <div style={{ flex: '1', minWidth: '150px' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#bfc9da', fontSize: '0.9rem' }}>
                          Amount Filter
                        </label>
                        <select
                          value={amountFilterType}
                          onChange={(e) => setAmountFilterType(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '1rem',
                            fontFamily: 'Inter, sans-serif',
                            cursor: 'pointer',
                            marginBottom: '0.5rem'
                          }}
                        >
                          <option value="none">No Filter</option>
                          <option value="greater">Greater Than</option>
                          <option value="less">Less Than</option>
                        </select>
                        {amountFilterType !== 'none' && (
                          <input
                            type="number"
                            value={amountFilterValue}
                            onChange={(e) => setAmountFilterValue(e.target.value)}
                            placeholder="Amount..."
                            step="0.01"
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
                        )}
                      </div>
                    </div>

                    {/* Filtered Transactions */}
                    <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', overflow: 'hidden' }}>
                        <thead>
                          <tr style={{ background: 'rgba(45, 140, 255, 0.2)' }}>
                            <th style={{ padding: '1rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Date</th>
                            <th style={{ padding: '1rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Description</th>
                            <th style={{ padding: '1rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Amount</th>
                            <th style={{ padding: '1rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600, borderBottom: '2px solid rgba(45, 140, 255, 0.3)' }}>Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                    {(() => {
                      const filteredTransactions = csvData.filter((transaction) => {
                        // Get all keys to help with field access
                        const keys = Object.keys(transaction);
                        
                        // Detect bank format
                        const isAIB = keys.some(k => 
                          k.includes('Posted Account') || 
                          k.includes('Posted Transactions Date') || 
                          k.includes('Description1')
                        );
                        
                        // Extract description
                        let description = '';
                        if (isAIB) {
                          const desc1Key = keys.find(k => k.trim() === 'Description1' || k.includes('Description1'));
                          const desc2Key = keys.find(k => k.trim() === 'Description2' || k.includes('Description2'));
                          const desc3Key = keys.find(k => k.trim() === 'Description3' || k.includes('Description3'));
                          
                          const desc1 = desc1Key ? (transaction as any)[desc1Key] || '' : '';
                          const desc2 = desc2Key ? (transaction as any)[desc2Key] || '' : '';
                          const desc3 = desc3Key ? (transaction as any)[desc3Key] || '' : '';
                          description = [desc1, desc2, desc3].filter(d => d && String(d).trim()).join(' ').trim();
                        } else {
                          const descKey = keys.find(k => k.trim() === 'Description' || k.includes('Description'));
                          description = descKey ? (transaction as any)[descKey] || '' : '';
                        }
                        
                        // Extract amount
                        let amount = 0;
                        if (isAIB) {
                          const debitKey = keys.find(k => k.trim() === 'Debit Amount' || k.includes('Debit Amount'));
                          const creditKey = keys.find(k => k.trim() === 'Credit Amount' || k.includes('Credit Amount'));
                          
                          const debitAmount = debitKey ? (transaction as any)[debitKey] : '';
                          const creditAmount = creditKey ? (transaction as any)[creditKey] : '';
                          
                          if (debitAmount && String(debitAmount).trim()) {
                            amount = -parseFloat(String(debitAmount).replace(/,/g, ''));
                          } else if (creditAmount && String(creditAmount).trim()) {
                            amount = parseFloat(String(creditAmount).replace(/,/g, ''));
                          }
                        } else {
                          const amountKey = keys.find(k => k.trim() === 'Amount' || k.includes('Amount'));
                          amount = amountKey ? parseFloat((transaction as any)[amountKey] || '0') : 0;
                        }
                        
                        // Check if subscription
                        const isSubscription = subscriptions.some(sub => 
                          sub.description.toLowerCase() === description.toLowerCase()
                        );
                        const isCredit = amount > 0;
                        const isDebit = amount < 0;
                        
                        // Apply type filter
                        if (transactionFilter === 'Credit' && !isCredit) return false;
                        if (transactionFilter === 'Debit' && !isDebit) return false;
                        if (transactionFilter === 'Subscription' && !isSubscription) return false;
                        
                        // Apply search filter
                        if (transactionSearch && !description.toLowerCase().includes(transactionSearch.toLowerCase())) {
                          return false;
                        }
                        
                        // Apply amount filter
                        if (amountFilterType !== 'none' && amountFilterValue) {
                          const filterAmount = parseFloat(amountFilterValue);
                          if (!isNaN(filterAmount)) {
                            const absAmount = Math.abs(amount);
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
                            // Get all keys to help with debugging and field access
                            const keys = Object.keys(transaction);
                            
                            // Detect bank format - check for AIB-specific fields (try with and without spaces)
                            const isAIB = keys.some(k => 
                              k.includes('Posted Account') || 
                              k.includes('Posted Transactions Date') || 
                              k.includes('Description1')
                            );
                            const isRevolut = keys.some(k => 
                              k.includes('Type') && !k.includes('Transaction Type') ||
                              k.includes('Completed Date') ||
                              k.includes('Started Date')
                            );
                            
                            // Extract description
                            let description = '';
                            if (isAIB) {
                              // AIB: concatenate Description1, Description2, Description3
                              // Try various field name variations
                              const desc1Key = keys.find(k => k.trim() === 'Description1' || k.includes('Description1'));
                              const desc2Key = keys.find(k => k.trim() === 'Description2' || k.includes('Description2'));
                              const desc3Key = keys.find(k => k.trim() === 'Description3' || k.includes('Description3'));
                              
                              const desc1 = desc1Key ? (transaction as any)[desc1Key] || '' : '';
                              const desc2 = desc2Key ? (transaction as any)[desc2Key] || '' : '';
                              const desc3 = desc3Key ? (transaction as any)[desc3Key] || '' : '';
                              description = [desc1, desc2, desc3].filter(d => d && String(d).trim()).join(' ').trim();
                            } else {
                              // Revolut: single Description field
                              const descKey = keys.find(k => k.trim() === 'Description' || k.includes('Description'));
                              description = descKey ? (transaction as any)[descKey] || '' : '';
                            }
                            
                            // Extract amount
                            let amount = 0;
                            if (isAIB) {
                              // AIB: use Debit Amount (negative) or Credit Amount (positive)
                              const debitKey = keys.find(k => k.trim() === 'Debit Amount' || k.includes('Debit Amount'));
                              const creditKey = keys.find(k => k.trim() === 'Credit Amount' || k.includes('Credit Amount'));
                              
                              const debitAmount = debitKey ? (transaction as any)[debitKey] : '';
                              const creditAmount = creditKey ? (transaction as any)[creditKey] : '';
                              
                              if (debitAmount && String(debitAmount).trim()) {
                                amount = -parseFloat(String(debitAmount).replace(/,/g, ''));
                              } else if (creditAmount && String(creditAmount).trim()) {
                                amount = parseFloat(String(creditAmount).replace(/,/g, ''));
                              }
                            } else {
                              // Revolut: single Amount field (already signed)
                              const amountKey = keys.find(k => k.trim() === 'Amount' || k.includes('Amount'));
                              amount = amountKey ? parseFloat((transaction as any)[amountKey] || '0') : 0;
                            }
                            
                            // Extract date
                            let date = '';
                            if (isAIB) {
                              const dateKey = keys.find(k => k.trim() === 'Posted Transactions Date' || k.includes('Posted Transactions Date'));
                              date = dateKey ? (transaction as any)[dateKey] || '' : '';
                            } else {
                              const completedKey = keys.find(k => k.trim() === 'Completed Date' || k.includes('Completed Date'));
                              const startedKey = keys.find(k => k.trim() === 'Started Date' || k.includes('Started Date'));
                              date = completedKey ? (transaction as any)[completedKey] : 
                                     startedKey ? (transaction as any)[startedKey] : 
                                     transaction.Date || transaction.date || '';
                            }
                            
                            // Extract balance
                            const balanceKey = keys.find(k => k.trim() === 'Balance' || k.includes('Balance'));
                            const balance = balanceKey ? parseFloat((transaction as any)[balanceKey] || '0') : 0;
                            
                            // Check if this transaction is a subscription
                            const isSubscription = subscriptions.some(sub => 
                              sub.description.toLowerCase() === description.toLowerCase()
                            );
                            
                            // Determine transaction type
                            const isCredit = amount > 0;
                            const isDebit = amount < 0;
                            
                            // Set row background color
                            let rowBgColor = 'transparent';
                            if (isSubscription) {
                              rowBgColor = 'rgba(247, 37, 133, 0.15)'; // Soft red for subscriptions
                            } else if (isCredit) {
                              rowBgColor = 'rgba(76, 201, 240, 0.15)'; // Soft green for credits
                            } else if (isDebit) {
                              rowBgColor = 'rgba(255, 165, 0, 0.15)'; // Soft orange for debits
                            }
                            
                            // Format date
                            let formattedDate = date;
                            try {
                              // Try to parse and format the date
                              if (date.includes('/')) {
                                // AIB format: DD/MM/YYYY
                                const [day, month, year] = date.split('/');
                                formattedDate = `${year}-${month}-${day}`;
                              } else if (date.includes('-') && date.includes(' ')) {
                                // Revolut format: YYYY-MM-DD HH:MM:SS
                                formattedDate = date.split(' ')[0];
                              }
                            } catch (e) {
                              // Keep original if parsing fails
                            }
                            
                            return (
                              <tr 
                                key={index} 
                                style={{ 
                                  backgroundColor: rowBgColor,
                                  borderBottom: index < csvData.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
                                  transition: 'background-color 0.2s'
                                }}
                              >
                                <td style={{ padding: '1rem', color: 'white' }}>{formattedDate}</td>
                                <td style={{ padding: '1rem', color: 'white' }}>{description}</td>
                                <td style={{ 
                                  padding: '1rem', 
                                  textAlign: 'right', 
                                  color: isCredit ? '#4cc9f0' : 'white', 
                                  fontWeight: 500 
                                }}>
                                  {amount > 0 ? '+' : ''}€{Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td style={{ padding: '1rem', textAlign: 'right', color: 'white' }}>
                                  €{balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
              <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 0' }}>
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
                    onClick={() => window.open('https://broc.fi', '_blank')}
                  >
                    Join the Waitlist
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
        {/* Overlay for mobile sidebar */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      </div>
  );
};

export default App;
