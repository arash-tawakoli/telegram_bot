alter table public.platform_auth_flows
  add column if not exists transient_ciphertext text,
  add column if not exists transient_iv text,
  add column if not exists transient_key_version smallint not null default 1 check (transient_key_version > 0);

comment on column public.platform_auth_flows.transient_ciphertext is 'Encrypted ephemeral provider authentication state such as MFA transaction tokens; cleared when the auth flow is consumed.';
comment on column public.platform_auth_flows.transient_iv is 'AES-GCM IV for transient_ciphertext.';
comment on column public.platform_auth_flows.transient_key_version is 'Encryption key version used for transient_ciphertext.';
