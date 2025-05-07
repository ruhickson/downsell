import React, { useState, useMemo } from 'react';
import Papa from 'papaparse';
import { Bar, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import './App.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

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
  const daysBetween = Math.max(1, Math.ceil((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const freqPerYear = count / (daysBetween / 365);
  if (freqPerYear < 1) return 'Once-off/yearly';
  if (freqPerYear < 4) return 'Quarterly';
  if (freqPerYear < 16) return 'Monthly';
  if (freqPerYear < 52) return 'Weekly';
  if (freqPerYear < 156) return 'Three or more times a week';
  return 'Daily';
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

  const top10ByPie = useMemo(() => {
    return subscriptions
      .slice()
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
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

  return (
    <div className="dashboard-container">
      <h1>Bank Statement Analyzer</h1>
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
      {subscriptions.length > 0 && (
        <div className="charts-row">
          <div className="chart-col">
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
          <div className="chart-col">
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
        </div>
      )}
      {subscriptions.length > 0 && top10ByPie.length > 0 && (
        <div style={{ maxWidth: 600, margin: '2rem auto' }}>
          <Pie
            data={pieData}
            options={{
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
          <div className="subscriptions-grid-responsive">
            {subscriptions.map((sub) => (
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
                  <div className="subscription-actions">
                    <button className="optimize-btn">Optimize</button>
                    <button className="alt-btn">Find alternative</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {csvData.length === 0 && <p style={{ marginTop: '2rem', color: '#888' }}>No data loaded. Please upload a CSV file.</p>}
    </div>
  );
};

export default App;
