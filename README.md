# AI-Assisted Bank Statement Analyzer

This project is an **AI-assisted tool** that analyzes your yearly bank statement (CSV) and offers actionable suggestions, optimization actions, and techniques to help you improve your finances immediately.

## Project Overview

Upload your bank statement CSV and let the dashboard:
- Detect and group recurring payments (subscriptions)
- Visualize your spending patterns
- Suggest ways to optimize or reduce recurring expenses
- Provide actionable insights for better financial health

## Key Features
- **Automatic Subscription Detection:** Identifies recurring outgoing payments, ignoring transfers and exchanges.
- **Modern Dashboard UI:** Wide, responsive grid of cards for each detected subscription, with clear statistics and actionable buttons.
- **Spending Visualizations:** Bar and pie charts for top subscriptions by spend and count, and overall subscription vs non-subscription spend.
- **Frequency Analysis:** Labels subscriptions as Monthly, Weekly, etc., based on payment patterns.
- **Actionable Suggestions:** Each subscription card offers "Optimize" and "Find alternative" actions.
- **Summary Stats:** See total transactions, total spent, and potential savings at a glance.
- **Robust Error Handling:** Defensive coding ensures smooth experience even with imperfect CSVs.

## Usage
1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Start the development server:**
   ```bash
   npm run dev
   ```
3. **Upload your bank statement CSV** via the dashboard UI.
4. **Explore insights:** Review detected subscriptions, charts, and actionable suggestions.

## Technologies Used
- **React + TypeScript** (with Vite)
- **Chart.js** and **react-chartjs-2** for data visualization
- **PapaParse** for CSV parsing

---

## Vite + React + TypeScript Template Info

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```
