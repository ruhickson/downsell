// Analytics tracking utility (Netlify Functions)
// Each event type has its own function for separate metrics tracking

// Helper to send event to specific function
function sendEvent(functionName: string, data: Record<string, any>) {
  if (typeof window !== 'undefined') {
    try {
      fetch(`/.netlify/functions/${functionName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      }).catch((error) => {
        // Silently fail - don't interrupt user experience
        console.debug(`Event tracking failed (non-blocking): ${functionName}`, error);
      });
    } catch (error) {
      // Silently fail - don't interrupt user experience
      console.debug(`Event tracking failed (non-blocking): ${functionName}`, error);
    }
  }
}

// Track page views (for SPA navigation)
export function trackPageView(pageName: string) {
  sendEvent('track-page-view', { page: pageName });
}

// Track button clicks
export function trackButtonClick(buttonName: string, context?: Record<string, any>) {
  sendEvent('track-button-click', { buttonName, ...context });
}

// Track CSV upload
export function trackCSVUpload(rowCount: number, bankType?: string, method?: string) {
  sendEvent('track-csv-upload', { 
    rowCount,
    bankType: bankType || 'unknown',
    method: method || 'unknown'
  });
}

// Track PDF download
export function trackPDFDownload() {
  sendEvent('track-pdf-download', {});
}

// Track tab navigation
export function trackTabNavigation(tabName: string) {
  sendEvent('track-tab-navigation', { tabName });
}

