-- 2026-09-21_create_schedule_entry_completed.sql
-- Adds an explicit Completed branch to create_schedule_entry(): a booking on a
-- Completed job (a warranty / return visit) is a directly-confirmed work entry
-- and never changes jobs.status. Same signature as before, so
-- create or replace is safe to run as-is.

create or replace function public.create_schedule_entry(
  target_job_id uuid,
  target_technician_id uuid,
  target_date date,
  target_start time,
  target_end time
)
returns public.schedule_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
  job_status public.job_status;
  has_confirmed_work boolean;
  new_entry_type public.schedule_entry_type;
  new_status public.schedule_entry_status;
  result public.schedule_entries;
begin
  select status into job_status from public.jobs where id = target_job_id;

  if job_status = 'Quote' then
    new_entry_type := 'inspection';
    new_status := 'confirmed';
  elsif job_status = 'Completed' then
    new_entry_type := 'work';
    new_status := 'confirmed';
  else
    new_entry_type := 'work';
    select exists (
      select 1 from public.schedule_entries
      where job_id = target_job_id and entry_type = 'work' and status = 'confirmed'
    ) into has_confirmed_work;
    new_status := case when has_confirmed_work then 'confirmed' else 'tentative' end;
  end if;

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (target_job_id, target_technician_id, new_entry_type, new_status, target_date, target_start, target_end, auth.uid())
  returning * into result;

  if new_entry_type = 'work' and new_status = 'confirmed' and job_status = 'Work Order' then
    update public.jobs set status = 'Scheduled' where id = target_job_id;
  end if;

  return result;
end;
$$;

comment on function public.create_schedule_entry(uuid, uuid, date, time, time) is 'Creates one schedule_entries row. Quote-stage jobs always get a directly-confirmed inspection entry. Completed jobs (e.g. a warranty return visit) get a directly-confirmed work entry and their status is left as Completed. Work-Order/Scheduled-stage jobs get a tentative work entry, unless the job already has a confirmed work entry (a second/third day), in which case the new entry is also directly confirmed. A directly-confirmed work entry on a Work-Order-stage job advances jobs.status to Scheduled.';
