(() => {
  // Clear all pages: hide everything with .page class
  function clearPages() {
    document.querySelectorAll('.page').forEach(p => {
      p.classList.add('hidden');
      p.classList.remove('active');
    });
  }
  
  // Show a specific page
  function setPage(pageId) {
    clearPages();
    const page = document.getElementById('page' + pageId.charAt(0).toUpperCase() + pageId.slice(1));
    if (page) {
      page.classList.add('active');
      page.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  
  // Route function - determines which page to show based on URL hash
  function route() {
    const hash = location.hash.toLowerCase();
    
    if (hash === '#/scout' || hash === '#/scout.html') {
      setPage('Scout');
    } else if (hash === '#/guide') {
      setPage('Guide');
    } else if (hash === '#/feedback') {
      setPage('Feedback');
    } else if (hash === '#/app' || hash === '#/download' || hash === '#/apps') {
      setPage('Apps');
    } else {
      setPage('Home');
    }
  }
  
  // Set initial active tab in nav
  function setActiveTab(which) {
    const tabMap = {
      'home': 'navHomeBtn',
      'scout': 'navScoutBtn',
      'guide': 'navGuideBtn',
      'feedback': 'navFeedbackBtn',
      'apps': 'navAppsBtn'
    };
    if (tabMap[which]) {
      const btn = document.getElementById(tabMap[which]);
      if (btn) {
        document.querySelectorAll('.tab-btn').forEach(b => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
      }
    }
  }
  
  // Initialize
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  route();
  setActiveTab('home');
  
  // Handle form submissions
  document.addEventListener('submit', (e) => {
    const target = e.target;
    if (target.id === 'scoutForm') {
      e.preventDefault();
      document.getElementById('scoutStatus').textContent = 'Scout entry submitted! (Demo)';
      setTimeout(() => {
        document.getElementById('scoutStatus').textContent = '';
        target.reset();
      }, 2000);
    }
    if (target.id === 'feedbackForm') {
      e.preventDefault();
      document.getElementById('feedbackStatus').textContent = 'Thank you for your feedback!';
      setTimeout(() => {
        document.getElementById('feedbackStatus').textContent = '';
        target.reset();
      }, 2000);
    }
  });
})();