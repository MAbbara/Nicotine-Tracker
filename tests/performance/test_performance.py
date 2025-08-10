"""
Performance and load tests for the Nicotine Tracker application using Locust.

To run these tests:
1. Make sure the Flask app is running.
2. Run `locust -f tests/performance/test_performance.py` in your terminal.
3. Open a web browser to http://localhost:8089 and start a new load test.

Note: This script assumes a test user with email 'test@example.com' and password 'password123' exists.
"""
from locust import HttpUser, task, between

class WebsiteUser(HttpUser):
    wait_time = between(1, 5)  # Wait 1-5 seconds between tasks
    
    def on_start(self):
        """On start, log in a user."""
        self.client.post("/login", {
            "email": "test@example.com",
            "password": "password123"
        })

    @task(3)
    def view_dashboard(self):
        """Simulate a user viewing the dashboard."""
        self.client.get("/dashboard/")

    @task(2)
    def view_logs(self):
        """Simulate a user viewing their log history."""
        self.client.get("/logging/view")

    @task(1)
    def view_goals(self):
        """Simulate a user viewing their goals."""
        self.client.get("/goals/")

    @task(1)
    def view_catalog(self):
        """Simulate a user viewing the pouch catalog."""
        self.client.get("/catalog/")

    @task(1)
    def add_log_page(self):
        """Simulate a user visiting the add log page."""
        self.client.get("/logging/add")
