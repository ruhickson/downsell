import React from 'react';
import { getCategoryColor, type Category } from './categories';

interface SankeyDiagramProps {
  data: Record<string, number>; // Category -> total spending
}

const SankeyDiagram: React.FC<SankeyDiagramProps> = ({ data }) => {
  // Calculate total spending
  const totalSpending = Object.values(data).reduce((sum, val) => sum + val, 0);
  
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

  // Calculate layout
  const nodeHeight = 30;
  const nodeSpacing = 10;
  const leftColumnX = 50;
  const rightColumnX = 400;
  const startY = 50;
  const svgHeight = Math.max(400, nodes.length * (nodeHeight + nodeSpacing) + 100);
  const svgWidth = 800;

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
    const sourceX = leftColumnX + 150; // End of source node
    const targetX = rightColumnX; // Start of target node
    const sourceCenterY = sourceY + sourceHeight / 2;
    const targetCenterY = targetY + targetHeight / 2;
    
    const controlPoint1X = sourceX + (targetX - sourceX) * 0.5;
    const controlPoint2X = sourceX + (targetX - sourceX) * 0.5;
    
    return `M ${sourceX} ${sourceCenterY} C ${controlPoint1X} ${sourceCenterY}, ${controlPoint2X} ${targetCenterY}, ${targetX} ${targetCenterY}`;
  };

  return (
    <div style={{ width: '100%', overflowX: 'auto', marginBottom: '2rem' }}>
      <svg width={svgWidth} height={svgHeight} style={{ background: 'transparent' }}>
        {/* Draw links first (so nodes appear on top) */}
        {links.map((link, index) => {
          const sourceY = leftNodeY;
          const sourceHeight = leftNodeHeight;
          const targetY = rightNodesY[index];
          const targetHeight = nodeHeight;
          const path = calculateLinkPath(sourceY, sourceHeight, targetY, targetHeight);
          
          // Calculate link width based on value
          const linkWidth = Math.max(2, (link.value / totalSpending) * 20);
          const opacity = 0.3 + (link.value / totalSpending) * 0.7;
          
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
          x={leftColumnX + 75}
          y={leftNodeY + leftNodeHeight / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize="14"
          fontWeight="bold"
        >
          Total Spending
        </text>
        <text
          x={leftColumnX + 75}
          y={leftNodeY + leftNodeHeight / 2 + 18}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize="12"
          opacity={0.9}
        >
          €{totalSpending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </text>

        {/* Draw category nodes */}
        {categories.map(([category, value], index) => {
          const y = rightNodesY[index];
          const percentage = ((value / totalSpending) * 100).toFixed(1);
          const nodeWidth = 180;
          
          return (
            <g key={category}>
              <rect
                x={rightColumnX}
                y={y}
                width={nodeWidth}
                height={nodeHeight}
                fill={nodes[index + 1].color}
                rx={4}
                style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}
              />
              <text
                x={rightColumnX + nodeWidth / 2}
                y={y + nodeHeight / 2 - 6}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="12"
                fontWeight="500"
              >
                {category}
              </text>
              <text
                x={rightColumnX + nodeWidth / 2}
                y={y + nodeHeight / 2 + 10}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="11"
                opacity={0.9}
              >
                €{value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({percentage}%)
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default SankeyDiagram;

