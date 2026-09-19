alter table public.platform_auth_flows
  drop column if exists transient_ciphertext,
  drop column if exists transient_iv,
  drop column if exists transient_key_version;