import React, { useState } from 'react';
import { getCategoryColor, type Category } from './categories';

interface Transaction {
  Description: string;
  Amount: number;
  Date: string;
  Category?: string;
  Currency?: string;
}

interface SankeyDiagramProps {
  data: Record<string, number>; // Category -> total spending
  transactions?: Transaction[]; // Optional: full transaction data for breakdown
}

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

const SankeyDiagram: React.FC<SankeyDiagramProps> = ({ data, transactions = [] }) => {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  // Calculate total spending
  const totalSpending = Object.values(data).reduce((sum, val) => sum + val, 0);
  
  // Get primary currency (most common currency in transactions)
  const primaryCurrency = transactions.length > 0 ? (() => {
    const currencyCounts: Record<string, number> = {};
    transactions.forEach(tx => {
      const currency = tx.Currency || 'EUR';
      currencyCounts[currency] = (currencyCounts[currency] || 0) + 1;
    });
    return Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'EUR';
  })() : 'EUR';
  
  if (totalSpending === 0) {
    return <div style={{ color: '#888', textAlign: 'center', padding: '2rem' }}>No spending data available</div>;
  }

  // Create nodes: [Total Spending, ...categories]
  const nodes: Array<{ name: string; value: number; color: string }> = [
    { name: 'Total Spending', value: totalSpending, color: '#2d8cff' }
  ];

  // Add category nodes
  const categories = Object.entries(data)
    .filter(([_, value]) => value > 0)
    .sort(([_, a], [__, b]) => b - a); // Sort by value descending

  categories.forEach(([category, value]) => {
    nodes.push({
      name: category,
      value: value,
      color: getCategoryColor(category as Category)
    });
  });

  // Create links from Total Spending to each category
  const links: Array<{ source: number; target: number; value: number }> = [];
  categories.forEach((_, index) => {
    links.push({
      source: 0, // Total Spending
      target: index + 1, // Category index
      value: categories[index][1]
    });
  });

  // Calculate layout - use full available space
  const nodeHeight = 35;
  const nodeSpacing = 8;
  const leftColumnX = 80;
  const rightColumnX = 500;
  const startY = 40;
  const padding = 40;
  const svgHeight = Math.max(600, Math.min(1200, nodes.length * (nodeHeight + nodeSpacing) + padding * 2));
  const svgWidth = 1000;

  // Calculate positions for left column (Total Spending)
  const leftNodeY = startY;
  const leftNodeHeight = nodeHeight * 2; // Make total spending node bigger

  // Calculate positions for right column (Categories)
  const rightNodesY: number[] = [];
  let currentY = startY;
  categories.forEach(() => {
    rightNodesY.push(currentY);
    currentY += nodeHeight + nodeSpacing;
  });

  // Calculate link paths (curved)
  const calculateLinkPath = (sourceY: number, sourceHeight: number, targetY: number, targetHeight: number) => {
    const sourceX = leftColumnX + 180; // End of source node (updated to match new width)
    const targetX = rightColumnX; // Start of target node
    const sourceCenterY = sourceY + sourceHeight / 2;
    const targetCenterY = targetY + targetHeight / 2;
    
    const controlPoint1X = sourceX + (targetX - sourceX) * 0.5;
    const controlPoint2X = sourceX + (targetX - sourceX) * 0.5;
    
    return `M ${sourceX} ${sourceCenterY} C ${controlPoint1X} ${sourceCenterY}, ${controlPoint2X} ${targetCenterY}, ${targetX} ${targetCenterY}`;
  };

  return (
    <div style={{ width: '100%', overflowX: 'auto', marginBottom: '2rem', display: 'flex', justifyContent: 'center' }}>
      <svg width={svgWidth} height={svgHeight} style={{ background: 'transparent', maxWidth: '100%' }}>
        {/* Draw links first (so nodes appear on top) */}
        {links.map((link, index) => {
          const sourceY = leftNodeY;
          const sourceHeight = leftNodeHeight;
          const targetY = rightNodesY[index];
          const targetHeight = nodeHeight;
          const path = calculateLinkPath(sourceY, sourceHeight, targetY, targetHeight);
          
          // Calculate link width based on value - make them thicker
          const linkWidth = Math.max(4, (link.value / totalSpending) * 40); // Increased from 20 to 40, min from 2 to 4
          const opacity = 0.4 + (link.value / totalSpending) * 0.6;
          
          return (
            <path
              key={`link-${index}`}
              d={path}
              stroke={nodes[link.target].color}
              strokeWidth={linkWidth}
              fill="none"
              opacity={opacity}
            />
          );
        })}

        {/* Draw Total Spending node */}
        <rect
          x={leftColumnX}
          y={leftNodeY}
          width={150}
          height={leftNodeHeight}
          fill={nodes[0].color}
          rx={4}
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}
        />
        <text
          x={leftColumnX + 90}
          y={leftNodeY + leftNodeHeight / 2 - 8}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize="16"
          fontWeight="bold"
        >
          Total Spending
        </text>
        <text
          x={leftColumnX + 90}
          y={leftNodeY + leftNodeHeight / 2 + 12}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize="14"
          opacity={0.95}
        >
          {getCurrencySymbol(primaryCurrency)}{totalSpending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </text>

        {/* Draw category nodes - make them bigger and better spaced */}
        {categories.map(([category, value], index) => {
          const y = rightNodesY[index];
          const percentage = ((value / totalSpending) * 100).toFixed(1);
          const nodeWidth = 220;
          const isExpanded = expandedCategory === category;
          
          return (
            <g key={category}>
              <rect
                x={rightColumnX}
                y={y}
                width={nodeWidth}
                height={nodeHeight}
                fill={nodes[index + 1].color}
                rx={6}
                style={{ 
                  filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))',
                  cursor: 'pointer',
                  opacity: isExpanded ? 0.9 : 1
                }}
                onClick={() => setExpandedCategory(isExpanded ? null : category)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.85';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = isExpanded ? '0.9' : '1';
                }}
              />
              <text
                x={rightColumnX + nodeWidth / 2}
                y={y + nodeHeight / 2 - 7}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="13"
                fontWeight="600"
                style={{ cursor: 'pointer', pointerEvents: 'none' }}
              >
                {category}
              </text>
              <text
                x={rightColumnX + nodeWidth / 2}
                y={y + nodeHeight / 2 + 11}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="12"
                opacity={0.95}
                style={{ cursor: 'pointer', pointerEvents: 'none' }}
              >
                {getCurrencySymbol(primaryCurrency)}{value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({percentage}%)
              </text>
              {/* Expand/collapse indicator */}
              <text
                x={rightColumnX + nodeWidth - 15}
                y={y + nodeHeight / 2 + 5}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="16"
                fontWeight="bold"
                style={{ cursor: 'pointer', pointerEvents: 'none' }}
              >
                {isExpanded ? '−' : '+'}
              </text>
            </g>
          );
        })}
      </svg>
      
      {/* Category breakdown panel */}
      {expandedCategory && transactions.length > 0 && (() => {
        // Get all transactions for this category
        const categoryTransactions = transactions
          .filter(tx => tx.Amount < 0 && (tx.Category || 'Other') === expandedCategory)
          .map(tx => ({
            description: tx.Description,
            amount: Math.abs(tx.Amount),
            date: tx.Date,
          }))
          .sort((a, b) => b.amount - a.amount); // Sort by amount descending
        
        // Group by description and sum amounts
        const groupedTransactions: Record<string, { count: number; total: number; lastDate: string }> = {};
        categoryTransactions.forEach(tx => {
          if (!groupedTransactions[tx.description]) {
            groupedTransactions[tx.description] = { count: 0, total: 0, lastDate: tx.date };
          }
          groupedTransactions[tx.description].count++;
          groupedTransactions[tx.description].total += tx.amount;
          if (new Date(tx.date) > new Date(groupedTransactions[tx.description].lastDate)) {
            groupedTransactions[tx.description].lastDate = tx.date;
          }
        });
        
        const groupedList = Object.entries(groupedTransactions)
          .map(([description, data]) => ({
            description,
            ...data,
          }))
          .sort((a, b) => b.total - a.total);
        
        return (
          <div style={{
            marginTop: '2rem',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            padding: '1.5rem',
            border: `2px solid ${getCategoryColor(expandedCategory as Category)}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, color: 'white', fontSize: '1.2rem' }}>
                {expandedCategory} Breakdown
              </h3>
              <button
                onClick={() => setExpandedCategory(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                Close
              </button>
            </div>
            
            {groupedList.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.2)' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#2d8cff', fontWeight: 600 }}>Transaction</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600 }}>Count</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600 }}>Total Amount</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#2d8cff', fontWeight: 600 }}>Average</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedList.map((item, idx) => (
                      <tr key={item.description} style={{ borderBottom: idx < groupedList.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none' }}>
                        <td style={{ padding: '0.75rem', color: 'white' }}>{item.description}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: '#bfc9da' }}>{item.count}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: 'white', fontWeight: 500 }}>
                          {getCurrencySymbol(primaryCurrency)}{item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: '#bfc9da' }}>
                          {getCurrencySymbol(primaryCurrency)}{(item.total / item.count).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: '#888', textAlign: 'center', padding: '1rem' }}>No transactions found in this category.</p>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default SankeyDiagram;

