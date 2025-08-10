"""
Security and static analysis tests for the Nicotine Tracker application.
"""
import pytest
import subprocess
import json
from flask import session

class TestSecurity:
    """A collection of security-focused tests."""

    def test_bandit_scan(self):
        """
        Runs the Bandit static analysis tool to find common security issues.
        Fails if any high-severity issues are found.
        """
        try:
            # We run bandit as a subprocess and capture the output.
            # -r: recursive scan
            # -f: json output format
            # -ll: report only high-severity issues
            # We target the 'app', 'models', 'routes', and 'services' directories.
            result = subprocess.run(
                ['bandit', '-r', 'app.py', 'models', 'routes', 'services', '-f', 'json', '-ll'],
                capture_output=True,
                text=True,
                check=False  # Don't raise an exception if bandit finds issues
            )
            
            # Bandit exits with a non-zero code if it finds issues.
            # We parse the JSON to see if there are any results.
            report = json.loads(result.stdout)
            
            # We assert that the list of results is empty.
            # If not, we print the results for debugging.
            assert len(report['results']) == 0, f"Bandit found high-severity issues: {json.dumps(report['results'], indent=2)}"

        except (FileNotFoundError, json.JSONDecodeError) as e:
            pytest.fail(f"Bandit scan failed to run or produced invalid output: {e}")

    def test_sql_injection_in_login(self, client):
        """
        Tests if the login form is vulnerable to basic SQL injection.
        """
        # A common SQL injection payload
        malicious_email = "' OR '1'='1"
        
        response = client.post('/login', data={
            'email': malicious_email,
            'password': 'anypassword'
        }, follow_redirects=True)
        
        # The application should treat this as a failed login, not a successful one.
        assert b'Invalid email or password' in response.data
        assert b'Dashboard' not in response.data

    def test_xss_in_log_notes(self, client, test_user):
        """
        Tests for Cross-Site Scripting (XSS) vulnerability in the log notes field.
        """
        with client:
            # Log in the user
            client.post('/login', data={'email': test_user.email, 'password': 'password123'}, follow_redirects=True)
            
            # A simple XSS payload
            xss_payload = '<script>alert("XSS")</script>'
            
            # Add a log with the malicious note
            client.post('/add_log', data={
                'pouch_id': 1,
                'quantity': 1,
                'log_time': '2023-01-01T12:00',
                'notes': xss_payload
            }, follow_redirects=True)
            
            # View the logs and check if the script tag is escaped
            response = client.get('/dashboard/')
            
            # The payload should be rendered as text, not executed as a script.
            # Flask's Jinja2 templating engine should auto-escape this by default.
            assert b'<script>alert("XSS")</script>' not in response.data
            assert b'<script>alert(&#34;XSS&#34;)</script>' in response.data

    def test_csrf_protection_on_forms(self, client, test_user):
        """
        Tests that forms are protected by CSRF tokens.
        This test assumes WTF_CSRF_ENABLED is True in the testing config.
        """
        # Enable CSRF protection for this test
        client.application.config['WTF_CSRF_ENABLED'] = True
        
        with client:
            # We don't log in here, as we want to test the CSRF protection
            # on a form that requires it. The login form itself is often
            # exempt from CSRF, but actions after login should be protected.
            
            # Attempt to post to a protected endpoint without a CSRF token
            response = client.post('/add_log', data={
                'pouch_id': 1,
                'quantity': 1,
                'log_time': '2023-01-01T12:00'
            })

            # A missing or invalid CSRF token should result in a 400 Bad Request
            assert response.status_code == 400
            assert b'CSRF token missing' in response.data or b'The CSRF token is missing.' in response.data

        # Disable CSRF protection again to not affect other tests
        client.application.config['WTF_CSRF_ENABLED'] = False
