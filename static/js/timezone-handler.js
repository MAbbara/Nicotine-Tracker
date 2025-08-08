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

        // Set default values in user's timezone
        this.setDefaultDateTime(dateInput, timeInput);

        // Add timezone conversion on form submission
        form.addEventListener('submit', (e) => {
            this.handleFormSubmission(e, form, dateInput, timeInput);
        });
    }

    setupEditLogForm(form) {
        const dateInput = form.querySelector('input[name="log_date"]');
        const timeInput = form.querySelector('input[name="log_time"]');
        
        if (!dateInput || !timeInput) return;

        // Convert existing UTC values to user timezone for editing
        this.convertExistingValues(dateInput, timeInput);

        // Add timezone conversion on form submission
        form.addEventListener('submit', (e) => {
            this.handleFormSubmission(e, form, dateInput, timeInput);
        });
    }

    setDefaultDateTime(dateInput, timeInput) {
        if (!this.userTimezone) return;

        try {
            // Get current time in user's timezone
            const now = new Date();
            const userTime = this.convertToUserTimezone(now);
            
            // Set default date
            if (!dateInput.value) {
                dateInput.value = userTime.toISOString().split('T')[0];
            }
            
            // Set default time
            if (!timeInput.value) {
                const hours = userTime.getHours().toString().padStart(2, '0');
                const minutes = userTime.getMinutes().toString().padStart(2, '0');
                timeInput.value = `${hours}:${minutes}`;
            }
        } catch (error) {
            console.warn('Error setting default timezone values:', error);
        }
    }

    convertExistingValues(dateInput, timeInput) {
        if (!this.userTimezone || !dateInput.value || !timeInput.value) return;

        try {
            // Parse the existing UTC values
            const utcDateStr = dateInput.value;
            const utcTimeStr = timeInput.value;
            
            // Create UTC datetime
            const utcDateTime = new Date(`${utcDateStr}T${utcTimeStr}:00.000Z`);
            
            // Convert to user timezone
            const userDateTime = this.convertToUserTimezone(utcDateTime);
            
            // Update form fields
            dateInput.value = userDateTime.toISOString().split('T')[0];
            const hours = userDateTime.getHours().toString().padStart(2, '0');
            const minutes = userDateTime.getMinutes().toString().padStart(2, '0');
            timeInput.value = `${hours}:${minutes}`;
        } catch (error) {
            console.warn('Error converting existing timezone values:', error);
        }
    }

    handleFormSubmission(event, form, dateInput, timeInput) {
        if (!this.userTimezone) return;

        try {
            // Get the user's input values
            const userDate = dateInput.value;
            const userTime = timeInput.value;
            
            if (!userDate || !userTime) return;

            // Convert user's local input to UTC
            const userDateTime = new Date(`${userDate}T${userTime}:00`);
            const utcDateTime = this.convertToUTC(userDateTime);
            
            // Create hidden fields with UTC values
            this.addHiddenTimezoneFields(form, utcDateTime);
            
        } catch (error) {
            console.warn('Error handling timezone conversion on form submission:', error);
        }
    }

    convertToUserTimezone(utcDate) {
        if (!this.userTimezone) return utcDate;
        
        // Use Intl.DateTimeFormat to convert to user's timezone
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: this.userTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        const parts = formatter.formatToParts(utcDate);
        const year = parts.find(p => p.type === 'year').value;
        const month = parts.find(p => p.type === 'month').value;
        const day = parts.find(p => p.type === 'day').value;
        const hour = parts.find(p => p.type === 'hour').value;
        const minute = parts.find(p => p.type === 'minute').value;
        const second = parts.find(p => p.type === 'second').value;
        
        return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    }

    convertToUTC(userDateTime) {
        if (!this.userTimezone) return userDateTime;
        
        // Create a date in the user's timezone
        const tempDate = new Date(userDateTime.toLocaleString('en-US', {timeZone: 'UTC'}));
        const userOffset = userDateTime.getTime() - tempDate.getTime();
        
        // Get the timezone offset for the user's timezone
        const userTzDate = new Date(userDateTime.toLocaleString('en-US', {timeZone: this.userTimezone}));
        const utcDate = new Date(userDateTime.toLocaleString('en-US', {timeZone: 'UTC'}));
        const tzOffset = userTzDate.getTime() - utcDate.getTime();
        
        // Apply the offset to get UTC time
        return new Date(userDateTime.getTime() - tzOffset);
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
