-- The document transfer tables are deliberately small and user-scoped.
-- Keep only primary/unique indexes required by their constraints; no secondary
-- write-amplifying indexes are needed for the current access patterns.

drop index if exists public.application_document_transfers_user_idx;
drop index if exists public.application_document_transfers_remote_idx;
drop index if exists public.application_document_packages_user_idx;
