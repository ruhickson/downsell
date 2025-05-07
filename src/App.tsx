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
} from 'chart.js';
import './App.css';
import { getGeminiSuggestion } from './gemini';
import ReactMarkdown from 'react-markdown';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement
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
  if (freqPerYear < 52) return 'Weekly';
  if (freqPerYear < 156) return 'Three or more times a week';
  // Only return 'Daily' if count >= 60, otherwise treat as once-off/yearly
  if (count >= 60) return 'Daily';
  return 'Once-off/yearly';
}

function analyzeBankStatement(data: Transaction[]): Subscription[] {
  const transactionsByDescription: Record<string, any> = {};
  data.forEach((transaction) => {
    const description = transaction.Description || transaction.description || '';
    const type = (transaction.Type || transaction.type || '').toUpperCase();
    const amount = parseFloat(transaction.Amount || transaction.amount || '0');
    if (amount > 0) return;
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
    transactionsByDescription[description].maxAmount = Math.max(transactionsByDescription[description].maxAmount, amount);
    const date =
      (transaction as any)['Completed Date'] ||
      (transaction as any)['Started Date'] ||
      transaction.Date ||
      transaction.date;
    if (date) {
      const transactionDate = new Date(date);
      transactionsByDescription[description].dates.push(transactionDate);
      if (!transactionsByDescription[description].firstDate || transactionDate < transactionsByDescription[description].firstDate) {
        transactionsByDescription[description].firstDate = transactionDate;
      }
      if (!transactionsByDescription[description].lastDate || transactionDate > transactionsByDescription[description].lastDate) {
        transactionsByDescription[description].lastDate = transactionDate;
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
        maxAmount: data.maxAmount,
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

const App: React.FC = () => {
  const [csvData, setCsvData] = useState<Transaction[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, { loading: boolean; error?: string; suggestion?: string }>>({});
  const [frequencyFilter, setFrequencyFilter] = useState<string>('All');
  const frequencyOptions = [
    'All',
    'Once-off/yearly',
    'Quarterly',
    'Monthly',
    'Weekly',
    'Three or more times a week',
    'Daily',
  ];

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

  const fetchAiSuggestion = async (sub: Subscription) => {
    setAiSuggestions((prev) => ({ ...prev, [sub.description]: { loading: true } }));
    const raw = subscriptionRawData[sub.description] || { dates: [], amounts: [] };
    const dateList = raw.dates.map(d => d.toISOString().slice(0, 10)).join(', ');
    const amountList = raw.amounts.map(a => a.toFixed(2)).join(', ');
    const prompt = `I am analyzing my bank statement. For the following recurring payment, please:\n- Guess the category/type of expense (e.g., takeaway, groceries, medical, travel, insurance, loan, etc.) based on the name/description.\n- Give optimization or alternative suggestions that are specific to that category.\n- If relevant, analyze the data (dates and amounts) for patterns and suggest ways to save or optimize.\n- If possible, provide a simple ASCII chart or table to visualize the pattern.\n\nDetails:\n- Description: ${sub.description}\n- Frequency: ${sub.frequencyLabel}\n- Total spent: €${(-sub.total).toFixed(2)}\n- Number of payments: ${sub.count}\n- Average payment: €${(-sub.average).toFixed(2)}\n- Dates: ${dateList}\n- Amounts: ${amountList}`;
    try {
      const suggestion = await getGeminiSuggestion(prompt, GEMINI_API_KEY);
      setAiSuggestions((prev) => ({ ...prev, [sub.description]: { loading: false, suggestion } }));
    } catch (e: any) {
      setAiSuggestions((prev) => ({ ...prev, [sub.description]: { loading: false, error: e.message || 'Error fetching suggestion' } }));
    }
  };

  return (
    <div className="dashboard-container">
      <h1>Analyze Your Subscriptions</h1>
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
                            <td>${(-sub.total).toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td>Number of Payments:</td>
                            <td>{sub.count}</td>
                          </tr>
                          <tr>
                            <td>Average Payment:</td>
                            <td>${(-sub.average).toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td>Maximum Payment:</td>
                            <td>${(-sub.maxAmount).toFixed(2)}</td>
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
                        <button className="optimize-btn" onClick={() => fetchAiSuggestion(sub)} disabled={aiSuggestions[sub.description]?.loading}>
                          {aiSuggestions[sub.description]?.loading ? 'Getting suggestion...' : 'Optimize'}
                        </button>
                        <button className="alt-btn">Find Alternative (coming soon)</button>
                      </div>
                      {aiSuggestions[sub.description]?.suggestion && (
                        <div className="ai-suggestion-box">
                          <strong>AI Suggestion:</strong>
                          <div style={{ marginTop: '0.5rem', whiteSpace: 'pre-line' }}>
                            <ReactMarkdown>{aiSuggestions[sub.description]?.suggestion}</ReactMarkdown>
                          </div>
                        </div>
                      )}
                      {aiSuggestions[sub.description]?.error && (
                        <div className="ai-suggestion-box error">
                          <strong>Error:</strong> {aiSuggestions[sub.description]?.error}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </>
      )}
      {csvData.length === 0 && <p style={{ marginTop: '2rem', color: '#888' }}>No data loaded. Please upload a CSV file.</p>}
    </div>
  );
};

export default App;
