// Responsive Layout Switcher - Detects screen changes and suggests PC/Mobile switching
(function() {
  'use strict';

  const MOBILE_BREAKPOINT = 768; // px - standard tablet/mobile breakpoint
  const STORAGE_KEY = 'layoutPreference';
  const POPUP_COOLDOWN = 300000; // 5 minutes in ms - don't show popup too frequently

  let currentMode = null;
  let lastPopupTime = 0;

  // Detect current device mode based on screen width
  function detectMode() {
    return window.innerWidth <= MOBILE_BREAKPOINT ? 'mobile' : 'desktop';
  }

  // Get stored user preference
  function getStoredPreference() {
    try {
      const pref = localStorage.getItem(STORAGE_KEY);
      return pref ? JSON.parse(pref) : null;
    } catch (e) {
      return null;
    }
  }

  // Store user preference
  function storePreference(mode, autoSwitch) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: mode,
        autoSwitch: autoSwitch,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.log('[Responsive] Cannot store preference');
    }
  }

  // Get corresponding page URL for the other mode
  function getCorrespondingUrl(targetMode) {
    const currentUrl = new URL(window.location.href);
    const pathname = currentUrl.pathname;
    
    // Map of mobile <-> desktop page pairs
    const pageMap = {
      // Mobile pages -> Desktop pages
      '/dashboard-mobile.html': '/dashboard.html',
      '/community-mobile.html': '/community.html',
      '/instructor-mobile.html': '/instructor.html',
      
      // Desktop pages -> Mobile pages  
      '/dashboard.html': '/dashboard-mobile.html',
      '/community.html': '/community-mobile.html',
      '/instructor.html': '/instructor-mobile.html'
    };

    // Check if current page has a corresponding page
    if (pageMap[pathname]) {
      currentUrl.pathname = pageMap[pathname];
      return currentUrl.toString();
    }

    // For pages that don't have mobile/desktop pairs, return null
    return null;
  }

  // Show popup notification
  function showSwitchPopup(targetMode, targetUrl) {
    const now = Date.now();
    
    // Check cooldown to avoid spamming
    if (now - lastPopupTime < POPUP_COOLDOWN) {
      return;
    }
    lastPopupTime = now;

    // Check if user previously chose "don't ask again" for this mode
    const preference = getStoredPreference();
    if (preference && preference.mode === targetMode && preference.autoSwitch === false) {
      return;
    }

    // Create popup HTML
    const popup = document.createElement('div');
    popup.id = 'responsive-switch-popup';
    popup.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        padding: 16px 20px;
        z-index: 9999;
        max-width: 320px;
        width: 90%;
        font-family: 'Inter', -apple-system, sans-serif;
        animation: slideDown 0.3s ease;
      ">
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="
            width: 40px;
            height: 40px;
            background: #3b82f6;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
              <path d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/>
            </svg>
          </div>
          <div style="flex: 1;">
            <h3 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #1f2937;">
              화면 크기가 변경되었습니다
            </h3>
            <p style="margin: 0 0 12px 0; font-size: 13px; color: #6b7280; line-height: 1.4;">
              ${targetMode === 'mobile' ? '모바일' : 'PC'} 화면에 최적화된 레이아웃으로 전환하시겠어요?
            </p>
            <div style="display: flex; gap: 8px;">
              <button id="switch-yes" style="
                flex: 1;
                padding: 8px 12px;
                background: #3b82f6;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
              ">전환하기</button>
              <button id="switch-no" style="
                flex: 1;
                padding: 8px 12px;
                background: #f3f4f6;
                color: #4b5563;
                border: none;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
              ">현재 유지</button>
            </div>
            <button id="switch-never" style="
              margin-top: 8px;
              padding: 0;
              background: none;
              border: none;
              color: #9ca3af;
              font-size: 12px;
              cursor: pointer;
              text-decoration: underline;
            ">다시 묻지 않기</button>
          </div>
          <button id="switch-close" style="
            padding: 4px;
            background: none;
            border: none;
            cursor: pointer;
            flex-shrink: 0;
          ">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
      <style>
        @keyframes slideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      </style>
    `;

    document.body.appendChild(popup);

    // Event handlers
    popup.querySelector('#switch-yes').addEventListener('click', () => {
      storePreference(targetMode, true);
      window.location.href = targetUrl;
    });

    popup.querySelector('#switch-no').addEventListener('click', () => {
      popup.remove();
    });

    popup.querySelector('#switch-never').addEventListener('click', () => {
      storePreference(targetMode, false);
      popup.remove();
    });

    popup.querySelector('#switch-close').addEventListener('click', () => {
      popup.remove();
    });

    // Auto-close after 10 seconds
    setTimeout(() => {
      if (popup.parentNode) {
        popup.remove();
      }
    }, 10000);
  }

  // Check if we're on a page that can switch
  function canSwitch() {
    const pathname = window.location.pathname;
    const switchablePages = [
      '/dashboard-mobile.html', '/dashboard.html',
      '/community-mobile.html', '/community.html',
      '/instructor-mobile.html', '/instructor.html'
    ];
    return switchablePages.includes(pathname);
  }

  // Initialize
  function init() {
    if (!canSwitch()) {
      console.log('[Responsive] Page not in switchable list');
      return;
    }

    currentMode = detectMode();
    console.log('[Responsive] Initial mode:', currentMode);

    // Listen for resize events
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const newMode = detectMode();
        
        if (newMode !== currentMode) {
          console.log('[Responsive] Mode changed from', currentMode, 'to', newMode);
          
          const targetUrl = getCorrespondingUrl(newMode);
          if (targetUrl) {
            showSwitchPopup(newMode, targetUrl);
          }
          
          currentMode = newMode;
        }
      }, 500); // Debounce resize events
    });

    // Also check on orientation change for mobile devices
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        const newMode = detectMode();
        if (newMode !== currentMode) {
          const targetUrl = getCorrespondingUrl(newMode);
          if (targetUrl) {
            showSwitchPopup(newMode, targetUrl);
          }
          currentMode = newMode;
        }
      }, 300);
    });
    
    // Use matchMedia for more reliable detection (works with desktop view mode)
    const mobileMediaQuery = window.matchMedia('(max-width: 768px)');
    const handleMediaChange = (e) => {
      const newMode = e.matches ? 'mobile' : 'desktop';
      if (newMode !== currentMode) {
        console.log('[Responsive] Media query changed to:', newMode);
        const targetUrl = getCorrespondingUrl(newMode);
        if (targetUrl) {
          showSwitchPopup(newMode, targetUrl);
        }
        currentMode = newMode;
      }
    };
    
    // Modern browsers
    if (mobileMediaQuery.addEventListener) {
      mobileMediaQuery.addEventListener('change', handleMediaChange);
    } else if (mobileMediaQuery.addListener) {
      // Legacy support
      mobileMediaQuery.addListener(handleMediaChange);
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
