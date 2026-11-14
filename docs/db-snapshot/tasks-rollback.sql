-- Откат этапа «Задания»: функции и таблица (вместе с данными заданий; запись аудита остаётся в audit_log).
drop function if exists task_create(int, date, text, text, date);
drop function if exists task_set_status(bigint, text);
drop function if exists task_delete(bigint);
drop table if exists tasks;
