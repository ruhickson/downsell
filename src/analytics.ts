// Netlify Analytics tracking utility

declare global {
  interface Window {
    netlify?: {
      track: (eventName: string, data?: Record<string, any>) => void;
    };
  }
}

// Track custom events for Netlify Analytics
export function trackEvent(eventName: string, data?: Record<string, any>) {
  // Check if Netlify Analytics is available
  if (typeof window !== 'undefined' && window.netlify?.track) {
    try {
      window.netlify.track(eventName, data || {});
    } catch (error) {
      console.warn('Failed to track event:', error);
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

