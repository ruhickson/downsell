// Analytics tracking utility (Netlify Functions)

// Track custom events via Netlify Function
export function trackEvent(eventName: string, data?: Record<string, any>) {
  if (typeof window !== 'undefined') {
    // Send event to Netlify Function (will appear in Function Metrics)
    try {
      fetch('/.netlify/functions/track-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventName,
          data: data || {},
        }),
      }).catch((error) => {
        // Silently fail - don't interrupt user experience
        console.debug('Event tracking failed (non-blocking):', error);
      });
    } catch (error) {
      // Silently fail - don't interrupt user experience
      console.debug('Event tracking failed (non-blocking):', error);
    }
  }
}

// Track page views (for SPA navigation)
export function trackPageView(pageName: string) {
  trackEvent('page_view', { page: pageName });
}

// Track button clicks
export function trackButtonClick(buttonName: string, context?: Record<string, any>) {
  trackEvent('button_click', { button: buttonName, ...context });
}

// Track CSV upload
export function trackCSVUpload(rowCount: number, bankType?: string) {
  trackEvent('csv_upload', { 
    row_count: rowCount,
    bank_type: bankType || 'unknown'
  });
}

// Track PDF download
export function trackPDFDownload() {
  trackEvent('pdf_download', {});
}

// Track tab navigation
export function trackTabNavigation(tabName: string) {
  trackEvent('tab_navigation', { tab: tabName });
}

