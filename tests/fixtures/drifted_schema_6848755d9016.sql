-- drifted_schema_6848755d9016.sql
--
-- Fixed synthetic fixture: stamped 6848755d9016 with DELIBERATE schema drift.
-- The user-side preference columns (user.units_preference,
-- user.preferred_brands) are already removed and notification_channel is
-- already JSON, but user_preferences.units_preference and
-- user_preferences.preferred_brands were never created — the data move that
-- 6848755d9016 should have performed never happened. The reconciliation
-- revision must recreate and default these columns, and the repaired
-- historical revisions must tolerate this shape.
--
-- Every row is fixed synthetic data (reserved domain example.invalid,
-- placeholder password hash). No instance database was copied, dumped,
-- mutated, or exported to create this file.

CREATE TABLE alembic_version (
	version_num VARCHAR(32) NOT NULL,
	CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Post-684... user shape: preference columns already removed.
CREATE TABLE "user" (
	id INTEGER NOT NULL,
	email VARCHAR(120) NOT NULL,
	password_hash VARCHAR(128) NOT NULL,
	created_at DATETIME,
	age INTEGER,
	gender VARCHAR(20),
	weight FLOAT,
	email_verified BOOLEAN,
	timezone VARCHAR(50),
	PRIMARY KEY (id)
);

CREATE TABLE pouch (
	id INTEGER NOT NULL,
	brand VARCHAR(80) NOT NULL,
	nicotine_mg INTEGER NOT NULL,
	is_default BOOLEAN,
	created_by INTEGER,
	created_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(created_by) REFERENCES "user" (id)
);

-- Post-f8... notification_channel (JSON), but the 684... target columns
-- units_preference and preferred_brands are deliberately MISSING.
CREATE TABLE user_preferences (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	goal_notifications BOOLEAN NOT NULL,
	daily_reminders BOOLEAN NOT NULL,
	weekly_reports BOOLEAN NOT NULL,
	achievement_notifications BOOLEAN NOT NULL,
	discord_webhook TEXT,
	slack_webhook TEXT,
	reminder_time TIME,
	quiet_hours_start TIME,
	quiet_hours_end TIME,
	notification_frequency VARCHAR(20) NOT NULL,
	daily_reset_time TIME,
	notification_channel JSON DEFAULT '["email"]' NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (user_id),
	FOREIGN KEY(user_id) REFERENCES "user" (id)
);

CREATE TABLE "log" (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	log_date DATE NOT NULL,
	log_time DATETIME NOT NULL,
	created_at DATETIME,
	pouch_id INTEGER,
	custom_brand VARCHAR(80),
	custom_nicotine_mg INTEGER,
	quantity INTEGER NOT NULL,
	notes TEXT,
	PRIMARY KEY (id),
	FOREIGN KEY(pouch_id) REFERENCES pouch (id),
	FOREIGN KEY(user_id) REFERENCES "user" (id)
);

CREATE TABLE craving (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	craving_time DATETIME NOT NULL,
	intensity INTEGER NOT NULL,
	"trigger" VARCHAR(100),
	notes TEXT,
	duration_minutes INTEGER,
	physical_symptoms TEXT,
	situation_context TEXT,
	outcome VARCHAR(50),
	outcome_notes TEXT,
	mood_before INTEGER,
	mood_after INTEGER,
	stress_level INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES "user" (id)
);

CREATE TABLE notification_queue (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	notification_type VARCHAR(50) NOT NULL,
	category VARCHAR(50) NOT NULL,
	subject VARCHAR(255),
	message TEXT NOT NULL,
	recipient VARCHAR(255) NOT NULL,
	scheduled_for DATETIME NOT NULL,
	created_at DATETIME NOT NULL,
	status VARCHAR(20) NOT NULL,
	attempts INTEGER NOT NULL,
	max_attempts INTEGER NOT NULL,
	last_attempt_at DATETIME,
	error_message TEXT,
	priority INTEGER NOT NULL,
	extra_data JSON,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES "user" (id)
);

CREATE TABLE goal (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	created_at DATETIME,
	updated_at DATETIME,
	goal_type VARCHAR(20),
	target_value INTEGER NOT NULL,
	current_streak INTEGER,
	best_streak INTEGER,
	start_date DATE,
	end_date DATE,
	is_active BOOLEAN,
	enable_notifications BOOLEAN,
	notification_threshold FLOAT,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES "user" (id)
);

CREATE TABLE email_verifications (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	token VARCHAR(100) NOT NULL,
	created_at DATETIME NOT NULL,
	expires_at DATETIME NOT NULL,
	verified_at DATETIME,
	is_verified BOOLEAN NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES "user" (id)
);

CREATE TABLE password_resets (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	token VARCHAR(100) NOT NULL,
	created_at DATETIME NOT NULL,
	expires_at DATETIME NOT NULL,
	used_at DATETIME,
	is_used BOOLEAN NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES "user" (id)
);

CREATE TABLE notification_history (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	notification_type VARCHAR(50) NOT NULL,
	category VARCHAR(50) NOT NULL,
	subject VARCHAR(255),
	recipient VARCHAR(255) NOT NULL,
	sent_at DATETIME NOT NULL,
	delivery_status VARCHAR(20) NOT NULL,
	attempts_made INTEGER NOT NULL,
	original_queue_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES "user" (id)
);

CREATE TABLE user_activity (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	activity_type VARCHAR(50) NOT NULL,
	created_at DATETIME NOT NULL,
	status VARCHAR(20) NOT NULL,
	extra_data JSON,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES "user" (id)
);

CREATE TABLE user_settings (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	default_view VARCHAR(20) NOT NULL,
	chart_theme VARCHAR(20) NOT NULL,
	logs_per_page INTEGER NOT NULL,
	date_format VARCHAR(20) NOT NULL,
	time_format VARCHAR(10) NOT NULL,
	show_weekly_summary BOOLEAN NOT NULL,
	show_monthly_summary BOOLEAN NOT NULL,
	show_goal_progress BOOLEAN NOT NULL,
	show_recent_logs BOOLEAN NOT NULL,
	default_chart_period VARCHAR(20) NOT NULL,
	chart_animation BOOLEAN NOT NULL,
	show_trend_lines BOOLEAN NOT NULL,
	show_nicotine_content BOOLEAN NOT NULL,
	show_brand_info BOOLEAN NOT NULL,
	compact_view BOOLEAN NOT NULL,
	hide_sensitive_data BOOLEAN NOT NULL,
	anonymous_mode BOOLEAN NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES "user" (id),
	UNIQUE (user_id)
);

CREATE UNIQUE INDEX ix_email_verifications_token ON email_verifications (token);
CREATE UNIQUE INDEX ix_password_resets_token ON password_resets (token);
CREATE UNIQUE INDEX ix_user_email ON "user" (email);

-- Fixed synthetic manifest (post-f8... channel representation) --------------

INSERT INTO "user" (id, email, password_hash, created_at, age, gender, weight, email_verified, timezone) VALUES
  (1, 'synthetic-alice@example.invalid', 'synthetic-only-not-a-real-password-hash', '2025-01-05 08:00:00.000000', NULL, NULL, NULL, 1, 'UTC'),
  (2, 'synthetic-bob@example.invalid', 'synthetic-only-not-a-real-password-hash', '2025-01-05 08:00:00.000000', NULL, NULL, NULL, 1, 'UTC'),
  (3, 'synthetic-carol@example.invalid', 'synthetic-only-not-a-real-password-hash', '2025-01-05 08:00:00.000000', NULL, NULL, NULL, 1, 'UTC'),
  (4, 'synthetic-dave@example.invalid', 'synthetic-only-not-a-real-password-hash', '2025-01-05 08:00:00.000000', NULL, NULL, NULL, 1, 'UTC');

INSERT INTO pouch (id, brand, nicotine_mg, is_default, created_by, created_at) VALUES
  (1, 'SYNTH-Pouch', 1.5, 0, 1, '2025-01-05 08:00:00.000000'),
  (2, 'SYNTH-Default', 3, 1, NULL, '2025-01-05 08:00:00.000000');

INSERT INTO user_preferences (user_id, created_at, updated_at, goal_notifications, daily_reminders, weekly_reports, achievement_notifications, discord_webhook, slack_webhook, reminder_time, quiet_hours_start, quiet_hours_end, notification_frequency, daily_reset_time, notification_channel) VALUES
  (1, '2025-01-05 08:00:00.000000', '2025-01-05 08:00:00.000000', 1, 0, 0, 1, NULL, NULL, NULL, NULL, NULL, 'immediate', NULL, '["email"]'),
  (2, '2025-01-05 08:00:00.000000', '2025-01-05 08:00:00.000000', 1, 0, 0, 1, NULL, NULL, NULL, NULL, NULL, 'immediate', NULL, '["discord"]'),
  (3, '2025-01-05 08:00:00.000000', '2025-01-05 08:00:00.000000', 1, 0, 0, 1, NULL, NULL, NULL, NULL, NULL, 'immediate', NULL, '["email", "discord"]'),
  (4, '2025-01-05 08:00:00.000000', '2025-01-05 08:00:00.000000', 1, 0, 0, 1, NULL, NULL, NULL, NULL, NULL, 'immediate', NULL, '[]');

INSERT INTO "log" (id, user_id, log_date, log_time, created_at, pouch_id, custom_brand, custom_nicotine_mg, quantity, notes) VALUES
  (1, 1, '2025-01-05', '2025-01-05 12:00:00.000000', '2025-01-05 12:00:00.000000', 1, NULL, NULL, 2, 'synthetic log via pouch'),
  (2, 1, '2025-01-05', '2025-01-05 12:00:00.000000', '2025-01-05 12:00:00.000000', NULL, 'SYNTH-Custom', 6, 1, 'synthetic custom log'),
  (3, 1, '2025-01-05', '2025-01-05 12:00:00.000000', '2025-01-05 12:00:00.000000', NULL, NULL, NULL, 1, 'synthetic unknown-strength log');

INSERT INTO craving (id, user_id, craving_time, intensity, "trigger", notes, duration_minutes, physical_symptoms, situation_context, outcome, outcome_notes, mood_before, mood_after, stress_level) VALUES
  (1, 1, '2025-01-05 09:30:00.000000', 7, 'synthetic-stress', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO notification_queue (id, user_id, notification_type, category, subject, message, recipient, scheduled_for, created_at, status, attempts, max_attempts, last_attempt_at, error_message, priority, extra_data) VALUES
  (1, 1, 'email', 'daily_reminder', 'synthetic subject', 'synthetic message', 'synthetic-alice@example.invalid', '2025-01-06 08:00:00.000000', '2025-01-05 08:00:00.000000', 'pending', 0, 3, NULL, NULL, 5, NULL);

INSERT INTO goal (id, user_id, created_at, updated_at, goal_type, target_value, current_streak, best_streak, start_date, end_date, is_active, enable_notifications, notification_threshold) VALUES
  (1, 1, '2025-01-05 08:00:00.000000', '2025-01-05 08:00:00.000000', 'daily_pouches', 5, 0, 0, '2025-01-01', NULL, 1, 1, 0.8);

INSERT INTO alembic_version (version_num) VALUES ('6848755d9016');
