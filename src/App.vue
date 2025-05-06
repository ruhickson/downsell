<script setup>
import { ref } from 'vue'
import Papa from 'papaparse'

const csvData = ref([])
const headers = ref([])

function handleFileUpload(event) {
  const file = event.target.files[0]
  if (!file) return
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      headers.value = results.meta.fields
      csvData.value = results.data
    }
  })
}
</script>

<template>
  <div style="max-width: 900px; margin: 2rem auto;">
    <h1>CSV Table Viewer</h1>
    <input type="file" accept=".csv" @change="handleFileUpload" />
    <table v-if="csvData.length" border="1" cellpadding="8" style="margin-top: 2rem; width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th v-for="header in headers" :key="header">{{ header }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, idx) in csvData" :key="idx">
          <td v-for="header in headers" :key="header">{{ row[header] }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else style="margin-top: 2rem; color: #888;">No data loaded. Please upload a CSV file.</p>
  </div>
</template>

<style scoped>
table th {
  background: #f4f4f4;
}
table td, table th {
  text-align: left;
}
</style>
