<script setup>
import { ref, computed } from 'vue'
import Papa from 'papaparse'
import BarChart from './BarChart.vue'

const csvData = ref([])
const headers = ref([])
const potentialSubscriptions = ref([])

const totalTransactions = computed(() => csvData.value.length)
const totalPotentialSubscriptions = computed(() => potentialSubscriptions.value.length)

// Compute top 10 subscriptions by absolute total spent (display as positive), only high-confidence
const top10Subscriptions = computed(() => {
  return potentialSubscriptions.value
    .slice()
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, 10)
})
const top10Labels = computed(() => top10Subscriptions.value.map(sub => sub.description))
const top10Values = computed(() => top10Subscriptions.value.map(sub => -sub.total))

// Compute top 10 subscriptions by count (number of payments), only high-confidence
const top10ByCount = computed(() => {
  return potentialSubscriptions.value
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
})
const top10CountLabels = computed(() => top10ByCount.value.map(sub => sub.description))
const top10CountValues = computed(() => top10ByCount.value.map(sub => sub.count))

function handleFileUpload(event) {
  const file = event.target.files[0]
  if (!file) return
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      headers.value = results.meta.fields
      csvData.value = results.data
      analyzeBankStatement(results.data)
    }
  })
}

function analyzeBankStatement(data) {
  // Group transactions by description
  const transactionsByDescription = data.reduce((acc, transaction) => {
    const description = transaction.Description || transaction.description
    const type = (transaction.Type || transaction.type || '').toUpperCase()
    let amount = parseFloat(transaction.Amount || transaction.amount)
    
    // Only skip if Type field specifically contains EXCHANGE or TRANSFER
    if (type === 'EXCHANGE' || type === 'TRANSFER') {
      return acc
    }
    
    if (!acc[description]) {
      acc[description] = {
        total: 0,
        count: 0,
        amounts: [],
        lastDate: null,
        firstDate: null,
        dates: [], // Track all dates for better frequency analysis
        maxAmount: -Infinity // Track maximum amount
      }
    }

    acc[description].total += amount
    acc[description].count += 1
    acc[description].amounts.push(amount)
    acc[description].maxAmount = Math.max(acc[description].maxAmount, amount)
    
    // Track dates if available
    const date = transaction.Date || transaction.date
    if (date) {
      const transactionDate = new Date(date)
      acc[description].dates.push(transactionDate)
      if (!acc[description].firstDate || transactionDate < acc[description].firstDate) {
        acc[description].firstDate = transactionDate
      }
      if (!acc[description].lastDate || transactionDate > acc[description].lastDate) {
        acc[description].lastDate = transactionDate
      }
    }

    return acc
  }, {})

  // Analyze potential subscriptions
  potentialSubscriptions.value = Object.entries(transactionsByDescription)
    .map(([description, data]) => {
      const average = data.total / data.count
      const variance = calculateVariance(data.amounts, average)
      const standardDeviation = Math.sqrt(variance)
      
      // Calculate time span in days if dates are available
      let timeSpan = null
      if (data.firstDate && data.lastDate) {
        timeSpan = Math.ceil((data.lastDate - data.firstDate) / (1000 * 60 * 60 * 24))
      }

      // Calculate frequency (transactions per month)
      const frequency = timeSpan ? (data.count / (timeSpan / 30)) : null

      // Calculate average days between transactions
      let avgDaysBetween = null
      if (data.dates.length > 1) {
        const sortedDates = data.dates.sort((a, b) => a - b)
        const daysBetween = []
        for (let i = 1; i < sortedDates.length; i++) {
          daysBetween.push(Math.ceil((sortedDates[i] - sortedDates[i-1]) / (1000 * 60 * 60 * 24)))
        }
        avgDaysBetween = daysBetween.reduce((a, b) => a + b, 0) / daysBetween.length
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
        subscriptionScore: calculateSubscriptionScore({
          count: data.count,
          standardDeviation,
          frequency,
          timeSpan,
          avgDaysBetween,
          description
        })
      }
    })
    // Only show subscriptions where all amounts are negative (outgoing payments),
    // that occur at least monthly (frequency >= 1 or avgDaysBetween <= 31),
    // and have a confidence score of 80% or higher
    .filter(item => item.total < 0 && item.average < 0 && item.maxAmount < 0 && item.subscriptionScore >= 0.8 && ((item.frequency && item.frequency >= 1) || (item.avgDaysBetween && item.avgDaysBetween <= 31)))
    .sort((a, b) => a.total - b.total)
}

function calculateVariance(numbers, mean) {
  return numbers.reduce((acc, num) => acc + Math.pow(num - mean, 2), 0) / numbers.length
}

function calculateSubscriptionScore({ count, standardDeviation, frequency, timeSpan, avgDaysBetween, description }) {
  let score = 0
  
  // More transactions = higher likelihood (lowered threshold)
  if (count >= 2) score += 0.3
  else if (count >= 1) score += 0.2

  // More lenient standard deviation thresholds
  if (standardDeviation < 5) score += 0.3
  else if (standardDeviation < 10) score += 0.2
  else if (standardDeviation < 20) score += 0.1

  // More flexible frequency matching
  if (frequency) {
    // Monthly (0.8-1.2 times per month)
    if (Math.abs(frequency - 1) < 0.2) score += 0.3
    // Bi-weekly (1.8-2.2 times per month)
    else if (Math.abs(frequency - 2) < 0.2) score += 0.3
    // Weekly (3.8-4.2 times per month)
    else if (Math.abs(frequency - 4) < 0.2) score += 0.3
    // Any regular frequency
    else if (frequency > 0.5) score += 0.2
  }

  // Check for common subscription-related keywords
  const subscriptionKeywords = [
    'subscription', 'monthly', 'recurring', 'membership', 'premium', 'pro', 'plus',
    'service', 'plan', 'billing', 'payment', 'charge', 'fee', 'rent', 'lease'
  ]
  const descriptionLower = description.toLowerCase()
  if (subscriptionKeywords.some(keyword => descriptionLower.includes(keyword))) {
    score += 0.2
  }

  // Check for consistent payment intervals
  if (avgDaysBetween) {
    // Monthly (25-35 days)
    if (avgDaysBetween >= 25 && avgDaysBetween <= 35) score += 0.2
    // Bi-weekly (12-16 days)
    else if (avgDaysBetween >= 12 && avgDaysBetween <= 16) score += 0.15
    // Weekly (5-9 days)
    else if (avgDaysBetween >= 5 && avgDaysBetween <= 9) score += 0.1
    // Any regular interval
    else if (avgDaysBetween > 0) score += 0.05
  }

  // Longer time span with consistent payments
  if (timeSpan && timeSpan > 30) score += 0.1

  return score
}
</script>

<template>
  <div class="dashboard-container">
    <h1>Bank Statement Analyzer</h1>
    <input type="file" accept=".csv" @change="handleFileUpload" />
    <div v-if="potentialSubscriptions.length" class="charts-row">
      <div class="chart-col">
        <BarChart :labels="top10Labels" :values="top10Values" />
      </div>
      <div class="chart-col">
        <BarChart :labels="top10CountLabels" :values="top10CountValues" :title="'Top 10 Subscriptions by Count'" />
      </div>
    </div>
    <div v-if="csvData.length" style="margin-top: 1.5rem; margin-bottom: 1.5rem;">
      <strong>Total Transactions:</strong> {{ totalTransactions }}<br>
      <strong>Potential Subscriptions:</strong> {{ totalPotentialSubscriptions }}
    </div>
    <div v-if="csvData.length">
      <h2 style="margin-top: 2rem;">Potential Subscriptions</h2>
      <div v-if="potentialSubscriptions.length" class="subscriptions-grid-responsive">
        <div v-for="sub in potentialSubscriptions" :key="sub.description" class="subscription-card">
          <h3>{{ sub.description }}</h3>
          <div class="subscription-details">
            <p><strong>Total Spent:</strong> ${{ (-sub.total).toFixed(2) }}</p>
            <p><strong>Number of Payments:</strong> {{ sub.count }}</p>
            <p><strong>Average Payment:</strong> ${{ (-sub.average).toFixed(2) }}</p>
            <p><strong>Maximum Payment:</strong> ${{ (-sub.maxAmount).toFixed(2) }}</p>
            <p><strong>Frequency:</strong> {{ sub.frequency ? sub.frequency.toFixed(1) + ' times/month' : 'N/A' }}</p>
            <p><strong>Confidence Score:</strong> {{ (sub.subscriptionScore * 100).toFixed(0) }}%</p>
            <div class="subscription-actions">
              <button class="optimize-btn">Optimize</button>
              <button class="alt-btn">Find alternative</button>
            </div>
          </div>
        </div>
      </div>
      <p v-else style="margin-top: 1rem; color: #888;">No potential subscriptions found.</p>
    </div>
    <p v-else style="margin-top: 2rem; color: #888;">No data loaded. Please upload a CSV file.</p>
  </div>
</template>

<style scoped>
.dashboard-container {
  width: 100%;
  max-width: none;
  margin: 2rem auto;
  padding: 0 4vw;
  box-sizing: border-box;
}

.charts-row {
  display: flex;
  flex-wrap: wrap;
  gap: 2rem;
  margin: 2rem 0 2.5rem 0;
}
.chart-col {
  flex: 1 1 400px;
  min-width: 320px;
  max-width: 600px;
}

table th {
  background: #f4f4f4;
}
table td, table th {
  text-align: left;
}

.subscriptions-grid-responsive {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 2rem;
  margin-top: 1rem;
  justify-items: center;
}

.subscription-card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 1.5rem;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  width: 100%;
  max-width: 400px;
}

.subscription-card h3 {
  margin: 0 0 1rem 0;
  color: #333;
}

.subscription-details p {
  margin: 0.5rem 0;
  color: #666;
}

.subscription-details strong {
  color: #333;
}

.subscription-actions {
  margin-top: 1rem;
  text-align: right;
}

.optimize-btn, .alt-btn {
  padding: 0.5rem 1rem;
  border: none;
  background: none;
  color: #333;
  cursor: pointer;
  transition: color 0.3s;
}

.optimize-btn:hover, .alt-btn:hover {
  color: #007bff;
}
</style>
