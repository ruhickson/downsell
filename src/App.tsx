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
import { GoogleOAuthProvider } from '@react-oauth/google';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
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
    if (Math.abs(amount) > Math.abs(transactionsByDescription[description].maxAmount)) {
      transactionsByDescription[description].maxAmount = amount;
    }
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
  { label: 'Account', icon: '👤' },
  { label: 'About', icon: 'ℹ️' },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('Analysis');
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    'Irregular',
    'Quarterly',
    'Monthly',
    'Weekly',
    'Three or more times a week',
    'Daily',
  ];

  // --- About page statistics ---
  const [visitCount, setVisitCount] = useState<number>(() => {
    const stored = localStorage.getItem('downsell_visit_count');
    return stored ? parseInt(stored, 10) : 0;
  });
  const [filesUploaded, setFilesUploaded] = useState<number>(() => {
    const stored = localStorage.getItem('downsell_files_uploaded');
    return stored ? parseInt(stored, 10) : 0;
  });
  const [rowsAnalyzed, setRowsAnalyzed] = useState<number>(() => {
    const stored = localStorage.getItem('downsell_rows_analyzed');
    return stored ? parseInt(stored, 10) : 0;
  });
  const [savingsRecommended, setSavingsRecommended] = useState<number>(() => {
    const stored = localStorage.getItem('downsell_savings_recommended');
    return stored ? parseFloat(stored) : 0;
  });
  const [reportsDownloaded, setReportsDownloaded] = useState<number>(() => {
    const stored = localStorage.getItem('downsell_reports_downloaded');
    return stored ? parseInt(stored, 10) : 0;
  });

  // Increment visit count on mount
  React.useEffect(() => {
    const newCount = visitCount + 1;
    setVisitCount(newCount);
    localStorage.setItem('downsell_visit_count', newCount.toString());
  }, []);

  // Update localStorage when files uploaded, rows analyzed, savings, or reports change
  React.useEffect(() => {
    localStorage.setItem('downsell_files_uploaded', filesUploaded.toString());
  }, [filesUploaded]);
  React.useEffect(() => {
    localStorage.setItem('downsell_rows_analyzed', rowsAnalyzed.toString());
  }, [rowsAnalyzed]);
  React.useEffect(() => {
    localStorage.setItem('downsell_savings_recommended', savingsRecommended.toString());
  }, [savingsRecommended]);
  React.useEffect(() => {
    localStorage.setItem('downsell_reports_downloaded', reportsDownloaded.toString());
  }, [reportsDownloaded]);

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
        setFilesUploaded(f => f + 1);
        setRowsAnalyzed(r => r + (results.data as Transaction[]).length);
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
          setFilesUploaded(f => f + 1);
          setRowsAnalyzed(r => r + (results.data as Transaction[]).length);
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
    const prompt = `I am analyzing my bank statement in Dublin, Ireland. For the following recurring payment, please:
    - Check if the name matches a well-known chain or franchise in Dublin/Ireland, and mention this if so. Use up-to-date web knowledge to check for this.
    - Guess the category/type of expense (e.g., takeaway, groceries, medical, travel, insurance, loan, etc.) based on the name/description.
    - If the name could be a local business, assume it is in Dublin and consider what type of business it is (e.g., search 'Foodgame Dublin').
    - Give optimization or alternative suggestions that are specific to that category.
    - If relevant, analyze the data (dates and amounts) for patterns and suggest ways to save or optimize.
    - If possible, provide a simple ASCII chart or table to visualize the pattern.

    Details:
    - Description: ${sub.description}
    - Frequency: ${sub.frequencyLabel}
    - Total spent: €${(-sub.total).toFixed(2)}
    - Number of payments: ${sub.count}
    - Average payment: €${(-sub.average).toFixed(2)}
    - Dates: ${dateList}
    - Amounts: ${amountList}`;
    try {
      const suggestion = await getGeminiSuggestion(prompt, GEMINI_API_KEY);
      setAiSuggestions((prev) => ({ ...prev, [sub.description]: { loading: false, suggestion } }));
    } catch (e: any) {
      setAiSuggestions((prev) => ({ ...prev, [sub.description]: { loading: false, error: e.message || 'Error fetching suggestion' } }));
    }
  };

  // Placeholder: increment savingsRecommended when an AI suggestion is shown (simulate €5 per suggestion)
  const handleShowAiSuggestion = (sub: Subscription) => {
    fetchAiSuggestion(sub);
    setSavingsRecommended(s => s + 5); // Simulate €5 savings per suggestion
  };

  // Generate PDF report for top 4 optimizations (weekly/monthly)
  const handleDownloadReport = async () => {
    setReportsDownloaded(r => r + 1);
    // Filter top 4 subscriptions (weekly/monthly) by total spent
    const filtered = subscriptions
      .filter(sub => sub.frequencyLabel === 'Weekly' || sub.frequencyLabel === 'Monthly')
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .slice(0, 4);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 40;
    doc.setFontSize(22);
    doc.text('Downsell: Top 4 Optimisation Recommendations', 40, y);
    y += 30;
    doc.setFontSize(12);
    for (let i = 0; i < filtered.length; i++) {
      const sub = filtered[i];
      doc.setFontSize(16);
      doc.text(`${i + 1}. ${sub.description}`, 40, y);
      y += 18;
      doc.setFontSize(12);
      doc.text(`Frequency: ${sub.frequencyLabel} | Total Spent: €${(-sub.total).toFixed(2)} | Payments: ${sub.count}`, 40, y);
      y += 16;
      // AI suggestion (if available)
      const suggestion = aiSuggestions[sub.description]?.suggestion || 'No suggestion available.';
      const lines = doc.splitTextToSize(suggestion, 500);
      doc.text(lines, 40, y);
      y += lines.length * 14 + 8;
      // Bar chart: Payments per Month (draw on canvas, then to image)
      const raw = subscriptionRawData[sub.description] || { dates: [], amounts: [] };
      const monthCounts: Record<string, number> = {};
      raw.dates.forEach((d) => {
        const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        monthCounts[key] = (monthCounts[key] || 0) + 1;
      });
      const monthLabels = Object.keys(monthCounts).sort();
      const monthValues = monthLabels.map((k) => monthCounts[k]);
      // Create a hidden canvas for the bar chart
      const canvasId = `pdf-bar-canvas-${i}`;
      let canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = canvasId;
        canvas.width = 300;
        canvas.height = 80;
        canvas.style.position = 'fixed';
        canvas.style.left = '-9999px';
        document.body.appendChild(canvas);
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Background
        ctx.fillStyle = '#232b36';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Draw bars
        for (let idx = 0; idx < monthValues.length; idx++) {
          const v = monthValues[idx];
          const barHeight = v * 12;
          ctx.fillStyle = '#2d8cff';
          ctx.fillRect(20 + idx * 40, 70 - barHeight, 24, barHeight);
          // Label
          ctx.fillStyle = '#fff';
          ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(monthLabels[idx].slice(5), 32 + idx * 40, 75);
        }
        // Add to PDF
        const imgData = canvas.toDataURL('image/png');
        doc.addImage(imgData, 'PNG', 40, y, 300, 80);
        y += 90;
      }
      y += 10;
      if (y > 700 && i < filtered.length - 1) {
        doc.addPage();
        y = 40;
      }
    }
    doc.save('downsell_report.pdf');
  };

  const [user, setUser] = useState<any>(() => {
    const stored = localStorage.getItem('downsell_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [usersSignedIn, setUsersSignedIn] = useState<number>(() => {
    const stored = localStorage.getItem('downsell_users_signed_in');
    return stored ? parseInt(stored, 10) : 0;
  });

  // Persist user in localStorage
  React.useEffect(() => {
    if (user) {
      localStorage.setItem('downsell_user', JSON.stringify(user));
      // Track unique users by sub or email
      let usersSet: Set<string> = new Set();
      const stored = localStorage.getItem('downsell_users_signed_in_set');
      if (stored) {
        usersSet = new Set(JSON.parse(stored));
      }
      if (user.sub || user.email) {
        usersSet.add(user.sub || user.email);
        localStorage.setItem('downsell_users_signed_in_set', JSON.stringify(Array.from(usersSet)));
        localStorage.setItem('downsell_users_signed_in', usersSet.size.toString());
        setUsersSignedIn(usersSet.size);
      }
    } else {
      localStorage.removeItem('downsell_user');
    }
  }, [user]);

  return (
    <GoogleOAuthProvider clientId="456095468781-fcpgaireqemia7tll1oujqmet5m7m94v.apps.googleusercontent.com">
      <div className="app-layout">
        {/* Sidebar */}
        <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
          <div className="sidebar-logo">🪙</div>
          <nav className="sidebar-nav">
            {TAB_LABELS.map(tab => (
              <div
                key={tab.label}
                className={activeTab === tab.label ? 'sidebar-item sidebar-item-active' : 'sidebar-item'}
                onClick={() => handleSidebarTabClick(tab.label)}
              >
                <span className="sidebar-icon">{tab.icon}</span>
                <span className="sidebar-label">{tab.label}</span>
              </div>
            ))}
          </nav>
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
            <div className="topbar-title">Downsell</div>
            <div className="topbar-right">
              <input className="topbar-search" type="text" placeholder="Search..." />
              {!user ? (
                <GoogleLogin
                  onSuccess={credentialResponse => {
                    if (credentialResponse.credential) {
                      const decoded = jwtDecode(credentialResponse.credential);
                      setUser(decoded);
                    }
                  }}
                  onError={() => {
                    alert('Login Failed');
                  }}
                  width="220"
                />
              ) : (
                <div>
                  <span>Welcome, {user.name}</span>
                  <button onClick={() => { setUser(null); googleLogout(); }}>Logout</button>
                </div>
              )}
            </div>
          </header>
          {/* Main Content */}
          <main className="main-content">
            {activeTab === 'Analysis' && (
              <>
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
                                  <button className="optimize-btn" onClick={() => handleShowAiSuggestion(sub)} disabled={aiSuggestions[sub.description]?.loading}>
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
              </>
            )}
            {activeTab === 'Report' && (
              <div className="tab-placeholder">
                <h2>Report</h2>
                <p>Report features coming soon.</p>
                <button className="optimize-btn" onClick={handleDownloadReport}>Simulate Report Download</button>
              </div>
            )}
            {activeTab === 'Actions' && (
              <div className="tab-placeholder"><h2>Actions</h2><p>Actions and recommendations will appear here.</p></div>
            )}
            {activeTab === 'Account' && (
              <div className="tab-placeholder"><h2>Account</h2><p>Account management features coming soon.</p></div>
            )}
            {activeTab === 'About' && (
              <div className="about-stats">
                <h2>About Downsell</h2>
                <div className="about-stats-row">
                  <div className="about-stats-tile"><div className="about-stats-label">Visits</div><div className="about-stats-value">{visitCount}</div></div>
                  <div className="about-stats-tile"><div className="about-stats-label">Files Uploaded</div><div className="about-stats-value">{filesUploaded}</div></div>
                  <div className="about-stats-tile"><div className="about-stats-label">Rows Analyzed</div><div className="about-stats-value">{rowsAnalyzed}</div></div>
                  <div className="about-stats-tile"><div className="about-stats-label">Savings Recommended</div><div className="about-stats-value">€{savingsRecommended.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div></div>
                  <div className="about-stats-tile"><div className="about-stats-label">Reports Downloaded</div><div className="about-stats-value">{reportsDownloaded}</div></div>
                  <div className="about-stats-tile"><div className="about-stats-label">Users Signed In</div><div className="about-stats-value">{usersSignedIn}</div></div>
                </div>
                <p style={{marginTop: '2rem', color: '#bfc9da'}}>These statistics are stored locally in your browser and are not shared with anyone.</p>
              </div>
            )}
          </main>
        </div>
        {/* Overlay for mobile sidebar */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      </div>
    </GoogleOAuthProvider>
  );
};

export default App;
