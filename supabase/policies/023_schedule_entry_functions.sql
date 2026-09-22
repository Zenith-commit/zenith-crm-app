-- Inserts one schedule_entries row, deciding entry_type and initial status
-- from the job's current state. This is the single place that owns the
-- "tentative unless the job already has a confirmed entry of the same
-- type" rule -- symmetric for inspection and work -- so callers never
-- have to duplicate it. Completed jobs (warranty/return visits) are the
-- one deliberate exception: always a directly-confirmed work entry.
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
  has_confirmed_inspection boolean;
  has_confirmed_work boolean;
  new_entry_type public.schedule_entry_type;
  new_status public.schedule_entry_status;
  result public.schedule_entries;
begin
  select status into job_status from public.jobs where id = target_job_id;

  if job_status = 'Quote' then
    new_entry_type := 'inspection';
    select exists (
      select 1 from public.schedule_entries
      where job_id = target_job_id and entry_type = 'inspection' and status = 'confirmed'
    ) into has_confirmed_inspection;
    new_status := case when has_confirmed_inspection then 'confirmed' else 'tentative' end;
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

comment on function public.create_schedule_entry(uuid, uuid, date, time, time) is 'Creates one schedule_entries row. Quote-stage jobs get a tentative inspection entry, unless the job already has a confirmed inspection entry, in which case the new entry is directly confirmed -- symmetric with the Work-Order/Scheduled rule below. Completed jobs (e.g. a warranty return visit) get a directly-confirmed work entry and their status is left as Completed. Work-Order/Scheduled-stage jobs get a tentative work entry, unless the job already has a confirmed work entry (a second/third day), in which case the new entry is also directly confirmed. A directly-confirmed work entry on a Work-Order-stage job advances jobs.status to Scheduled.';

-- Promotes one tentative entry (work OR inspection) to confirmed and drops
-- every other tentative entry of the SAME entry_type for the same job (the
-- "pick one, drop the rest" rule) -- a tentative work hold and a tentative
-- inspection candidate never affect each other. Guard: only ever applies to
-- status=tentative rows; confirming an already-confirmed row or a bad id
-- raises rather than silently doing nothing. jobs.status only ever advances
-- Work Order -> Scheduled off a WORK confirm -- an inspection confirm never
-- touches jobs.status, matching create_schedule_entry()'s Quote branch,
-- which never changes jobs.status either.
create or replace function public.confirm_schedule_entry(target_entry_id uuid)
returns public.schedule_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
  job_status public.job_status;
  result public.schedule_entries;
begin
  update public.schedule_entries
  set status = 'confirmed'
  where id = target_entry_id and status = 'tentative'
  returning * into result;

  if result.id is null then
    raise exception 'schedule entry % is not a tentative entry', target_entry_id;
  end if;

  delete from public.schedule_entries
  where job_id = result.job_id
    and entry_type = result.entry_type
    and status = 'tentative'
    and id != target_entry_id;

  select status into job_status from public.jobs where id = result.job_id;
  if result.entry_type = 'work' and job_status = 'Work Order' then
    update public.jobs set status = 'Scheduled' where id = result.job_id;
  end if;

  return result;
end;
$$;

comment on function public.confirm_schedule_entry(uuid) is 'Promotes one tentative entry (work or inspection) to confirmed, deletes every other tentative entry of the SAME entry_type for the same job, and advances jobs.status Work Order -> Scheduled if the confirmed entry is a work entry and the job has not already moved past Work Order. Raises if the target row is not a tentative entry.';

-- Deletes one entry and, if it was a job's last remaining confirmed work
-- entry, reverts jobs.status Scheduled -> Work Order. A no-op (not an
-- error) if the caller's RLS doesn't let the delete match any row --
-- same fail-closed shape as apply_bundle_to_job()'s silent-null pattern.
create or replace function public.remove_schedule_entry(target_entry_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  removed public.schedule_entries;
  remaining_confirmed_work boolean;
  job_status public.job_status;
begin
  delete from public.schedule_entries where id = target_entry_id returning * into removed;

  if removed.entry_type = 'work' and removed.status = 'confirmed' then
    select exists (
      select 1 from public.schedule_entries
      where job_id = removed.job_id and entry_type = 'work' and status = 'confirmed'
    ) into remaining_confirmed_work;

    if not remaining_confirmed_work then
      select status into job_status from public.jobs where id = removed.job_id;
      if job_status = 'Scheduled' then
        update public.jobs set status = 'Work Order' where id = removed.job_id;
      end if;
    end if;
  end if;
end;
$$;

comment on function public.remove_schedule_entry(uuid) is 'Deletes one schedule entry. If it was a job''s last remaining confirmed work entry and the job is still exactly Scheduled, reverts jobs.status to Work Order. Never touches jobs.status for an inspection entry, or for a job whose status has since moved past Scheduled (e.g. Completed).';
