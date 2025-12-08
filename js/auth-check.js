(function(){
  // Minimal auth-check shim used by pages. Keeps behavior non-intrusive.
  try {
    if (typeof Cookies === 'undefined') return;
    // Expose helper to get user id quickly
    window.getCurrentUserId = function(){ return Cookies.get('userid') || null; };
    // If a page includes this script it may expect cookies and small helpers
    if (!Cookies.get('userid')) {
      // Do nothing by default; pages will handle showing "please login"
      // But keep a console note for debugging
      console.debug('[auth-check] userid cookie not found');
    }
  } catch (e) {
    console.warn('[auth-check] init error', e && e.message);
  }
})();
