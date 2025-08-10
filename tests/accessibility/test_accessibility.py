"""
Accessibility tests for the Nicotine Tracker application using Selenium and Axe.

These tests require a running instance of the Flask application and a ChromeDriver.
Make sure to have ChromeDriver installed and available in your PATH.
"""
import pytest
from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager
from axe_selenium_python import Axe
import json

# URL of the running Flask application
BASE_URL = "http://127.0.0.1:5000"

@pytest.fixture(scope="module")
def driver():
    """
    Pytest fixture to set up and tear down the Selenium WebDriver.
    This uses webdriver-manager to automatically download the correct ChromeDriver.
    """
    options = webdriver.ChromeOptions()
    options.add_argument("--headless")  # Run in headless mode for CI environments
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    
    # Use webdriver-manager to handle the driver
    service = ChromeService(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    
    yield driver
    
    driver.quit()

def run_axe_test(driver, url, file_path='axe_results.json'):
    """
    Helper function to navigate to a URL and run an Axe accessibility test.
    """
    driver.get(url)
    axe = Axe(driver)
    
    # Inject axe-core javascript into page
    axe.inject()
    
    # Run axe accessibility checks.
    results = axe.run()
    
    # Write results to file for debugging
    axe.write_results(results, file_path)
    
    # We assert that there are no violations.
    # For a real project, you might want to filter out minor issues.
    assert len(results["violations"]) == 0, f"Axe violations found on {url}:\n{json.dumps(results['violations'], indent=2)}"

class TestAccessibility:
    """
    A collection of accessibility tests for key pages.
    These tests require the Flask application to be running separately.
    """

    def test_login_page_accessibility(self, driver):
        """
        Tests the accessibility of the login page.
        """
        run_axe_test(driver, f"{BASE_URL}/auth/login", 'axe_login.json')

    def test_dashboard_page_accessibility(self, driver):
        """
        Tests the accessibility of the dashboard page.
        This requires logging in first.
        """
        # First, log in
        driver.get(f"{BASE_URL}/auth/login")
        driver.find_element("id", "email").send_keys("test@example.com")
        driver.find_element("id", "password").send_keys("password123")
        driver.find_element("css selector", "button[type='submit']").click()
        
        # Now, test the dashboard
        run_axe_test(driver, f"{BASE_URL}/dashboard/", 'axe_dashboard.json')

    def test_settings_page_accessibility(self, driver):
        """
        Tests the accessibility of the settings page.
        """
        # Assumes the user is already logged in from the previous test
        run_axe_test(driver, f"{BASE_URL}/settings/profile", 'axe_settings.json')

    def test_add_log_page_accessibility(self, driver):
        """
        Tests the accessibility of the add log page.
        """
        run_axe_test(driver, f"{BASE_URL}/logging/add", 'axe_add_log.json')
