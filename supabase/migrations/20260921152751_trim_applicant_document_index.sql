-- Keep only the user-scoped access index; selected documents are few per applicant.

drop index if exists public.applicant_documents_selected_idx;
