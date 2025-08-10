class TimezoneHandler {
    constructor() {
        this.userTimezone = null;
        this.init();
    }

    init() {
        // Get user's preferred timezone from the page
        const timezoneElement = document.querySelector('[data-user-timezone]');
        if (timezoneElement) {
            this.userTimezone = timezoneElement.getAttribute('data-user-timezone');
        }

        // Only use browser timezone if user hasn't set a preference
        if (!this.userTimezone || this.userTimezone === 'UTC') {
            try {
                this.userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
                console.log('Detected browser timezone:', this.userTimezone);
            } catch (error) {
                console.warn('Error detecting user timezone:', error);
                this.userTimezone = 'UTC';
            }
        } else {
            console.log('Using user-configured timezone:', this.userTimezone);
        }
        
        // Initialize form handlers
        this.initializeFormHandlers();
    }

    initializeFormHandlers() {
        // Handle add log form
        const addLogForm = document.querySelector('#add-log-form');
        if (addLogForm) {
            this.setupAddLogForm(addLogForm);
        }

        // Handle edit log forms
        const editLogForms = document.querySelectorAll('.edit-log-form');
        editLogForms.forEach(form => this.setupEditLogForm(form));
    }

    setupAddLogForm(form) {
        const dateInput = form.querySelector('input[name="log_date"]');
        const timeInput = form.querySelector('input[name="log_time"]');
        
        if (!dateInput || !timeInput) return;

        // Only set default time if it's empty and user has a configured timezone
        // The server already provides the correct time in user's timezone
        if (!timeInput.value && this.userTimezone && this.userTimezone !== 'UTC') {
            this.setDefaultTime(timeInput);
        }

        // Add timezone conversion on form submission
        form.addEventListener('submit', (e) => {
            this.handleFormSubmission(e, form, dateInput, timeInput);
        });
    }

    setupEditLogForm(form) {
        const dateInput = form.querySelector('input[name="log_date"]');
        const timeInput = form.querySelector('input[name="log_time"]');
        
        if (!dateInput || !timeInput) return;

        // Add timezone conversion on form submission
        form.addEventListener('submit', (e) => {
            this.handleFormSubmission(e, form, dateInput, timeInput);
        });
    }

    setDefaultTime(timeInput) {
        if (!this.userTimezone || timeInput.value) return;

        try {
            // Get current time in user's configured timezone (not browser timezone)
            const now = new Date();
            const userTime = new Date(now.toLocaleString('en-US', {timeZone: this.userTimezone}));
            
            const hours = userTime.getHours().toString().padStart(2, '0');
            const minutes = userTime.getMinutes().toString().padStart(2, '0');
            timeInput.value = `${hours}:${minutes}`;
            
            console.log(`Set default time to ${timeInput.value} in timezone ${this.userTimezone}`);
        } catch (error) {
            console.warn('Error setting default timezone time:', error);
        }
    }

    handleFormSubmission(event, form, dateInput, timeInput) {
        // Disable frontend timezone conversion - let server handle it properly
        console.log('Frontend timezone conversion disabled - server will handle timezone conversion');
        
        // Just add the timezone info for the server to use
        this.addTimezoneInfo(form);
    }

    createDateInTimezone(dateStr, timeStr, timezone) {
        // Simplified approach: Let the server handle timezone conversion
        // We'll just pass the user's input and timezone info to the server
        // This avoids complex JavaScript timezone calculations
        
        try {
            // For now, just create a simple date object
            // The server will handle the proper timezone conversion
            const dateTime = new Date(`${dateStr}T${timeStr}:00`);
            
            console.log(`User input: ${dateStr} ${timeStr} (${timezone})`);
            console.log(`Will be processed server-side for timezone conversion`);
            
            return dateTime;
            
        } catch (error) {
            console.error('Error in createDateInTimezone:', error);
            // Fallback to simple date creation
            return new Date(`${dateStr}T${timeStr}:00`);
        }
    }

    addTimezoneInfo(form) {
        // Remove existing timezone fields
        const existingFields = form.querySelectorAll('.timezone-info-field');
        existingFields.forEach(field => field.remove());
        
        // Add timezone info field for server-side processing
        const timezoneField = document.createElement('input');
        timezoneField.type = 'hidden';
        timezoneField.name = 'user_timezone';
        timezoneField.value = this.userTimezone;
        timezoneField.className = 'timezone-info-field';
        form.appendChild(timezoneField);
        
        console.log(`Added timezone info: ${this.userTimezone}`);
    }

    addHiddenTimezoneFields(form, utcDateTime) {
        // Remove existing hidden timezone fields
        const existingFields = form.querySelectorAll('.timezone-converted-field');
        existingFields.forEach(field => field.remove());
        
        // Add UTC date field
        const utcDateField = document.createElement('input');
        utcDateField.type = 'hidden';
        utcDateField.name = 'utc_log_date';
        utcDateField.value = utcDateTime.toISOString().split('T')[0];
        utcDateField.className = 'timezone-converted-field';
        form.appendChild(utcDateField);
        
        // Add UTC time field
        const utcTimeField = document.createElement('input');
        utcTimeField.type = 'hidden';
        utcTimeField.name = 'utc_log_time';
        const hours = utcDateTime.getUTCHours().toString().padStart(2, '0');
        const minutes = utcDateTime.getUTCMinutes().toString().padStart(2, '0');
        utcTimeField.value = `${hours}:${minutes}`;
        utcTimeField.className = 'timezone-converted-field';
        form.appendChild(utcTimeField);
        
        // Add timezone info field
        const timezoneField = document.createElement('input');
        timezoneField.type = 'hidden';
        timezoneField.name = 'user_timezone';
        timezoneField.value = this.userTimezone;
        timezoneField.className = 'timezone-converted-field';
        form.appendChild(timezoneField);
        
        console.log(`Added hidden fields: UTC date=${utcDateField.value}, UTC time=${utcTimeField.value}, timezone=${this.userTimezone}`);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TimezoneHandler();
});

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimezoneHandler;
}
