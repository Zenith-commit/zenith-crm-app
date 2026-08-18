-- One-off migration run manually in the Supabase SQL Editor against the
-- live project on 2026-08-19, dropping the unused job_costs table.
--
-- job_costs was created in Day 1-2 around a receipt-OCR auto-extraction
-- feature that was scoped out (workers send receipts via WhatsApp instead).
-- It was never read or written by the app. Real per-job costing is handled
-- by job_line_items / bundles / bundle_items, built and verified live as
-- part of the Job Billing Integration feature. Confirmed empty (row_count
-- = 0) and unreferenced by any other table's foreign keys before dropping.
--
-- Dropping the table also drops its RLS policies and enable-RLS setting
-- automatically -- no separate policy cleanup needed.
--
-- supabase/schema/004_job_costs.sql and supabase/policies/005_job_costs_policies.sql
-- have been deleted from the fresh-install sequence to match -- a fresh
-- install should no longer create this table at all.

drop table public.job_costs;
