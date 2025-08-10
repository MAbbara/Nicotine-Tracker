// User menu toggle and global initialisation
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();

    // Toggle profile menu in the navbar
    const userMenuButton = document.getElementById('user-menu-button');
    const userMenu = document.getElementById('user-menu');
    if (userMenuButton && userMenu) {
        userMenuButton.addEventListener('click', function(event) {
            event.stopPropagation();
            const isExpanded = userMenuButton.getAttribute('aria-expanded') === 'true';
            userMenuButton.setAttribute('aria-expanded', !isExpanded);
            userMenu.classList.toggle('hidden');
        });
        // Close menu when clicking outside
        document.addEventListener('click', function(event) {
            if (!userMenu.contains(event.target) && !userMenuButton.contains(event.target)) {
                userMenu.classList.add('hidden');
                userMenuButton.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // Set current time as default
    const timeInput = document.getElementById('log_time');
    if (timeInput) {
        const now = new Date();
        const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                           now.getMinutes().toString().padStart(2, '0');
        timeInput.value = currentTime;
    }
});

function initializeApp() {
    // Tooltips and form validation
    initializeTooltips();
    initializeFormValidations();

    // Dashboard charts and insights
    if (document.getElementById('dailyIntakeChart')) {
        loadDailyIntakeChart();
        loadHourlyChart();
        loadInsights();

        const openModalBtn = document.getElementById('openAddLogModal');
        const closeModalBtn = document.getElementById('closeAddLogModal');
        const addLogModal = document.getElementById('addLogModal');
        if (openModalBtn && closeModalBtn && addLogModal) {
            openModalBtn.addEventListener('click', () => addLogModal.classList.remove('hidden'));
            closeModalBtn.addEventListener('click', () => addLogModal.classList.add('hidden'));
        }
    }

    initializeQuickAdd();
    checkNotifications();
}

// Tooltip helper functions
function initializeTooltips() {
    const tooltips = document.querySelectorAll('[data-tooltip]');
    tooltips.forEach(element => {
        element.addEventListener('mouseenter', showTooltip);
        element.addEventListener('mouseleave', hideTooltip);
    });
}

function showTooltip(event) {
    const text = event.target.getAttribute('data-tooltip');
    const tooltip = document.createElement('div');
    tooltip.className = 'absolute z-50 px-2 py-1 text-sm text-white bg-gray-900 rounded shadow-lg';
    tooltip.textContent = text;
    tooltip.id = 'tooltip';
    document.body.appendChild(tooltip);
    const rect = event.target.getBoundingClientRect();
    tooltip.style.left = rect.left + 'px';
    tooltip.style.top = (rect.top - tooltip.offsetHeight - 5) + 'px';
}

function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) tooltip.remove();
}

// Form validation helpers
function initializeFormValidations() {
    const forms = document.querySelectorAll('form[data-validate]');
    forms.forEach(form => {
        form.addEventListener('submit', validateForm);
    });
}

function validateForm(event) {
    const form = event.target;
    const requiredFields = form.querySelectorAll('[required]');
    let isValid = true;
    requiredFields.forEach(field => {
        if (!field.value.trim()) {
            showFieldError(field, 'This field is required');
            isValid = false;
        } else {
            clearFieldError(field);
        }
    });
    // Email validation
    const emailFields = form.querySelectorAll('input[type="email"]');
    emailFields.forEach(field => {
        if (field.value && !isValidEmail(field.value)) {
            showFieldError(field, 'Please enter a valid email address');
            isValid = false;
        }
    });
    // Password confirmation
    const passwordField = form.querySelector('input[name="password"]');
    const confirmField = form.querySelector('input[name="confirm_password"]');
    if (passwordField && confirmField && passwordField.value !== confirmField.value) {
        showFieldError(confirmField, 'Passwords do not match');
        isValid = false;
    }
    if (!isValid) event.preventDefault();
}

function showFieldError(field, message) {
    clearFieldError(field);
    const errorDiv = document.createElement('div');
    errorDiv.className = 'text-red-600 text-sm mt-1';
    errorDiv.textContent = message;
    errorDiv.setAttribute('data-error-for', field.name);
    field.parentNode.appendChild(errorDiv);
    field.classList.add('border-red-500');
}

function clearFieldError(field) {
    const existingError = field.parentNode.querySelector(`[data-error-for="${field.name}"]`);
    if (existingError) existingError.remove();
    field.classList.remove('border-red-500');
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// ApexCharts loaders
function loadDailyIntakeChart() {
  fetch('/dashboard/api/daily_intake_chart?days=30')
    .then(res => res.json())
    .then(data => {
      if (!data.success) return;

      const chartDom = document.querySelector('#dailyIntakeChart');
      if (!chartDom) return;
      if (chartDom._apexcharts) chartDom._apexcharts.destroy();

      const isDark = document.documentElement.classList.contains('dark');
      const seriesColor = isDark ? '#A78BFA' : '#8B5CF6';  // violet-400 ↔ violet-600
      const axisColor   = isDark ? '#D1D5DB' : '#4B5563';  // gray-300 ↔ gray-600
      const gridColor   = isDark ? '#374151' : '#E5E7EB';  // gray-700 ↔ gray-200
      const bgColor     = isDark ? '#1F2937' : '#FFF';

      const options = {
        chart: {
          type: 'line',
          height: chartDom.clientHeight || 256,
          toolbar: { show: false },
          zoom: { enabled: false },
          background: bgColor
        },
        series: [{ name: 'Pouches', data: data.data.map(d => d.pouches) }],
        colors: [ seriesColor ],
        stroke: { curve: 'straight', width: 2 },
        fill: {
          type: 'gradient',
          gradient: {
            shade: 'dark',
            shadeIntensity: 0.2,
            opacityFrom: 0.2,
            opacityTo: 0.6,
            stops: [0, 80, 100]
          }
        },
        xaxis: {
          categories: data.data.map(d => new Date(d.date).toLocaleDateString()),
          labels: { style: { colors: axisColor, fontSize: '12px' } }
        },
        yaxis: {
          min: 0,
          labels: { style: { colors: axisColor, fontSize: '12px' } }
        },
        grid: {
          borderColor: gridColor,
          strokeDashArray: 4
        },
        theme: {
          mode: isDark ? 'dark' : 'light'
        }
      };

      new ApexCharts(chartDom, options).render();
    })
    .catch(err => console.error(err));
}



function loadHourlyChart() {
  fetch('/dashboard/api/hourly_distribution?days=30')
    .then(res => res.json())
    .then(data => {
      if (!data.success) return;

      const chartDom = document.querySelector('#hourlyChart');
      if (!chartDom) return;
      if (chartDom._apexcharts) chartDom._apexcharts.destroy();

      const isDark = document.documentElement.classList.contains('dark');

      // use Tailwind’s green-500 in light, green-400 in dark
      const seriesColor = isDark ? '#4ADE80' : '#22C55E';
      // axis/grid colors
      const axisColor   = isDark ? '#D1D5DB' : '#4B5563';  // gray-300 ↔ gray-600
      const gridColor   = isDark ? '#374151' : '#E5E7EB';  // gray-600 vs gray-200
      // chart background
      const bgColor     = isDark ? '#1F2937' : '#FFFFFF';  // gray-800 vs white

      const options = {
        chart: {
          type: 'bar',
          height: chartDom.clientHeight || 256,
          toolbar: { show: false },
          background: bgColor,
        },
        series: [{ name: 'Pouches', data: data.data.map(d => d.pouches) }],
        colors: [ seriesColor ],
        xaxis: {
          categories: data.data.map(d => d.hour),
          labels: { style: { colors: axisColor, fontSize: '12px' } }
        },
        yaxis: {
          min: 0,
          labels: { style: { colors: axisColor, fontSize: '12px' } }
        },
        grid: {
          borderColor: gridColor,
          strokeDashArray: 4
        },
        theme: {
          mode: isDark ? 'dark' : 'light'
        }
      };

      new ApexCharts(chartDom, options).render();
    })
    .catch(err => console.error(err));
}



function loadInsights() {
    fetch('/dashboard/api/insights')
        .then(response => response.json())
        .then(data => {
            const insightsContent = document.getElementById('insights-content');
            if (!insightsContent) return;
            if (data.success && data.insights.length > 0) {
                insightsContent.innerHTML = data.insights.map(insight =>
                    `<p class="text-sm text-gray-600 dark:text-gray-400 mb-2">• ${insight}</p>`
                ).join('');
            } else {
                insightsContent.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400">No insights available yet. Add more log entries to see personalized insights.</p>';
            }
        })
        .catch(err => {
            console.error('Error loading insights:', err);
            const insightsContent = document.getElementById('insights-content');
            if (insightsContent) {
                insightsContent.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400">Unable to load insights.</p>';
            }
        });
}

// Quick add buttons
function initializeQuickAdd() {
    const quickAddButtons = document.querySelectorAll('[data-quick-add]');
    quickAddButtons.forEach(button => {
        button.addEventListener('click', handleQuickAdd);
    });
}

function handleQuickAdd(event) {
    const button = event.target;
    const pouchId = button.getAttribute('data-pouch-id');
    const quantity = button.getAttribute('data-quantity') || 1;
    if (!pouchId) return;
    const originalText = button.textContent;
    button.textContent = 'Adding...';
    button.disabled = true;
    fetch('/log/api/quick_add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pouch_id: pouchId, quantity: parseInt(quantity) })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification(data.message, 'success');
            if (typeof refreshDashboard === 'function') {
                refreshDashboard();
            }
        } else {
            showNotification(data.error || 'Failed to add log entry', 'error');
        }
    })
    .catch(err => {
        console.error('Quick add error:', err);
        showNotification('An error occurred while adding the log entry', 'error');
    })
    .finally(() => {
        button.textContent = originalText;
        button.disabled = false;
    });
}

// Notification helpers
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm ${getNotificationClasses(type)}`;
    notification.innerHTML = `
        <div class="flex items-center">
            <div class="flex-shrink-0">${getNotificationIcon(type)}</div>
            <div class="ml-3"><p class="text-sm font-medium">${message}</p></div>
            <div class="ml-auto pl-3">
                <button onclick="this.parentElement.parentElement.parentElement.remove()" class="text-gray-400 hover:text-gray-600">
                    <span class="sr-only">Close</span>
                    <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                    </svg>
                </button>
            </div>
        </div>`;
    document.body.appendChild(notification);
    setTimeout(() => { if (notification.parentNode) notification.remove(); }, 5000);
}

function getNotificationClasses(type) {
    switch (type) {
        case 'success': return 'bg-green-50 border border-green-200 text-green-800';
        case 'error': return 'bg-red-50 border border-red-200 text-red-800';
        case 'warning': return 'bg-yellow-50 border border-yellow-200 text-yellow-800';
        default: return 'bg-blue-50 border border-blue-200 text-blue-800';
    }
}

function getNotificationIcon(type) {
    switch (type) {
        case 'success':
            return '<svg class="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>';
        case 'error':
            return '<svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>';
        case 'warning':
            return '<svg class="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>';
        default:
            return '<svg class="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>';
    }
}

// Notifications checker
function checkNotifications() {
    if (window.location.pathname.includes('/dashboard') || window.location.pathname.includes('/goals')) {
        fetch('/goals/api/check_notifications')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.notifications.length > 0) {
                    data.notifications.forEach(notification => {
                        showNotification(notification.message, notification.type);
                    });
                }
            })
            .catch(err => console.error('Error checking notifications:', err));
    }
}

// Utility functions (optional use)
function formatDate(date) { return new Date(date).toLocaleDateString(); }
function formatTime(time) { return new Date(`2000-01-01T${time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function formatNumber(number, decimals = 0) { return Number(number).toFixed(decimals); }

window.NicotineTracker = {
    showNotification,
    formatDate,
    formatTime,
    formatNumber,
    isValidEmail
};

// Form submission loading state
document.addEventListener('submit', function(event) {
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton && !submitButton.disabled) {
        const originalText = submitButton.textContent;
        submitButton.textContent = 'Loading...';
        submitButton.disabled = true;
        setTimeout(() => {
            if (submitButton.disabled) {
                submitButton.textContent = originalText;
                submitButton.disabled = false;
            }
        }, 10000);
    }
});

// Global promise rejection handler
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    showNotification('An unexpected error occurred. Please try again.', 'error');
});

// Optional autosave helpers and dark mode toggles remain unchanged


// Handle AJAX errors globally
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    showNotification('An unexpected error occurred. Please try again.', 'error');
});

// Auto-save functionality for forms (optional)
function enableAutoSave(formSelector, saveEndpoint) {
    const form = document.querySelector(formSelector);
    if (!form) return;
    
    const inputs = form.querySelectorAll('input, textarea, select');
    let saveTimeout;
    
    inputs.forEach(input => {
        input.addEventListener('input', function() {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                autoSaveForm(form, saveEndpoint);
            }, 2000); // Save after 2 seconds of inactivity
        });
    });
}

function autoSaveForm(form, endpoint) {
    const formData = new FormData(form);
    
    fetch(endpoint, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('Form auto-saved');
        }
    })
    .catch(error => {
        console.error('Auto-save failed:', error);
    });
}

// Dark mode toggle (if implemented)
function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('darkMode', document.documentElement.classList.contains('dark'));
}

// Initialize dark mode from localStorage
if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.classList.add('dark');
}
