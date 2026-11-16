-- Этап 2b, шаг stage0d: ТОЛЬКО ЧТЕНИЕ (один SELECT, ничего не меняет). Rollback не нужен.
-- Выдаёт с prod тексты функций post_move, post_document, _insert_move, _bal,
-- trg_guard_unit_tracked_moves: все перегрузки, по 40 строк на строку результата.
-- Строка chunk = 0 содержит контрольные данные (md5 полного текста, число строк, права).
-- Пришлите результат ЦЕЛИКОМ, без сокращений и пересказа, в порядке proname, args, chunk.
with f as (
  select p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_functiondef(p.oid) as def,
         p.prosecdef,
         coalesce(array_to_string(p.proconfig, ','), '') as cfg,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
  from pg_proc p
  join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public'
    and p.proname in ('post_move', 'post_document', '_insert_move', '_bal', 'trg_guard_unit_tracked_moves')
),
ln as (
  select f.proname, f.args, t.n, t.line
  from f, lateral regexp_split_to_table(f.def, E'\n') with ordinality as t(line, n)
)
select proname, args, chunk, body from (
  select proname, args, 0 as chunk,
         'md5=' || md5(def)
         || ' chars=' || length(def)
         || ' lines=' || (length(def) - length(replace(def, E'\n', '')) + 1)
         || ' secdef=' || prosecdef
         || ' cfg=' || cfg
         || ' anon_exec=' || anon_exec
         || ' auth_exec=' || auth_exec as body
  from f
  union all
  select proname, args, 1 + ((n - 1) / 40) as chunk, string_agg(line, E'\n' order by n) as body
  from ln
  group by proname, args, 1 + ((n - 1) / 40)
) r
order by proname, args, chunk;
