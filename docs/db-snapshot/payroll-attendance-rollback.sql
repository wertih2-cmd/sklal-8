-- Откат payroll-attendance.sql. ВНИМАНИЕ: удаляет все отметки посещаемости, ставки, снимки закрытых месяцев и журнал.
-- Перед откатом сделайте резервную копию этих таблиц.
drop view if exists staff_directory;
drop function if exists attendance_clear(date, int, boolean);
drop function if exists attendance_mark(date, int, text, numeric, boolean, text, boolean);
drop function if exists payroll_reopen(date, text);
drop function if exists payroll_close(date, boolean);
drop function if exists payroll_month_is_closed(date);
drop function if exists payroll_report(date);
drop function if exists _payroll_control(date);
drop function if exists _payroll_calc(date);
drop table if exists payroll_lines;
drop table if exists payroll_month_log;
drop table if exists payroll_months;
drop table if exists attendance;
drop table if exists payroll_adjustments;
drop table if exists cleaning_bonus_coef;
drop table if exists cleaning_bonus_rates;
drop table if exists payroll_settings;
drop function if exists trg_payroll_closed_guard();
drop function if exists _payroll_month_closed(date);
