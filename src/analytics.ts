// Analytics tracking utility (Netlify Functions)
// Each event type has its own function for separate metrics tracking

// Check if user has consented to analytics cookies
function hasConsentedToCookies(): boolean {
  if (typeof window === 'undefined') return false;
  const consent = localStorage.getItem('cookie-consent');
  return consent === 'accepted';
}

// Helper to send event to specific function
function sendEvent(functionName: string, data: Record<string, any>) {
  // Only track if user has consented to cookies
  if (!hasConsentedToCookies()) {
    return; // Silently skip tracking if consent not given
  }
  
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

